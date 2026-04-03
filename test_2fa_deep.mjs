import { firefox } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { faker } from '@faker-js/faker';
import * as cheerio from 'cheerio';

async function generateEmail() {
    const res = await fetch('https://generator.email/', { headers: { accept: 'text/html' } });
    const text = await res.text();
    const $ = cheerio.load(text);
    const domains = [];
    $('.e7m.tt-suggestions').find('div > p').each((i, el) => domains.push($(el).text()));
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const first = faker.person.firstName().replace(/["']/g, '');
    const last = faker.person.lastName().replace(/["']/g, '');
    const rand = Math.random().toString(36).substring(2, 7);
    return { email: `${first}${last}${rand}@${domain}`.toLowerCase(), first, last };
}
async function getCode(email, max = 8) {
    const [u, d] = email.split('@');
    for (let i = 0; i < max; i++) {
        try {
            const r = await fetch('https://generator.email/', { headers: { accept: 'text/html', cookie: `surl=${d}/${u}`, 'user-agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(await r.text());
            const t = $("#email-table > div.e7m.list-group-item.list-group-item-info > div.e7m.subj_div_45g45gg").text().trim();
            if (t) { const m = t.match(/\d{6}/); if (m) return m[0]; }
        } catch {}
        await new Promise(r => setTimeout(r, 3000));
    }
    return null;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_2fa2_'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const password = 'Gptbis77777@';

try {
    const { email, first, last } = await generateEmail();
    console.log('Email:', email);

    const context = await firefox.launchPersistentContext(tempDir, {
        headless: true, viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
        locale: 'en-US', timezoneId: 'America/New_York',
        ignoreHTTPSErrors: true, bypassCSP: true, timeout: 60000,
        firefoxUserPrefs: { 'dom.webdriver.enabled': false, 'marionette.enabled': false }
    });
    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

    // === CREATE ACCOUNT (proven flow) ===
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(5000);
    try { const b = page.locator('button:has-text("Accept all")'); if (await b.isVisible({ timeout: 3000 })) { await b.click(); await sleep(1000); } } catch {}
    try { const b = page.locator('button[aria-label="Close"]'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1000); } } catch {}
    
    await page.locator('[data-testid="signup-button"]').click({ timeout: 15000 }); await sleep(2000);
    const ei = page.getByRole('textbox', { name: 'Email address' });
    await ei.waitFor({ state: 'visible', timeout: 10000 });
    await ei.click(); await page.keyboard.type(email, { delay: 50 }); await sleep(2000);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10000 }); await sleep(8000);
    const pw = page.locator('input[type="password"]');
    await pw.waitFor({ state: 'visible', timeout: 15000 });
    await pw.click(); await page.keyboard.type(password, { delay: 30 }); await sleep(1500);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10000 }); await sleep(8000);
    await sleep(3000); const code = await getCode(email);
    if (!code) { console.log('FAILED: no code'); process.exit(1); }
    const ci = page.locator('input[name="code"]');
    await ci.waitFor({ state: 'visible', timeout: 10000 });
    await ci.click(); await page.keyboard.type(code, { delay: 50 }); await sleep(1000);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10000 }); await sleep(5000);
    const nameInput = page.locator('input[name="full_name"], input[placeholder="Full name"]');
    await nameInput.waitFor({ state: 'visible', timeout: 15000 });
    await nameInput.click(); await page.keyboard.type(`${first} ${last}`, { delay: 30 }); await sleep(500);
    const monthSpin = page.locator('[role="spinbutton"]').first();
    await monthSpin.waitFor({ state: 'visible', timeout: 5000 });
    await monthSpin.click(); await sleep(300);
    await page.keyboard.type('05151995', { delay: 80 }); await sleep(500);
    const finishBtn = page.getByRole('button', { name: /Finish creating account/i });
    await finishBtn.click({ timeout: 10000 });
    try { await page.waitForURL(url => !url.toString().includes('about-you'), { timeout: 30000 }); } catch {}
    await sleep(3000);
    console.log('✅ Account created! URL:', page.url());

    // === DISMISS ONBOARDING OVERLAY ===
    console.log('\n--- Dismissing onboarding ---');
    try {
        const skipBtn = page.locator('button:has-text("Skip")');
        if (await skipBtn.isVisible({ timeout: 3000 })) {
            await skipBtn.click();
            console.log('Clicked Skip');
            await sleep(2000);
        }
    } catch {}
    // Close any remaining dialogs
    try {
        const closeBtn = page.locator('[aria-label="Close"]');
        if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.click();
            await sleep(1000);
        }
    } catch {}

    // === OPEN SETTINGS ===
    console.log('\n--- Opening Security Settings ---');
    await page.goto('https://chatgpt.com/#settings/Security', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Dismiss any remaining overlay
    try {
        const skipBtn = page.locator('button:has-text("Skip")');
        if (await skipBtn.isVisible({ timeout: 2000 })) {
            await skipBtn.click();
            await sleep(2000);
        }
    } catch {}

    // Click Security tab directly
    try {
        const secTab = page.locator('[data-testid="security-tab"]');
        if (await secTab.isVisible({ timeout: 5000 })) {
            await secTab.click();
            console.log('Clicked Security tab');
            await sleep(2000);
        }
    } catch {}

    await page.screenshot({ path: 'screenshots/2fa_20_security.png', fullPage: true });
    
    // Get detailed HTML of the MFA section
    const mfaHTML = await page.evaluate(() => {
        const body = document.body.innerHTML;
        // Find the section containing "Authenticator app"
        const authAppIdx = body.indexOf('Authenticator app');
        if (authAppIdx > -1) {
            return body.substring(Math.max(0, authAppIdx - 500), authAppIdx + 1000);
        }
        return 'NOT FOUND';
    });
    console.log('\nMFA HTML section:', mfaHTML.substring(0, 1500));
    
    // Look for any clickable element near "Authenticator app"
    const authAppElements = await page.evaluate(() => {
        const allEls = document.querySelectorAll('*');
        const results = [];
        for (const el of allEls) {
            if (el.textContent?.includes('Authenticator app') && el.children.length < 5) {
                results.push({
                    tag: el.tagName,
                    text: el.textContent?.trim().substring(0, 100),
                    role: el.getAttribute('role'),
                    dataTestId: el.getAttribute('data-testid'),
                    clickable: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'switch',
                    className: el.className?.substring(0, 80),
                    parentTag: el.parentElement?.tagName,
                    parentTestId: el.parentElement?.getAttribute('data-testid'),
                });
            }
        }
        // Also look for switches/toggles
        const switches = document.querySelectorAll('[role="switch"], input[type="checkbox"], [data-testid*="mfa"], [data-testid*="authenticator"]');
        for (const s of switches) {
            results.push({
                tag: s.tagName, role: s.getAttribute('role'),
                text: s.textContent?.trim().substring(0, 50),
                dataTestId: s.getAttribute('data-testid'),
                checked: s.getAttribute('aria-checked'),
                className: s.className?.substring(0, 80),
            });
        }
        return results;
    });
    console.log('\nAuth app elements:', JSON.stringify(authAppElements, null, 2));

    await context.close();
} catch (e) {
    console.error('Error:', e.message);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
