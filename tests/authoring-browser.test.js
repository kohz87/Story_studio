// The three author workflows run from the shipped page, with every other request blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openPack } from '../src/model.js';
import { exportWorldInfo } from '../src/lorebook.js';
import { worldPack } from './fixtures/world.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const SHOTS = resolve(process.env.STUDIO_SCREENSHOTS_DIR || 'artifacts/part-3');
const fixture = readFileSync(new globalThis.URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const golden = name => readFileSync(new globalThis.URL(`./golden/${name}.json`, import.meta.url), 'utf8');

async function withPage(action, options = {}) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
        ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 1200 }, acceptDownloads: true, colorScheme: 'dark' });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('request', request => { if (request.url() !== URL) requests.push(request.url()); });
        await context.route('**/*', route => route.request().url() === URL && route.request().isNavigationRequest() ? route.continue() : route.abort());
        await page.goto(URL);
        await page.locator('.studio').waitFor();
        await action(page);
        assert.deepEqual(requests, [], 'No network or subresource requests');
        assert.deepEqual(errors, [], 'No page or console errors');
        await context.close();
    } finally { await browser.close(); }
}
async function upload(page, pack) {
    const data = typeof pack === 'string' ? pack : JSON.stringify(pack);
    await page.setInputFiles('#pack-file', { name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(data) });
    await page.waitForFunction(name => document.getElementById('pack-name').value === name, JSON.parse(data).name);
}
async function navigate(page, name) { await page.locator('.rail').getByRole('button', { name, exact: true }).click(); }
async function importLore(page, value) {
    await page.setInputFiles('#lore-file', { name: 'lore.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
}
async function download(page, name) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}
async function screenshot(page, name) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(SHOTS, name + '.png'), fullPage: true });
}
async function packDownload(page) {
    await navigate(page, 'Check / export');
    return (await download(page, 'Export pack file')).bytes;
}
async function assertLayout(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await page.locator('.inspector').isVisible(), false);
    assert.deepEqual(await page.locator('main').evaluate(node => [...node.querySelectorAll('input,textarea,select')]
        .filter(control => control.getClientRects().length && !control.labels.length && !control.getAttribute('aria-label')).map(control => control.id)), []);
}

test('offline narrator flow edits V2 JSON and exports a decodable PNG with identical metadata', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await upload(page, fixture);
        await navigate(page, 'Narrator card');
        assert.equal(await page.locator('#card-first_mes').inputValue(), JSON.parse(golden('ersveil-narrator')).data.first_mes);
        assert.equal((await download(page, 'Download card JSON')).bytes.toString(), golden('ersveil-narrator'));
        await page.locator('#card-name').fill('Bluewatch Narrator');
        await page.locator('#card-personality').fill('Measured pace; salt air and quiet tension.');
        await page.locator('#card-first_mes').fill('You stand at Bluewatch Village as the quay stirs. What do you do?');
        await navigate(page, 'Lorebook');
        await navigate(page, 'Narrator card');
        assert.equal(await page.locator('#card-name').inputValue(), 'Bluewatch Narrator', 'Edits survive navigation');
        const json = await download(page, 'Download card JSON');
        assert.equal(json.name, 'ersveil-narrator.json');
        const card = JSON.parse(json.bytes);
        assert.equal(card.data.personality, 'Measured pace; salt air and quiet tension.');
        assert.match(card.data.first_mes, /Bluewatch Village/);
        assert.match(card.data.description, /op kind Name\[ — text\]\[ \| label: value\]\*/);
        const png = await download(page, 'Download card PNG');
        assert.equal(png.name, 'ersveil-narrator.png');
        let metadata;
        for (let at = 8; at < png.bytes.length;) {
            const length = png.bytes.readUInt32BE(at);
            if (png.bytes.toString('ascii', at + 4, at + 8) === 'tEXt') metadata = png.bytes.subarray(at + 8, at + 8 + length);
            at += length + 12;
        }
        assert.equal(metadata.subarray(0, 6).toString(), 'chara\0');
        assert.deepEqual(Buffer.from(metadata.subarray(6).toString(), 'base64'), json.bytes);
        const dimensions = await page.evaluate(async bytes => {
            const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
            const size = [image.width, image.height];
            image.close();
            return size;
        }, [...png.bytes]);
        assert.deepEqual(dimensions, [128, 192]);
        await assertLayout(page);
        await screenshot(page, 'narrator-card');
        await page.getByRole('button', { name: 'Reset card from pack', exact: true }).click();
        assert.equal((await download(page, 'Download card JSON')).bytes.toString(), golden('ersveil-narrator'));
        assert.equal((await packDownload(page)).toString(), fixture, 'Card edits never alter the pack');
    });
});

