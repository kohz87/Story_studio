// Adjustable columns and the parts list on a world pack at desktop and phone widths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openParts } from './helpers/parts.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const BLUEWATCH = readFileSync(new globalThis.URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const KEY = 'story-studio-columns';

async function withPage(options, action) {
    const browser = await chromium.launch({
        headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}),
    });
    try {
        const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: options.height ?? 820 }, colorScheme: 'dark' });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [], requests = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('request', req => {
            if (!(req.url() === URL && req.isNavigationRequest() && req.frame() === page.mainFrame())) requests.push(req.url());
        });
        await context.route('**/*', route => (route.request().url() === URL && route.request().isNavigationRequest() ? route.continue() : route.abort()));
        if (options.storageDenied) await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Access denied', 'SecurityError'); } });
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

async function load(page, text = BLUEWATCH) {
    await page.setInputFiles('#pack-file', { name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.getElementById('pack-name').value !== '');
}

// The rail also holds the "More kinds" list; the first eight buttons are the kinds.
async function open(page, name) {
    await openParts(page);
    await page.locator('.rail').getByRole('button', { name: new RegExp('^' + name) }).click();
    await page.locator('main h1', { hasText: name }).waitFor();
}

const divider = (page, name) => page.locator(`.divider-${name}`);
const values = (page, name) => divider(page, name).evaluate(node => ({
    now: Number(node.getAttribute('aria-valuenow')), min: Number(node.getAttribute('aria-valuemin')), max: Number(node.getAttribute('aria-valuemax')),
}));
const widths = page => page.evaluate(() => ({
    rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width),
    list: Math.round(document.querySelector('main').getBoundingClientRect().width),
    inspector: Math.round(document.querySelector('.inspector').getBoundingClientRect().width),
}));
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);

async function drag(page, name, dx) {
    const box = await divider(page, name).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 6 });
    await page.mouse.up();
}

async function focusDivider(page, name) {
    await page.keyboard.press('Tab');
    await divider(page, name).focus();
}

for (const width of [1280, 900]) {
    test(`dividers at ${width}: markup, drag, keys, clamps and reset`, { timeout: 90000 }, async () => {
        await withPage({ width }, async page => {
            await load(page);
            const rail = divider(page, 'rail');
            assert.equal(await rail.getAttribute('role'), 'separator');
            assert.equal(await rail.getAttribute('aria-orientation'), 'vertical');
            assert.equal(await rail.getAttribute('aria-controls'), 'rail');
            assert.equal(await rail.getAttribute('tabindex'), '0');
            assert.deepEqual(await values(page, 'rail'), { now: 190, min: 150, max: 320 });
            assert.equal((await widths(page)).rail, 190);

            await drag(page, 'rail', 60);
            assert.equal((await values(page, 'rail')).now, 250);
            assert.equal((await widths(page)).rail, 250);
            assert.equal((await stored(page)).rail, 250);
            await drag(page, 'rail', 900);
            assert.equal((await values(page, 'rail')).now, 320, 'the drag stops at the maximum');
            await drag(page, 'rail', -900);
            assert.equal((await values(page, 'rail')).now, 150, 'the drag stops at the minimum');

            await focusDivider(page, 'rail');
            await page.keyboard.press('ArrowRight');
            assert.equal((await values(page, 'rail')).now, 166);
            await page.keyboard.press('Shift+ArrowRight');
            assert.equal((await values(page, 'rail')).now, 230);
            await page.keyboard.press('ArrowLeft');
            assert.equal((await values(page, 'rail')).now, 214);
            await page.keyboard.press('Shift+ArrowLeft');
            assert.equal((await values(page, 'rail')).now, 150);
            await page.keyboard.press('End');
            assert.equal((await values(page, 'rail')).now, 320);
            assert.equal((await widths(page)).rail, 320);
            await page.keyboard.press('ArrowRight');
            assert.equal((await values(page, 'rail')).now, 320, 'arrows stop at the maximum');
            await page.keyboard.press('Home');
            assert.equal((await values(page, 'rail')).now, 150);
            await page.keyboard.press('ArrowLeft');
            assert.equal((await values(page, 'rail')).now, 150, 'arrows stop at the minimum');
            await page.keyboard.press('End');
            await page.keyboard.press('Enter');
            assert.equal((await values(page, 'rail')).now, 190, 'Enter resets');
            await page.keyboard.press('End');
            await rail.dblclick();
            assert.equal((await values(page, 'rail')).now, 190, 'a double click resets');
            assert.equal((await stored(page)).rail, 190);

            const inspectorVisible = await divider(page, 'inspector').isVisible();
            assert.equal(inspectorVisible, width === 1280, 'the inspector divider shows from 1101 px up only');
            assert.equal(await page.locator('.divider:visible').count(), width === 1280 ? 2 : 1);
        });
    });
}

