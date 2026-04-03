import assert from 'node:assert/strict';
import test from 'node:test';

import { createCLIProxyManagementClient } from '../cliproxy_management_client.js';
import {
    createPostSignupOAuthOrchestrator,
    diffAuthFilesSnapshots,
    normalizeAuthFilesSnapshot,
    runPostSignupCodexOAuthOrchestrator,
    sanitizeProviderUrl
} from '../post_signup_oauth_orchestrator.js';
import {
    createCliproxyStubServer,
    writeEvidenceJson
} from './support/cliproxy_test_harness.mjs';

function createConfig(overrides = {}) {
    return {
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key',
        cliproxy_management_auth_mode: 'bearer',
        cliproxy_poll_interval_ms: 5,
        cliproxy_poll_timeout_ms: 20,
        ...overrides
    };
}

function createFakePersistentContext(options = {}) {
    const {
        gotoError = null,
        controls = []
    } = options;

    const pages = [{ kind: 'original-chatgpt-page' }];
    const gotoCalls = [];

    return {
        pages,
        gotoCalls,
        async newPage() {
            const page = {
                async goto(url, gotoOptions) {
                    gotoCalls.push({ url, gotoOptions });
                    if (gotoError) {
                        throw gotoError;
                    }

                    return {
                        url,
                        gotoOptions
                    };
                },
                getByRole(role, options = {}) {
                    const namePattern = options.name;
                    const matches = controls.filter((control) => {
                        if (control.role !== role) {
                            return false;
                        }

                        if (!namePattern) {
                            return true;
                        }

                        return namePattern instanceof RegExp
                            ? namePattern.test(control.label)
                            : control.label === namePattern;
                    });

                    return makeFakeLocator(matches);
                },
                locator(selector) {
                    const matches = controls.filter((control) => control.selector === selector);
                    return makeFakeLocator(matches);
                }
            };

            pages.push(page);
            return page;
        }
    };
}

function makeFakeLocator(matches) {
    return {
        async count() {
            return matches.length;
        },
        first() {
            return makeFakeElement(matches[0]);
        },
        nth(index) {
            return makeFakeElement(matches[index]);
        }
    };
}

function makeFakeElement(match) {
    return {
        async isVisible() {
            return Boolean(match?.visible);
        },
        async click() {
            if (match && typeof match.onClick === 'function') {
                await match.onClick();
            }
        },
        async textContent() {
            return match?.label ?? '';
        }
    };
}

function createStepClock(stepMs = 5) {
    let currentMs = 1000;

    return {
        now() {
            const value = currentMs;
            currentMs += stepMs;
            return value;
        }
    };
}

test('helpers normalize and diff auth-files snapshots without exposing raw payloads', () => {
    const pre = normalizeAuthFilesSnapshot({
        authFiles: [
            { provider: 'openai', path: '/auth/openai.json', size: 10, token: 'secret' },
            { provider: 'openai', path: '/auth/readme.txt' }
        ]
    });
    const post = normalizeAuthFilesSnapshot({
        authFiles: [
            { provider: 'openai', path: '/auth/openai.json', size: 11 },
            { provider: 'openai', path: '/auth/second.json', size: 5 }
        ]
    });

    assert.deepEqual(pre.jsonArtifactPaths, ['/auth/openai.json']);
    assert.equal(pre.totalFiles, 2);
    assert.equal(Object.hasOwn(pre.authFiles[0], 'token'), false);
    assert.deepEqual(diffAuthFilesSnapshots(pre, post), {
        changed: true,
        addedJsonPaths: ['/auth/second.json'],
        removedJsonPaths: [],
        changedJsonPaths: ['/auth/openai.json']
    });
    assert.equal(sanitizeProviderUrl('https://auth.openai.example/authorize?state=opaque-state'), 'https://auth.openai.example/authorize');
});

