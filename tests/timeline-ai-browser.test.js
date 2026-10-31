// Writing timeline events with an AI in a real browser, against the committed offline distribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openParts } from './helpers/parts.js';

const PAGE = pathToFileURL(resolve('dist/story-studio.html')).href;
const ersveil = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const idea = 'The Emperor of Highmark dies in early winter CY 612. The news reaches the north about two weeks later.';
const answer = JSON.stringify([
    { name: 'The Emperor of Highmark dies', when: { on: 'icewane 4, cy 612, dawn' }, where: ['highmark empire'], news: 'Bells toll from the capital: the Emperor is dead.', lasting: { name: 'Highmark succession', state: 'looming', keep: true } },
    { name: 'News reaches the north', when: { after: 'The Emperor of Highmark dies', days: 14 }, where: ['Shornmarch', 'Bluewatch Village'], news: 'The news arrives.' },
    { name: 'The Diet splits', when: { after: 'The Emperor of Highmark dies', days: 30 }, where: ['Highmark Capital Nowhere'], news: 'Split.' },
], null, 2);

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

// Every control reachable, 44 px at least, with a label; no sideways scroll.
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
    test(`writing events with an AI: ask, paste, drafts, keep, offline ${theme} ${width}`, { timeout: 90000 }, async () => {
        await withPage({ theme, width }, async page => {
            await openParts(page);
            await page.locator('.rail').getByRole('button', { name: /^Timeline/ }).click();
            const write = page.getByRole('button', { name: '✦ Write with an AI', exact: true });
            await write.click();
            const panel = page.locator('.inspector .tl-ai');
            assert.equal(await panel.locator('h2').textContent(), 'Write events with an AI');
            assert.equal(await panel.locator('[aria-current]').textContent(), '1 · Ask');
            assert.ok(await panel.getByRole('button', { name: 'Copy prompt' }).isDisabled(), 'nothing to copy until there is an idea');
            await panel.getByLabel('Your idea, in your own words').fill(idea);
            assert.equal(await panel.locator('input[type=checkbox]').count(), 4);
            for (const box of await panel.locator('input[type=checkbox]').all()) assert.ok(await box.isChecked());
            assert.match(await panel.locator('pre').textContent(), /^You are helping a writer plan hidden world events for the Story Suite pack "Ersveil \(open world\)"[\s\S]*THE WRITER'S IDEA:\nThe Emperor of Highmark dies in early winter CY 612\.[\s\S]*PLACES: Abyssal Throat/);
            assert.match(await panel.locator('summary').textContent(), /^The prompt \([\d,]+ words\)$/);
            assert.deepEqual(await findings(page), []);
            await panel.getByLabel(/^\s*The 7 events already here/).uncheck();
            assert.ok(!/EVENTS ALREADY/.test(await panel.locator('pre').textContent()));
            await panel.getByRole('button', { name: 'Copy prompt' }).click();
            await page.locator('.tl-ai [role=status]').filter({ hasText: /Copied\.|would not copy it/ }).waitFor();
            assert.deepEqual(await findings(page), []);
            await panel.getByRole('button', { name: 'Next: paste the answer' }).click();
            await panel.getByLabel('Paste it here').fill(answer);
            await panel.getByRole('button', { name: 'Check it' }).click();
            assert.equal(await panel.locator('.tl-ai-draft').count(), 3);
            assert.deepEqual(await panel.locator('.tl-ai-draft > span:first-child').allTextContents(), ['✓ Ready', '✓ Ready', '⚠ Needs a look']);
            assert.deepEqual(await findings(page), []);
            await panel.getByRole('button', { name: 'Add 3 as drafts' }).click();
            // The drafts: a chip, a dashed outline, a warning on the one that needs a look; the pack's count is unchanged.
            assert.equal(await page.locator('.tl-draft-row').count(), 3);
            assert.equal(await page.locator('.tl-draft-row .tl-chips .tl-draft').count(), 3);
            assert.equal(await page.locator('.tl-draft-row').first().evaluate(node => getComputedStyle(node).borderTopStyle), 'dashed');
            assert.equal(await page.locator('.tl-draft-row .tl-warn').count(), 1);
            assert.match(await page.locator('.records-subtitle').textContent(), /7 events \+ 3 drafts/);
            assert.match(await page.evaluate(() => [...document.querySelectorAll('.rail .parts-list button')].find(node => /^Timeline/.test(node.textContent)).textContent), /7$/, 'the rail counts the pack\'s events only');
            const banner = page.locator('.inspector .tl-banner');
            assert.match(await banner.textContent(), /Draft from the AI/);
            assert.equal(await page.locator('.inspector .inspector-title-row .tl-draft').textContent(), 'Draft');
            assert.equal(await page.locator('[aria-label="From day"]').inputValue(), '4');
            assert.deepEqual(await findings(page), []);
            // Drafts are left out of the Problems export check and of the export.
            assert.equal(await page.getByRole('button', { name: /^Problems/ }).textContent(), 'Problems (0)');
            // A draft that needs a look cannot be kept; the one that is ready can.
            await page.locator('.tl-row[data-id="the-diet-splits"]').click();
            assert.ok(await page.locator('.inspector .tl-banner').getByRole('button', { name: 'Keep', exact: true }).isDisabled());
            assert.match(await page.locator('.inspector .tl-banner').textContent(), /“Highmark Capital Nowhere” is not a place in this pack/);
            assert.deepEqual(await findings(page), []);
            await page.locator('.tl-row[data-id="the-emperor-of-highmark-dies"]').click();
            await page.locator('.inspector .tl-banner').getByRole('button', { name: 'Keep', exact: true }).click();
            assert.match(await page.locator('.records-subtitle').textContent(), /^8 events \+ 2 drafts/);
            assert.equal(await page.locator('.tl-draft-row').count(), 2);
            assert.equal(await page.locator('.inspector .tl-banner').count(), 0);
            assert.match(await page.locator('.inspector-title-row .chip').textContent(), /^Event$/);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            assert.equal(await page.locator('.tl-draft-row').count(), 3);
            assert.match(await page.locator('.records-subtitle').textContent(), /^7 events \+ 3 drafts/);
            assert.deepEqual(await findings(page), []);
        });
    });
}