test('the inspector divider at 1280: markup, drag, keys, clamps, reset, and the list keeps 320 px', { timeout: 90000 }, async () => {
    await withPage({ width: 1280 }, async page => {
        await load(page);
        const bar = divider(page, 'inspector');
        assert.equal(await bar.getAttribute('role'), 'separator');
        assert.equal(await bar.getAttribute('aria-orientation'), 'vertical');
        assert.equal(await bar.getAttribute('aria-controls'), 'inspector');
        assert.deepEqual(await values(page, 'inspector'), { now: 330, min: 280, max: 640 });
        assert.equal((await widths(page)).inspector, 330);

        await drag(page, 'inspector', -100);
        assert.equal((await values(page, 'inspector')).now, 430, 'dragging left widens the inspector');
        assert.equal((await widths(page)).inspector, 430);
        await drag(page, 'inspector', -900);
        assert.equal((await values(page, 'inspector')).now, 640);
        await drag(page, 'inspector', 900);
        assert.equal((await values(page, 'inspector')).now, 280);

        await focusDivider(page, 'inspector');
        await page.keyboard.press('ArrowLeft');
        assert.equal((await values(page, 'inspector')).now, 296);
        await page.keyboard.press('Shift+ArrowLeft');
        assert.equal((await values(page, 'inspector')).now, 360);
        await page.keyboard.press('ArrowRight');
        assert.equal((await values(page, 'inspector')).now, 344);
        await page.keyboard.press('End');
        assert.equal((await values(page, 'inspector')).now, 640);
        await page.keyboard.press('Home');
        assert.equal((await values(page, 'inspector')).now, 280);
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        assert.equal((await values(page, 'inspector')).now, 330);
        await page.keyboard.press('End');
        await bar.dblclick();
        assert.equal((await values(page, 'inspector')).now, 330);

        // With the inspector at 640 the rail may not take the list under 320 px.
        await page.keyboard.press('End');
        await focusDivider(page, 'rail');
        await page.keyboard.press('End');
        const { rail } = await widths(page);
        const { list } = await widths(page);
        assert.ok(list >= 320, `the list is ${list} px`);
        assert.equal(rail, 1280 - 2 * 12 - 320 - 640);
        assert.equal((await values(page, 'rail')).max, rail);
    });
});

test('the grip shows on hover and on keyboard focus, not at rest', { timeout: 60000 }, async () => {
    await withPage({}, async page => {
        await load(page);
        const grip = name => divider(page, name).locator('.grip').evaluate(node => getComputedStyle(node).opacity);
        assert.equal(await grip('rail'), '0');
        await divider(page, 'rail').hover();
        assert.equal(await grip('rail'), '1');
        await page.mouse.move(640, 400);
        assert.equal(await grip('rail'), '0');
        await focusDivider(page, 'inspector');
        assert.equal(await grip('inspector'), '1');
        assert.equal(await divider(page, 'inspector').evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    });
});

test('widths are remembered on this device across a reload, and reset is remembered too', { timeout: 90000 }, async () => {
    await withPage({}, async page => {
        await load(page);
        await drag(page, 'rail', 40);
        await drag(page, 'inspector', -70);
        assert.deepEqual(await stored(page), { rail: 230, inspector: 400 });
        await page.reload();
        await page.locator('.studio').waitFor();
        await page.waitForFunction(() => document.getElementById('pack-name').value !== '');
        assert.deepEqual(await values(page, 'rail'), { now: 230, min: 150, max: 320 });
        assert.deepEqual(await values(page, 'inspector'), { now: 400, min: 280, max: 640 });
        assert.deepEqual(await widths(page), { rail: 230, list: 1280 - 230 - 400 - 24, inspector: 400 });
        await focusDivider(page, 'rail');
        await page.keyboard.press('Enter');
        await page.reload();
        await page.locator('.studio').waitFor();
        assert.equal((await values(page, 'rail')).now, 190);
    });
});

test('damaged stored widths fall back to the defaults, and out-of-range ones are held to the range', { timeout: 60000 }, async () => {
    for (const [raw, expected] of [['{"rail":"wide","inspector":"x"}', [190, 330]], ['not json', [190, 330]], ['{"rail":-4,"inspector":99999}', [150, 640]]]) {
        await withPage({}, async page => {
            await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, raw]);
            await page.reload();
            await page.locator('.studio').waitFor();
            await load(page);
            assert.deepEqual([(await values(page, 'rail')).now, (await values(page, 'inspector')).now], expected, raw);
        });
    }
});

