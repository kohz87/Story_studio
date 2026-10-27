// Shared browser plumbing for the Data modules suites: a page with every request aborted (but the page itself) and every
// page or console error collected, plus small drivers for the forms. Driving goes through the real controls, by their
// accessible names, and never reaches into Studio's modules.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openParts } from './parts.js';

export const SHIPPED = pathToFileURL(resolve('dist/story-studio.html')).href;

export async function withPage(url, options, action) {
    const browser = await chromium.launch({
        headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}),
    });
    try {
        const context = await browser.newContext({
            viewport: { width: options.width ?? 1280, height: options.height ?? 900 },
            colorScheme: options.theme ?? 'dark', acceptDownloads: true,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [], requests = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('request', req => {
            if (!(req.url() === url && req.isNavigationRequest() && req.frame() === page.mainFrame())) requests.push(req.url());
        });
        await context.route('**/*', route => {
            if (route.request().url() === url && route.request().isNavigationRequest()) return route.continue();
            return route.abort();
        });
        await page.goto(url);
        await page.locator('.studio').waitFor();
        await action(page);
        assert.deepEqual(requests, [], 'No subresource or network requests');
        assert.deepEqual(errors, [], 'No page or console errors');
        await context.close();
    } finally {
        await browser.close();
    }
}

export async function upload(page, text) {
    await page.setInputFiles('#pack-file', { name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.getElementById('pack-name').value !== '' || document.querySelector('.rail'));
}

export async function openDataModules(page) {
    await openParts(page);
    await page.locator('.rail').getByRole('button', { name: /^Data modules/ }).click();
    await page.locator('main h1', { hasText: 'Data modules' }).waitFor();
}

export async function section(page, name) {
    await page.locator('[aria-label="Module sections"]').getByRole('button', { name, exact: true }).click();
    await page.locator('#dm-section h2', { hasText: new RegExp(`^${name === 'Record JSON' ? 'Record JSON' : name}$`) }).waitFor();
}

/** Waits for the debounced verdict, then returns its text. */
export async function verdict(page) {
    await page.waitForTimeout(220);
    return page.locator('#dm-validation').innerText();
}

export async function waitAccepted(page) {
    try {
        await page.waitForFunction(() => document.getElementById('dm-validation')?.textContent.startsWith('Accepted by Story Block.'));
    } catch (error) {
        // Say what Story Block said instead of a bare timeout.
        error.message = `${error.message}\n${await page.locator('#dm-validation').innerText()}`;
        throw error;
    }
}

const sel = label => `[aria-label="${label}"]`;
export const control = (scope, label) => scope.locator(sel(label));

export async function fill(scope, label, value, index = 0) {
    const box = scope.locator(sel(label)).nth(index);
    await box.fill(String(value));
    await box.dispatchEvent('change');
}

export async function choose(scope, label, value, index = 0) {
    await scope.locator(sel(label)).nth(index).selectOption(typeof value === 'string' ? { value } : value);
}

export async function tick(scope, label, on = true) {
    const box = scope.locator(sel(label)).first();
    if ((await box.isChecked()) !== on) await box.click();
}

export async function exportedPack(page) {
    await openParts(page);
    await page.locator('.rail').getByRole('button', { name: /^Check \/ export/ }).click();
    const pending = page.waitForEvent('download');
    await page.locator('#export-btn').click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
}