test('orchestrator completes success path with dedicated page, exact state polling, and durability diff metadata', async (t) => {
    const authFilesSnapshots = [
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

    const server = await createCliproxyStubServer({
        scenario: 'success',
        state: 'opaque state+/=%25',
        authUrl: 'https://auth.openai.example/authorize?state=opaque%20state%2B%2F%3D%2525'
    });
    t.after(() => server.close());

    const managementClient = createCLIProxyManagementClient(createConfig({
        cliproxy_base_url: server.baseUrl
    }), {
        fetch: async (url, options) => {
            if (String(url).includes('/v0/management/auth-files')) {
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify(authFilesSnapshots.shift());
                    }
                };
            }

            return fetch(url, options);
        }
    });

    const context = createFakePersistentContext();
    const logLines = [];
    const clock = createStepClock(5);
    const slept = [];

    const result = await runPostSignupCodexOAuthOrchestrator({
        context,
        managementClient,
        config: createConfig({
            cliproxy_base_url: server.baseUrl,
            cliproxy_poll_interval_ms: 5,
            cliproxy_poll_timeout_ms: 25
        }),
        logger: (message) => logLines.push(message),
        now: () => clock.now(),
        sleepImpl: async (ms) => {
            slept.push(ms);
        }
    });

    writeEvidenceJson('task-4-orchestrator', {
        result,
        requests: server.requests,
        logLines
    }, {
        secrets: ['management-secret-key', 'opaque state+/=%25', 'https://auth.openai.example/authorize?state=opaque%20state%2B%2F%3D%2525']
    });

    assert.equal(result.status, 'success');
    assert.equal(result.code, 'success');
    assert.equal(result.auth.status, 'success');
    assert.equal(result.auth.completed, true);
    assert.equal(result.auth.statePresent, true);
    assert.equal(result.browser.dedicatedPageOpened, true);
    assert.equal(result.browser.samePersistentContext, true);
    assert.equal(result.browser.providerUrl, 'https://auth.openai.example/authorize');
    assert.deepEqual(result.durability.addedJsonPaths, ['/durability/openai-after.json']);
    assert.equal(result.durability.changed, true);
    assert.equal(result.durability.preAuth.jsonArtifactCount, 1);
    assert.equal(result.durability.postAuth.jsonArtifactCount, 2);
    assert.equal(context.pages.length, 2);
    assert.equal(context.gotoCalls.length, 1);
    assert.equal(context.gotoCalls[0].url, 'https://auth.openai.example/authorize?state=opaque%20state%2B%2F%3D%2525');
    assert.deepEqual(server.requests.map((request) => request.path), [
        '/v0/management/codex-auth-url',
        '/v0/management/get-auth-status?state=opaque+state%2B%2F%3D%2525',
        '/v0/management/get-auth-status?state=opaque+state%2B%2F%3D%2525'
    ]);
    assert.equal(slept.length, 1);
    assert.equal(slept[0], 5);
    assert.match(logLines[0], /pre-auth auth-files snapshot/);
    assert.match(logLines[1], /dedicated page/);
});