test('with no storage at all the columns still work from the defaults', { timeout: 60000 }, async () => {
    await withPage({ storageDenied: true }, async page => {
        await load(page);
        assert.deepEqual([(await values(page, 'rail')).now, (await values(page, 'inspector')).now], [190, 330]);
        await drag(page, 'rail', 30);
        assert.equal((await widths(page)).rail, 220);
        await focusDivider(page, 'inspector');
        await page.keyboard.press('Shift+ArrowLeft');
        assert.equal((await widths(page)).inspector, 394);
        await page.keyboard.press('Enter');
        assert.equal((await widths(page)).inspector, 330);
    });
});

test('at 390 px the columns stack with no dividers', { timeout: 90000 }, async () => {
    await withPage({ width: 390, height: 844 }, async page => {
        await load(page);
        await open(page, 'Places');
        assert.equal(await page.locator('.divider:visible').count(), 0);
        const tops = await page.evaluate(() => ['.rail', 'main', '.inspector'].map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().top)));
        assert.ok(tops[0] < tops[1] && tops[1] < tops[2], 'pack parts, then the list, then the inspector: ' + tops);
        const full = await page.evaluate(() => ['.rail', 'main', '.inspector'].map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().width)));
        assert.deepEqual(full, [390, 390, 390]);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    });
});

test('at 390 px the parts list starts collapsed, opens on a tap and collapses again after a part is picked', { timeout: 90000 }, async () => {
    await withPage({ width: 390, height: 844 }, async page => {
        await load(page);
        const summary = page.locator('.parts > summary');
        const list = page.locator('.parts-list');
        assert.equal(await summary.isVisible(), true);
        assert.match(await summary.innerText(), /^Places\s+320$/);
        assert.equal(await page.locator('.parts').evaluate(node => node.open), false, 'it starts collapsed');
        assert.equal(await list.isVisible(), false);
        await summary.click();
        assert.equal(await list.isVisible(), true);
        await list.getByRole('button', { name: /^Places/ }).click();
        await page.locator('main h1', { hasText: 'Places' }).waitFor();
        assert.equal(await page.locator('.parts').evaluate(node => node.open), false, 'picking a part collapses it');
        assert.equal(await list.isVisible(), false);
        assert.match(await summary.innerText(), /^Places\s+320$/);
        await openParts(page);
        assert.equal(await list.isVisible(), true);
        await openParts(page);
        assert.equal(await list.isVisible(), true, 'openParts leaves an open list alone');
        await list.getByRole('button', { name: /^Routes/ }).click();
        assert.match(await summary.innerText(), /^Routes\s+350$/);
        assert.equal(await list.isVisible(), false);
    });
});

for (const width of [1280, 900, 601]) {
    test(`above 600 px (${width}) the parts list is always visible, with no disclosure row`, { timeout: 60000 }, async () => {
        await withPage({ width }, async page => {
            await load(page);
            assert.equal(await page.locator('.parts > summary').isVisible(), false);
            assert.equal(await page.locator('.parts-list').isVisible(), true);
            await page.locator('.rail').getByRole('button', { name: /^Places/ }).click();
            assert.equal(await page.locator('.parts-list').isVisible(), true, 'picking a part does not collapse it');
        });
    });
}
