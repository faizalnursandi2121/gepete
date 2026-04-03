import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DEFAULT_AUTH_URL = 'https://auth.openai.example/authorize?state=opaque-state';
const DEFAULT_STATE = 'opaque-state';

function safeSlug(value) {
    return String(value)
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'artifact';
}

function toEvidenceDir(rootDir) {
    return path.resolve(rootDir, '.sisyphus', 'evidence');
}

export function ensureEvidenceDir(rootDir = process.cwd()) {
    const evidenceDir = toEvidenceDir(rootDir);
    fs.mkdirSync(evidenceDir, { recursive: true });
    return evidenceDir;
}

export function redactEvidence(value, secrets = []) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

    const variants = new Set();
    for (const secret of secrets) {
        if (typeof secret !== 'string' || secret.length === 0) {
            continue;
        }

        variants.add(secret);
        variants.add(encodeURIComponent(secret));

        try {
            const params = new URLSearchParams({ value: secret }).toString();
            variants.add(params.replace(/^value=/, ''));
        } catch {
            // Ignore encoding failures and keep raw redaction only.
        }
    }

    return [...variants].reduce((output, secret) => output.split(secret).join('[redacted]'), text);
}

export function writeEvidenceArtifact(slug, value, options = {}) {
    const {
        extension = '.txt',
        rootDir = process.cwd(),
        secrets = []
    } = options;

    const evidenceDir = ensureEvidenceDir(rootDir);
    const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
    const filePath = path.join(evidenceDir, `${safeSlug(slug)}${normalizedExtension}`);
    const payload = redactEvidence(value, secrets);

    fs.writeFileSync(filePath, payload, 'utf8');
    return filePath;
}

export function writeEvidenceJson(slug, value, options = {}) {
    return writeEvidenceArtifact(slug, `${JSON.stringify(value, null, 2)}\n`, {
        ...options,
        extension: '.json'
    });
}

function writeJson(res, statusCode, body) {
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(body));
}

function writeMalformedJson(res) {
    res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8'
    });
    res.end('{"status":"success"');
}

function routeKey(url) {
    return `${url.pathname}${url.search}`;
}

export async function createCliproxyStubServer(options = {}) {
    const {
        scenario = 'success',
        malformedEndpoint = 'start',
        authUrl = DEFAULT_AUTH_URL,
        state = DEFAULT_STATE,
        authFiles = [
            {
                provider: 'openai',
                path: '/durability/openai.json'
            }
        ],
        authFilesSnapshots = null,
        host = '127.0.0.1',
        port = 0
    } = options;

    let pollCount = 0;
    let authFilesRequestCount = 0;
    const requests = [];

    const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url, `http://${host}`);
        const requestPath = routeKey(requestUrl);

        requests.push({
            method: req.method,
            path: requestPath,
            headers: req.headers
        });

        if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'method not allowed' });
            return;
        }

        if (requestUrl.pathname === '/v0/management/codex-auth-url') {
            if (scenario === 'malformed' && malformedEndpoint === 'start') {
                writeMalformedJson(res);
                return;
            }

            writeJson(res, 200, {
                url: authUrl,
                state
            });
            return;
        }

        if (requestUrl.pathname === '/v0/management/get-auth-status') {
            if (!requestUrl.searchParams.get('state')) {
                writeJson(res, 400, { error: 'state query parameter is required' });
                return;
            }

            if (scenario === 'malformed' && malformedEndpoint === 'status') {
                writeMalformedJson(res);
                return;
            }

            if (scenario === 'failure') {
                writeJson(res, 200, {
                    status: 'failed',
                    state,
                    error: 'explicit failure'
                });
                return;
            }

            if (scenario === 'success') {
                pollCount += 1;
                writeJson(res, 200, pollCount < 2
                    ? { status: 'pending', state }
                    : { status: 'success', state });
                return;
            }

            if (scenario === 'timeout') {
                writeJson(res, 200, {
                    status: 'pending',
                    state,
                    retryAfterMs: 5000
                });
                return;
            }

            writeJson(res, 200, {
                status: 'pending',
                state
            });
            return;
        }

        if (requestUrl.pathname === '/v0/management/auth-files') {
            if (scenario === 'malformed' && malformedEndpoint === 'auth-files') {
                writeMalformedJson(res);
                return;
            }

            const snapshotBody = Array.isArray(authFilesSnapshots) && authFilesSnapshots.length > 0
                ? authFilesSnapshots[Math.min(authFilesRequestCount, authFilesSnapshots.length - 1)]
                : { authFiles };
            authFilesRequestCount += 1;

            writeJson(res, 200, snapshotBody);
            return;
        }

        if (requestUrl.pathname === '/provider-login') {
            res.writeHead(200, {
                'content-type': 'text/html; charset=utf-8'
            });
            res.end('<!doctype html><html><body><h1>Stub Provider Login</h1><p>OAuth handoff page loaded.</p></body></html>');
            return;
        }

        writeJson(res, 404, {
            error: 'not found',
            path: requestUrl.pathname
        });
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
    });

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;

    return {
        baseUrl: `http://${host}:${actualPort}`,
        requests,
        close() {
            return new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve();
                });
            });
        }
    };
}
