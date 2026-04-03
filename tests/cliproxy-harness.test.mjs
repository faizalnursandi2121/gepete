import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createCliproxyStubServer,
    writeEvidenceArtifact,
    writeEvidenceJson
} from './support/cliproxy_test_harness.mjs';

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    return { response, body };
}

test('stub server emits success, pending, timeout, malformed, and failure fixtures deterministically', async (t) => {
    const successServer = await createCliproxyStubServer({ scenario: 'success' });
    t.after(() => successServer.close());

    const successStart = await fetchJson(`${successServer.baseUrl}/v0/management/codex-auth-url`);
    assert.deepEqual(successStart.body, {
        url: 'https://auth.openai.example/authorize?state=opaque-state',
        state: 'opaque-state'
    });

    const firstPoll = await fetchJson(`${successServer.baseUrl}/v0/management/get-auth-status?state=opaque-state`);
    const secondPoll = await fetchJson(`${successServer.baseUrl}/v0/management/get-auth-status?state=opaque-state`);
    assert.equal(firstPoll.body.status, 'pending');
    assert.equal(secondPoll.body.status, 'success');

    const pendingServer = await createCliproxyStubServer({ scenario: 'pending' });
    t.after(() => pendingServer.close());
    const pendingPoll = await fetchJson(`${pendingServer.baseUrl}/v0/management/get-auth-status?state=opaque-state`);
    const pendingPollAgain = await fetchJson(`${pendingServer.baseUrl}/v0/management/get-auth-status?state=opaque-state`);
    assert.equal(pendingPoll.body.status, 'pending');
    assert.equal(pendingPollAgain.body.status, 'pending');

    const timeoutServer = await createCliproxyStubServer({ scenario: 'timeout' });
    t.after(() => timeoutServer.close());
    const timeoutPoll = await fetchJson(`${timeoutServer.baseUrl}/v0/management/get-auth-status?state=opaque-state`);
    assert.equal(timeoutPoll.body.status, 'pending');
    assert.equal(timeoutPoll.body.retryAfterMs, 5000);

    const failureServer = await createCliproxyStubServer({ scenario: 'failure' });
    t.after(() => failureServer.close());
    const failurePoll = await fetchJson(`${failureServer.baseUrl}/v0/management/get-auth-status?state=opaque-state`);
    assert.deepEqual(failurePoll.body, {
        status: 'failed',
        state: 'opaque-state',
        error: 'explicit failure'
    });

    const authFiles = await fetchJson(`${successServer.baseUrl}/v0/management/auth-files`);
    assert.deepEqual(authFiles.body, {
        authFiles: [
            {
                provider: 'openai',
                path: '/durability/openai.json'
            }
        ]
    });

    assert.equal(successServer.requests[0].path, '/v0/management/codex-auth-url');
    assert.equal(successServer.requests[1].path, '/v0/management/get-auth-status?state=opaque-state');
    assert.equal(successServer.requests[2].path, '/v0/management/get-auth-status?state=opaque-state');
});

test('stub server can emit malformed JSON deterministically', async (t) => {
    const malformedServer = await createCliproxyStubServer({
        scenario: 'malformed',
        malformedEndpoint: 'start'
    });
    t.after(() => malformedServer.close());

    const response = await fetch(`${malformedServer.baseUrl}/v0/management/codex-auth-url`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /^\{"status":"success"/);
    assert.throws(() => JSON.parse(text), /property value in JSON/);
});

test('evidence writers create repo-rooted artifacts and redact secrets', async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cliproxy-evidence-test-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const textPath = writeEvidenceArtifact('task-3-harness', 'management_key=super-secret\nstate=opaque-state', {
        rootDir: tempRoot,
        secrets: ['super-secret']
    });

    const jsonPath = writeEvidenceJson('task-3-harness-response', {
        status: 'success',
        token: 'super-secret'
    }, {
        rootDir: tempRoot,
        secrets: ['super-secret']
    });

    assert.equal(textPath, path.resolve(tempRoot, '.sisyphus', 'evidence', 'task-3-harness.txt'));
    assert.equal(jsonPath, path.resolve(tempRoot, '.sisyphus', 'evidence', 'task-3-harness-response.json'));
    assert.match(fs.readFileSync(textPath, 'utf8'), /\[redacted\]/);
    assert.match(fs.readFileSync(jsonPath, 'utf8'), /\[redacted\]/);
    assert.ok(fs.existsSync(path.dirname(textPath)));
});
