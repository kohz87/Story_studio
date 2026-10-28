// Browser workflows against the committed offline distribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { worldPack } from './fixtures/world.js';
import { openPack } from '../src/model.js';
import { openParts } from './helpers/parts.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;

async function withPage(options, action) {
    const browser = await chromium.launch({
        headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}),
    });
    try {
        const context = await browser.newContext({
            viewport: { width: options.width ?? 1280, height: 820 },
            colorScheme: options.theme ?? 'dark', acceptDownloads: true,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
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
        if (options.storageDenied) await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                get() { throw new DOMException('Access denied', 'SecurityError'); },
            });
        });
        await page.goto(URL);
        await page.locator('.studio').waitFor();
        await action(page);
        assert.deepEqual(requests, [], 'No subresource or network requests, including during editing and export');
        assert.deepEqual(errors, [], 'No page or console errors');
        await context.close();
    } finally {
        await browser.close();
    }
}

async function upload(page, pack) {
    await page.setInputFiles('#pack-file', {
        name: 'fixture.json', mimeType: 'application/json',
        buffer: Buffer.from(typeof pack === 'string' ? pack : JSON.stringify(pack)),
    });
    if (typeof pack !== 'string') await page.waitForFunction(name => document.getElementById('pack-name').value === name, pack.name);
}

async function navigate(page, name) {
    await page.locator('.rail').getByRole('button', { name: new RegExp('^' + name) }).click();
}

async function closeInspector(page) {
    const close = page.getByRole('button', { name: 'Close inspector', exact: true });
    if (await close.isVisible()) await close.click();
}

async function change(page, selector, value) {
    await page.locator(selector).fill(value);
    await page.locator(selector).press('Tab');
}

async function download(page) {
    await navigate(page, 'Check / export');
    assert.equal(await page.locator('#export-btn').isEnabled(), true);
    const pending = page.waitForEvent('download');
    await page.locator('#export-btn').click();
    const file = await pending;
    const stream = await file.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function checkAccessibility(page) {
    const findings = await page.evaluate(() => {
        const findings = [];
        for (const node of document.querySelectorAll('button,input,select,textarea,summary')) {
            const box = node.getBoundingClientRect();
            if (!box.width || !box.height || getComputedStyle(node).visibility === 'hidden') continue;
            if (box.height < 43.5 || box.width < 43.5) findings.push('Small target: ' + node.tagName + ' ' + node.id);
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) &&
                !node.labels?.length && !node.getAttribute('aria-label')) findings.push('Unlabelled control: ' + node.id);
            if (node.tagName === 'BUTTON' && !node.textContent.trim() && !node.getAttribute('aria-label')) findings.push('Unlabelled button');
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) findings.push('Horizontal page overflow');
        for (const node of document.querySelectorAll('*')) {
            const box = node.getBoundingClientRect();
            if (box.width && box.height && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX)
                && node.scrollWidth > node.clientWidth + 1) findings.push('Horizontal scroller: ' + node.tagName + ' ' + node.className);
        }
        return findings;
    });
    assert.deepEqual(findings, []);
}

