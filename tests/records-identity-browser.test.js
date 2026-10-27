// Name-keyed records (Bluewatch's items and places have no slug) are told apart in the real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const PACK = JSON.parse(readFileSync(resolve('tests/fixtures/ersveil-bluewatch.json'), 'utf8'));

async function withPage(action) {
    const browser = await chromium.launch({
        headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}),
    });
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
        await context.route('**/*', route => (route.request().url() === URL ? route.continue() : route.abort()));
        await page.goto(URL);
        await page.locator('.studio').waitFor();
        await page.setInputFiles('#pack-file', { name: 'bluewatch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PACK)) });
        await page.waitForFunction(name => document.getElementById('pack-name').value === name, PACK.name);
        await action(page);
        assert.deepEqual(errors, [], 'No page or console errors');
        await context.close();
    } finally {
        await browser.close();
    }
}

async function open(page, label) {
    await page.locator('.rail').getByRole('button', { name: new RegExp('^' + label) }).click();
    const close = page.getByRole('button', { name: 'Close inspector', exact: true });
    if (await close.isVisible()) await close.click();
}

const pressedIndexes = page => page.locator('.record-card').evaluateAll(cards => cards.flatMap((card, i) => (card.getAttribute('aria-pressed') === 'true' ? [i] : [])));
const listed = (page, kind) => page.evaluate(kind => JSON.parse(localStorage.getItem('story-studio-draft'))?.document?.content?.[kind]?.map(r => r.name), kind);

for (const [label, kind, count] of [['Items', 'items', 43], ['Places', 'places', 54]]) {
    test(`Bluewatch ${kind}: clicking the second record selects and shows only that record`, async () => {
        await withPage(async page => {
            await open(page, label);
            assert.equal(await page.locator('.record-card').count(), count);
            assert.deepEqual(await pressedIndexes(page), []);
            const ids = await page.locator('.record-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-id')));
            assert.equal(new Set(ids).size, count, 'every card has its own ID');
            assert.ok(ids.every(Boolean));

            const second = page.locator('.record-card').nth(1);
            const name = await second.locator('.record-card-name').textContent();
            await second.click();
            assert.deepEqual(await pressedIndexes(page), [1], 'only the second card is highlighted');
            assert.equal(await page.locator('.record-card[aria-pressed="true"]').count(), 1);
            assert.equal(await page.locator('.inspector-title-row h2').textContent(), name);
            assert.equal(await page.locator(`.inspector-body input[data-path='["content","${kind}",1,"name"]']`).inputValue(), name);

            await page.locator('.record-card').nth(5).click();
            assert.deepEqual(await pressedIndexes(page), [5]);
            assert.notEqual(await page.locator('.inspector-title-row h2').textContent(), name);
        });
    });

    test(`Bluewatch ${kind}: renaming a record keeps it selected, and Remove takes away only it`, async () => {
        await withPage(async page => {
            await open(page, label);
            await page.locator('.record-card').nth(1).click();
            const before = await page.locator('.record-card .record-card-name').allTextContents();
            const nameInput = page.locator(`.inspector-body input[data-path='["content","${kind}",1,"name"]']`);
            await nameInput.fill('Renamed By Hand');
            await nameInput.press('Tab');
            assert.deepEqual(await pressedIndexes(page), [1], 'the selection follows the renamed record');
            assert.equal(await page.locator('.inspector-title-row h2').textContent(), 'Renamed By Hand');
            assert.equal(await page.locator('.record-card').nth(1).getAttribute('data-id'), 'renamed-by-hand');

            await page.locator('.inspector-body').getByRole('button', { name: 'Remove…', exact: true }).click();
            const dialog = page.getByRole('dialog');
            if (await dialog.count()) await dialog.getByRole('button', { name: /^Remove all/ }).click();
            const after = await page.locator('.record-card .record-card-name').allTextContents();
            const expected = before.filter((_, i) => i !== 1);
            // Taking a place away also takes the routes and shops that name it, never another place.
            assert.deepEqual(after, expected, 'only the second record is gone');
            assert.deepEqual(await pressedIndexes(page), []);
            assert.deepEqual((await listed(page, kind)).filter(name => name === 'Renamed By Hand'), []);
        });
    });
}