test('blank card names visibly refuse JSON and PNG downloads until corrected', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await upload(page, worldPack());
        await navigate(page, 'Narrator card');
        const downloads = [];
        page.on('download', file => downloads.push(file.suggestedFilename()));
        for (const name of ['', ' \t\u00a0\u2003']) {
            await page.locator('#card-name').fill(name);
            assert.equal(await page.locator('#card-preview').textContent(), 'export-error: Card name must not be empty');
            await navigate(page, 'Lorebook');
            await navigate(page, 'Narrator card');
            assert.equal(await page.locator('#card-name').inputValue(), name, 'Invalid drafts remain editable after navigation');
            for (const format of ['JSON', 'PNG']) {
                await page.getByRole('button', { name: `Download card ${format}`, exact: true }).click();
                assert.equal(await page.locator('.notice').isVisible(), true);
                assert.equal(await page.locator('.notice').textContent(), 'export-error: Card name must not be empty');
                assert.deepEqual(downloads, []);
            }
        }
        await page.locator('#card-name').fill('A named narrator');
        assert.equal(JSON.parse(await page.locator('#card-preview').textContent()).data.name, 'A named narrator');
        const json = await download(page, 'Download card JSON');
        assert.equal(JSON.parse(json.bytes).data.name, 'A named narrator');
        const png = await download(page, 'Download card PNG');
        assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.deepEqual(downloads, ['fixture-narrator.json', 'fixture-narrator.png']);
    });
});

test('offline lorebook flow previews names, aliases and regions and exports the Ersveil golden', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await upload(page, fixture);
        await navigate(page, 'Lorebook');
        const expected = JSON.parse(golden('ersveil-world-info'));
        assert.equal(await page.locator('.lore-entry').count(), Object.keys(expected.entries).length);
        await page.locator('.lore-entry').first().locator('summary').click();
        assert.match(await page.locator('.lore-entry').first().textContent(), /region: Highmark Empire/);
        const file = await download(page, 'Download World Info JSON');
        assert.equal(file.name, 'ersveil-world-info.json');
        assert.equal(file.bytes.toString(), golden('ersveil-world-info'));
        await assertLayout(page);
        await screenshot(page, 'lorebook');
        assert.equal((await packDownload(page)).toString(), fixture);
    });
});

test('offline import flow accepts, skips, refuses duplicates and repairs a draft explicitly with Undo', { timeout: 60000 }, async () => {
    await withPage(async page => {
        const pack = { id: 'local', version: '1.0.0', name: 'Local', requires: { storyBlock: '^2' }, content: {} };
        await upload(page, pack);
        await navigate(page, 'Import lorebook');
        await importLore(page, { entries: {
            0: { key: ['Quiet Port', 'Harbor'], content: 'Wet docks.', comment: 'A starting place' },
            1: { key: ['Skip me'], content: 'Not for this pack.' },
            2: { key: ['Quiet Port'], content: 'Do not overwrite the first record.' },
            3: { key: ['Key'], content: 'Opens the port gate.', extensions: { story_studio: { kind: 'items' } } },
            4: { key: ['Fenna'], content: 'An ink-stained clerk.', extensions: { story_studio: { kind: 'npcs' } } },
        } });
        await page.locator('#lore-name').waitFor();
        const before = await packDownload(page);
        assert.deepEqual(JSON.parse(before), pack, 'Loading World Info alone does not edit the pack');
        await navigate(page, 'Import lorebook');
        await page.locator('#lore-region').fill('River Coast');
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        await page.getByRole('button', { name: 'Skip entry', exact: true }).click();
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.match(await page.getByRole('region', { name: 'Draft entry', exact: true }).textContent(), /dup-id/);
        await screenshot(page, 'lore-import');
        await page.locator('#lore-slug').fill('second-port');
        await page.locator('#lore-name').fill('Second Port');
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.equal(await page.locator('#lore-kind').inputValue(), 'items');
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.equal(await page.locator('#lore-kind').inputValue(), 'creatures');
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.match(await page.locator('#import-counts').textContent(), /5 reviewed/);
        const after = openPack((await packDownload(page)).toString());
        assert.equal(after.validation.ok, true);
        assert.equal(after.document.content.places.length, 2);
        assert.equal(after.document.content.places[0].note, 'Wet docks.');
        assert.equal(after.document.content.places[0].region, 'River Coast');
        assert.deepEqual(after.document.content.places[0].aliases, ['Harbor']);
        assert.equal(after.document.content.items[0].name, 'Key');
        assert.equal(after.document.content.creatures[0].name, 'Fenna');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        const undone = openPack((await packDownload(page)).toString());
        assert.equal(undone.document.content.creatures, undefined);
        assert.equal(undone.document.content.items[0].name, 'Key');
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await navigate(page, 'Lorebook');
        assert.equal((await download(page, 'Download World Info JSON')).bytes.toString(), exportWorldInfo(after.document));
        await assertLayout(page);
    }, { width: 1024 });
});