test('orchestrator returns explicit failure when CLIProxy reports auth failure', async (t) => {
    const server = await createCliproxyStubServer({ scenario: 'failure' });
    t.after(() => server.close());

    const context = createFakePersistentContext();
    const managementClient = createCLIProxyManagementClient(createConfig({
        cliproxy_base_url: server.baseUrl
    }));

    const result = await runPostSignupCodexOAuthOrchestrator({
        context,
        managementClient,
        config: createConfig({
            cliproxy_base_url: server.baseUrl
        }),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'failure');
    assert.equal(result.code, 'auth_failed');
    assert.equal(result.auth.status, 'failed');
    assert.equal(result.auth.error, 'explicit failure');
    assert.equal(result.browser.dedicatedPageOpened, true);
    assert.equal(result.durability.preAuth.jsonArtifactCount, 1);
    assert.equal(result.durability.postAuth.jsonArtifactCount, 1);
    assert.equal(result.durability.confirmed, false);
});

test('orchestrator returns timeout when polling never reaches a terminal state', async (t) => {
    const server = await createCliproxyStubServer({ scenario: 'timeout' });
    t.after(() => server.close());

    const result = await runPostSignupCodexOAuthOrchestrator({
        context: createFakePersistentContext(),
        managementClient: createCLIProxyManagementClient(createConfig({
            cliproxy_base_url: server.baseUrl
        })),
        config: createConfig({
            cliproxy_base_url: server.baseUrl,
            cliproxy_poll_interval_ms: 5,
            cliproxy_poll_timeout_ms: 12
        }),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'timeout');
    assert.equal(result.code, 'auth_timeout');
    assert.equal(result.auth.status, 'timeout');
    assert.equal(result.pollCount, 2);
    assert.equal(result.browser.dedicatedPageOpened, true);
});

test('orchestrator fails closed on missing state without polling', async () => {
    const managementClient = {
        async getAuthFilesSnapshot() {
            return {
                authFiles: []
            };
        },
        async startCodexAuth() {
            return {
                url: 'https://auth.openai.example/authorize?state=should-not-be-used'
            };
        },
        async getAuthStatus() {
            throw new Error('poll should not be called');
        }
    };

    const result = await runPostSignupCodexOAuthOrchestrator({
        context: createFakePersistentContext(),
        managementClient,
        config: createConfig(),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'failure');
    assert.equal(result.code, 'missing_state');
    assert.equal(result.auth.statePresent, false);
    assert.equal(result.pollCount, 0);
    assert.equal(result.browser.dedicatedPageOpened, false);
});

test('orchestrator fails closed when polled state differs from the issued state', async () => {
    const managementClient = {
        async getAuthFilesSnapshot() {
            return {
                authFiles: [
                    { provider: 'openai', path: '/durability/openai.json' }
                ]
            };
        },
        async startCodexAuth() {
            return {
                url: 'https://auth.openai.example/authorize?state=opaque-state',
                state: 'opaque-state'
            };
        },
        async getAuthStatus(state) {
            assert.equal(state, 'opaque-state');
            return {
                status: 'pending',
                state: 'different-state'
            };
        }
    };

    const result = await runPostSignupCodexOAuthOrchestrator({
        context: createFakePersistentContext(),
        managementClient,
        config: createConfig(),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'failure');
    assert.equal(result.code, 'state_mismatch');
    assert.equal(result.auth.status, 'state-mismatch');
    assert.equal(result.pollCount, 1);
});

test('orchestrator returns deterministic browser handoff failure and redacts raw provider URL from details', async () => {
    const context = createFakePersistentContext({
        gotoError: new Error('navigation failed for https://auth.openai.example/authorize?state=opaque-state')
    });
    const managementClient = {
        async getAuthFilesSnapshot() {
            return {
                authFiles: [
                    { provider: 'openai', path: '/durability/openai.json' }
                ]
            };
        },
        async startCodexAuth() {
            return {
                url: 'https://auth.openai.example/authorize?state=opaque-state',
                state: 'opaque-state'
            };
        },
        async getAuthStatus() {
            throw new Error('poll should not be called');
        }
    };

    const result = await runPostSignupCodexOAuthOrchestrator({
        context,
        managementClient,
        config: createConfig(),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'failure');
    assert.equal(result.code, 'browser_handoff_failed');
    assert.equal(result.browser.dedicatedPageOpened, true);
    assert.equal(result.browser.providerUrl, 'https://auth.openai.example/authorize');
    assert.match(result.auth.error, /\[redacted\]/);
    assert.doesNotMatch(result.auth.error, /opaque-state/);
    assert.equal(result.pollCount, 0);
});

test('factory creates an orchestrator with injected management client seam', async () => {
    const calls = [];
    let snapshotCall = 0;
    const managementClient = {
        async getAuthFilesSnapshot() {
            calls.push('snapshot');
            snapshotCall += 1;
            return {
                authFiles: snapshotCall === 1
                    ? []
                    : [
                        {
                            provider: 'openai',
                            path: '/durability/openai-after.json',
                            size: 42
                        }
                    ]
            };
        },
        async startCodexAuth() {
            calls.push('start');
            return {
                url: 'https://auth.openai.example/authorize?state=opaque-state',
                state: 'opaque-state'
            };
        },
        async getAuthStatus() {
            calls.push('status');
            return {
                status: 'success',
                state: 'opaque-state'
            };
        }
    };

    const orchestrator = createPostSignupOAuthOrchestrator(createConfig(), {
        managementClient,
        now: createStepClock(5).now,
        sleepImpl: async () => {}
    });

    const result = await orchestrator.run({
        context: createFakePersistentContext()
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(calls, ['snapshot', 'start', 'status', 'snapshot']);
});

test('orchestrator fails closed when CLIProxy reports success but durability snapshot does not change', async () => {
    const calls = [];
    const managementClient = {
        async getAuthFilesSnapshot() {
            calls.push('snapshot');
            return {
                authFiles: [
                    { provider: 'openai', path: '/durability/openai.json', size: 10 }
                ]
            };
        },
        async startCodexAuth() {
            calls.push('start');
            return {
                url: 'https://auth.openai.example/authorize?state=opaque-state',
                state: 'opaque-state'
            };
        },
        async getAuthStatus() {
            calls.push('status');
            return {
                status: 'success',
                state: 'opaque-state'
            };
        }
    };

    const result = await runPostSignupCodexOAuthOrchestrator({
        context: createFakePersistentContext(),
        managementClient,
        config: createConfig(),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'failure');
    assert.equal(result.code, 'durability_not_confirmed');
    assert.equal(result.auth.status, 'success');
    assert.equal(result.auth.completed, true);
    assert.equal(result.durability.changed, false);
    assert.equal(result.durability.confirmed, false);
    assert.deepEqual(calls, ['snapshot', 'start', 'status', 'snapshot']);
});

test('orchestrator attempts to advance provider handoff while status remains pending', async () => {
    const clicks = [];
    const context = createFakePersistentContext({
        controls: [
            {
                role: 'button',
                label: 'Continue',
                visible: true,
                onClick: () => clicks.push('continue')
            }
        ]
    });

    const managementClient = {
        async getAuthFilesSnapshot() {
            return { authFiles: [] };
        },
        async startCodexAuth() {
            return {
                url: 'https://auth.openai.example/authorize?state=opaque-state',
                state: 'opaque-state'
            };
        },
        async getAuthStatus() {
            return {
                status: 'wait',
                state: 'opaque-state'
            };
        }
    };

    const result = await runPostSignupCodexOAuthOrchestrator({
        context,
        managementClient,
        config: createConfig({
            cliproxy_poll_interval_ms: 5,
            cliproxy_poll_timeout_ms: 12
        }),
        sleepImpl: async () => {},
        now: createStepClock(5).now
    });

    assert.equal(result.status, 'timeout');
    assert.equal(result.code, 'auth_timeout');
    assert.deepEqual(clicks, ['continue', 'continue']);
});