test('drafts survive a reload, and Discard and Keep all work, offline', { timeout: 90000 }, async () => {
    await withPage({ theme: 'light', width: 1280 }, async page => {
        await page.locator('.rail').getByRole('button', { name: /^Timeline/ }).click();
        await page.getByRole('button', { name: '✦ Write with an AI', exact: true }).click();
        const panel = page.locator('.inspector .tl-ai');
        await panel.getByLabel('Your idea, in your own words').fill(idea);
        await panel.getByRole('button', { name: 'Next: paste the answer' }).click();
        await panel.getByLabel('Paste it here').fill(answer);
        await panel.getByRole('button', { name: 'Check it' }).click();
        await panel.getByRole('button', { name: 'Add 3 as drafts' }).click();
        assert.equal(await page.locator('.tl-draft-row').count(), 3);
        await page.reload();
        await page.locator('.studio').waitFor();
        await page.waitForFunction(() => document.getElementById('pack-name').value !== '');
        await page.locator('.rail').getByRole('button', { name: /^Timeline/ }).click();
        assert.equal(await page.locator('.tl-draft-row').count(), 3);
        assert.match(await page.locator('.records-subtitle').textContent(), /7 events \+ 3 drafts/);
        await page.locator('.tl-row[data-id="the-diet-splits"]').click();
        await page.getByRole('button', { name: 'Discard', exact: true }).click();
        assert.equal(await page.locator('.tl-draft-row').count(), 2);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(await page.locator('.tl-draft-row').count(), 3);
        await page.locator('.tl-row[data-id="the-emperor-of-highmark-dies"]').click();
        await page.getByRole('button', { name: 'Keep the 2 that are ready', exact: true }).click();
        assert.equal(await page.locator('.tl-draft-row').count(), 1);
        assert.match(await page.locator('.records-subtitle').textContent(), /^9 events \+ 1 draft /);
        assert.equal(await page.getByRole('button', { name: /^Problems/ }).textContent(), 'Problems (0)');
    });
});
