function getConfigValue(config, key, fallback = undefined) {
    if (!config || typeof config !== 'object') {
        return fallback;
    }

    return Object.hasOwn(config, key) ? config[key] : fallback;
}

function normalizeManagementBaseUrl(config) {
    const baseUrl = getConfigValue(config, 'cliproxy_base_url', '');

    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
        throw new Error('CLIProxy management client requires cliproxy_base_url.');
    }

    return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeManagementKey(config) {
    const managementKey = getConfigValue(config, 'cliproxy_management_key', '');

    if (typeof managementKey !== 'string' || managementKey.trim().length === 0) {
        throw new Error('CLIProxy management client requires cliproxy_management_key.');
    }

    return managementKey.trim();
}

function normalizeManagementAuthMode(config) {
    const authMode = getConfigValue(config, 'cliproxy_management_auth_mode', 'bearer');

    if (typeof authMode !== 'string' || authMode.trim().length === 0) {
        return 'bearer';
    }

    return authMode.trim().toLowerCase();
}

function normalizeManagementHeaders(config) {
    const managementKey = normalizeManagementKey(config);
    const authMode = normalizeManagementAuthMode(config);

    if (authMode === 'x-management-key') {
        return {
            'x-management-key': managementKey
        };
    }

    return {
        authorization: `Bearer ${managementKey}`
    };
}

async function parseManagementResponse(response, endpoint) {
    const text = await response.text();
    let body = null;

    if (text.length > 0) {
        try {
            body = JSON.parse(text);
        } catch {
            throw new Error(`CLIProxy management request failed for ${endpoint}: response was not valid JSON.`);
        }
    }

    if (!response.ok) {
        const detail = body && typeof body === 'object' && typeof body.error === 'string'
            ? ` ${body.error}`
            : '';
        throw new Error(`CLIProxy management request failed for ${endpoint}: HTTP ${response.status}.${detail}`);
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`CLIProxy management request failed for ${endpoint}: response body must be a JSON object.`);
    }

    return body;
}

function buildManagementUrl(baseUrl, endpoint, query = null) {
    const url = new URL(`${baseUrl}${endpoint}`);

    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        }
    }

    return url;
}

function createCLIProxyManagementClient(config, options = {}) {
    const baseUrl = normalizeManagementBaseUrl(config);
    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
        throw new Error('CLIProxy management client requires a fetch implementation.');
    }

    const headers = {
        accept: 'application/json',
        ...normalizeManagementHeaders(config)
    };

    async function getJson(endpoint, query = null) {
        const url = buildManagementUrl(baseUrl, endpoint, query);
        const response = await fetchImpl(url, {
            method: 'GET',
            headers
        });

        return parseManagementResponse(response, endpoint);
    }

    return {
        baseUrl,
        headers: { ...headers },

        async startCodexAuth() {
            const body = await getJson('/v0/management/codex-auth-url');

            if (typeof body.url !== 'string' || body.url.length === 0 || typeof body.state !== 'string' || body.state.length === 0) {
                throw new Error('CLIProxy management request failed for /v0/management/codex-auth-url: response must include non-empty string url and state.');
            }

            return {
                url: body.url,
                state: body.state
            };
        },

        async getAuthStatus(state) {
            if (typeof state !== 'string' || state.length === 0) {
                throw new Error('CLIProxy management client requires a non-empty state for /v0/management/get-auth-status.');
            }

            return getJson('/v0/management/get-auth-status', { state });
        },

        async getAuthFilesSnapshot() {
            return getJson('/v0/management/auth-files');
        }
    };
}

export {
    createCLIProxyManagementClient,
    normalizeManagementAuthMode,
    normalizeManagementHeaders
};
