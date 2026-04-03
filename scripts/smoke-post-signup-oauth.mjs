import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { firefox } from 'playwright';

import { ChatGPTAccountCreator } from '../chatgpt_account_creator.js';
import { createCLIProxyManagementClient } from '../cliproxy_management_client.js';
import { createPostSignupOAuthOrchestrator } from '../post_signup_oauth_orchestrator.js';
import {
    createCliproxyStubServer,
    writeEvidenceArtifact,
    writeEvidenceJson
} from '../tests/support/cliproxy_test_harness.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const defaultStubSnapshots = [
    {
        authFiles: [
            {
                provider: 'openai',
                path: '/durability/openai-before.json',
                size: 10,
                modifiedAt: '2026-04-03T00:00:00.000Z'
            }
        ]
    },
    {
        authFiles: [
            {
                provider: 'openai',
                path: '/durability/openai-before.json',
                size: 10,
                modifiedAt: '2026-04-03T00:00:00.000Z'
            },
            {
                provider: 'openai',
                path: '/durability/openai-after.json',
                size: 42,
                modifiedAt: '2026-04-03T00:01:00.000Z'
            }
        ]
    }
];
const stubState = 'stub smoke state+/=%25';
const stubAuthUrl = 'https://auth.openai.example/authorize?state=stub%20smoke%20state%2B%2F%3D%2525&code=super-secret';

function parseArgs(argv) {
    const flags = new Set(argv);
    const positional = argv.filter((value) => !value.startsWith('--'));
    return {
        stubServer: flags.has('--stub-server'),
        failureMode: flags.has('--failure-mode'),
        help: flags.has('--help') || flags.has('-h'),
        positional
    };
}

function printUsage() {
    console.log([
        'Usage:',
        '  node scripts/smoke-post-signup-oauth.mjs --stub-server',
        '  node scripts/smoke-post-signup-oauth.mjs --stub-server --failure-mode',
        '  node scripts/smoke-post-signup-oauth.mjs',
        '',
        'Modes:',
        '  --stub-server     Run deterministic integrated smoke flow against stubbed CLIProxy management endpoints.',
        '  --failure-mode    With --stub-server, force a terminal CLIProxy failure and require zero local persistence.',
        '  (no flag)         Run the real-mode smoke flow using config.json CLIProxy settings from the current workspace.'
    ].join('\n'));
}

function sanitizeConfigForEvidence(config) {
    return {
        ...config,
        cliproxy_management_key: config.cliproxy_management_key ? '[redacted]' : '',
        password: config.password ? '[redacted]' : null
    };
}

function sanitizeUrlOriginPath(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
        return null;
    }

    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return '[invalid-url]';
    }
}

function sanitizeRequestPath(requestPath) {
    if (typeof requestPath !== 'string' || requestPath.length === 0) {
        return requestPath;
    }

    try {
        const parsed = new URL(requestPath, 'http://cliproxy.local');
        if (parsed.searchParams.has('state')) {
            parsed.searchParams.set('state', '[redacted]');
        }
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return requestPath;
    }
}

function sanitizeHeadersForEvidence(headers = {}) {
    const sanitizedHeaders = { ...headers };
    if (typeof sanitizedHeaders.authorization === 'string') {
        sanitizedHeaders.authorization = '[redacted]';
    }
    if (typeof sanitizedHeaders['x-management-key'] === 'string') {
        sanitizedHeaders['x-management-key'] = '[redacted]';
    }
    return sanitizedHeaders;
}

function sanitizeRequestsForEvidence(requests = []) {
    return requests.map((request) => ({
        method: request.method,
        path: sanitizeRequestPath(request.path),
        headers: sanitizeHeadersForEvidence(request.headers)
    }));
}

function createFakePersistentContext() {
    const gotoCalls = [];
    return {
        gotoCalls,
        async newPage() {
            return {
                async goto(url, gotoOptions) {
                    gotoCalls.push({ url, gotoOptions });
                    return { url, gotoOptions };
                }
            };
        }
    };
}

async function createRealPersistentContext(config, tempDir) {
    const context = await firefox.launchPersistentContext(tempDir, {
        headless: config.headless !== false,
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ignoreHTTPSErrors: true,
        timeout: config.timeout ?? 30000
    });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    const gotoCalls = [];
    const originalNewPage = context.newPage.bind(context);

    async function instrumentPage(targetPage) {
        const originalGoto = targetPage.goto.bind(targetPage);
        targetPage.goto = async (url, gotoOptions) => {
            gotoCalls.push({ url, gotoOptions });
            return originalGoto(url, gotoOptions);
        };
        return targetPage;
    }

    context.gotoCalls = gotoCalls;
    context.newPage = async (...args) => instrumentPage(await originalNewPage(...args));

    return { context, page };
}

