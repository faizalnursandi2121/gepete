import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ChatGPTAccountCreator } from '../chatgpt_account_creator.js';

function withTempProject(config, callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliproxy-config-test-'));
    const originalCwd = process.cwd();

    try {
        process.chdir(tempDir);
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2), 'utf-8');
        return callback(tempDir);
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function baseLegacyConfig() {
    return {
        max_workers: 3,
        headless: false,
        slow_mo: 1000,
        timeout: 30000,
        password: 'example-password-123'
    };
}

test('disabled legacy mode loads without CLIProxy required fields', () => {
    const config = withTempProject(baseLegacyConfig(), () => {
        const creator = new ChatGPTAccountCreator();
        return creator.config;
    });

    assert.equal(config.cliproxy_enable_codex_oauth, false);
    assert.equal(config.cliproxy_base_url, '');
    assert.equal(config.cliproxy_management_key, '');
    assert.equal(config.cliproxy_management_auth_mode, 'bearer');
    assert.equal(config.cliproxy_poll_interval_ms, 2000);
    assert.equal(config.cliproxy_poll_timeout_ms, 180000);
});

test('enabled valid mode loads with explicit CLIProxy settings', () => {
    const config = withTempProject({
        ...baseLegacyConfig(),
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key',
        cliproxy_management_auth_mode: 'bearer',
        cliproxy_poll_interval_ms: 2500,
        cliproxy_poll_timeout_ms: 90000
    }, () => {
        const creator = new ChatGPTAccountCreator();
        return creator.config;
    });

    assert.equal(config.cliproxy_enable_codex_oauth, true);
    assert.equal(config.cliproxy_base_url, 'https://cliproxy.example.com');
    assert.equal(config.cliproxy_management_key, 'management-secret-key');
    assert.equal(config.cliproxy_management_auth_mode, 'bearer');
    assert.equal(config.cliproxy_poll_interval_ms, 2500);
    assert.equal(config.cliproxy_poll_timeout_ms, 90000);
});

test('enabled mode fails closed when the base URL is missing', () => {
    assert.throws(() => {
        withTempProject({
            ...baseLegacyConfig(),
            cliproxy_enable_codex_oauth: true,
            cliproxy_management_key: 'management-secret-key'
        }, () => new ChatGPTAccountCreator());
    }, /CLIProxy configuration error: cliproxy_base_url is required/i);
});

test('enabled mode fails closed when the management key is missing', () => {
    assert.throws(() => {
        withTempProject({
            ...baseLegacyConfig(),
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com'
        }, () => new ChatGPTAccountCreator());
    }, /CLIProxy configuration error: cliproxy_management_key is required/i);
});

test('enabled mode fails closed when auth mode is invalid', () => {
    assert.throws(() => {
        withTempProject({
            ...baseLegacyConfig(),
            cliproxy_enable_codex_oauth: true,
            cliproxy_base_url: 'https://cliproxy.example.com',
            cliproxy_management_key: 'management-secret-key',
            cliproxy_management_auth_mode: 'token'
        }, () => new ChatGPTAccountCreator());
    }, /CLIProxy configuration error: cliproxy_management_auth_mode must be bearer or x-management-key/i);
});

test('default polling values are applied when they are omitted', () => {
    const config = withTempProject({
        ...baseLegacyConfig(),
        cliproxy_enable_codex_oauth: true,
        cliproxy_base_url: 'https://cliproxy.example.com',
        cliproxy_management_key: 'management-secret-key'
    }, () => {
        const creator = new ChatGPTAccountCreator();
        return creator.config;
    });

    assert.equal(config.cliproxy_management_auth_mode, 'bearer');
    assert.equal(config.cliproxy_poll_interval_ms, 2000);
    assert.equal(config.cliproxy_poll_timeout_ms, 180000);
});
