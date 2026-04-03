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
async function getCode(email, max = 10) {
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_2fas_'));
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

    // === CREATE ACCOUNT (compact) ===
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
    console.log('Code:', code);
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
    for (let i = 0; i < 15; i++) {
        await sleep(2000);
        if (page.url().includes('chatgpt.com') && !page.url().includes('auth.openai')) break;
    }
    console.log('✅ Account created! URL:', page.url());

    // === DISMISS OVERLAYS ===
    await sleep(3000);
    for (let i = 0; i < 3; i++) {
        try { const b = page.locator('button:has-text("Skip")'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1500); } } catch {}
        try { const b = page.locator('button[aria-label="Close"]').first(); if (await b.isVisible({ timeout: 1000 })) { await b.click(); await sleep(1000); } } catch {}
    }

    // === OPEN SECURITY SETTINGS ===
    console.log('\n--- Security Settings ---');
    await page.goto('https://chatgpt.com/#settings/Security', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    try { const b = page.locator('button:has-text("Skip")'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1500); } } catch {}
    try { const b = page.locator('button[aria-label="Close"]').first(); if (await b.isVisible({ timeout: 1000 })) { await b.click(); await sleep(1000); } } catch {}
    
    const secTab = page.locator('[data-testid="security-tab"]');
    await secTab.waitFor({ state: 'visible', timeout: 10000 });
    await secTab.click(); await sleep(2000);

    // === CLICK MFA AUTHENTICATOR TOGGLE ===
    console.log('\n--- Enabling Authenticator App ---');
    const mfaToggle = page.locator('[data-testid="mfa-authenticator-toggle"]');
    await mfaToggle.waitFor({ state: 'visible', timeout: 10000 });
    const checked = await mfaToggle.getAttribute('aria-checked');
    console.log('Toggle state:', checked);
    
    await mfaToggle.click();
    console.log('Clicked MFA toggle!');
    await sleep(5000);
    
    // Check what happened
    console.log('URL:', page.url());
    await page.screenshot({ path: 'screenshots/2fa_40_after_toggle.png', fullPage: true });
    
    // Get page text
    const text = await page.evaluate(() => document.body.innerText?.substring(0, 3000));
    console.log('\nPage text:', text.substring(0, 1000));
    
    // Look for QR code images
    const images = await page.$$eval('img', els => els.map(el => ({
        src: el.src?.substring(0, 200),
        alt: el.alt,
        width: el.width, height: el.height,
    })));
    console.log('\nImages:', JSON.stringify(images));
    
    // Look for otpauth URI or TOTP secret
    const secretInfo = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const results = {};
        
        // Check for otpauth:// URI
        const otpMatch = html.match(/otpauth:\/\/[^"'\s<>&]+/);
        if (otpMatch) results.otpauthUri = otpMatch[0];
        
        // Check for base32 secret key (16-64 chars of A-Z2-7)
        const secretMatch = html.match(/[A-Z2-7]{16,64}/g);
        if (secretMatch) results.possibleSecrets = secretMatch;
        
        // Check for data URLs (QR code images)
        const dataUrlMatch = html.match(/data:image\/[^"'\s]+/);
        if (dataUrlMatch) results.dataUrl = dataUrlMatch[0].substring(0, 100);
        
        // Check SVG QR codes
        const svgs = document.querySelectorAll('svg');
        results.svgCount = svgs.length;
        
        // Check canvas elements (QR might be rendered in canvas)
        const canvases = document.querySelectorAll('canvas');
        results.canvasCount = canvases.length;
        
        return results;
    });
    console.log('\nSecret info:', JSON.stringify(secretInfo, null, 2));
    
    // Check for visible inputs (code entry)
    const inputs = await page.$$eval('input', els => els.map(el => ({
        type: el.type, name: el.name, placeholder: el.placeholder,
        visible: el.offsetParent !== null, ariaLabel: el.getAttribute('aria-label'),
    })).filter(e => e.visible));
    console.log('\nInputs:', JSON.stringify(inputs));
    
    // Check all buttons
    const btns = await page.$$eval('button', els => els.map(el => ({
        text: el.textContent?.trim().substring(0, 80),
        visible: el.offsetParent !== null,
        testId: el.getAttribute('data-testid'),
    })).filter(e => e.visible && e.text.length > 0));
    console.log('\nButtons:', JSON.stringify(btns, null, 2));
    
    // Check for any text that looks like a setup key
    const allText = await page.evaluate(() => document.body.innerText);
    const keyPattern = allText.match(/[A-Z2-7]{4}[\s-]?[A-Z2-7]{4}[\s-]?[A-Z2-7]{4}[\s-]?[A-Z2-7]{4}/g);
    if (keyPattern) {
        console.log('\nSetup key found:', keyPattern);
    }

    await context.close();
} catch (e) {
    console.error('Error:', e.message);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