function createBaseConfig(overrides = {}) {
    return {
        max_workers: 1,
        headless: true,
        slow_mo: 0,
        timeout: 30000,
        password: 'example-password-123',
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: '',
        cliproxy_management_key: 'management-secret-key',
        cliproxy_management_auth_mode: 'bearer',
        cliproxy_poll_interval_ms: 10,
        cliproxy_poll_timeout_ms: 2000,
        ...overrides
    };
}

function readAccountsFile(accountsFile) {
    return fs.existsSync(accountsFile) ? fs.readFileSync(accountsFile, 'utf8') : '';
}

function redactTotpSecrets(value) {
    if (typeof value !== 'string' || value.length === 0) {
        return value;
    }

    return value.replace(/\|([^|\n]{8,})(?=\n|$)/g, '|[redacted]');
}

async function withTempWorkspace(config, callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-post-signup-oauth-'));
    const originalCwd = process.cwd();

    try {
        process.chdir(tempDir);
        fs.writeFileSync(path.join(tempDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        return await callback(tempDir);
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function withRealWorkspace(config, callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-post-signup-oauth-real-'));
    const originalCwd = process.cwd();
    let browserContext = null;

    try {
        process.chdir(tempDir);
        fs.writeFileSync(path.join(tempDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        const browser = await createRealPersistentContext(config, path.join(tempDir, 'browser-profile'));
        browserContext = browser.context;
        return await callback({ tempDir, context: browser.context, page: browser.page });
    } finally {
        if (browserContext) {
            await browserContext.close();
        }
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function runFinalizeFlow({ tempDir, config, managementClient, modeName, creator = null, context = null, page = null, setup2FAImpl = null, logImpl = null, takeDebugScreenshotImpl = null, orchestratorFactory = null }) {
    const runtimeCreator = creator ?? new ChatGPTAccountCreator();
    const events = [];
    const runtimeContext = context ?? createFakePersistentContext();
    const runtimePage = page ?? { sentinel: 'chatgpt-page' };
    const orchestrator = createPostSignupOAuthOrchestrator(config, {
        managementClient,
        logger: (message) => runtimeCreator.log(`[CLIProxy OAuth] ${message}`),
        sleepImpl: async () => {}
    });

    runtimeCreator.accountsFile = path.join(tempDir, 'accounts.txt');
    runtimeCreator.config = {
        ...runtimeCreator.config,
        ...config
    };
    runtimeCreator.takeDebugScreenshot = takeDebugScreenshotImpl ?? (async () => {});
    runtimeCreator.log = logImpl ?? ((message, level = 'INFO') => {
        events.push({ type: 'log', level, message: runtimeCreator.sanitizeLogMessage(message) });
    });
    runtimeCreator.setup2FA = setup2FAImpl ?? (async (pageValue, accountNumber) => {
        events.push({ type: 'setup2FA', accountNumber, pageSentinel: pageValue?.sentinel ?? null });
        return 'BASE32SECRETKEY1234';
    });
    runtimeCreator.createPostSignupOAuthOrchestrator = orchestratorFactory ?? (() => ({
        async run({ context: flowContext }) {
            events.push({ type: 'orchestrator-run', contextMatches: flowContext === runtimeContext, modeName });
            return orchestrator.run({ context: flowContext });
        }
    }));

    const success = await runtimeCreator.finalizeSuccessfulAccountCreation({
        page: runtimePage,
        context: runtimeContext,
        email: `${modeName}@example.com`,
        password: runtimeCreator.config.password,
        accountNumber: 1,
        currentUrl: 'https://chatgpt.com/'
    });

    return {
        success,
        events,
        config: sanitizeConfigForEvidence(runtimeCreator.config),
        accountsFilePath: runtimeCreator.accountsFile,
        accountsFileContents: redactTotpSecrets(readAccountsFile(runtimeCreator.accountsFile)),
        createdAccounts: runtimeCreator.createdAccounts.map((account) => ({
            ...account,
            password: account.password ? '[redacted]' : account.password,
            totpSecret: account.totpSecret ? '[redacted]' : account.totpSecret
        })),
        gotoCalls: runtimeContext.gotoCalls.map((call) => ({
            urlOriginPath: sanitizeUrlOriginPath(call.url),
            gotoOptions: call.gotoOptions
        }))
    };
}

async function runStubSmoke({ failureMode }) {
    const server = await createCliproxyStubServer({
        scenario: failureMode ? 'failure' : 'success',
        state: stubState,
        authUrl: stubAuthUrl,
        authFilesSnapshots: failureMode
            ? [defaultStubSnapshots[0], defaultStubSnapshots[0]]
            : defaultStubSnapshots
    });

    try {
        const config = createBaseConfig({
            cliproxy_base_url: server.baseUrl
        });

        const summary = await withTempWorkspace(config, async (tempDir) => {
            const managementClient = createCLIProxyManagementClient(config);
            return runFinalizeFlow({
                tempDir,
                config,
                managementClient,
                modeName: failureMode ? 'stub-failure' : 'stub-success'
            });
        });

        const evidencePayload = {
            mode: 'stub',
            failureMode,
            summary,
            requests: sanitizeRequestsForEvidence(server.requests)
        };

        const secrets = [config.password, config.cliproxy_management_key, stubAuthUrl, stubState, 'super-secret'];
        const evidenceSlug = failureMode ? 'task-7-smoke-error' : 'task-7-smoke';
        writeEvidenceJson(evidenceSlug, evidencePayload, {
            rootDir: repoRoot,
            secrets
        });

        if (failureMode) {
            assert.equal(summary.success, false, 'Failure-mode stub smoke must fail closed.');
            assert.equal(summary.accountsFileContents, '', 'Failure-mode stub smoke must not persist accounts.');
            assert.equal(summary.createdAccounts.length, 0, 'Failure-mode stub smoke must not record created accounts.');
            const failureLog = summary.events.find((event) => event.type === 'log' && /durability gate failed/i.test(event.message));
            assert.ok(failureLog, 'Failure-mode stub smoke must log the durability gate failure.');
            throw new Error('Stub smoke failure mode correctly failed closed with no persistence.');
        }

        assert.equal(summary.success, true, 'Stub smoke success mode must complete successfully.');
        assert.match(summary.accountsFileContents, /stub-success@example\.com\|example-password-123\|\[redacted\]/);
        assert.equal(summary.createdAccounts[0]?.totpSecret, '[redacted]');
        assert.equal(summary.createdAccounts.length, 1, 'Stub smoke success mode must persist exactly one account.');
        assert.equal(summary.gotoCalls.length, 1, 'Stub smoke success mode must open one provider handoff page.');
        console.log(`Smoke success evidence written to ${path.relative(repoRoot, path.join(repoRoot, '.sisyphus', 'evidence', `${evidenceSlug}.json`))}`);
    } finally {
        await server.close();
    }
}

async function runRealSmoke(options = {}) {
    const creator = options.creator ?? new ChatGPTAccountCreator();
    const config = creator.config;
    const evidenceSlug = 'task-7-smoke-real';
    const secrets = [config.password, config.cliproxy_management_key];
    const evidence = {
        mode: 'real',
        config: sanitizeConfigForEvidence(config)
    };

    if (config.cliproxy_enable_codex_oauth !== true) {
        throw new Error('Real smoke requires cliproxy_enable_codex_oauth=true in config.json.');
    }

    try {
        const managementClient = options.managementClient ?? createCLIProxyManagementClient(config);
        const useInjectedContext = Boolean(options.context || options.page || options.orchestratorFactory || options.setup2FAImpl || options.logImpl || options.takeDebugScreenshotImpl);
        const summary = useInjectedContext
            ? await withTempWorkspace(config, async (tempDir) => runFinalizeFlow({
                tempDir,
                config,
                managementClient,
                modeName: 'real-smoke',
                creator,
                context: options.context,
                page: options.page,
                setup2FAImpl: options.setup2FAImpl,
                logImpl: options.logImpl,
                takeDebugScreenshotImpl: options.takeDebugScreenshotImpl,
                orchestratorFactory: options.orchestratorFactory
            }))
            : await withRealWorkspace(config, async ({ tempDir, context, page }) => runFinalizeFlow({
                tempDir,
                config,
                managementClient,
                modeName: 'real-smoke',
                creator,
                context,
                page,
                setup2FAImpl: async () => null,
                takeDebugScreenshotImpl: async () => {}
            }));

        if (!summary.success) {
            throw new Error('CLIProxy confirmation missing for real smoke; integrated finalization flow did not complete successfully.');
        }

        evidence.result = {
            status: 'success',
            integratedFinalization: true,
            persistedAccounts: summary.createdAccounts.length,
            dedicatedPageHandoffCount: summary.gotoCalls.length
        };
        writeEvidenceJson(evidenceSlug, {
            ...evidence,
            summary
        }, {
            rootDir: repoRoot,
            secrets
        });
        console.log(`Real smoke evidence written to .sisyphus/evidence/${evidenceSlug}.json`);
    } catch (error) {
        evidence.result = {
            status: 'failure',
            error: error.message
        };
        writeEvidenceJson(evidenceSlug, {
            ...evidence
        }, {
            rootDir: repoRoot,
            secrets
        });
        throw error;
    }
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);

    if (args.help || args.positional.length > 0) {
        printUsage();
        process.exit(args.help ? 0 : 1);
    }

    try {
        if (args.stubServer) {
            await runStubSmoke({ failureMode: args.failureMode });
        } else {
            await runRealSmoke();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeEvidenceArtifact('task-7-smoke-last-error', `${message}\n`, {
            rootDir: repoRoot
        });
        console.error(message);
        process.exit(1);
    }
}

export {
    main,
    parseArgs,
    runRealSmoke,
    runStubSmoke,
    withTempWorkspace
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