test('imported HTML is literal, malformed entries and files stay visible, long text requires explicit editing', { timeout: 60000 }, async () => {
    await withPage(async page => {
        await upload(page, { id: 'local', version: '1.0.0', name: 'Local', requires: { storyBlock: '^2' }, content: {} });
        await navigate(page, 'Import lorebook');
        const hostile = '<img src=x onerror="window.injected=1"><script>window.injected=1</script>';
        await importLore(page, { entries: { 0: { key: [hostile, '<b>alias</b>'], comment: hostile, content: hostile }, 1: null, 2: { key: ['Long text'], content: 'x'.repeat(501) } } });
        await page.locator('#lore-content').waitFor();
        assert.equal(await page.locator('#lore-content').inputValue(), hostile);
        assert.equal(await page.locator('#lore-name').inputValue(), hostile);
        assert.equal(await page.locator('main img,main script,main b,main iframe').count(), 0);
        assert.equal(await page.evaluate(() => window.injected), undefined);
        assert.match(await page.getByRole('region', { name: 'Entry decisions', exact: true }).textContent(), /refused/);
        await page.getByRole('button', { name: 'Skip entry', exact: true }).click();
        await page.getByRole('button', { name: 'Skip entry', exact: true }).click();
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.match(await page.getByRole('alert').textContent(), /500 characters/);
        assert.equal((await page.locator('#lore-content').inputValue()).length, 501);
        await page.locator('#lore-content').fill('Shortened by the author.');
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        const accepted = await packDownload(page);
        await navigate(page, 'Import lorebook');
        await importLore(page, '{"entries":{"__proto__":{}}}');
        await page.getByRole('alert').waitFor();
        assert.match(await page.getByRole('alert').textContent(), /Import refused: Unsafe key/);
        assert.equal(await page.evaluate(() => ({}).polluted), undefined);
        assert.equal((await packDownload(page)).toString(), accepted.toString());
        await navigate(page, 'Import lorebook');
        await importLore(page, 'x'.repeat(2 * 1024 * 1024 + 1));
        await page.getByRole('alert').waitFor();
        assert.match(await page.getByRole('alert').textContent(), /2 MiB/);
        await assertLayout(page);
    });
});

test('narrative NPC imports in world packs stay valid and preserve undo', { timeout: 60000 }, async () => {
    await withPage(async page => {
        const pack = worldPack();
        await upload(page, pack);
        await navigate(page, 'Import lorebook');
        await importLore(page, { entries: { 0: { key: ['Clerk'], content: 'Keeps records.' } } });
        await page.locator('#lore-kind').selectOption('creatures');
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.deepEqual(JSON.parse(await packDownload(page)), pack);
    });
});

test('import refuses an existing host-derived ID and retains the original file bytes', { timeout: 60000 }, async () => {
    await withPage(async page => {
        const pack = { id: 'local', version: '1.0.0', name: 'Local', requires: { storyBlock: '^2' }, content: {
            places: [{ name: 'Café Port', x: 0, y: 0, note: 'The original port.' }],
        } };
        await upload(page, pack);
        await navigate(page, 'Import lorebook');
        await importLore(page, { entries: [{ key: ['Café Port'], content: 'Replacement attempt.' }] });
        await page.getByRole('button', { name: 'Accept draft', exact: true }).click();
        assert.match(await page.getByRole('alert').textContent(), /dup-id/);
        assert.equal((await packDownload(page)).toString(), JSON.stringify(pack));
    });
});

test('card drafts reset when opening another pack and derived exports never mark pack edits as saved', { timeout: 60000 }, async () => {
    await withPage(async page => {
        const pack = worldPack();
        await upload(page, pack);
        await page.locator('#pack-name').fill('An edited pack');
        await page.locator('#pack-name').press('Tab');
        await navigate(page, 'Narrator card');
        await page.locator('#card-name').fill('Local card edit');
        await download(page, 'Download card JSON');
        await navigate(page, 'Lorebook');
        await download(page, 'Download World Info JSON');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('story-studio-draft')).dirty), true);
        await upload(page, { id: 'other', version: '1.0.0', name: 'Another pack', requires: { storyBlock: '^2' }, content: {} });
        await navigate(page, 'Narrator card');
        assert.equal(await page.locator('#card-name').inputValue(), 'Another pack — Narrator');
        await navigate(page, 'Import lorebook');
        assert.equal(await page.locator('#import-counts').count(), 0);
    });
});
