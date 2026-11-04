// The Character card page, run from the shipped page with every other request blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { worldPack } from './fixtures/world.js';
import { pngBytes } from './helpers/images.js';
import { readCardPng } from '../src/card-png.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;

async function withPage(action) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true, colorScheme: 'dark' });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('request', request => { if (request.url() !== URL) requests.push(request.url()); });
        await context.route('**/*', route => route.request().url() === URL && route.request().isNavigationRequest() ? route.continue() : route.abort());
        await page.goto(URL);
        await page.locator('.studio').waitFor();
        await action(page);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        await context.close();
    } finally { await browser.close(); }
}
const open = async page => {
    await page.setInputFiles('#pack-file', { name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(worldPack())) });
    await page.waitForFunction(() => document.getElementById('pack-name').value === 'Fixture');
};
const go = (page, name) => page.locator('.rail').getByRole('button', { name, exact: true }).click();
async function download(page, name) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}
const fieldIds = ['#card-name', '#card-description', '#card-personality', '#card-scenario', '#card-first_mes', '#card-mes_example', '#card-system_prompt',
    '#card-post_history_instructions', '#card-note', '#card-note-depth', '#card-note-role', '#card-talkativeness', '#card-creator', '#card-character_version', '#card-creator_notes'];
const values = page => page.evaluate(ids => ids.map(id => document.querySelector(id).value), fieldIds);

test('Build a card… on Check / export opens the Character card page, and the rail item is renamed', async () => {
    await withPage(async page => {
        await open(page);
        await go(page, 'Check / export');
        await page.locator('#build-card').click();
        assert.equal(await page.locator('h1').textContent(), 'Character card');
        assert.equal(await page.locator('.rail').getByRole('button', { name: 'Narrator card' }).count(), 0);
        assert.equal(await page.locator('#card-saved').textContent(), 'Saved with the pack.');
    });
});

test('every field is written, and picking the downloaded card again gives the same fields', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await open(page);
        await go(page, 'Character card');
        await page.locator('#card-name').fill('Wren the Guide');
        await page.locator('#card-mes_example').fill('<START>\n{{char}}: Hi');
        await page.locator('#card-system_prompt').fill('Be brief.');
        await page.locator('#card-post_history_instructions').fill('Stay kind.');
        await page.locator('#card-note').fill('Remember the lantern.');
        await page.locator('#card-note-depth').fill('7');
        await page.locator('#card-note-role').selectOption('assistant');
        await page.locator('#card-talkativeness').fill('0.4');
        await page.locator('#card-creator').fill('An author');
        await page.locator('#card-character_version').fill('3');
        await page.locator('#card-creator_notes').fill('For testing.');
        await page.locator('#card-greeting-add').click();
        await page.locator('#card-greeting-0').fill('Another hello');
        await page.locator('#card-tag-input').fill('fantasy, rpg');
        await page.locator('#card-tag-add').click();
        const before = await values(page);
        const json = await download(page, 'Download card JSON');
        const png = await download(page, 'Download card PNG');
        const card = JSON.parse(json.bytes);
        assert.equal(card.data.extensions.depth_prompt.depth, 7);
        assert.equal(card.data.extensions.talkativeness, 0.4);
        assert.deepEqual(card.data.alternate_greetings, ['Another hello']);
        assert.deepEqual(card.data.tags, ['fantasy', 'rpg']);
        assert.equal(readCardPng(new Uint8Array(png.bytes)), json.bytes.toString());
        for (const [name, bytes, type] of [['card.json', json.bytes, 'application/json'], ['card.png', png.bytes, 'image/png']]) {
            await go(page, 'Lorebook');
            await go(page, 'Character card');
            await page.getByRole('button', { name: 'Reset card from pack', exact: true }).click();
            assert.notDeepEqual(await values(page), before);
            await page.setInputFiles('#card-file', { name, mimeType: type, buffer: bytes });
            await page.locator('#card-pick-note').waitFor();
            assert.deepEqual(await values(page), before, `${name} gives the same fields`);
            assert.equal(await page.locator('#card-greeting-0').inputValue(), 'Another hello');
            assert.deepEqual(await page.locator('.cc-chip span:first-child').allTextContents(), ['fantasy', 'rpg']);
            assert.equal((await download(page, 'Download card JSON')).bytes.toString(), json.bytes.toString());
        }
    });
});

test('card drafts and the picture are saved with the pack and survive a reload', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await open(page);
        await go(page, 'Character card');
        await page.locator('#card-name').fill('Kept over a reload');
        await page.locator('#card-greeting-add').click();
        await page.locator('#card-greeting-0').fill('Still here');
        await page.locator('#setting-scan').check();
        await page.locator('#setting-scan-value').fill('9');
        await page.setInputFiles('#card-image-file', { name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(pngBytes(60, 90, 3)) });
        await page.waitForFunction(() => document.getElementById('card-image').alt === 'Card image');
        await page.waitForTimeout(300);
        await page.reload();
        await page.locator('.studio').waitFor();
        await go(page, 'Character card');
        assert.equal(await page.locator('#card-name').inputValue(), 'Kept over a reload');
        assert.equal(await page.locator('#card-greeting-0').inputValue(), 'Still here');
        assert.equal(await page.locator('#setting-scan').isChecked(), true);
        assert.equal(await page.locator('#setting-scan-value').inputValue(), '9');
        await page.waitForFunction(() => document.getElementById('card-image').alt === 'Card image');
        const png = await download(page, 'Download card PNG');
        assert.ok(png.bytes.length > pngBytes(60, 90, 3).length);
        await page.locator('#card-image-remove').click();
        assert.equal(await page.locator('#card-image').getAttribute('alt'), 'Default card cover');
    });
});

test('the checklist sizes add up to the total, and unticking a part takes its size out', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await open(page);
        await go(page, 'Character card');
        const read = () => page.evaluate(() => ({
            rows: [...document.querySelectorAll('.cc-size')].map(cell => +cell.dataset.bytes),
            total: +document.getElementById('card-total').dataset.bytes, png: +document.getElementById('card-total-png').dataset.bytes,
        }));
        await page.waitForFunction(() => document.getElementById('card-total').dataset.bytes);
        let sizes = await read();
        assert.ok(sizes.total > 0 && sizes.png > sizes.total);
        const parts = sizes.rows.reduce((a, b) => a + b, 0);
        assert.ok(sizes.total > parts, 'the card text is the rest');
        await page.locator('#put-lore').uncheck();
        await page.waitForFunction(old => +document.getElementById('card-total').dataset.bytes < old, sizes.total);
        const after = await read();
        assert.equal(after.rows[1], 0);
        assert.ok(sizes.total - after.total >= sizes.rows[1] - 40);
    });
});
