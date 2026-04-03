import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ChatGPTAccountCreator } from '../chatgpt_account_creator.js';
import { createCliproxyStubServer } from './support/cliproxy_test_harness.mjs';
import { runStubSmoke } from '../scripts/smoke-post-signup-oauth.mjs';
import { runRealSmoke } from '../scripts/smoke-post-signup-oauth.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(repoRoot, '.sisyphus', 'evidence');

function readEvidenceJson(name) {
    return JSON.parse(fs.readFileSync(path.join(evidenceDir, `${name}.json`), 'utf8'));
}

async function withTempConfig(config, callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-smoke-test-'));
    const originalCwd = process.cwd();

    try {
        process.chdir(tempDir);
        fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(config, null, 2));
        return await callback(tempDir);
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

test('stub smoke success runs integrated finalization path and writes redacted evidence', async () => {
    await runStubSmoke({ failureMode: false });

    const evidencePath = path.join(evidenceDir, 'task-7-smoke.json');
    const evidenceText = fs.readFileSync(evidencePath, 'utf8');
    const evidence = readEvidenceJson('task-7-smoke');

    assert.equal(fs.existsSync(evidencePath), true);
    assert.equal(evidence.summary.success, true);
    assert.equal(evidence.summary.createdAccounts.length, 1);
    assert.equal(evidence.summary.gotoCalls.length, 1);
    assert.deepEqual(evidence.requests.map((request) => request.path), [
        '/v0/management/auth-files',
        '/v0/management/codex-auth-url',
        '/v0/management/get-auth-status?state=%5Bredacted%5D',
        '/v0/management/get-auth-status?state=%5Bredacted%5D',
        '/v0/management/auth-files'
    ]);
    assert.equal(evidence.requests[0].headers.authorization, '[redacted]');
    assert.doesNotMatch(evidenceText, /management-secret-key/);
    assert.doesNotMatch(evidenceText, /stub%20smoke%20state/);
    assert.doesNotMatch(evidenceText, /code=super-secret/);
    assert.match(evidence.summary.accountsFileContents, /stub-success@example\.com\|\[redacted\]\|\[redacted\]/);
    assert.equal(evidence.summary.createdAccounts[0].totpSecret, '[redacted]');
});

test('stub smoke failure mode exits through failure path and proves no persistence', async () => {
    await assert.rejects(
        () => runStubSmoke({ failureMode: true }),
        /correctly failed closed with no persistence/
    );

    const evidencePath = path.join(evidenceDir, 'task-7-smoke-error.json');
    const evidenceText = fs.readFileSync(evidencePath, 'utf8');
    const evidence = readEvidenceJson('task-7-smoke-error');

    assert.equal(fs.existsSync(evidencePath), true);
    assert.equal(evidence.summary.success, false);
    assert.equal(evidence.summary.accountsFileContents, '');
    assert.equal(evidence.summary.createdAccounts.length, 0);
    assert.match(evidenceText, /\[redacted\]/);
    assert.doesNotMatch(evidenceText, /management-secret-key/);
    assert.doesNotMatch(evidenceText, /stub%20smoke%20state/);
});

test('real smoke reuses integrated finalization path and fails closed when finalization does not complete', async () => {
    await withTempConfig({
        max_workers: 1,
        headless: true,
        slow_mo: 0,
        timeout: 30000,
        password: 'example-password-123',
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key',
        cliproxy_management_auth_mode: 'bearer',
        cliproxy_poll_interval_ms: 10,
        cliproxy_poll_timeout_ms: 2000
    }, async () => {
        const creator = new ChatGPTAccountCreator();
        const calls = [];

        await assert.rejects(() => runRealSmoke({
            creator,
            setup2FAImpl: async () => {
                calls.push('setup2FA');
                return 'BASE32SECRETKEY1234';
            },
            takeDebugScreenshotImpl: async () => {},
            logImpl: () => {},
            context: {
                gotoCalls: [],
                async newPage() {
                    return {
                        async goto() {
                            calls.push('goto');
                        }
                    };
                }
            },
            orchestratorFactory: () => ({
                async run() {
                    calls.push('orchestrator');
                    return { status: 'failure', code: 'auth_failed' };
                }
            })
        }), /integrated finalization flow did not complete successfully/);

        const evidencePath = path.join(evidenceDir, 'task-7-smoke-real.json');
        const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

        assert.equal(evidence.result.status, 'failure');
        assert.match(evidence.result.error, /integrated finalization flow did not complete successfully/);
        assert.deepEqual(calls, ['setup2FA', 'orchestrator']);
    });
});

test('real smoke can record a successful integrated finalization run', async () => {
    const server = await createCliproxyStubServer({
        scenario: 'success',
        authUrl: 'http://127.0.0.1/provider-login?state=opaque-state',
        state: 'opaque-state',
        authFilesSnapshots: [
            {
                authFiles: [
                    { provider: 'openai', path: '/durability/openai-before.json', size: 10, modifiedAt: '2026-04-03T00:00:00.000Z' }
                ]
            },
            {
                authFiles: [
                    { provider: 'openai', path: '/durability/openai-before.json', size: 10, modifiedAt: '2026-04-03T00:00:00.000Z' },
                    { provider: 'openai', path: '/durability/openai-after.json', size: 42, modifiedAt: '2026-04-03T00:01:00.000Z' }
                ]
            }
        ]
    });

    try {
        await withTempConfig({
            max_workers: 1,
            headless: true,
            slow_mo: 0,
            timeout: 30000,
            password: 'example-password-123',
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: server.baseUrl,
            cliproxy_management_key: 'management-secret-key',
            cliproxy_management_auth_mode: 'bearer',
            cliproxy_poll_interval_ms: 10,
            cliproxy_poll_timeout_ms: 2000
        }, async () => {
            const creator = new ChatGPTAccountCreator();
            await runRealSmoke({
                creator,
                setup2FAImpl: async () => null,
                takeDebugScreenshotImpl: async () => {}
            });
        });

        const evidence = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'task-7-smoke-real.json'), 'utf8'));
        assert.equal(evidence.result.status, 'success');
        assert.equal(evidence.result.integratedFinalization, true);
        assert.equal(evidence.result.persistedAccounts, 1);
        assert.equal(evidence.result.dedicatedPageHandoffCount, 1);
        assert.equal(Array.isArray(evidence.summary.gotoCalls), true);
        assert.equal(evidence.summary.gotoCalls.length, 1);
        assert.match(evidence.summary.events.map((event) => event.message ?? '').join('\n'), /CLIProxy Codex OAuth durability confirmed/);
    } finally {
        await server.close();
    }
});
