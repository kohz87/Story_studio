// Pack settings in a real browser, against the committed offline distribution: no Stat formula card, a standard pack stays valid,
// a classic pack gets Story Block's refusal in Check, and the usual target-size checks on a desktop and a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openParts } from './helpers/parts.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const PACK = readFileSync(new globalThis.URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');

async function withPage(options, action) {
    const browser = await chromium.launch({
        headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}),
    });
    try {
        const context = await browser.newContext({
            viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
            colorScheme: options.theme ?? 'dark', acceptDownloads: true,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        const errors = [], requests = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('request', req => {
            if (!(req.url() === URL && req.isNavigationRequest() && req.frame() === page.mainFrame())) requests.push(req.url());
        });
        await context.route('**/*', route => {
            if (route.request().url() === URL && route.request().isNavigationRequest()) return route.continue();
            return route.abort();
        });
        if (options.noIndexedDb) await page.addInitScript(() => {
            Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Access denied', 'SecurityError'); } });
        });
        await page.goto(URL);
        await page.locator('.studio').waitFor();
        await action(page);
        assert.deepEqual(requests, [], 'No subresource or network requests');
        assert.deepEqual(errors, [], 'No page or console errors');
        await context.close();
    } finally {
        await browser.close();
    }
}

async function load(page, text = PACK, name = 'pack.json', mimeType = 'application/json') {
    await page.setInputFiles('#pack-file', { name, mimeType, buffer: Buffer.isBuffer(text) ? text : typeof text === 'string' ? Buffer.from(text) : Buffer.from(text) });
    await page.waitForFunction(() => document.getElementById('pack-name').value !== '');
}
async function navigate(page, name) {
    await openParts(page);
    await page.locator('.rail').getByRole('button', { name: new RegExp('^' + name) }).click();
}
async function downloaded(page, selector) {
    const pending = page.waitForEvent('download');
    await page.locator(selector).click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    return { name: file.suggestedFilename(), bytes: new Uint8Array(Buffer.concat(chunks)) };
}

async function findings(page) {
    return page.evaluate(() => {
        const found = [];
        for (const node of document.querySelectorAll('button,input,select,textarea,summary')) {
            const box = node.getBoundingClientRect();
            if (!box.width || !box.height || getComputedStyle(node).visibility === 'hidden') continue;
            if (box.height < 43.5 || box.width < 43.5) found.push('Small target: ' + node.tagName + ' ' + (node.getAttribute('aria-label') || node.textContent || node.id).slice(0, 30));
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !node.labels?.length && !node.getAttribute('aria-label')) found.push('Unlabelled control: ' + node.tagName + ' ' + node.id);
            if (node.tagName === 'BUTTON' && !node.textContent.trim() && !node.getAttribute('aria-label')) found.push('Unlabelled button');
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) found.push('Horizontal page overflow');
        for (const node of document.querySelectorAll('*')) {
            const box = node.getBoundingClientRect();
            if (box.width && box.height && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 1) found.push('Horizontal scroller: ' + node.tagName + ' ' + node.className);
        }
        return found;
    });
}


const card = page => page.locator('[data-cf=formula]');
const withFormula = formula => { const pack = JSON.parse(PACK); pack.content.rpg = { ...pack.content.rpg, formula }; return JSON.stringify(pack); };
async function settings(page) {
    await navigate(page, 'Pack settings');
    await page.locator('main h1', { hasText: 'Pack settings' }).waitFor();
}

test('Pack settings has no Stat formula card, and exporting adds no formula', async () => {
    await withPage({}, async page => {
        await load(page, PACK);
        await settings(page);
        assert.equal(await card(page).count(), 0);
        assert.equal(await page.locator('[data-formula]').count(), 0);
        assert.doesNotMatch(await page.locator('main').innerText(), /Stat formula|Classic|Reader's choice/);
        await navigate(page, 'Check / export');
        const pack = JSON.parse(new TextDecoder().decode((await downloaded(page, '#export-btn')).bytes));
        assert.equal(pack.content?.rpg?.formula, undefined);
    });
});

test('a pack that says standard loads clean and keeps its formula on export', async () => {
    await withPage({}, async page => {
        await load(page, withFormula('standard'));
        await navigate(page, 'Check / export');
        assert.doesNotMatch(await page.locator('main').innerText(), /content\.rpg\.formula/);
        const pack = JSON.parse(new TextDecoder().decode((await downloaded(page, '#export-btn')).bytes));
        assert.equal(pack.content.rpg.formula, 'standard');
    });
});

test('a pack that says classic shows the refusal in Check', async () => {
    await withPage({}, async page => {
        await load(page, withFormula('classic'));
        await navigate(page, 'Check / export');
        const text = await page.locator('main').innerText();
        assert.match(text, /content\.rpg\.formula/);
        assert.match(text, /no longer supported/);
        assert.equal(await card(page).count(), 0);
    });
});

for (const [name, options] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    test(`Pack settings keeps the target size and labels in both themes on a ${name}`, async () => {
        for (const theme of ['dark', 'light']) {
            await withPage({ ...options, theme }, async page => {
                await load(page, PACK);
                if (options.width < 600) await openParts(page);
                await settings(page);
                assert.deepEqual(await findings(page), []);
            });
        }
    });
}
