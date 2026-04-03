/**
 * ChatGPT Account Creator Automation Script
 * This script automates the creation of ChatGPT accounts using temporary browser data.
 * Converted from Python Playwright to Node.js Playwright.
 */

import { firefox } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { pathToFileURL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import * as cheerio from 'cheerio';
import { faker } from '@faker-js/faker';
import * as OTPAuth from 'otpauth';
import { createPostSignupOAuthOrchestrator } from './post_signup_oauth_orchestrator.js';

class ChatGPTAccountCreator {
    constructor() {
        this.accountsFile = 'accounts.txt';
        this.createdAccounts = [];
        this.configFile = 'config.json';
        this.config = this.loadConfig();
        this.currentProgress = null;
        this.screenshotsDir = 'screenshots';
        if (!fs.existsSync(this.screenshotsDir)) {
            fs.mkdirSync(this.screenshotsDir, { recursive: true });
        }
    }

    log(message, level = null) {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        // Use currentProgress if available, otherwise use level or default to INFO
        let label;
        if (this.currentProgress) {
            label = this.currentProgress;
        } else if (level) {
            label = level;
        } else {
            label = "INFO";
        }
        const logMessage = `[${timestamp}] [${label}] ${this.sanitizeLogMessage(message)}`;
        console.log(logMessage);
    }

    sanitizeLogMessage(message) {
        if (typeof message !== 'string') {
            return message;
        }

        const secrets = [
            this.config?.password,
            this.config?.cliproxy_management_key
        ].filter((secret) => typeof secret === 'string' && secret.length > 0);

        return secrets.reduce((sanitizedMessage, secret) => {
            return sanitizedMessage.split(secret).join('[redacted]');
        }, message);
    }

    failCliproxyConfig(message) {
        throw new Error(`CLIProxy configuration error: ${message}`);
    }

    validateCliproxyConfig(config) {
        if (config.cliproxy_enable_codex_oauth !== true) {
            return config;
        }

        if (typeof config.cliproxy_base_url !== 'string' || config.cliproxy_base_url.trim().length === 0) {
            this.failCliproxyConfig('cliproxy_base_url is required when cliproxy_enable_codex_oauth is enabled.');
        }

        const baseUrl = config.cliproxy_base_url.trim();
        try {
            const parsedBaseUrl = new URL(baseUrl);
            if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
                this.failCliproxyConfig('cliproxy_base_url must use http or https when cliproxy_enable_codex_oauth is enabled.');
            }
        } catch {
            this.failCliproxyConfig('cliproxy_base_url must be a valid absolute URL when cliproxy_enable_codex_oauth is enabled.');
        }

        if (typeof config.cliproxy_management_key !== 'string' || config.cliproxy_management_key.trim().length === 0) {
            this.failCliproxyConfig('cliproxy_management_key is required when cliproxy_enable_codex_oauth is enabled.');
        }

        const authMode = typeof config.cliproxy_management_auth_mode === 'string'
            ? config.cliproxy_management_auth_mode.trim().toLowerCase()
            : null;
        if (!['bearer', 'x-management-key'].includes(authMode)) {
            this.failCliproxyConfig('cliproxy_management_auth_mode must be bearer or x-management-key when cliproxy_enable_codex_oauth is enabled.');
        }

        if (!Number.isInteger(config.cliproxy_poll_interval_ms) || config.cliproxy_poll_interval_ms <= 0) {
            this.failCliproxyConfig('cliproxy_poll_interval_ms must be a positive integer when cliproxy_enable_codex_oauth is enabled.');
        }

        if (!Number.isInteger(config.cliproxy_poll_timeout_ms) || config.cliproxy_poll_timeout_ms <= 0) {
            this.failCliproxyConfig('cliproxy_poll_timeout_ms must be a positive integer when cliproxy_enable_codex_oauth is enabled.');
        }

        config.cliproxy_base_url = baseUrl;
        config.cliproxy_management_key = config.cliproxy_management_key.trim();
        config.cliproxy_management_auth_mode = authMode;

        return config;
    }

    loadConfig() {
        const defaultConfig = {
            max_workers: 3,
            headless: false,
            slow_mo: 1000,
            timeout: 30000,
            password: null,
            cliproxy_enable_codex_oauth: false,
            cliproxy_base_url: '',
            cliproxy_management_key: '',
            cliproxy_management_auth_mode: 'bearer',
            cliproxy_poll_interval_ms: 2000,
            cliproxy_poll_timeout_ms: 180000
        };

        if (!fs.existsSync(this.configFile)) {
            fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');
            this.log(`📝 Created default config file: ${this.configFile}`);
            return defaultConfig;
        }

        const configData = fs.readFileSync(this.configFile, 'utf-8');
        const config = JSON.parse(configData);
        const loadedConfig = Object.assign({}, defaultConfig, config);

        if (loadedConfig.password) {
            const password = loadedConfig.password;
            if (password.length < 12) {
                this.log(`⚠️ Warning: Password in config.json is less than 12 characters. ChatGPT requires at least 12 characters.`, "WARNING");
            }
        }

        return this.validateCliproxyConfig(loadedConfig);
    }


    randstr(length) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    generateRandomEmail() {
        return new Promise((resolve, reject) => {
            fetch('https://generator.email/', {
                method: 'get',
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
                    'accept-encoding': 'gzip, deflate, br'
                }
            })
                .then(res => res.text())
                .then(text => {
                    const $ = cheerio.load(text);
                    const domains = [];
                    $('.e7m.tt-suggestions').find('div > p').each(function (index, element) {
                        domains.push($(element).text());
                    });

                    if (domains.length > 0) {
                        const domain = domains[Math.floor(Math.random() * domains.length)];

                        // Generate and store names for later use
                        this.currentFirstName = faker.person.firstName().replace(/["']/g, '');
                        this.currentLastName = faker.person.lastName().replace(/["']/g, '');

                        const randomStr = this.randstr(5);
                        const email = `${this.currentFirstName}${this.currentLastName}${randomStr}@${domain}`.toLowerCase();

                        this.log(`📧 Generated email: ${email}`);
                        resolve(email);
                    } else {
                        reject(new Error('No domains found from generator.email'));
                    }
                })
                .catch(err => reject(err));
        });
    }


    generateRandomName() {
        // Use stored names from generateRandomEmail if available
        if (this.currentFirstName && this.currentLastName) {
            return `${this.currentFirstName} ${this.currentLastName}`;
        }

        // Fallback: generate new names using faker
        const firstName = faker.person.firstName().replace(/["']/g, '');
        const lastName = faker.person.lastName().replace(/["']/g, '');
        return `${firstName} ${lastName}`;
    }

    generateRandomBirthday() {
        const today = new Date();
        const minYear = today.getFullYear() - 65;
        const maxYear = 2000;

        const year = Math.floor(Math.random() * (maxYear - minYear + 1)) + minYear;
        const month = Math.floor(Math.random() * 12) + 1;

        let maxDay;
        if ([1, 3, 5, 7, 8, 10, 12].includes(month)) {
            maxDay = 31;
        } else if ([4, 6, 9, 11].includes(month)) {
            maxDay = 30;
        } else {
            // February - check leap year
            if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
                maxDay = 29;
            } else {
                maxDay = 28;
            }
        }

        const day = Math.floor(Math.random() * maxDay) + 1;

        return { year, month, day };
    }

    saveAccount(email, password, totpSecret = null) {
        try {
            const line = totpSecret
                ? `${email}|${password}|${totpSecret}\n`
                : `${email}|${password}\n`;
            fs.appendFileSync(this.accountsFile, line, 'utf-8');
            this.createdAccounts.push({ email, password, totpSecret });
            this.log(`💾 Saved account to ${this.accountsFile}: ${email}${totpSecret ? ' (with 2FA)' : ''}`);
            return true;
        } catch (e) {
            this.log(`❌ Error saving account: ${e.message}`, "ERROR");
            return false;
        }
    }

    createPostSignupOAuthOrchestrator() {
        return createPostSignupOAuthOrchestrator(this.config, {
            logger: (message) => this.log(`[CLIProxy OAuth] ${message}`),
            sleepImpl: (ms) => this.sleep(ms)
        });
    }

    async finalizeSuccessfulAccountCreation({ page, context, email, password, accountNumber, currentUrl }) {
        const cliproxyEnabled = this.config.cliproxy_enable_codex_oauth === true;
        const urlLooksSuccessful = typeof currentUrl === 'string'
            && currentUrl.includes('chatgpt.com')
            && !currentUrl.includes('auth');

        if (!urlLooksSuccessful) {
            this.log(`❌ Signup success checkpoint failed at final URL: ${currentUrl}`, 'ERROR');
            return false;
        }

        this.log('✅ ChatGPT signup checkpoint passed. Final account completion is now gated by 2FA, CLIProxy verification, and local persistence.');

        const totpSecret = await this.setup2FA(page, accountNumber);

        if (cliproxyEnabled) {
            this.log('🔐 ChatGPT signup checkpoint passed; starting CLIProxy Codex OAuth durability gate before local persistence.');
            const orchestrator = this.createPostSignupOAuthOrchestrator();
            const orchestrationResult = await orchestrator.run({ context });

            if (orchestrationResult.status !== 'success' || orchestrationResult.code !== 'success') {
                this.log(
                    `❌ CLIProxy Codex OAuth durability gate failed (${orchestrationResult.code}). Local account persistence skipped for ${email}.`,
                    'ERROR'
                );
                return false;
            }

            this.log('✅ CLIProxy Codex OAuth durability confirmed; attempting local account persistence.');
        }

        const saved = this.saveAccount(email, password, totpSecret);
        if (!saved) {
            this.log(`❌ Local account persistence failed for ${email}.`, 'ERROR');
            return false;
        }

        this.log(`✅ Account completion confirmed for ${email}.`);

        return true;
    }

    async getVerificationCode(email, maxRetries = 15, delay = 4) {
        // Extract username and domain from email
        const [username, domain] = email.split('@');

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch('https://generator.email/', {
                    method: 'GET',
                    headers: {
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                        'cookie': `surl=${domain}/${username}`,
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    redirect: 'follow'
                });

                const html = await response.text();
                const $ = cheerio.load(html);

                const candidateTexts = [
                    $("#email-table > div.e7m.list-group-item.list-group-item-info > div.e7m.subj_div_45g45gg").text().trim(),
                    $("#email-table").text().trim(),
                    $('body').text().replace(/\s+/g, ' ').trim(),
                    html
                ].filter(Boolean);

                for (const candidateText of candidateTexts) {
                    const codeMatch = candidateText.match(/\b\d{6}\b/);
                    if (codeMatch) {
                        const code = codeMatch[0];
                        this.log(`✅ Retrieved verification code: ${code}`);
                        return code;
                    }
                }

                const mailboxPreview = ($('body').text().replace(/\s+/g, ' ').trim() || html.replace(/\s+/g, ' ').trim())
                    .slice(0, 300);
                if (mailboxPreview.length > 0) {
                    this.log(`⚠️ No verification code found yet. Mailbox preview: ${mailboxPreview}...`, 'WARNING');
                }

                if (attempt < maxRetries - 1) {
                    this.log(`⏳ Code not found, waiting ${delay}s before retry ${attempt + 1}/${maxRetries}...`);
                    await this.sleep(delay * 1000);
                }

            } catch (e) {
                this.log(`⚠️ Error fetching verification code (attempt ${attempt + 1}): ${e.message}`, "WARNING");
                if (attempt < maxRetries - 1) {
                    await this.sleep(delay * 1000);
                }
            }
        }

        this.log(`❌ Failed to get verification code after ${maxRetries} attempts`, "ERROR");
        return null;
    }

    async detectAuthStep(page) {
        const currentUrl = page.url();

        const selectors = {
            password: page.locator('input[type="password"]'),
            code: page.locator('input[name="code"], input[inputmode="numeric"], input[autocomplete="one-time-code"]')
        };

        for (let attempt = 0; attempt < 10; attempt++) {
            if (await selectors.password.count() > 0 && await selectors.password.first().isVisible().catch(() => false)) {
                return { step: 'password', url: page.url() };
            }

            if (await selectors.code.count() > 0 && await selectors.code.first().isVisible().catch(() => false)) {
                return { step: 'verification_code', url: page.url() };
            }

            await this.sleep(1500);
        }

        const title = await page.title().catch(() => '');
        const bodyPreview = await page.evaluate(() => document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 500) || '').catch(() => '');
        return {
            step: 'unknown',
            url: currentUrl,
            title,
            bodyPreview
        };
    }

    async fillPasswordStep(page, password, accountNumber) {
        this.log("🔑 Setting up password");
        try {
            const passwordInput = page.locator('input[type="password"]');
            await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
            await passwordInput.click();
            await page.keyboard.type(password, { delay: 30 });
            await this.sleep(this.randomFloat(1000, 2000));
            return true;
        } catch (e) {
            this.log(`❌ Error filling password: ${e.message}`);
            await this.takeDebugScreenshot(page, `password_error_${accountNumber}`);
            return false;
        }
    }

    async submitContinueStep(page, accountNumber, label) {
        try {
            const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
            await continueButton.waitFor({ state: 'visible', timeout: 10000 });
            await continueButton.click({ timeout: 10000 });
            await this.sleep(this.randomFloat(4000, 6000));

            if (page.url().includes('/error') || page.url().includes('challenge')) {
                this.log(`⚠️ Cloudflare challenge after ${label}, attempting...`);
                try {
                    const iframeEl = page.locator('iframe[src*="challenges.cloudflare.com"]');
                    const box = await iframeEl.boundingBox({ timeout: 5000 });
                    if (box) {
                        await page.mouse.click(box.x + 25, box.y + box.height / 2);
                        await this.sleep(10000);
                    }
                } catch {
                    await this.takeDebugScreenshot(page, `${label}_turnstile_error_${accountNumber}`);
                    return false;
                }
            }

            return true;
        } catch (e) {
            this.log(`❌ Error clicking Continue after ${label}: ${e.message}`);
            await this.takeDebugScreenshot(page, `continue_${label}_error_${accountNumber}`);
            return false;
        }
    }

    async completeVerificationCodeStep(page, email, accountNumber, context) {
        this.log("⏳ Waiting for verification code...");
        await this.sleep(5000);

        const verificationCode = await this.getVerificationCode(email);

        if (!verificationCode) {
            this.log(`❌ Failed to get verification code for ${email}`, "ERROR");
            await this.takeDebugScreenshot(page, `no_code_${accountNumber}`);
            await context.close();
            return false;
        }

        this.log(`✅ Got code: ${verificationCode}`);
        try {
            const codeInput = page.locator('input[name="code"], input[inputmode="numeric"], input[autocomplete="one-time-code"]');
            await codeInput.first().waitFor({ state: 'visible', timeout: 10000 });
            await codeInput.first().click();
            await page.keyboard.type(verificationCode, { delay: 50 });
            await this.sleep(1000);
        } catch (e) {
            this.log(`❌ Error entering verification code: ${e.message}`);
            await this.takeDebugScreenshot(page, `code_input_error_${accountNumber}`);
            return false;
        }

        return this.submitContinueStep(page, accountNumber, 'code');
    }

    async takeDebugScreenshot(page, label) {
        try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_');
            const filePath = path.join(this.screenshotsDir, `${ts}_${safeName}.png`);
            await page.screenshot({ path: filePath, fullPage: true });
            this.log(`📸 Screenshot saved: ${filePath}`);
        } catch (e) {
            this.log(`⚠️ Failed to take screenshot: ${e.message}`, "WARNING");
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    randomFloat(min, max) {
        return Math.random() * (max - min) + min;
    }

    async setup2FA(page, accountNumber) {
        try {
            this.log('🔐 Setting up 2FA authenticator app...');

            // Dismiss any overlays (onboarding, popups)
            for (let i = 0; i < 3; i++) {
                try { const b = page.locator('button:has-text("Skip")'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await this.sleep(1500); } } catch {}
                try { const b = page.locator('button[aria-label="Close"]').first(); if (await b.isVisible({ timeout: 1000 })) { await b.click(); await this.sleep(1000); } } catch {}
            }

            // Navigate to Security settings
            await page.goto('https://chatgpt.com/#settings/Security', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.sleep(3000);

            // Dismiss overlays again after navigation
            for (let i = 0; i < 2; i++) {
                try { const b = page.locator('button:has-text("Skip")'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await this.sleep(1500); } } catch {}
                try { const b = page.locator('button[aria-label="Close"]').first(); if (await b.isVisible({ timeout: 1000 })) { await b.click(); await this.sleep(1000); } } catch {}
            }

            // Click Security tab
            const secTab = page.locator('[data-testid="security-tab"]');
            await secTab.waitFor({ state: 'visible', timeout: 10000 });
            await secTab.click();
            await this.sleep(2000);

            // Click MFA authenticator toggle
            const mfaToggle = page.locator('[data-testid="mfa-authenticator-toggle"]');
            await mfaToggle.waitFor({ state: 'visible', timeout: 10000 });
            await mfaToggle.click();
            this.log('🔘 Clicked authenticator app toggle');
            await this.sleep(5000);

            // Click "Trouble scanning?" to reveal text secret
            try {
                const troubleBtn = page.getByRole('button', { name: /Trouble scanning/i });
                await troubleBtn.waitFor({ state: 'visible', timeout: 5000 });
                await troubleBtn.click();
                this.log('🔍 Clicked "Trouble scanning?" to reveal secret key');
                await this.sleep(3000);
            } catch (e) {
                this.log(`⚠️ Could not click "Trouble scanning?": ${e.message}`);
            }

            await this.takeDebugScreenshot(page, `2fa_secret_revealed_${accountNumber}`);

            // Extract TOTP secret from page (now visible as text)
            const secretKey = await page.evaluate(() => {
                const html = document.documentElement.innerHTML;
                // Look for base32 secret (16+ chars of A-Z2-7)
                const matches = html.match(/[A-Z2-7]{16,64}/g);
                if (matches) {
                    // Filter out common false positives, pick the longest match
                    const filtered = matches.filter(m => m.length >= 16 && m.length <= 64);
                    return filtered.length > 0 ? filtered.sort((a, b) => b.length - a.length)[0] : null;
                }
                return null;
            });

            if (!secretKey) {
                this.log('❌ Could not find TOTP secret key on page');
                await this.takeDebugScreenshot(page, `2fa_no_secret_${accountNumber}`);
                return null;
            }

            this.log(`🔑 TOTP secret: ${secretKey}`);

            // Generate TOTP code
            const totp = new OTPAuth.TOTP({
                issuer: 'OpenAI',
                label: 'ChatGPT',
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: OTPAuth.Secret.fromBase32(secretKey),
            });
            const otpCode = totp.generate();
            this.log(`🔢 Generated OTP code: ${otpCode}`);

            // Enter the verification code
            const codeInput = page.locator('input[name="totp_otp"]');
            await codeInput.waitFor({ state: 'visible', timeout: 10000 });
            await codeInput.click();
            await page.keyboard.type(otpCode, { delay: 50 });
            await this.sleep(1000);

            // Click Verify
            const verifyBtn = page.getByRole('button', { name: 'Verify', exact: true });
            await verifyBtn.click({ timeout: 10000 });
            this.log('🔘 Clicked Verify');
            await this.sleep(5000);

            // Check if toggle is now enabled
            const isEnabled = await page.evaluate(() => {
                const toggle = document.querySelector('[data-testid="mfa-authenticator-toggle"]');
                return toggle ? toggle.getAttribute('aria-checked') === 'true' : false;
            });

            if (isEnabled) {
                this.log('✅ 2FA authenticator app enabled successfully!');
                await this.takeDebugScreenshot(page, `2fa_success_${accountNumber}`);
                return secretKey;
            }

            // If toggle still not checked, look for error or success feedback
            const pageText = await page.evaluate(() => document.body.innerText?.substring(0, 2000));
            if (pageText.includes('success') || pageText.includes('enabled') || pageText.includes('verified')) {
                this.log('✅ 2FA appears to be enabled (text confirmation)');
                return secretKey;
            }

            this.log('⚠️ 2FA verification status unclear, checking toggle state again...');
            await this.takeDebugScreenshot(page, `2fa_unclear_${accountNumber}`);
            this.log('⚠️ 2FA verification could not be confirmed. Continuing without persisting a TOTP secret.', 'WARNING');
            return null;

        } catch (e) {
            this.log(`❌ Error setting up 2FA: ${e.message}`);
            await this.takeDebugScreenshot(page, `2fa_error_${accountNumber}`);
            return null;
        }
    }

    async createAccount(accountNumber, totalAccounts) {
        // Set progress for logging
        this.currentProgress = `${accountNumber}/${totalAccounts}`;

        const email = await this.generateRandomEmail();
        const password = this.config.password;

        if (!password) {
            this.log("❌ Error: No password found in config.json! Please add a 'password' field to config.json", "ERROR");
            return false;
        }

        if (password.length < 12) {
            this.log(`⚠️ Warning: Password in config.json is only ${password.length} characters. ChatGPT requires at least 12 characters.`, "WARNING");
        }

        const name = this.generateRandomName();
        const birthday = this.generateRandomBirthday();

        // this.log(`🚀 Creating account ${accountNumber}/${totalAccounts}: ${email}`);

        const uniqueId = uuidv4().substring(0, 8);
        const timestamp = Date.now();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `chatgpt_browser_${accountNumber}_${timestamp}_${uniqueId}_`));

        try {
            const firefoxVersion = "131.0";
            const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${firefoxVersion}) Gecko/20100101 Firefox/${firefoxVersion}`;

            const extraHttpHeaders = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
            };

            const firefoxUserPrefs = {
                'dom.webdriver.enabled': false,
                'useAutomationExtension': false,
                'marionette.enabled': false,
            };

            const context = await firefox.launchPersistentContext(tempDir, {
                headless: this.config.headless !== false,
                viewport: { width: 1366, height: 768 },
                userAgent: userAgent,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                deviceScaleFactor: 0.9,
                hasTouch: false,
                isMobile: false,
                ignoreHTTPSErrors: true,
                bypassCSP: true,
                extraHTTPHeaders: extraHttpHeaders,
                firefoxUserPrefs: firefoxUserPrefs,
                timeout: 30000,
            });

            const pages = context.pages();
            const page = pages.length > 0 ? pages[0] : await context.newPage();

            const firefoxStealthScript = `
                (function() {
                    // Hide webdriver property (Firefox)
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                        configurable: true
                    });
                    
                    // Override plugins to look realistic
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => {
                            return {
                                length: 0,
                                item: function() { return null; },
                                namedItem: function() { return null; },
                                refresh: function() {}
                            };
                        },
                        configurable: true
                    });
                    
                    // Override languages
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['en-US', 'en'],
                        configurable: true
                    });
                    
                    // Override permissions query
                    const originalQuery = window.navigator.permissions.query;
                    if (originalQuery) {
                        window.navigator.permissions.query = (parameters) => (
                            parameters.name === 'notifications' ?
                                Promise.resolve({ state: Notification.permission }) :
                                originalQuery(parameters)
                        );
                    }
                    
                    // Remove automation indicators
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
                    
                    // Firefox-specific: Hide marionette
                    delete navigator.__marionette;
                    delete navigator.__fxdriver;
                    delete navigator._driver;
                    delete navigator._selenium;
                    delete navigator.__driver_evaluate;
                    delete navigator.__webdriver_evaluate;
                    delete navigator.__selenium_evaluate;
                    delete navigator.__fxdriver_evaluate;
                    delete navigator.__driver_unwrapped;
                    delete navigator.__webdriver_unwrapped;
                    delete navigator.__selenium_unwrapped;
                    delete navigator.__fxdriver_unwrapped;
                })();
            `;

            await page.addInitScript(firefoxStealthScript);

            // Step 1: Navigate to ChatGPT
            try {
                await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.sleep(this.randomFloat(3000, 5000));
            } catch (e) {
                this.log(`❌ Error navigating to ChatGPT: ${e.message}`, "ERROR");
                await this.takeDebugScreenshot(page, `navigate_error_${accountNumber}`);
                return false;
            }

            // Dismiss cookie banner if present
            try {
                const acceptCookies = page.locator('button:has-text("Accept all")');
                if (await acceptCookies.isVisible({ timeout: 3000 })) {
                    await acceptCookies.click();
                    this.log("🍪 Dismissed cookie banner");
                    await this.sleep(1000);
                }
            } catch {}

            // Close Google login popup if present
            try {
                const closePopup = page.locator('button[aria-label="Close"]');
                if (await closePopup.isVisible({ timeout: 2000 })) {
                    await closePopup.click();
                    await this.sleep(1000);
                }
            } catch {}

            // Click Sign up button
            this.log("🔘 Processing 'Sign up'");
            try {
                const signupButton = page.locator('[data-testid="signup-button"]');
                await signupButton.waitFor({ state: 'visible', timeout: 15000 });
                await this.sleep(this.randomFloat(1000, 2000));
                await signupButton.click({ timeout: 10000 });
                await this.sleep(this.randomFloat(1500, 2500));
            } catch (e) {
                this.log(`❌ Error processing signup: ${e.message}`);
                await this.takeDebugScreenshot(page, `signup_error_${accountNumber}`);
                return false;
            }

            // Fill email (type character by character to avoid Turnstile CAPTCHA)
            this.log("📝 Filling email address");
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email address' });
                await emailInput.waitFor({ state: 'visible', timeout: 15000 });
                await emailInput.click();
                await page.keyboard.type(email, { delay: 50 });
                await this.sleep(this.randomFloat(1500, 2500));
            } catch (e) {
                this.log(`❌ Error filling email: ${e.message}`);
                await this.takeDebugScreenshot(page, `email_error_${accountNumber}`);
                return false;
            }

            // Click Continue after email
            try {
                const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
                await continueButton.waitFor({ state: 'visible', timeout: 10000 });
                await continueButton.click({ timeout: 10000 });
                await this.sleep(this.randomFloat(6000, 8000));

                const currentUrl = page.url();

                // Handle Cloudflare Turnstile challenge if present
                if (currentUrl.includes('/error') || currentUrl.includes('challenge')) {
                    this.log("⚠️ Cloudflare challenge detected, attempting to solve...");
                    try {
                        const iframeEl = page.locator('iframe[src*="challenges.cloudflare.com"]');
                        const box = await iframeEl.boundingBox({ timeout: 5000 });
                        if (box) {
                            await page.mouse.move(box.x + 25, box.y + box.height / 2, { steps: 10 });
                            await this.sleep(500);
                            await page.mouse.click(box.x + 25, box.y + box.height / 2);
                            await this.sleep(10000);
                        }
                    } catch (cfError) {
                        this.log(`❌ Failed to solve Cloudflare challenge: ${cfError.message}`);
                        await this.takeDebugScreenshot(page, `turnstile_error_${accountNumber}`);
                        return false;
                    }
                }

                const afterUrl = page.url();
                if (afterUrl.includes('/error')) {
                    this.log(`❌ Auth error: ${afterUrl}`);
                    await this.takeDebugScreenshot(page, `auth_error_${accountNumber}`);
                    return false;
                }
            } catch (e) {
                this.log(`❌ Error clicking Continue: ${e.message}`);
                await this.takeDebugScreenshot(page, `continue_email_error_${accountNumber}`);
                return false;
            }

            const firstStep = await this.detectAuthStep(page);
            if (firstStep.step === 'password') {
                this.log('✅ Next auth step detected: password');
                const passwordFilled = await this.fillPasswordStep(page, password, accountNumber);
                if (!passwordFilled) {
                    return false;
                }
            } else if (firstStep.step === 'verification_code') {
                this.log('✅ Next auth step detected: verification code');
                const codeCompleted = await this.completeVerificationCodeStep(page, email, accountNumber, context);
                if (!codeCompleted) {
                    return false;
                }

                const secondStep = await this.detectAuthStep(page);
                if (secondStep.step === 'password') {
                    this.log('✅ Password step detected after verification code');
                    const passwordFilled = await this.fillPasswordStep(page, password, accountNumber);
                    if (!passwordFilled) {
                        return false;
                    }
                } else if (secondStep.url?.includes('about') || secondStep.url?.includes('chatgpt.com')) {
                    this.log(`✅ Proceeding directly to post-verification onboarding step (${secondStep.url}).`);
                } else {
                    this.log(`❌ Expected password step after email verification but detected ${secondStep.step}. URL: ${secondStep.url}. Title: ${secondStep.title || 'n/a'}. Body preview: ${(secondStep.bodyPreview || '').slice(0, 200)}`);
                    await this.takeDebugScreenshot(page, `password_after_code_missing_${accountNumber}`);
                    return false;
                }
            } else {
                this.log(`❌ Could not determine next auth step. URL: ${firstStep.url}. Title: ${firstStep.title || 'n/a'}. Body preview: ${(firstStep.bodyPreview || '').slice(0, 200)}`);
                await this.takeDebugScreenshot(page, `unknown_auth_step_${accountNumber}`);
                return false;
            }

            if (firstStep.step === 'password' || (firstStep.step === 'verification_code' && !page.url().includes('about'))) {
                const passwordSubmitted = await this.submitContinueStep(page, accountNumber, 'password');
                if (!passwordSubmitted) {
                    return false;
                }

                const postPasswordStep = await this.detectAuthStep(page);
                if (postPasswordStep.step === 'verification_code') {
                    this.log('✅ Verification code step detected after password');
                    const codeCompleted = await this.completeVerificationCodeStep(page, email, accountNumber, context);
                    if (!codeCompleted) {
                        return false;
                    }
                } else if (postPasswordStep.step === 'password') {
                    this.log('⚠️ Password step still visible after submit, continuing with current flow.', 'WARNING');
                } else if (!page.url().includes('about') && !page.url().includes('chatgpt.com')) {
                    this.log(`❌ Unexpected post-password state. URL: ${postPasswordStep.url}. Title: ${postPasswordStep.title || 'n/a'}. Body preview: ${(postPasswordStep.bodyPreview || '').slice(0, 200)}`);
                    await this.takeDebugScreenshot(page, `unexpected_post_password_state_${accountNumber}`);
                    return false;
                }
            }

            // Fill name on about-you page
            this.log(`👤 Setting name: ${name}`);
            try {
                const nameInput = page.locator('input[name="full_name"], input[placeholder="Full name"]');
                await nameInput.waitFor({ state: 'visible', timeout: 15000 });
                await nameInput.click();
                await page.keyboard.type(name, { delay: 30 });
                await this.sleep(500);
            } catch (e) {
                this.log(`❌ Error filling name: ${e.message}`);
                await this.takeDebugScreenshot(page, `name_error_${accountNumber}`);
                return false;
            }

            // Handle birthday - React Aria DateField with spinbutton segments
            const monthNum = birthday.month;
            const dayNum = birthday.day;
            const yearNum = birthday.year;
            this.log(`🎂 Setting birthday: ${monthNum}/${dayNum}/${yearNum}`);

            try {
                const monthStr = String(monthNum).padStart(2, '0');
                const dayStr = String(dayNum).padStart(2, '0');
                const yearStr = String(yearNum);

                const spinbuttons = page.locator('[role="spinbutton"]');
                if (await spinbuttons.count() > 0 && await spinbuttons.first().isVisible().catch(() => false)) {
                    const monthSpin = spinbuttons.first();
                    await monthSpin.click();
                    await this.sleep(300);
                    await page.keyboard.type(`${monthStr}${dayStr}${yearStr}`, { delay: 80 });
                    await this.sleep(500);
                } else {
                    const monthField = page.locator('select[name*="month" i], input[name*="month" i], input[placeholder*="month" i]').first();
                    const dayField = page.locator('select[name*="day" i], input[name*="day" i], input[placeholder*="day" i]').first();
                    const yearField = page.locator('select[name*="year" i], input[name*="year" i], input[placeholder*="year" i]').first();
                    const dateField = page.locator('input[type="date"], input[name*="birth" i], input[placeholder*="birthday" i]').first();

                    if (await dateField.count() > 0 && await dateField.isVisible().catch(() => false)) {
                        await dateField.fill(`${yearStr}-${monthStr}-${dayStr}`);
                    } else if (
                        await monthField.count() > 0
                        && await dayField.count() > 0
                        && await yearField.count() > 0
                        && await monthField.isVisible().catch(() => false)
                        && await dayField.isVisible().catch(() => false)
                        && await yearField.isVisible().catch(() => false)
                    ) {
                        await monthField.click();
                        await monthField.fill(monthStr).catch(async () => page.keyboard.type(monthStr, { delay: 50 }));
                        await this.sleep(200);
                        await dayField.click();
                        await dayField.fill(dayStr).catch(async () => page.keyboard.type(dayStr, { delay: 50 }));
                        await this.sleep(200);
                        await yearField.click();
                        await yearField.fill(yearStr).catch(async () => page.keyboard.type(yearStr, { delay: 50 }));
                    } else {
                        throw new Error('No supported birthday input pattern detected');
                    }

                    await this.sleep(500);
                }
            } catch (e) {
                this.log(`❌ Error setting birthday: ${e.message}`, "ERROR");
                await this.takeDebugScreenshot(page, `birthday_error_${accountNumber}`);
                return false;
            }

            // Click "Finish creating account" button
            try {
                const finishButton = page.getByRole('button', { name: /Finish creating account/i });
                await finishButton.waitFor({ state: 'visible', timeout: 10000 });
                await finishButton.click({ timeout: 10000 });

                // Wait for navigation away from the about-you page
                try {
                    await page.waitForURL((url) => !url.toString().includes('about-you'), { timeout: 30000 });
                } catch {
                    // Handle Turnstile if it appeared
                    if (page.url().includes('/error') || page.url().includes('challenge')) {
                        this.log("⚠️ Cloudflare challenge after finish, attempting...");
                        try {
                            const iframeEl = page.locator('iframe[src*="challenges.cloudflare.com"]');
                            const box = await iframeEl.boundingBox({ timeout: 5000 });
                            if (box) {
                                await page.mouse.click(box.x + 25, box.y + box.height / 2);
                                await this.sleep(10000);
                            }
                        } catch {}
                    }
                }
                await this.sleep(3000);
                this.log(`📍 URL after finish: ${page.url()}`);
            } catch (e) {
                this.log(`❌ Error clicking Finish: ${e.message}`);
                await this.takeDebugScreenshot(page, `finish_error_${accountNumber}`);
                return false;
            }

            // Verify account creation and setup 2FA
            try {
                const currentUrl = page.url();
                await this.takeDebugScreenshot(page, `final_${accountNumber}`);
                const success = await this.finalizeSuccessfulAccountCreation({
                    page,
                    context,
                    email,
                    password,
                    accountNumber,
                    currentUrl
                });
                await context.close();
                return success;
            } catch (e) {
                this.log(`❌ Error verifying account creation: ${e.message}`, 'ERROR');
                await context.close();
                return false;
            }

        } catch (e) {
            return false;
        } finally {
            try {
                await this.sleep(1000);
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    async createAccounts(numAccounts) {
        console.log(`🚀 Starting account creation for ${numAccounts} accounts...`);

        let successful = 0;
        let failed = 0;

        // Sequential processing - one account at a time
        for (let accountNum = 1; accountNum <= numAccounts; accountNum++) {
            // Set progress for logging
            this.currentProgress = `${accountNum}/${numAccounts}`;

            try {
                const success = await this.createAccount(accountNum, numAccounts);

                if (success) {
                    successful++;
                    this.log(`✅ Account completed successfully\n`);
                } else {
                    failed++;
                    this.log(`❌ Account failed\n`);
                }

                // Delay between accounts if not the last one
                if (accountNum < numAccounts) {
                    const delay = this.randomFloat(2000, 4000);
                    // this.log(`⏳ Waiting ${Math.round(delay / 1000)}s before next account...`);
                    await this.sleep(delay);
                }

            } catch (e) {
                this.log(`💥 Error: ${e.message}\n`);
                failed++;
            }
        }

        // Reset progress
        this.currentProgress = null;

        this.printSummary(successful, failed);
    }

    printSummary(successful, failed) {
        console.log("\n" + "=".repeat(60));
        console.log("📊 ACCOUNT CREATION SUMMARY");
        console.log("=".repeat(60));
        console.log(`✅ Successful: ${successful}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📝 Total accounts saved: ${this.createdAccounts.length}`);
        console.log(`💾 Accounts saved to: ${this.accountsFile}`);

        if (this.createdAccounts.length > 0) {
            console.log("\n✅ CREATED ACCOUNTS:");
            this.createdAccounts.forEach((account, i) => {
                const twofa = account.totpSecret ? ' 🔐 2FA' : '';
                console.log(`  ${i + 1}. ${account.email}${twofa}`);
            });
        }

        console.log("=".repeat(60));
    }
}

async function main() {
    console.log("🤖 ChatGPT Account Creator");
    console.log("=".repeat(60));

    const creator = new ChatGPTAccountCreator();

    console.log(`⚙️ Configuration loaded`);
    // console.log(`   - Headless mode: ${creator.config.headless !== false}`);

    const password = creator.config.password;
    // if (password) {
    //     console.log(`   - Password: ${'*'.repeat(Math.min(password.length, 20))} (from config.json)`);
    // } else {
    //     console.log(`   - Password: ❌ NOT SET (please add 'password' to config.json)`);
    // }
    console.log();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const answer = await new Promise((resolve) => {
            rl.question("\n📝 How many accounts do you want to create? ", resolve);
        });

        const numAccounts = parseInt(answer, 10);
        if (isNaN(numAccounts) || numAccounts <= 0) {
            console.log("❌ Please enter a positive number!");
            rl.close();
            return;
        }

        console.log(`\n🚀 Starting creation of ${numAccounts} account(s)...`);
        console.log(`   Processing one account at a time (sequential mode)\n`);

        await creator.createAccounts(numAccounts);

    } catch (e) {
        if (e.message === 'readline was closed') {
            console.log("\n\n🛑 Script interrupted by user (Ctrl+C)");
            console.log("✅ Progress saved to accounts.txt");
        } else {
            console.log(`\n❌ Error: ${e.message}`);
        }
    } finally {
        rl.close();
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log("\n\n🛑 Script interrupted by user (Ctrl+C)");
    console.log("✅ Progress saved to accounts.txt");
    process.exit(0);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(console.error);
}

export { ChatGPTAccountCreator, main };
