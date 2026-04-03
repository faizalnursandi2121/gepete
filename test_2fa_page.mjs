import { firefox } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use the account we just created
const email = 'eldorapurdyvjfd3@alvaxio.com';
const password = 'Gptbis77777@';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_2fa_'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    const context = await firefox.launchPersistentContext(tempDir, {
        headless: true, viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
        locale: 'en-US', timezoneId: 'America/New_York',
        ignoreHTTPSErrors: true, bypassCSP: true, timeout: 60000,
        firefoxUserPrefs: { 'dom.webdriver.enabled': false, 'marionette.enabled': false }
    });
    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

    // Login first
    console.log('1. Navigate to ChatGPT...');
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Dismiss cookies
    try { const b = page.locator('button:has-text("Accept all")'); if (await b.isVisible({ timeout: 3000 })) { await b.click(); await sleep(1000); } } catch {}
    try { const b = page.locator('button[aria-label="Close"]'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1000); } } catch {}

    // Click Login
    console.log('2. Click Login...');
    const loginBtn = page.locator('[data-testid="login-button"]');
    await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
    await loginBtn.click({ timeout: 10000 });
    await sleep(3000);

    console.log('   URL:', page.url());
    await page.screenshot({ path: 'screenshots/2fa_01_login_page.png', fullPage: true });

    // Fill email
    console.log('3. Fill email...');
    const emailInput = page.getByRole('textbox', { name: 'Email address' });
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.click();
    await page.keyboard.type(email, { delay: 50 });
    await sleep(1500);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10000 });
    await sleep(8000);
    console.log('   URL after email:', page.url());

    // Fill password
    console.log('4. Fill password...');
    const pwInput = page.locator('input[type="password"]');
    await pwInput.waitFor({ state: 'visible', timeout: 15000 });
    await pwInput.click();
    await page.keyboard.type(password, { delay: 30 });
    await sleep(1500);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10000 });
    await sleep(10000);
    console.log('   URL after login:', page.url());
    await page.screenshot({ path: 'screenshots/2fa_02_logged_in.png', fullPage: true });

    // Navigate to settings/security
    console.log('5. Navigate to settings/security...');
    await page.goto('https://chatgpt.com/#settings/Security', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    console.log('   URL:', page.url());
    await page.screenshot({ path: 'screenshots/2fa_03_security_page.png', fullPage: true });

    // Look for 2FA/MFA related elements
    const pageText = await page.evaluate(() => document.body.innerText?.substring(0, 2000));
    console.log('6. Page text:', pageText.substring(0, 800));

    // Find all buttons
    const buttons = await page.$$eval('button', els => els.map(el => ({
        text: el.textContent?.trim().substring(0, 60),
        visible: el.offsetParent !== null,
        testId: el.getAttribute('data-testid'),
    })).filter(e => e.visible && e.text.length > 0));
    console.log('7. Visible buttons:', JSON.stringify(buttons, null, 2));

    // Look for specific 2FA elements
    const links = await page.$$eval('a', els => els.map(el => ({
        text: el.textContent?.trim().substring(0, 60),
        href: el.href,
    })).filter(e => e.text.length > 0));
    console.log('8. Links:', JSON.stringify(links, null, 2));

    // Try clicking on "Multi-factor authentication" or similar
    const mfaSelectors = [
        'button:has-text("Enable")',
        'button:has-text("Set up")',
        'button:has-text("multi-factor")',
        'button:has-text("2FA")',
        'button:has-text("two-factor")',
        'button:has-text("authenticator")',
        '[data-testid*="mfa"]',
        '[data-testid*="2fa"]',
    ];
    for (const sel of mfaSelectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 })) {
                const text = await el.textContent();
                console.log(`9. FOUND: "${sel}" => "${text?.trim().substring(0, 60)}"`);
            }
        } catch {}
    }

    await context.close();
} catch (e) {
    console.error('Error:', e.message, e.stack?.substring(0, 200));
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
