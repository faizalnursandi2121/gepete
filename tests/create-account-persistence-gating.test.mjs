import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import nodeFs from 'node:fs';

import { ChatGPTAccountCreator } from '../chatgpt_account_creator.js';
import { writeEvidenceJson } from './support/cliproxy_test_harness.mjs';

async function withTempProject(config, callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-account-persistence-gating-'));
    const originalCwd = process.cwd();

    try {
        process.chdir(tempDir);
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2), 'utf-8');
        return await callback(tempDir);
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function baseConfig(overrides = {}) {
    return {
        max_workers: 1,
        headless: true,
        slow_mo: 0,
        timeout: 30000,
        password: 'example-password-123',
        ...overrides
    };
}

function createFinalizeHarness(tempDir, configOverrides = {}) {
    const creator = new ChatGPTAccountCreator();
    const events = [];
    const state = {
        orchestratorResult: { status: 'success', code: 'success' },
        totpSecret: 'BASE32SECRETKEY1234',
        saveShouldSucceed: true
    };

    creator.accountsFile = path.join(tempDir, 'accounts.txt');
    creator.takeDebugScreenshot = async () => {};
    creator.log = (message) => {
        events.push({ type: 'log', message });
    };
    creator.setup2FA = async (page, accountNumber) => {
        events.push({ type: 'setup2FA', page, accountNumber });
        return state.totpSecret;
    };
    creator.createPostSignupOAuthOrchestrator = () => ({
        async run({ context }) {
            events.push({ type: 'orchestrator-run', context });
            return state.orchestratorResult;
        }
    });
    creator.saveAccount = (email, password, totpSecret) => {
        events.push({ type: 'saveAccount', email, password, totpSecret });
        if (state.saveShouldSucceed) {
            fs.appendFileSync(creator.accountsFile, `${email}|${password}${totpSecret ? `|${totpSecret}` : ''}\n`, 'utf8');
            creator.createdAccounts.push({ email, password, totpSecret });
            return true;
        }

        return false;
    };
    creator.config = {
        ...creator.config,
        ...configOverrides
    };

    const context = {
        sentinel: 'persistent-context'
    };
    const page = {
        sentinel: 'chatgpt-page'
    };

    return { creator, events, state, context, page };
}

test('enabled CLIProxy flow saves only after durable auth success', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }), async (tempDir) => {
        const { creator, events, context, page } = createFinalizeHarness(tempDir, {
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key'
        });

        const success = await creator.finalizeSuccessfulAccountCreation({
            page,
            context,
            email: 'durable@example.com',
            password: creator.config.password,
            accountNumber: 1,
            currentUrl: 'https://chatgpt.com/'
        });

        writeEvidenceJson('task-5-persistence-gating-success', {
            success,
            events,
            accountsFile: fs.readFileSync(creator.accountsFile, 'utf8')
        }, {
            secrets: ['management-secret-key']
        });

        assert.equal(success, true);
        assert.deepEqual(events.filter((event) => event.type !== 'log').map((event) => event.type), [
            'setup2FA',
            'orchestrator-run',
            'saveAccount'
        ]);
        assert.equal(fs.readFileSync(creator.accountsFile, 'utf8'), 'durable@example.com|example-password-123|BASE32SECRETKEY1234\n');
    });
});

test('bad final signup URL fails closed before 2FA, CLIProxy orchestration, or persistence', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }), async (tempDir) => {
        const { creator, events, context, page } = createFinalizeHarness(tempDir, {
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key'
        });

        const success = await creator.finalizeSuccessfulAccountCreation({
            page,
            context,
            email: 'bad-url@example.com',
            password: creator.config.password,
            accountNumber: 99,
            currentUrl: 'https://chatgpt.com/auth/error'
        });

        assert.equal(success, false);
        assert.deepEqual(events.filter((event) => event.type !== 'log').map((event) => event.type), []);
        assert.equal(fs.existsSync(creator.accountsFile), false);
        assert.match(events.find((event) => event.type === 'log')?.message ?? '', /Signup success checkpoint failed/i);
    });
});

