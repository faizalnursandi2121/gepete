import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const readmePath = path.join(repoRoot, 'README.md');
const sourcePath = path.join(repoRoot, 'chatgpt_account_creator.js');

const readme = fs.readFileSync(readmePath, 'utf8');
const source = fs.readFileSync(sourcePath, 'utf8');

const requiredConfigKeys = [
    'cliproxy_enable_codex_oauth',
    'cliproxy_base_url',
    'cliproxy_management_key',
    'cliproxy_management_auth_mode',
    'cliproxy_poll_interval_ms',
    'cliproxy_poll_timeout_ms'
];

test('README documents every implemented CLIProxy config key in both language sections', () => {
    for (const key of requiredConfigKeys) {
        const sourceMentions = source.includes(key);
        const readmeMentions = readme.match(new RegExp(key, 'g')) ?? [];

        assert.equal(sourceMentions, true, `${key} should exist in source config contract`);
        assert.ok(readmeMentions.length >= 3, `${key} should appear in README config example/bullets for both languages`);
    }
});

test('README documents gated persistence semantics and currently available verification commands only', () => {
    assert.match(readme, /does \*\*not\*\* write to `accounts\.txt` until/i);
    assert.match(readme, /tidak\*\* akan menulis akun ke `accounts\.txt` sampai/i);
    assert.match(readme, /node --test tests\/create-account-persistence-gating\.test\.mjs/);
    assert.match(readme, /node scripts\/smoke-post-signup-oauth\.mjs --stub-server/);
    assert.match(readme, /node scripts\/smoke-post-signup-oauth\.mjs --stub-server --failure-mode/);
    assert.match(readme, /node scripts\/smoke-post-signup-oauth\.mjs(?!\s+--stub-server)/);
    assert.doesNotMatch(readme, /saved directly to `accounts\.txt` in the `email\|password` format/i);
    assert.doesNotMatch(readme, /otomatis terdata dengan rapi di dalam file `accounts\.txt`/i);
});
