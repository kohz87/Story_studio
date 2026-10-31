// The Timeline in a real browser, against the committed offline distribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openParts } from './helpers/parts.js';

const PAGE = pathToFileURL(resolve('dist/story-studio.html')).href;
const ersveil = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');

async function withPage(options, action) {
    const browser = await chromium.launch({
        headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}),
    });
    try {
        const context = await browser.newContext({ viewport: { width: options.width, height: 900 }, colorScheme: options.theme });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [], requests = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('request', req => { if (!(req.url() === PAGE && req.isNavigationRequest())) requests.push(req.url()); });
        await context.route('**/*', route => (route.request().url() === PAGE && route.request().isNavigationRequest() ? route.continue() : route.abort()));
        await page.goto(PAGE);
        await page.locator('.studio').waitFor();
        await page.setInputFiles('#pack-file', { name: 'ersveil.json', mimeType: 'application/json', buffer: Buffer.from(ersveil) });
        await page.waitForFunction(() => document.getElementById('pack-name').value !== '');
        await action(page);
        assert.deepEqual(requests, [], 'No network requests');
        assert.deepEqual(errors, [], 'No page or console errors');
        await context.close();
    } finally { await browser.close(); }
}

async function findings(page) {
    return page.evaluate(() => {
        const out = [];
        for (const node of document.querySelectorAll('.records-screen button,.records-screen input,.inspector button,.inspector input,.inspector select,.inspector textarea,.inspector summary')) {
            const box = node.getBoundingClientRect();
            if (!box.width || !box.height || getComputedStyle(node).visibility === 'hidden') continue;
            if (box.height < 43.5 || box.width < 43.5) out.push(`Small target: ${node.tagName} ${node.textContent.slice(0, 20)} ${box.width}x${box.height}`);
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !node.labels?.length && !node.getAttribute('aria-label')) out.push(`Unlabelled control: ${node.tagName}`);
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push('Horizontal page overflow');
        return out;
    });
}

for (const [theme, width] of [['dark', 1280], ['light', 1024], ['light', 390]]) {
    test(`the Timeline shows, edits and undoes offline ${theme} ${width}`, { timeout: 60000 }, async () => {
        await withPage({ theme, width }, async page => {
            await openParts(page);
            await page.locator('.rail').getByRole('button', { name: /^Timeline/ }).click();
            assert.equal(await page.locator('.records-header h1').textContent(), 'Timeline');
            assert.deepEqual(await page.locator('.tl-year').allTextContents(), ['CY 611 · the story starts Goldwane 12', 'CY 612', 'CY 613', 'Any date · by place only']);
            assert.equal(await page.locator('.tl-row').count(), 7);
            assert.equal(await page.locator('.tl-chain').count(), 1);
            await page.locator('.tl-row[data-id="the-turning-612"]').click();
            assert.equal(await page.locator('.inspector-title-row h2').textContent(), 'The turning 612');
            assert.equal(await page.locator('[aria-label="From day"]').inputValue(), '21');
            assert.deepEqual(await findings(page), []);
            const when = () => page.locator('[aria-label="when"]').inputValue();
            const before = await when();
            await page.locator('details.tl-advanced summary').click();
            await page.locator('[aria-label="From day"]').fill('22');
            await page.locator('[aria-label="From day"]').press('Tab');
            assert.match(await when(), /time\(\) >= 317636640 && time\(\) < 317692799/);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            assert.equal(await when(), before);
            // Below 1100 px the inspector slides over the list: close it first.
            const close = page.getByRole('button', { name: 'Close inspector', exact: true });
            if (await close.isVisible()) await close.click();
            await page.getByRole('button', { name: 'List', exact: true }).click();
            assert.equal(await page.locator('.tl-row').count(), 0);
            assert.equal(await page.locator('.record-card').count(), 7);
            assert.deepEqual(await findings(page), []);
        });
    });
}
