// The Stat formula card of Pack settings in a real browser, against the committed offline distribution: the choice, the help line,
// Undo and Redo, a reload, the exported pack, Check, and the usual target-size and contrast checks on a desktop and a phone.
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
const pick = (page, name) => card(page).getByRole('button', { name, exact: true }).click();
const pressed = page => card(page).locator('button[aria-pressed=true]').allInnerTexts();
const exported = async page => {
    await navigate(page, 'Check / export');
    return JSON.parse(new TextDecoder().decode((await downloaded(page, '#export-btn')).bytes));
};
async function settings(page) {
    await navigate(page, 'Pack settings');
    await card(page).waitFor();
}

test('the card is first in Pack settings; a choice writes content.rpg.formula, exports, checks, undoes and redoes', async () => {
    await withPage({}, async page => {
        await load(page, PACK);
        await settings(page);
        assert.equal(await page.locator('main > *').nth(3).getAttribute('data-cf'), 'formula');
        assert.equal(await card(page).locator('h3').innerText(), 'Stat formula');
        assert.deepEqual(await card(page).locator('button').allInnerTexts(), ["Reader's choice", 'Standard', 'Classic']);
        assert.deepEqual(await pressed(page), ["Reader's choice"]);
        assert.equal(await card(page).locator('.cf-hint').innerText(), 'The reader picks in Settings → RPG; a chat that never chose plays Standard.');
        await pick(page, 'Classic');
        assert.deepEqual(await pressed(page), ['Classic']);
        assert.equal(await card(page).locator('.cf-hint').innerText(), 'One stat on its own, stats start at 10, and the bars are fixed.');
        assert.equal((await exported(page)).content.rpg.formula, 'classic');
        await settings(page);
        await pick(page, 'Standard');
        assert.equal(await card(page).locator('.cf-hint').innerText(), 'A main stat plus half a second one, stats start at 5 and grow, and the bars grow with VIT, AGI and INT.');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.deepEqual(await pressed(page), ['Classic']);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        assert.deepEqual(await pressed(page), ['Standard']);
        await page.reload();
        await page.locator('.studio').waitFor();
        await navigate(page, 'Check / export');
        assert.doesNotMatch(await page.locator('main').innerText(), /content\.rpg\.formula/);
        await settings(page);
        await pick(page, "Reader's choice");
        assert.deepEqual(await pressed(page), ["Reader's choice"]);
        assert.equal(Object.hasOwn((await exported(page)).content ?? {}, 'rpg'), false);
    });
});

test('numbers and skill sets of content.rpg stay when the choice changes; the JSON card shows the same record', async () => {
    const pack = JSON.parse(PACK);
    pack.content.rpg = { formula: 'classic', numbers: { foeBase: 5 }, skillSets: [{ name: 'Wayfarer', skills: [{ name: 'Spark', about: 'A small burst of magic.', stat: 'int', uses: 'mana' }] }] };
    await withPage({}, async page => {
        await load(page, JSON.stringify(pack));
        await settings(page);
        assert.deepEqual(await pressed(page), ['Classic']);
        await pick(page, "Reader's choice");
        const json = page.locator('details').filter({ has: page.locator('summary', { hasText: /^content\.rpg$/ }) });
        await json.locator('summary').click();
        assert.deepEqual(JSON.parse(await json.locator('textarea').inputValue()), { numbers: pack.content.rpg.numbers, skillSets: pack.content.rpg.skillSets });
        assert.deepEqual((await exported(page)).content.rpg, { numbers: pack.content.rpg.numbers, skillSets: pack.content.rpg.skillSets });
    });
});

for (const [name, options] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    test(`the card keeps the target size, labels and contrast in both themes on a ${name}`, async () => {
        for (const theme of ['dark', 'light']) {
            await withPage({ ...options, theme }, async page => {
                await load(page, PACK);
                if (options.width < 600) await openParts(page);
                await settings(page);
                await pick(page, 'Classic');
                assert.deepEqual(await findings(page), []);
                const ratio = await card(page).locator('.cf-hint').evaluate(node => {
                    const channel = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                    const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
                    const hex = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
                    const [high, low] = [lum(getComputedStyle(node).color.match(/[\d.]+/g).slice(0, 3).map(Number)), lum([1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)))].sort((a, b) => b - a);
                    return (high + 0.05) / (low + 0.05);
                });
                assert.ok(ratio >= 4.5, `${theme} ${ratio}`);
            });
        }
    });
}