async function checkPrimaryContrast(page) {
    const colors = await page.locator('.topbar button.primary').evaluate(node => {
        const ctx = document.createElement('canvas').getContext('2d');
        return ['color', 'backgroundColor'].map(key => {
            ctx.fillStyle = getComputedStyle(node)[key];
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        });
    });
    const luminance = rgb => rgb.map(n => {
        const v = n / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const values = colors.map(luminance).sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, 'Primary text contrast must reach 4.5:1');
}

for (const theme of ['dark', 'light']) for (const width of [1280, 1024]) {
    test(`offline world workflow ${theme} ${width}`, { timeout: 60000 }, async () => {
        await withPage({ theme, width }, async page => {
            const pack = worldPack({ routes: [{ slug: 'road', from: 'haven', to: 'mill', kind: 'road' }] });
            await upload(page, pack);
            await checkPrimaryContrast(page);
            await checkAccessibility(page);
            await openParts(page);
            await navigate(page, 'Places');
            await page.locator('.record-card[data-id="haven"]').click();
            await change(page, `input[data-path='["content","places",0,"name"]']`, 'Renamed Haven');
            assert.equal(await page.locator('.inspector-title-row h2').textContent(), 'Renamed Haven');
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            assert.deepEqual(JSON.parse(await download(page)), pack);
        });
    });
}

test('hostile packs stay literal and unsafe input preserves the current draft', { timeout: 30000 }, async () => {
    await withPage({}, async page => {
        const pack = worldPack();
        pack.name = '<b>x</b>';
        pack.content.places[0].name = '<b>Haven</b>';
        await upload(page, pack);
        assert.equal(await page.locator('#studio b,#studio script,#studio iframe').count(), 0);
        await upload(page, '{"id":"fixture","__proto__":{"polluted":true}}');
        await page.waitForFunction(() => /UNSAFE_KEY/.test(document.querySelector('.notice').textContent));
        assert.equal(await page.locator('#pack-name').inputValue(), '<b>x</b>');
        assert.equal(await page.evaluate(() => ({}).polluted), undefined);
    });
});

test('denied storage still allows open edit undo and original-byte export', { timeout: 30000 }, async () => {
    await withPage({ storageDenied: true }, async page => {
        const golden = worldPack();
        await upload(page, golden);
        await change(page, '#pack-name', '[PRIVATE DRAFT]');
        assert.equal(await page.locator('#pack-name').inputValue(), '[PRIVATE DRAFT]');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(await page.locator('#pack-name').inputValue(), golden.name);
        assert.deepEqual(await download(page), Buffer.from(JSON.stringify(golden)));
    });
});

test('bundled Ersveil bytes survive browser open, edit/undo and draft reload offline', { timeout: 120000 }, async () => {
    const text = readFileSync(new globalThis.URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
    await withPage({}, async page => {
        page.setDefaultTimeout(15000);
        await upload(page, text);
        await page.waitForFunction(() => document.getElementById('pack-name').value === 'Ersveil (open world)');
        assert.ok((await download(page)).equals(Buffer.from(text)));
        await change(page, '#pack-name', 'Edited Ersveil');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.ok((await download(page)).equals(Buffer.from(text)));
        await page.reload();
        await page.locator('.studio').waitFor();
        assert.ok((await download(page)).equals(Buffer.from(text)));
        await navigate(page, 'Pack settings');
        const weather = page.locator('details').filter({ has: page.locator('summary', { hasText: /^weather$/ }) });
        await weather.locator('summary').click();
        const weatherText = JSON.stringify({ tables: [{ weather: ['rain'] }] });
        await weather.locator('textarea').fill(weatherText);
        await weather.locator('textarea').press('Tab');
        const exported = openPack((await download(page)).toString('utf8'));
        assert.equal(exported.validation.ok, true);
        assert.deepEqual(exported.document.weather, JSON.parse(weatherText));
    });
});

test('offline name edit and export preserve Unicode-distinct keys in layouts and screen data', { timeout: 30000 }, async () => {
    await withPage({}, async page => {
        const pack = worldPack();
        const nfc = 'caf\u00e9', nfd = 'cafe\u0301';
        pack.layouts = [{ [nfc]: 1, [nfd]: 2 }];
        pack.screens = [{ id: 'camp', layout: { root: 'camp' },
            data: { [nfc]: { query: 'party.pc' }, [nfd]: { query: 'party.all' } } }];
        await upload(page, pack);
        await change(page, '#pack-name', 'Renamed');
        const bytes = await download(page);
        const exported = JSON.parse(bytes);
        assert.deepEqual(exported, { ...pack, name: 'Renamed' });
        for (const key of ['layouts', 'screens']) {
            assert.deepEqual(Buffer.from(JSON.stringify(exported[key])), Buffer.from(JSON.stringify(pack[key])));
        }
        await page.reload();
        await page.locator('.studio').waitFor();
        assert.deepEqual(await download(page), bytes, 'Raw data also survives draft persistence');
    });
});
