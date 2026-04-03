import { createCLIProxyManagementClient } from './cliproxy_management_client.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 180000;

function getPositiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function redactSecrets(value, secrets = []) {
    if (typeof value !== 'string' || value.length === 0) {
        return value;
    }

    return secrets
        .filter((secret) => typeof secret === 'string' && secret.length > 0)
        .reduce((output, secret) => output.split(secret).join('[redacted]'), value);
}

function sanitizeErrorMessage(error, secrets = []) {
    if (error instanceof Error && typeof error.message === 'string') {
        return redactSecrets(error.message, secrets);
    }

    return redactSecrets(String(error), secrets);
}

function sanitizeProviderUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
        return null;
    }

    try {
        const parsedUrl = new URL(rawUrl);
        return `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
        return '[invalid-url]';
    }
}

function normalizeAuthFileEntry(entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`CLIProxy auth-files snapshot contained an invalid authFiles[${index}] entry.`);
    }

    const normalizedEntry = {};

    for (const key of ['provider', 'path', 'size', 'updatedAt', 'modifiedAt', 'mtime', 'sha256', 'id']) {
        const value = entry[key];
        if (['string', 'number', 'boolean'].includes(typeof value)) {
            normalizedEntry[key] = value;
        }
    }

    normalizedEntry.provider = typeof normalizedEntry.provider === 'string' ? normalizedEntry.provider : 'unknown';
    normalizedEntry.path = typeof normalizedEntry.path === 'string' ? normalizedEntry.path : `unknown-${index}`;
    normalizedEntry.isJsonArtifact = normalizedEntry.path.endsWith('.json');

    return normalizedEntry;
}

function normalizeAuthFilesSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('CLIProxy auth-files snapshot must be a JSON object.');
    }

    const rawAuthFiles = Array.isArray(snapshot.authFiles)
        ? snapshot.authFiles
        : Array.isArray(snapshot.files)
            ? snapshot.files
            : null;

    if (!Array.isArray(rawAuthFiles)) {
        throw new Error('CLIProxy auth-files snapshot must include an authFiles or files array.');
    }

    const authFiles = rawAuthFiles.map((entry, index) => normalizeAuthFileEntry(entry, index));
    const jsonArtifactPaths = authFiles
        .filter((entry) => entry.isJsonArtifact)
        .map((entry) => entry.path)
        .sort();

    return {
        totalFiles: authFiles.length,
        jsonArtifactCount: jsonArtifactPaths.length,
        jsonArtifactPaths,
        authFiles
    };
}

function diffAuthFilesSnapshots(preAuthSnapshot, postAuthSnapshot) {
    const preByPath = new Map(preAuthSnapshot.authFiles.map((entry) => [entry.path, JSON.stringify(entry)]));
    const postByPath = new Map(postAuthSnapshot.authFiles.map((entry) => [entry.path, JSON.stringify(entry)]));

    const addedJsonPaths = [];
    const removedJsonPaths = [];
    const changedJsonPaths = [];

    for (const entry of postAuthSnapshot.authFiles) {
        if (!entry.isJsonArtifact) {
            continue;
        }

        const before = preByPath.get(entry.path);
        const after = postByPath.get(entry.path);

        if (!before) {
            addedJsonPaths.push(entry.path);
            continue;
        }

        if (before !== after) {
            changedJsonPaths.push(entry.path);
        }
    }

    for (const entry of preAuthSnapshot.authFiles) {
        if (!entry.isJsonArtifact) {
            continue;
        }

        if (!postByPath.has(entry.path)) {
            removedJsonPaths.push(entry.path);
        }
    }

    addedJsonPaths.sort();
    removedJsonPaths.sort();
    changedJsonPaths.sort();

    return {
        changed: addedJsonPaths.length > 0 || removedJsonPaths.length > 0 || changedJsonPaths.length > 0,
        addedJsonPaths,
        removedJsonPaths,
        changedJsonPaths
    };
}

function hasDurabilityConfirmation(durabilityDiff) {
    return Boolean(
        durabilityDiff
        && (durabilityDiff.addedJsonPaths.length > 0 || durabilityDiff.changedJsonPaths.length > 0)
    );
}

function getNormalizedStatus(statusPayload) {
    if (typeof statusPayload?.status !== 'string') {
        return null;
    }

    const normalized = statusPayload.status.trim().toLowerCase();
    return normalized === 'wait' ? 'pending' : normalized;
}

function isTerminalFailureStatus(status) {
    return status === 'failed' || status === 'failure' || status === 'error';
}

async function runPostSignupCodexOAuthOrchestrator(options) {
    const {
        context,
        managementClient,
        config = {},
        logger = () => {},
        sleepImpl = sleep,
        now = () => Date.now(),
        gotoOptions = {
            waitUntil: 'domcontentloaded'
        }
    } = options ?? {};

    if (!context || typeof context.newPage !== 'function') {
        throw new Error('Post-signup Codex OAuth orchestrator requires a Playwright browser context with newPage().');
    }

    if (!managementClient || typeof managementClient.startCodexAuth !== 'function' || typeof managementClient.getAuthStatus !== 'function' || typeof managementClient.getAuthFilesSnapshot !== 'function') {
        throw new Error('Post-signup Codex OAuth orchestrator requires a CLIProxy management client with startCodexAuth(), getAuthStatus(), and getAuthFilesSnapshot().');
    }

    const pollIntervalMs = getPositiveInteger(config.cliproxy_poll_interval_ms, DEFAULT_POLL_INTERVAL_MS);
    const pollTimeoutMs = getPositiveInteger(config.cliproxy_poll_timeout_ms, DEFAULT_POLL_TIMEOUT_MS);
    const startedAtMs = now();

    let providerUrl = null;
    let attemptState = null;
    let dedicatedPageOpened = false;
    let pollCount = 0;
    let latestAuthStatus = 'not-started';
    let preAuthSnapshot = null;
    let postAuthSnapshot = null;
    let latestStatusPayload = null;

    const baseSecrets = [
        typeof config.cliproxy_management_key === 'string' ? config.cliproxy_management_key : null
    ];

    function buildResult(status, code, extra = {}) {
        const secrets = [...baseSecrets, providerUrl, attemptState];
        const browser = {
            dedicatedPageOpened,
            samePersistentContext: true,
            providerUrl: sanitizeProviderUrl(providerUrl)
        };

        const durabilityDiff = preAuthSnapshot && postAuthSnapshot
            ? diffAuthFilesSnapshots(preAuthSnapshot, postAuthSnapshot)
            : {
                changed: null,
                addedJsonPaths: [],
                removedJsonPaths: [],
                changedJsonPaths: []
            };

        const durability = {
            preAuth: preAuthSnapshot,
            postAuth: postAuthSnapshot,
            ...durabilityDiff,
            confirmed: hasDurabilityConfirmation(durabilityDiff)
        };

        return {
            status,
            code,
            provider: 'codex',
            startedAtMs,
            finishedAtMs: now(),
            pollIntervalMs,
            pollTimeoutMs,
            pollCount,
            browser,
            auth: {
                stateTracked: true,
                statePresent: typeof attemptState === 'string' && attemptState.length > 0,
                status: latestAuthStatus,
                lastResponseStatus: getNormalizedStatus(latestStatusPayload),
                ...(extra.authError
                    ? { error: redactSecrets(extra.authError, secrets) }
                    : {}),
                ...(extra.authContext ?? {})
            },
            durability,
            ...(extra.details
                ? {
                    details: redactSecrets(extra.details, secrets)
                }
                : {})
        };
    }

    async function captureSnapshot(which) {
        const snapshot = normalizeAuthFilesSnapshot(await managementClient.getAuthFilesSnapshot());
        logger(`Captured ${which} auth-files snapshot with ${snapshot.jsonArtifactCount} JSON artifacts.`);
        return snapshot;
    }

    async function capturePostSnapshotBestEffort() {
        try {
            postAuthSnapshot = await captureSnapshot('post-auth');
            return null;
        } catch (error) {
            return sanitizeErrorMessage(error, [...baseSecrets, providerUrl, attemptState]);
        }
    }

    try {
        preAuthSnapshot = await captureSnapshot('pre-auth');
    } catch (error) {
        return buildResult('failure', 'pre_auth_snapshot_failed', {
            authError: sanitizeErrorMessage(error, baseSecrets),
            details: 'Unable to capture the pre-auth CLIProxy auth-files snapshot before starting Codex OAuth.'
        });
    }

    let startResponse;
    try {
        startResponse = await managementClient.startCodexAuth();
    } catch (error) {
        const postSnapshotError = await capturePostSnapshotBestEffort();
        return buildResult('failure', 'start_auth_failed', {
            authError: sanitizeErrorMessage(error, baseSecrets),
            details: postSnapshotError
                ? `Starting Codex OAuth failed and post-auth snapshot capture also failed: ${postSnapshotError}`
                : 'Starting Codex OAuth through the CLIProxy management client failed.'
        });
    }

    providerUrl = typeof startResponse?.url === 'string' ? startResponse.url : null;
    attemptState = typeof startResponse?.state === 'string' ? startResponse.state : null;

    if (!attemptState) {
        const postSnapshotError = await capturePostSnapshotBestEffort();
        return buildResult('failure', 'missing_state', {
            details: postSnapshotError
                ? `CLIProxy start response was missing state and post-auth snapshot capture also failed: ${postSnapshotError}`
                : 'CLIProxy start response was missing the per-attempt OAuth state required for strict polling.'
        });
    }

    if (typeof providerUrl !== 'string' || providerUrl.length === 0) {
        const postSnapshotError = await capturePostSnapshotBestEffort();
        return buildResult('failure', 'malformed_start_response', {
            details: postSnapshotError
                ? `CLIProxy start response was missing the provider URL and post-auth snapshot capture also failed: ${postSnapshotError}`
                : 'CLIProxy start response was missing the provider URL required for browser handoff.'
        });
    }

    let providerPage;
    try {
        providerPage = await context.newPage();
        dedicatedPageOpened = true;
        await providerPage.goto(providerUrl, gotoOptions);
        logger(`Opened Codex OAuth handoff in a dedicated page for ${sanitizeProviderUrl(providerUrl)}.`);
    } catch (error) {
        const postSnapshotError = await capturePostSnapshotBestEffort();
        return buildResult('failure', 'browser_handoff_failed', {
            authError: sanitizeErrorMessage(error, [...baseSecrets, providerUrl, attemptState]),
            details: postSnapshotError
                ? `Opening the dedicated provider page failed and post-auth snapshot capture also failed: ${postSnapshotError}`
                : 'Opening the dedicated provider page in the existing persistent browser context failed.'
        });
    }

    const deadlineMs = startedAtMs + pollTimeoutMs;
    while (true) {
        pollCount += 1;

        try {
            latestStatusPayload = await managementClient.getAuthStatus(attemptState);
        } catch (error) {
            latestAuthStatus = 'poll-error';
            const postSnapshotError = await capturePostSnapshotBestEffort();
            return buildResult('failure', 'auth_status_poll_failed', {
                authError: sanitizeErrorMessage(error, [...baseSecrets, providerUrl, attemptState]),
                details: postSnapshotError
                    ? `Polling Codex OAuth status failed and post-auth snapshot capture also failed: ${postSnapshotError}`
                    : 'Polling Codex OAuth status through the CLIProxy management API failed.'
            });
        }

        const responseState = latestStatusPayload?.state;
        if (responseState !== undefined && responseState !== attemptState) {
            latestAuthStatus = 'state-mismatch';
            const postSnapshotError = await capturePostSnapshotBestEffort();
            return buildResult('failure', 'state_mismatch', {
                details: postSnapshotError
                    ? `CLIProxy status polling returned a different state and post-auth snapshot capture also failed: ${postSnapshotError}`
                    : 'CLIProxy status polling returned a different state than the one issued for this attempt.'
            });
        }

        const normalizedStatus = getNormalizedStatus(latestStatusPayload);
        latestAuthStatus = normalizedStatus ?? 'malformed-status';

        if (normalizedStatus === 'success') {
            try {
                postAuthSnapshot = await captureSnapshot('post-auth');
            } catch (error) {
                latestAuthStatus = 'success';
                return buildResult('failure', 'post_auth_snapshot_failed', {
                    authError: sanitizeErrorMessage(error, [...baseSecrets, providerUrl, attemptState]),
                    authContext: {
                        completed: true
                    },
                    details: 'Codex OAuth succeeded, but the post-auth CLIProxy auth-files snapshot could not be captured.'
                });
            }

            const durabilityDiff = diffAuthFilesSnapshots(preAuthSnapshot, postAuthSnapshot);
            if (!hasDurabilityConfirmation(durabilityDiff)) {
                return buildResult('failure', 'durability_not_confirmed', {
                    authContext: {
                        completed: true
                    },
                    details: 'Codex OAuth reached a success status, but CLIProxy auth-files did not show a new or changed JSON auth artifact for durable confirmation.'
                });
            }

            return buildResult('success', 'success', {
                authContext: {
                    completed: true
                }
            });
        }

        if (isTerminalFailureStatus(normalizedStatus)) {
            latestAuthStatus = 'failed';
            const postSnapshotError = await capturePostSnapshotBestEffort();
            return buildResult('failure', 'auth_failed', {
                authError: typeof latestStatusPayload?.error === 'string'
                    ? latestStatusPayload.error
                    : null,
                details: postSnapshotError
                    ? `CLIProxy reported explicit OAuth failure and post-auth snapshot capture also failed: ${postSnapshotError}`
                    : 'CLIProxy reported explicit OAuth failure for this Codex auth attempt.'
            });
        }

        if (normalizedStatus !== 'pending') {
            latestAuthStatus = 'malformed-status';
            const postSnapshotError = await capturePostSnapshotBestEffort();
            return buildResult('failure', 'malformed_status_response', {
                details: postSnapshotError
                    ? `CLIProxy returned an unrecognized OAuth status and post-auth snapshot capture also failed: ${postSnapshotError}`
                    : 'CLIProxy returned an unrecognized OAuth status while polling the preserved state.'
            });
        }

        if (now() >= deadlineMs) {
            latestAuthStatus = 'timeout';
            const postSnapshotError = await capturePostSnapshotBestEffort();
            return buildResult('timeout', 'auth_timeout', {
                details: postSnapshotError
                    ? `Codex OAuth timed out and post-auth snapshot capture also failed: ${postSnapshotError}`
                    : 'Codex OAuth polling timed out before CLIProxy reported success or failure.'
            });
        }

        const remainingMs = deadlineMs - now();
        await sleepImpl(Math.min(pollIntervalMs, remainingMs));
    }
}

function createPostSignupOAuthOrchestrator(config, dependencies = {}) {
    const managementClient = dependencies.managementClient
        ?? createCLIProxyManagementClient(config, { fetch: dependencies.fetch });

    return {
        async run(options = {}) {
            return runPostSignupCodexOAuthOrchestrator({
                ...dependencies,
                ...options,
                config,
                managementClient
            });
        }
    };
}

export {
    createPostSignupOAuthOrchestrator,
    diffAuthFilesSnapshots,
    normalizeAuthFilesSnapshot,
    runPostSignupCodexOAuthOrchestrator,
    sanitizeProviderUrl
};