test('enabled CLIProxy failure leaves accounts.txt untouched and returns failure', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }), async (tempDir) => {
        const { creator, events, state, context, page } = createFinalizeHarness(tempDir, {
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key'
        });
        state.orchestratorResult = { status: 'failure', code: 'auth_failed' };

        const success = await creator.finalizeSuccessfulAccountCreation({
            page,
            context,
            email: 'failed@example.com',
            password: creator.config.password,
            accountNumber: 2,
            currentUrl: 'https://chatgpt.com/'
        });

        assert.equal(success, false);
        assert.deepEqual(events.filter((event) => event.type !== 'log').map((event) => event.type), [
            'setup2FA',
            'orchestrator-run'
        ]);
        assert.equal(fs.existsSync(creator.accountsFile), false);
    });
});

test('enabled CLIProxy unknown or timeout state leaves accounts.txt untouched and returns failure', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }), async (tempDir) => {
        const { creator, events, state, context, page } = createFinalizeHarness(tempDir, {
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key'
        });
        state.orchestratorResult = { status: 'timeout', code: 'auth_timeout' };

        const success = await creator.finalizeSuccessfulAccountCreation({
            page,
            context,
            email: 'timeout@example.com',
            password: creator.config.password,
            accountNumber: 3,
            currentUrl: 'https://chatgpt.com/'
        });

        assert.equal(success, false);
        assert.deepEqual(events.filter((event) => event.type !== 'log').map((event) => event.type), [
            'setup2FA',
            'orchestrator-run'
        ]);
        assert.equal(fs.existsSync(creator.accountsFile), false);
    });
});

test('enabled CLIProxy flow surfaces local persistence failure after durable auth success', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }), async (tempDir) => {
        const { creator, events, state, context, page } = createFinalizeHarness(tempDir, {
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key'
        });
        state.saveShouldSucceed = false;

        const success = await creator.finalizeSuccessfulAccountCreation({
            page,
            context,
            email: 'persist-fail@example.com',
            password: creator.config.password,
            accountNumber: 4,
            currentUrl: 'https://chatgpt.com/'
        });

        assert.equal(success, false);
        assert.deepEqual(events.filter((event) => event.type !== 'log').map((event) => event.type), [
            'setup2FA',
            'orchestrator-run',
            'saveAccount'
        ]);
        assert.equal(fs.existsSync(creator.accountsFile), false);
    });
});

test('real saveAccount bookkeeping stays clean when appendFileSync throws', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }), async (tempDir) => {
        const creator = new ChatGPTAccountCreator();
        creator.accountsFile = path.join(tempDir, 'accounts.txt');
        creator.config = {
            ...creator.config,
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key'
        };
        creator.log = () => {};
        creator.createdAccounts = [];

        const originalAppend = nodeFs.appendFileSync;
        nodeFs.appendFileSync = () => {
            throw new Error('disk full');
        };

        try {
            const saved = creator.saveAccount('write-fail@example.com', creator.config.password, 'BASE32SECRETKEY1234');
            assert.equal(saved, false);
            assert.equal(creator.createdAccounts.length, 0);
            assert.equal(fs.existsSync(creator.accountsFile), false);
        } finally {
            nodeFs.appendFileSync = originalAppend;
        }
    });
});

test('legacy mode stays backward compatible and saves without CLIProxy orchestration', async () => {
    await withTempProject(baseConfig({
        cliproxy_enable_codex_oauth: false
    }), async (tempDir) => {
        const { creator, events, context, page } = createFinalizeHarness(tempDir, {
            cliproxy_enable_codex_oauth: false
        });

        const success = await creator.finalizeSuccessfulAccountCreation({
            page,
            context,
            email: 'legacy@example.com',
            password: creator.config.password,
            accountNumber: 5,
            currentUrl: 'https://chatgpt.com/'
        });

        assert.equal(success, true);
        assert.deepEqual(events.filter((event) => event.type !== 'log').map((event) => event.type), [
            'setup2FA',
            'saveAccount'
        ]);
        assert.equal(fs.readFileSync(creator.accountsFile, 'utf8'), 'legacy@example.com|example-password-123|BASE32SECRETKEY1234\n');
    });
});
