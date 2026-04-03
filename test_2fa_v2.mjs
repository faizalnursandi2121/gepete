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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_2fav2_'));
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

    // === CREATE ACCOUNT ===
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
    // Wait more robustly for navigation
    for (let i = 0; i < 15; i++) {
        await sleep(2000);
        const url = page.url();
        if (url.includes('chatgpt.com') && !url.includes('auth.openai')) break;
        console.log(`  Waiting... URL: ${url}`);
    }
    console.log('✅ Account created! URL:', page.url());

    // === DISMISS ALL OVERLAYS ===
    console.log('\n--- Dismissing overlays ---');
    await sleep(3000);
    // Dismiss onboarding "What brings you to ChatGPT?"
    for (let i = 0; i < 3; i++) {
        try { const b = page.locator('button:has-text("Skip")'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1500); console.log('  Skipped onboarding'); } } catch {}
        try { const b = page.locator('button[aria-label="Close"]').first(); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1500); console.log('  Closed dialog'); } } catch {}
    }
    await sleep(2000);
    await page.screenshot({ path: 'screenshots/2fa_30_clean.png', fullPage: true });

    // === OPEN SETTINGS WITH SECURITY TAB ===
    console.log('\n--- Opening Security Settings ---');
    // Click profile button to open menu, or navigate directly
    await page.goto('https://chatgpt.com/#settings/Security', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Dismiss any overlays again
    try { const b = page.locator('button:has-text("Skip")'); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1500); } } catch {}
    try { const b = page.locator('button[aria-label="Close"]').first(); if (await b.isVisible({ timeout: 2000 })) { await b.click(); await sleep(1500); } } catch {}
    
    // Make sure settings dialog is open - click Security tab
    const secTab = page.locator('[data-testid="security-tab"]');
    try {
        await secTab.waitFor({ state: 'visible', timeout: 5000 });
        await secTab.click();
        await sleep(2000);
        console.log('Clicked Security tab');
    } catch {
        console.log('Security tab not found, trying to open settings manually...');
        // Try clicking profile menu
        const profileBtn = page.locator('[data-testid="profile-button"]');
        if (await profileBtn.isVisible({ timeout: 3000 })) {
            await profileBtn.click(); await sleep(1000);
            const settingsItem = page.locator('text=Settings');
            if (await settingsItem.isVisible({ timeout: 3000 })) {
                await settingsItem.click(); await sleep(2000);
                const st = page.locator('[data-testid="security-tab"]');
                await st.click(); await sleep(2000);
            }
        }
    }

    await page.screenshot({ path: 'screenshots/2fa_31_security.png', fullPage: true });
    
    // === FIND THE AUTHENTICATOR APP BUTTON ===
    console.log('\n--- Finding Authenticator App button ---');
    
    // Get full HTML around MFA section
    const mfaInfo = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const idx = html.indexOf('Authenticator');
        if (idx === -1) return { found: false, text: document.body.innerText?.substring(0, 1000) };
        
        // Get surrounding HTML
        const start = Math.max(0, idx - 200);
        const end = Math.min(html.length, idx + 2000);
        const section = html.substring(start, end);
        
        // Find all interactive elements in MFA section
        const mfaEl = document.querySelector('[data-testid*="authenticator"], [data-testid*="mfa"], [data-testid*="totp"]');
        
        return {
            found: true,
            section: section,
            mfaTestId: mfaEl?.getAttribute('data-testid'),
            mfaTag: mfaEl?.tagName,
        };
    });
    
    if (mfaInfo.found) {
        console.log('MFA section HTML:', mfaInfo.section?.substring(0, 1500));
    } else {
        console.log('MFA section NOT found. Page text:', mfaInfo.text);
    }

    // Find ALL clickable elements (buttons, links, divs with onClick) in the settings
    const clickables = await page.evaluate(() => {
        const settingsDialog = document.querySelector('[role="dialog"]') || document.body;
        const els = settingsDialog.querySelectorAll('button, a, [role="button"], [role="switch"], [onclick], [data-testid]');
        return Array.from(els).map(el => ({
            tag: el.tagName,
            text: el.textContent?.trim().substring(0, 80),
            testId: el.getAttribute('data-testid'),
            role: el.getAttribute('role'),
            href: el.getAttribute('href'),
            visible: el.offsetParent !== null,
        })).filter(e => e.visible);
    });
    console.log('\nAll clickable elements:', JSON.stringify(clickables, null, 2));

    await context.close();
} catch (e) {
    console.error('Error:', e.message);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
