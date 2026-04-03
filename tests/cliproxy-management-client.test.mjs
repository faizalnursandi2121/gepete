import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createCLIProxyManagementClient,
    normalizeManagementAuthMode,
    normalizeManagementHeaders
} from '../cliproxy_management_client.js';

function createConfig(overrides = {}) {
    return {
        cliproxy_base_url: 'https://cliproxy.example.com/',
        cliproxy_management_key: 'management-secret-key',
        cliproxy_management_auth_mode: 'bearer',
        ...overrides
    };
}

function createJsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return JSON.stringify(body);
        }
    };
}

test('normalizeManagementAuthMode defaults to bearer', () => {
    assert.equal(normalizeManagementAuthMode({}), 'bearer');
    assert.equal(normalizeManagementAuthMode({ cliproxy_management_auth_mode: ' Bearer ' }), 'bearer');
});

test('normalizeManagementHeaders uses bearer mode by default', () => {
    const headers = normalizeManagementHeaders(createConfig());
    assert.deepEqual(headers, {
        authorization: 'Bearer management-secret-key'
    });
});

test('normalizeManagementHeaders falls back to x-management-key mode', () => {
    const headers = normalizeManagementHeaders(createConfig({
        cliproxy_management_auth_mode: 'x-management-key'
    }));

    assert.deepEqual(headers, {
        'x-management-key': 'management-secret-key'
    });
});

test('startCodexAuth calls documented endpoint and returns url and state', async () => {
    const calls = [];
    const client = createCLIProxyManagementClient(createConfig(), {
        fetch: async (url, options) => {
            calls.push({ url: String(url), options });
            return createJsonResponse(200, {
                url: 'https://auth.openai.example/authorize?state=opaque-state',
                state: 'opaque-state'
            });
        }
    });

    const result = await client.startCodexAuth();

    assert.deepEqual(result, {
        url: 'https://auth.openai.example/authorize?state=opaque-state',
        state: 'opaque-state'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://cliproxy.example.com/v0/management/codex-auth-url');
    assert.equal(calls[0].options.method, 'GET');
    assert.deepEqual(calls[0].options.headers, {
        accept: 'application/json',
        authorization: 'Bearer management-secret-key'
    });
});

test('startCodexAuth rejects malformed responses missing url or state', async () => {
    const client = createCLIProxyManagementClient(createConfig(), {
        fetch: async () => createJsonResponse(200, {
            url: 'https://auth.openai.example/authorize'
        })
    });

    await assert.rejects(
        () => client.startCodexAuth(),
        /response must include non-empty string url and state/
    );
});

test('getAuthStatus preserves exact state in polling request', async () => {
    const calls = [];
    const originalState = 'opaque state+/=%25';
    const client = createCLIProxyManagementClient(createConfig(), {
        fetch: async (url, options) => {
            calls.push({ url: String(url), options });
            return createJsonResponse(200, {
                status: 'pending',
                state: originalState
            });
        }
    });

    const result = await client.getAuthStatus(originalState);

    assert.deepEqual(result, {
        status: 'pending',
        state: originalState
    });
    assert.equal(calls.length, 1);
    const requestedUrl = new URL(calls[0].url);
    assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://cliproxy.example.com/v0/management/get-auth-status');
    assert.equal(requestedUrl.searchParams.get('state'), originalState);
});

test('getAuthFilesSnapshot uses read-only auth-files endpoint', async () => {
    const calls = [];
    const snapshot = {
        authFiles: [
            {
                provider: 'openai',
                path: '/durability/openai.json'
            }
        ]
    };
    const client = createCLIProxyManagementClient(createConfig({
        cliproxy_management_auth_mode: 'x-management-key'
    }), {
        fetch: async (url, options) => {
            calls.push({ url: String(url), options });
            return createJsonResponse(200, snapshot);
        }
    });

    const result = await client.getAuthFilesSnapshot();

    assert.deepEqual(result, snapshot);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://cliproxy.example.com/v0/management/auth-files');
    assert.deepEqual(calls[0].options.headers, {
        accept: 'application/json',
        'x-management-key': 'management-secret-key'
    });
});

test('management client surfaces HTTP failures with endpoint context', async () => {
    const client = createCLIProxyManagementClient(createConfig(), {
        fetch: async () => createJsonResponse(403, {
            error: 'forbidden'
        })
    });

    await assert.rejects(
        () => client.getAuthFilesSnapshot(),
        /CLIProxy management request failed for \/v0\/management\/auth-files: HTTP 403\. forbidden/
    );
});

test('management client rejects invalid JSON responses', async () => {
    const client = createCLIProxyManagementClient(createConfig(), {
        fetch: async () => ({
            ok: true,
            status: 200,
            async text() {
                return 'not json';
            }
        })
    });

    await assert.rejects(
        () => client.getAuthStatus('state-value'),
        /response was not valid JSON/
    );
});

test('management client rejects empty state for polling', async () => {
    const client = createCLIProxyManagementClient(createConfig(), {
        fetch: async () => createJsonResponse(200, { status: 'pending' })
    });

    await assert.rejects(
        () => client.getAuthStatus(''),
        /requires a non-empty state/
    );
});
