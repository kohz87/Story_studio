// The Cast part in a real browser, against the committed offline distribution: the rail, the portrait picker (a real canvas
// shrinks a real picture), undo and redo, a reload, the .zip going out and coming back, and the usual target-size and contrast checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { castEntries, castPack } from './fixtures/cast.js';
import { pngBytes } from './helpers/images.js';
import { openParts } from './helpers/parts.js';
import { writeZip } from '../src/cast/zip.js';
import { readPackZip } from '../vendor/story-block/src/v2/packs/bundle.js';
import { sniffImage } from '../vendor/story-block/src/v2/packs/portraits.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const PACK = JSON.stringify(castPack());

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
async function openPerson(page, name) {
    await navigate(page, 'Cast');
    await page.locator('.record-card', { hasText: name }).click();
    await page.locator('.inspector h2', { hasText: name }).waitFor();
}
const choose = (page, bytes, name = 'picture.png', mimeType = 'image/png') => page.locator('input[data-cast-portrait]').setInputFiles({ name, mimeType, buffer: Buffer.from(bytes) });
const facts = page => page.locator('[data-portrait-facts]').innerText();
const pictureBytes = page => page.locator('.cf-face img').evaluate(img => {
    const [head, data] = img.src.split(',');
    const text = atob(data);
    return { type: head, bytes: Array.from(text, char => char.charCodeAt(0)) };
});
// The form's redraw replaces every control. Stamp the controls on screen, then wait until none is left and the
// expected field (label, and value when given) holds focus: a state the page reaches once the redraw has settled.
const stampForm = page => page.evaluate(() => document.querySelectorAll('.cf-form [data-cast-focus]').forEach(node => node.setAttribute('data-test-old', '')));
const redrawn = (page, label, value) => page.waitForFunction(([want, text]) => {
    const node = document.activeElement;
    return !document.querySelector('.cf-form [data-test-old]') && node?.closest?.('.cf-form')
        && node.labels?.[0]?.firstChild?.textContent === want && (text === undefined || node.value === text);
}, [label, value]);
// Focus on a labelled cast field (and its value) as it stands after any further redraw: polls, so a second redraw that
// lands under load cannot fail a one-shot read; the end state is what matters.
const focusedOn = (page, label, value) => page.waitForFunction(([want, text]) => {
    const node = document.activeElement;
    return node?.closest?.('.cf-form') && node.labels?.[0]?.firstChild?.textContent === want && (text === undefined || node.value === text);
}, [label, value]);
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

test('the Cast sits in the rail beside People / creatures, with its count, and opens the list', async () => {
    await withPage({}, async page => {
        await load(page);
        const names = await page.locator('.rail .parts-list > button').evaluateAll(nodes => nodes.slice(0, 11).map(node => node.querySelector('span').textContent));
        assert.deepEqual(names, ['Places', 'Routes', 'Timeline', 'Items', 'People / creatures', 'Cast', 'Names', 'Ripples', 'Races', 'Talents', 'Presets']);
        assert.equal(await page.locator('.rail').getByRole('button', { name: /^Cast/ }).locator('small').innerText(), '2');
        await navigate(page, 'Cast');
        await page.locator('main h1', { hasText: 'Cast' }).waitFor();
        assert.equal(await page.locator('main .record-card').count(), 2);
        assert.match(await page.locator('main .records-subtitle').innerText(), /^2 people · hidden from players until met$/);
        assert.equal(await page.locator('.rail .parts-list > button[aria-current=page]').count(), 1);
    });
});

test('a big picture is made smaller to fit 150 KB as a WebP, named after the person, and its size is shown', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        const big = pngBytes(480, 600, 14);
        assert.ok(big.length > 500 * 1024);
        await choose(page, big);
        await page.locator('.cf-face img').waitFor();
        const text = await facts(page);
        assert.match(text, /^fenna\.webp · 480 × 600 · \d+ KB \(made smaller from \d+ KB PNG\)\. Pictures are made smaller automatically to fit 150 KB; JPEG, PNG or WebP\.$/);
        const { type, bytes } = await pictureBytes(page);
        assert.equal(type, 'data:image/webp;base64');
        assert.ok(bytes.length <= 150 * 1024, `${bytes.length} bytes`);
        assert.equal(sniffImage(Uint8Array.from(bytes)), 'webp');
        assert.match(text, new RegExp(`${Math.round(bytes.length / 1024)} KB`));
        assert.equal(await page.locator('main .record-card', { hasText: 'Fenna' }).locator('img').count(), 1);
        assert.match(await page.locator('main .record-card', { hasText: 'Fenna' }).innerText(), /portrait \d+ KB/);
        assert.equal(await page.locator('.cf-face img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    });
});

test('a picture that already fits is kept as it is, keeping its own type', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Sera');
        await choose(page, pngBytes(40, 50, 0));
        await page.locator('.cf-face img').waitFor();
        const text = await facts(page);
        assert.match(text, /^sera\.png · 40 × 50 · \d+ KB \(kept as it was\)\./);
        assert.equal((await pictureBytes(page)).type, 'data:image/png;base64');
    });
});

test('a file that is not a picture is refused in plain words and nothing changes', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Sera');
        await choose(page, Buffer.from('not a picture at all, just words'), 'words.png');
        await page.locator('.notice', { hasText: 'portrait:' }).waitFor();
        assert.match(await page.locator('.notice').innerText(), /portrait: That file is not a picture this browser can read\./);
        assert.equal(await page.locator('.cf-face img').count(), 0);
        assert.equal(await page.locator('[data-portrait-facts]').getByText('is named').count(), 0);
    });
});

test('choosing a picture, removing it and replacing it are undone and redone with the top-bar buttons', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        const picture = () => page.locator('.cf-face img').count();
        await choose(page, pngBytes(40, 50, 0));
        await page.locator('.cf-face img').waitFor();
        const first = (await pictureBytes(page)).bytes.length;
        await page.getByRole('button', { name: 'Remove', exact: true }).click();
        await page.locator('.cf-face img').waitFor({ state: 'detached' });
        assert.equal(await picture(), 0);
        assert.match(await facts(page), /^Pictures are made smaller/);
        await page.getByRole('button', { name: 'Undo' }).click();
        await page.locator('.cf-face img').waitFor();
        assert.equal((await pictureBytes(page)).bytes.length, first);
        // Replacing a picture under the same name and undoing it brings the first one back.
        await choose(page, pngBytes(60, 80, 0));
        await page.locator('[data-portrait-facts]', { hasText: '60 × 80' }).waitFor();
        const second = (await pictureBytes(page)).bytes.length;
        assert.notEqual(second, first);
        await page.getByRole('button', { name: 'Undo' }).click();
        assert.equal((await pictureBytes(page)).bytes.length, first);
        await page.getByRole('button', { name: 'Redo' }).click();
        assert.equal((await pictureBytes(page)).bytes.length, second);
        await page.getByRole('button', { name: 'Undo' }).click();
        await page.getByRole('button', { name: 'Undo' }).click();
        assert.equal(await picture(), 0);
        assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), true);
    });
});

test('the pictures come back after a reload, and the check counts them', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        await choose(page, pngBytes(40, 50, 0));
        await page.locator('.cf-face img').waitFor();
        const before = (await pictureBytes(page)).bytes.length;
        await page.reload();
        await page.locator('.studio').waitFor();
        await openPerson(page, 'Fenna');
        await page.locator('.cf-face img').waitFor();
        assert.equal((await pictureBytes(page)).bytes.length, before);
        await navigate(page, 'Check / export');
        assert.match(await page.locator('.cf-list').innerText(), /Portraits: 1 file, \d+ KB together \(each under 150 KB\)\./);
    });
});

test('without IndexedDB everything still works; only the reload loses the pictures', async () => {
    await withPage({ noIndexedDb: true }, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        await choose(page, pngBytes(40, 50, 0));
        await page.locator('.cf-face img').waitFor();
        await page.reload();
        await page.locator('.studio').waitFor();
        await openPerson(page, 'Fenna');
        assert.match(await facts(page), /fenna\.png is named, but no picture is held for it/);
    });
});

test('Export .zip gives pack.json and the pictures the cast names, as Story Block reads them; Export pack.json only gives the pack', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        await choose(page, pngBytes(480, 600, 14));
        await page.locator('.cf-face img').waitFor();
        await navigate(page, 'Check / export');
        const lines = await page.locator('.cf-list li').allInnerTexts();
        assert.match(lines.find(line => line.startsWith('Portraits')), /^Portraits: 1 file, \d+ KB together \(each under 150 KB\)\.$/);
        assert.match(await page.locator('.cf-zip').innerText(), /^fixture-2\.0\.0\.zip\n {2}pack\.json +\d+ KB\n {2}portraits\/fenna\.webp +\d+ KB$/);
        const zip = await downloaded(page, '#export-zip');
        assert.equal(zip.name, 'fixture-2.0.0.zip');
        const read = await readPackZip(zip.bytes);
        assert.equal(read.ok, true, read.message);
        assert.equal(JSON.parse(read.text).content.cast[0].portrait, 'fenna.webp');
        assert.deepEqual(read.files.map(file => file.name), ['fenna.webp']);
        const picture = await read.files[0].read();
        assert.equal(sniffImage(picture), 'webp');
        assert.ok(picture.length <= 150 * 1024);
        const plain = await downloaded(page, '#export-btn');
        assert.equal(plain.name, 'fixture-2.0.0.json');
        assert.equal(new TextDecoder().decode(plain.bytes), read.text);
    });
});

test('Open pack takes the .zip: the pack and its pictures arrive together, and the same zip exported again is the same zip', async () => {
    const picture = pngBytes(40, 50, 0);
    const cast = castEntries();
    cast[0].portrait = 'fenna.png';
    const text = JSON.stringify(castPack({ cast }));
    const zip = await writeZip([{ name: 'pack.json', bytes: new TextEncoder().encode(text) }, { name: 'portraits/fenna.png', bytes: picture }]);
    await withPage({}, async page => {
        await load(page, Buffer.from(zip), 'fixture-2.0.0.zip', 'application/zip');
        await navigate(page, 'Cast');
        assert.equal(await page.locator('main .record-card', { hasText: 'Fenna' }).locator('img').count(), 1);
        await page.locator('.record-card', { hasText: 'Fenna' }).click();
        assert.match(await facts(page), /^fenna\.png · 40 × 50 · \d+ KB\./);
        await navigate(page, 'Check / export');
        const again = await downloaded(page, '#export-zip');
        const read = await readPackZip(again.bytes);
        assert.equal(read.ok, true);
        assert.equal(read.text, text);
        assert.deepEqual(await read.files[0].read(), picture);
        assert.deepEqual(again.bytes, zip);
    });
});

test('a zip Story Block would refuse is refused here with its words, and the open pack stays', async () => {
    const zip = await writeZip([{ name: 'pack.json', bytes: new TextEncoder().encode(PACK) }, { name: 'notes.txt', bytes: new TextEncoder().encode('hi') }]);
    await withPage({}, async page => {
        await load(page);
        await page.setInputFiles('#pack-file', { name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
        await page.locator('.notice', { hasText: 'zip-refused' }).waitFor();
        assert.match(await page.locator('.notice').innerText(), /zip-refused: The zip holds "notes\.txt", which is not pack\.json or a portrait the pack's cast names/);
        assert.equal(await page.locator('#pack-name').inputValue(), 'Fixture');
        await page.setInputFiles('#pack-file', { name: 'junk.zip', mimeType: 'application/zip', buffer: Buffer.from('this is not a zip file at all, not even close') });
        await page.locator('.notice', { hasText: 'not a zip' }).waitFor();
        assert.equal(await page.locator('#pack-name').inputValue(), 'Fixture');
    });
});

test('a picture left out of a zip, or too big, is left out with a note and the pack still opens', async () => {
    const cast = castEntries();
    cast[0].portrait = 'fenna.png';
    const zip = await writeZip([{ name: 'pack.json', bytes: new TextEncoder().encode(JSON.stringify(castPack({ cast }))) }, { name: 'portraits/fenna.png', bytes: pngBytes(300, 300, 40) }]);
    await withPage({}, async page => {
        await load(page, Buffer.from(zip), 'big.zip', 'application/zip');
        assert.match(await page.locator('.notice').innerText(), /portrait: fenna\.png is over 150 KB; left out\./);
        await openPerson(page, 'Fenna');
        assert.match(await facts(page), /fenna\.png is named, but no picture is held for it/);
    });
});

test('a problem in a field is told in Story Block’s words, counted in Problems, and Go to finds the field', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        const look = page.getByLabel('Look', { exact: true });
        await look.fill('a <tag>');
        await look.press('Tab');
        await page.locator('.cf-error', { hasText: 'plain text' }).first().waitFor();
        assert.match(await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).innerText(), /^Problems \(1\)$/);
        assert.equal(await page.locator('.record-card[data-has-problem=true]').count(), 1);
        await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).click();
        await page.getByRole('button', { name: /^Go to problem at content\.cast\[0\]\.look/ }).click();
        assert.equal(await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.value), 'TEXTAREA:a <tag>');
        await page.getByRole('button', { name: 'Undo' }).click();
        assert.match(await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).innerText(), /^Problems \(0\)$/);
    });
});

test('typing in the form is undone and redone with the top-bar buttons', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        const voice = page.getByLabel('Voice', { exact: true });
        await voice.fill('Low and slow.');
        await voice.press('Tab');
        await page.getByRole('button', { name: 'Undo' }).click();
        assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'Dry and unhurried.');
        await page.getByRole('button', { name: 'Redo' }).click();
        assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'Low and slow.');
    });
});

test('typing across cast fields with Tab keeps focus and every character', async () => {
    const cast = castEntries();
    delete cast[0].aliases;
    await withPage({}, async page => {
        await load(page, JSON.stringify(castPack({ cast })));
        await openPerson(page, 'Fenna');
        const name = page.getByLabel('Name', { exact: true }).first();
        await name.fill('');
        await page.keyboard.type('Fenna Vale');
        await stampForm(page);
        await name.press('Tab');
        await page.keyboard.type('Captain ');
        await redrawn(page, 'Also called', 'Captain ');
        await focusedOn(page, 'Also called', 'Captain ');
        await page.keyboard.type('Fen');
        await focusedOn(page, 'Also called', 'Captain Fen');
        // No redraw is waited for here: a change that equals what is already saved legitimately redraws nothing.
        await page.keyboard.press('Tab');
        await focusedOn(page, 'In one line');
        await page.keyboard.press('Shift+Tab');
        await focusedOn(page, 'Also called', 'Captain Fen');
        await navigate(page, 'Check / export');
        const pack = JSON.parse(new TextDecoder().decode((await downloaded(page, '#export-btn')).bytes));
        assert.equal(pack.content.cast[0].name, 'Fenna Vale');
        assert.deepEqual(pack.content.cast[0].aliases, ['Captain Fen']);
    });
});

test('entering drawn-to phrases keeps focus and does not repeat the saved phrase', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        const input = page.getByLabel('Add something they are drawn to');
        await input.fill('the old bridge');
        await input.press('Enter');
        await page.locator('.cf-chip', { hasText: 'the old bridge' }).waitFor();
        assert.equal(await input.evaluate(node => node === document.activeElement), true);
        assert.equal(await input.inputValue(), '');
        await page.keyboard.type('a new boat');
        await input.press('Enter');
        await page.locator('.cf-chip', { hasText: 'a new boat' }).waitFor();
        assert.equal(await input.inputValue(), '');
        await input.press('Tab');
        assert.equal(await page.locator('.cf-chip', { hasText: 'the old bridge' }).count(), 1);
        assert.equal(await page.locator('.cf-chip', { hasText: 'a new boat' }).count(), 1);
    });
});

test('a pointer transition keeps a draft and its caret through the cast redraw', async () => {
    const cast = castEntries();
    delete cast[0].aliases;
    await withPage({}, async page => {
        await load(page, JSON.stringify(castPack({ cast })));
        await openPerson(page, 'Fenna');
        await page.getByLabel('Name', { exact: true }).first().fill('Fenna Vale');
        const aliases = page.getByLabel('Also called', { exact: true });
        const original = await aliases.elementHandle();
        const box = await aliases.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.keyboard.type('Captain ');
        await page.mouse.up();
        await page.waitForFunction(node => !node.isConnected, original);
        assert.equal(await aliases.inputValue(), 'Captain ');
        assert.deepEqual(await aliases.evaluate(node => [node === document.activeElement, node.selectionStart, node.selectionEnd]), [true, 8, 8]);
        await page.keyboard.press('Tab');
        assert.equal(await page.getByLabel('In one line', { exact: true }).evaluate(node => node === document.activeElement), true);
        await navigate(page, 'Check / export');
        const pack = JSON.parse(new TextDecoder().decode((await downloaded(page, '#export-btn')).bytes));
        assert.deepEqual(pack.content.cast[0].aliases, ['Captain']);
    });
});

test('a cast redraw preserves a draft until it is committed', async () => {
    const cast = castEntries();
    delete cast[0].aliases;
    cast[0].behaviour = ['Care: high - watches the river'];
    await withPage({}, async page => {
        await load(page, JSON.stringify(castPack({ cast })));
        await page.locator('.rail').getByRole('button', { name: /^Cast/ }).evaluate(node => node.click());
        await page.locator('.record-card', { hasText: 'Fenna' }).evaluate(node => node.click());
        const aliases = page.getByLabel('Also called', { exact: true });
        const original = await aliases.elementHandle();
        await page.getByLabel('Name', { exact: true }).first().evaluate(node => {
            node.focus();
            node.value = 'Fenna Vale';
            const next = [...document.querySelectorAll('input')].find(input => input.getAttribute('data-path')?.endsWith(',"aliases"]'));
            next.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
            next.focus();
            next.value = 'Captain ';
            next.setSelectionRange(8, 8);
            next.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.deepEqual(await original.evaluate(node => [node.isConnected, node === document.activeElement, node.value]), [true, true, 'Captain ']);
        await aliases.evaluate(node => node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
        await page.waitForFunction(node => !node.isConnected, original, { polling: 20 });
        assert.deepEqual(await aliases.evaluate(node => [node === document.activeElement, node.value, node.selectionStart, node.selectionEnd]), [true, 'Captain ', 8, 8]);
        await aliases.evaluate(node => node.blur());
        await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.getAttribute('data-path')?.endsWith(',"aliases"]') && input.value === 'Captain'), null, { polling: 20 });
        assert.equal(await aliases.inputValue(), 'Captain');
        const level = page.getByLabel('Level 1', { exact: true });
        const oldLevel = await level.elementHandle();
        const scroll = await level.evaluate(node => {
            node.focus();
            const top = document.querySelector('.inspector').scrollTop;
            node.value = 'medium';
            node.dispatchEvent(new Event('change', { bubbles: true }));
            return top;
        });
        assert.ok(scroll > 0);
        await page.waitForFunction(node => !node.isConnected, oldLevel, { polling: 20 });
        assert.equal(await level.evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('.inspector').evaluate(node => node.scrollTop), scroll);
        const number = page.getByLabel('Stage 1 value 1', { exact: true });
        const oldNumber = await number.elementHandle();
        await number.evaluate(node => { node.focus(); node.value = '21'; node.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForFunction(node => !node.isConnected, oldNumber, { polling: 20 });
        assert.deepEqual(await number.evaluate(node => [node === document.activeElement, node.value]), [true, '21']);
        const checkbox = page.getByRole('checkbox', { name: /may die off-screen/ });
        const oldCheckbox = await checkbox.elementHandle();
        await checkbox.evaluate(node => { node.focus(); node.checked = true; node.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForFunction(node => !node.isConnected, oldCheckbox, { polling: 20 });
        assert.deepEqual(await checkbox.evaluate(node => [node === document.activeElement, node.checked]), [true, true]);
        const look = page.getByLabel('Look', { exact: true });
        const oldLook = await look.elementHandle();
        await look.evaluate(node => {
            node.focus(); node.value = 'Calm and keen'; node.setSelectionRange(5, 8, 'backward');
            node.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(node => !node.isConnected, oldLook, { polling: 20 });
        assert.deepEqual(await look.evaluate(node => [node === document.activeElement, node.value, node.selectionStart, node.selectionEnd, node.selectionDirection]), [true, 'Calm and keen', 5, 8, 'backward']);
    });
});

test('cast text selections, selects, number fields and checkboxes retain focus on update', async () => {
    const cast = castEntries();
    cast[0].behaviour = ['Care: high - watches the river'];
    await withPage({}, async page => {
        await load(page, JSON.stringify(castPack({ cast })));
        await openPerson(page, 'Fenna');
        const look = page.getByLabel('Look', { exact: true });
        await look.fill('Calm and keen');
        await look.evaluate(node => node.setSelectionRange(5, 8, 'backward'));
        const oldLook = await look.elementHandle();
        await look.dispatchEvent('change');
        await page.waitForFunction(node => !node.isConnected, oldLook);
        assert.deepEqual(await look.evaluate(node => [node === document.activeElement, node.selectionStart, node.selectionEnd, node.selectionDirection]), [true, 5, 8, 'backward']);
        await page.keyboard.type('quite');
        assert.equal(await look.inputValue(), 'Calm quite keen');
        const editedLook = await look.elementHandle();
        await look.press('Tab');
        await page.waitForFunction(node => !node.isConnected, editedLook);

        const level = page.getByLabel('Level 1', { exact: true });
        await level.focus();
        const oldLevel = await level.elementHandle();
        await level.selectOption('medium');
        await page.waitForFunction(node => !node.isConnected, oldLevel);
        assert.equal(await level.evaluate(node => node === document.activeElement), true);
        assert.equal(await level.inputValue(), 'medium');
        const effect = page.getByLabel('Effect 1', { exact: true });
        const oldEffect = await effect.elementHandle();
        await effect.fill('helps everyone');
        await effect.press('Tab');
        await page.waitForFunction(node => !node.isConnected, oldEffect);
        assert.equal(await page.getByRole('button', { name: 'Remove lever 1' }).evaluate(node => node === document.activeElement), true);

        const number = page.getByLabel('Stage 1 value 1', { exact: true });
        await number.focus();
        const oldNumber = await number.elementHandle();
        await number.press('ArrowUp');
        await page.waitForFunction(node => !node.isConnected, oldNumber);
        assert.equal(await number.evaluate(node => node === document.activeElement), true);
        assert.equal(await number.inputValue(), '21');
        const checkbox = page.getByRole('checkbox', { name: /may die off-screen/ });
        const oldCheckbox = await checkbox.elementHandle();
        await checkbox.check();
        await page.waitForFunction(node => !node.isConnected, oldCheckbox);
        assert.equal(await checkbox.evaluate(node => node === document.activeElement), true);
        assert.equal(await checkbox.isChecked(), true);
    });
});

test('a newly named person keeps the next field focused when the key changes', async () => {
    await withPage({}, async page => {
        await load(page);
        await page.locator('.rail').getByRole('button', { name: /^Cast/ }).evaluate(node => node.click());
        await page.getByRole('button', { name: '+ Add person' }).evaluate(node => node.click());
        const aliases = page.getByLabel('Also called', { exact: true });
        const original = await aliases.elementHandle();
        await page.getByLabel('Name', { exact: true }).first().evaluate(node => {
            node.focus();
            node.value = 'Old Marta';
            node.dispatchEvent(new Event('change', { bubbles: true }));
            const next = [...document.querySelectorAll('input')].find(input => input.getAttribute('data-path')?.endsWith(',"aliases"]'));
            next.focus();
        });
        await page.waitForFunction(node => !node.isConnected, original, { polling: 20 });
        assert.equal(await page.getByLabel('Key', { exact: true }).inputValue(), 'old-marta');
        assert.equal(await aliases.evaluate(node => node === document.activeElement), true);
    });
});

test('clicking a cast list control after editing a row keeps both changes', async () => {
    const cast = castEntries();
    cast[0].behaviour = ['Care: high - watches the river'];
    cast[0].mannerisms = ['Hums softly'];
    await withPage({}, async page => {
        await load(page, JSON.stringify(castPack({ cast })));
        await page.locator('.rail').getByRole('button', { name: /^Cast/ }).evaluate(node => node.click());
        await page.locator('.record-card', { hasText: 'Fenna' }).evaluate(node => node.click());
        const commitAndClick = async (field, value, button) => {
            const target = await button.elementHandle();
            await field.evaluate((node, { value, target }) => {
                node.focus();
                node.value = value;
                target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
                target.focus();
                target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
                target.click();
            }, { value, target });
        };
        await commitAndClick(page.getByLabel('Effect 1', { exact: true }), 'helps everyone', page.getByRole('button', { name: '+ Add a lever' }));
        assert.equal(await page.getByLabel('Effect 1', { exact: true }).inputValue(), 'helps everyone');
        assert.equal(await page.getByLabel('Effect 2', { exact: true }).count(), 1);
        await commitAndClick(page.getByLabel('Mannerism 1', { exact: true }), 'Hums at dusk', page.getByRole('button', { name: '+ Add a mannerism' }));
        assert.equal(await page.getByLabel('Mannerism 1', { exact: true }).inputValue(), 'Hums at dusk');
        assert.equal(await page.getByLabel('Mannerism 2', { exact: true }).count(), 1);
        await commitAndClick(page.getByLabel('Add something they are drawn to'), 'the old bridge', page.getByRole('button', { name: 'Remove the weir' }));
        assert.equal(await page.locator('.cf-chip', { hasText: 'the weir' }).count(), 0);
        assert.equal(await page.locator('.cf-chip', { hasText: 'the old bridge' }).count(), 1);
    });
});

test('adding a person, filling the form and adding secrets works through the controls', async () => {
    await withPage({}, async page => {
        await load(page);
        await navigate(page, 'Cast');
        await page.getByRole('button', { name: '+ Add person' }).click();
        await page.locator('.inspector h2', { hasText: 'New person' }).waitFor();
        const name = page.getByLabel('Name', { exact: true });
        await name.fill('Old Marta');
        await name.press('Tab');
        await page.locator('.inspector h2', { hasText: 'Old Marta' }).waitFor();
        assert.equal(await page.getByLabel('Key', { exact: true }).inputValue(), 'old-marta');
        await page.getByRole('button', { name: '+ Add secret' }).click();
        await page.getByRole('button', { name: '+ Add stage' }).click();
        await page.getByLabel('Add something they are drawn to').fill('the lost ledger');
        await page.getByLabel('Add something they are drawn to').press('Enter');
        await page.locator('.cf-chip', { hasText: 'the lost ledger' }).waitFor();
        assert.match(await page.locator('legend', { hasText: 'Secrets' }).innerText(), /Secrets · 1 of 8/);
        assert.equal(await page.locator('.cf-preview .cf-bar').count(), 1);
        assert.match(await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).innerText(), /^Problems \(0\)$/);
        assert.match(await page.locator('main .records-subtitle').innerText(), /^3 people/);
    });
});

for (const [theme, width] of [['dark', 1440], ['light', 1440], ['dark', 1024], ['light', 390]]) {
    test(`the Cast list, form and check keep the target size, labels and fit at ${width} px in the ${theme} theme`, async () => {
        await withPage({ theme, width, height: width === 390 ? 844 : 900 }, async page => {
            await load(page);
            await openPerson(page, 'Fenna');
            await choose(page, pngBytes(40, 50, 0));
            await page.locator('.cf-face img').waitFor();
            assert.deepEqual(await findings(page), []);
            await navigate(page, 'Check / export');
            await page.locator('.cf-zip').waitFor();
            assert.deepEqual(await findings(page), []);
        });
    });
}

test('muted and error text in the new form read against the page in both themes', async () => {
    for (const theme of ['dark', 'light']) {
        await withPage({ theme }, async page => {
            await load(page);
            await openPerson(page, 'Fenna');
            const look = page.getByLabel('Look', { exact: true });
            await look.fill('<');
            await look.press('Tab');
            await page.locator('.cf-error').first().waitFor();
            const ratios = await page.evaluate(() => {
                const parse = text => text.match(/[\d.]+/g).map(Number);
                const channel = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
                const style = getComputedStyle(document.documentElement);
                const hex = style.getPropertyValue('--bg').trim();
                const page = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
                const ratio = selector => {
                    const [r, g, b] = parse(getComputedStyle(document.querySelector(selector)).color);
                    const [high, low] = [luminance([r, g, b]), luminance(page)].sort((a, b) => b - a);
                    return (high + 0.05) / (low + 0.05);
                };
                return { hint: ratio('.cf-hint'), error: ratio('.cf-error'), count: ratio('.tl-count') };
            });
            for (const [what, value] of Object.entries(ratios)) assert.ok(value >= 4.5, `${theme} ${what} ${value}`);
        });
    }
});

test('the twelve real Ersveil entries open in the browser and export, as pack.json and as a zip without pictures, byte for byte', async () => {
    const text = JSON.stringify(castPack({ cast: JSON.parse(readFileSync(resolve('tests/fixtures/ersveil-cast.json'), 'utf8')) }), null, 2) + '\n';
    await withPage({}, async page => {
        await load(page, text);
        await navigate(page, 'Cast');
        assert.equal(await page.locator('main .record-card').count(), 12);
        assert.match(await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).innerText(), /^Problems \(0\)$/);
        await navigate(page, 'Check / export');
        assert.equal(new TextDecoder().decode((await downloaded(page, '#export-btn')).bytes), text);
        const read = await readPackZip((await downloaded(page, '#export-zip')).bytes);
        assert.equal(read.ok, true);
        assert.equal(read.text, text);
        assert.deepEqual(read.files, []);
        assert.match(await page.locator('.cf-list').innerText(), /names the portrait .+ no picture is held/);
    });
});

test('the story event beside a meter secret keeps the target size, labels and contrast in both themes, and saves through the control', async () => {
    const entries = castEntries();
    entries[0].secrets[0].when = 'Severa comes to Bluewatch';
    const text = JSON.stringify(castPack({ cast: entries }));
    for (const theme of ['dark', 'light']) {
        await withPage({ theme }, async page => {
            await load(page, text);
            await openPerson(page, 'Fenna');
            const also = page.getByLabel('Secret 1 also opens on a story event');
            assert.equal(await also.inputValue(), 'Severa comes to Bluewatch');
            assert.deepEqual(await findings(page), []);
            const ratio = await page.locator('.cf-also .cf-hint').first().evaluate(node => {
                const channel = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
                const hex = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
                const [high, low] = [lum(getComputedStyle(node).color.match(/[\d.]+/g).slice(0, 3).map(Number)), lum([1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)))].sort((a, b) => b - a);
                return (high + 0.05) / (low + 0.05);
            });
            assert.ok(ratio >= 4.5, `${theme} ${ratio}`);
            await also.fill('');
            await also.press('Tab');
            assert.equal(await page.getByLabel('Secret 1 also opens on a story event').inputValue(), '');
            assert.match(await page.locator('.cf-preview .cf-hint').first().innerText(), /^Opens at Trust 20$/);
        });
    }
});

const SKILLED = () => {
    const cast = castEntries();
    cast[0].skills = [
        { name: 'Long Watch Cleave', about: 'A two-handed sweep with the greataxe that clears the line.', stat: 'str', uses: 'stamina', rank: 'expert' },
        { name: 'Beacon Call', about: 'A blast on the carved horn that rallies the party.', stat: 'cha', uses: 'stamina', rank: 'adept' },
        { name: 'Hold the Line', about: 'Plants a boot and takes the blow meant for another.', stat: 'vit', uses: 'stamina', rank: 'master' },
    ];
    return JSON.stringify(castPack({ cast }));
};
const skillCards = page => page.locator('fieldset[data-cf=skills] .cf-secret');

test('signature skills: the section opens with its cards, the list tag counts them, a skill is added and edited through the controls and goes out in the pack', async () => {
    await withPage({}, async page => {
        await load(page, SKILLED());
        await navigate(page, 'Cast');
        assert.match(await page.locator('.record-card', { hasText: 'Fenna' }).innerText(), /3 skills/);
        await page.locator('.record-card', { hasText: 'Fenna' }).click();
        const legends = await page.locator('.inspector legend').allInnerTexts();
        assert.deepEqual(legends.slice(-3).map(text => text.trim()), ['Before they are met', 'Signature skills · 3 of 8', 'Secrets · 3 of 8']);
        assert.equal(await skillCards(page).count(), 3);
        assert.equal(await page.getByLabel('Skill 2 name', { exact: true }).inputValue(), 'Beacon Call');
        assert.equal(await page.getByLabel('Skill 3 rank', { exact: true }).inputValue(), 'master');
        await page.getByRole('button', { name: '+ Add skill' }).click();
        await page.getByLabel('Skill 4 name', { exact: true }).fill('Spark');
        await page.getByLabel('Skill 4 name', { exact: true }).press('Tab');
        await page.getByLabel('Skill 4 what it does', { exact: true }).fill('A small burst of magic.');
        await page.getByLabel('Skill 4 what it does', { exact: true }).press('Tab');
        await page.getByLabel('Skill 4 stat', { exact: true }).selectOption('int');
        await page.getByLabel('Skill 4 rank', { exact: true }).selectOption('novice');
        await page.getByRole('group', { name: 'Skill 4 uses' }).getByRole('button', { name: 'Mana' }).click();
        assert.equal(await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).innerText(), 'Problems (0)');
        await page.getByRole('button', { name: 'Undo' }).click();
        await page.getByRole('button', { name: 'Redo' }).click();
        await navigate(page, 'Check / export');
        const plain = await downloaded(page, '#export-btn');
        const skills = JSON.parse(new TextDecoder().decode(plain.bytes)).content.cast[0].skills;
        assert.equal(skills.length, 4);
        assert.deepEqual(skills[3], { name: 'Spark', about: 'A small burst of magic.', stat: 'int', uses: 'mana', rank: 'novice' });
        assert.match((await page.locator('.cf-list li').allInnerTexts()).find(line => line.startsWith('Signature skills')), /^Signature skills: 4 for 1 person/);
    });
});

test('signature skills: a repeated name shows the checker’s line under it and in Problems, at desktop and phone width, with no overflow and 44 px targets', async () => {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
        await withPage({ width, height }, async page => {
            const cast = castEntries();
            cast[0].skills = [
                { name: 'Beacon Call', about: 'A blast on the carved horn.', stat: 'cha', uses: 'stamina', rank: 'adept' },
                { name: 'Hold the Line', about: 'Takes the blow meant for another.', stat: 'vit', uses: 'stamina', rank: 'master' },
                { name: 'beacon call', about: 'Again.', stat: 'str', uses: 'mana', rank: 'novice' },
            ];
            await load(page, JSON.stringify(castPack({ cast })));
            await openPerson(page, 'Fenna');
            const third = skillCards(page).nth(2);
            await third.scrollIntoViewIfNeeded();
            assert.match(await third.locator('.cf-error').innerText(), /^Cast "Fenna": skills\[2\]\.name repeats "beacon call"; a person names each skill once\.$/);
            assert.equal(await third.getByLabel('Skill 3 name', { exact: true }).getAttribute('aria-invalid'), 'true');
            assert.match(await page.locator('.topbar').getByRole('button', { name: /^Problems/ }).innerText(), /^Problems \(1\)$/);
            const boxes = await skillCards(page).evaluateAll(nodes => nodes.map(node => {
                const card = node.getBoundingClientRect();
                const inputs = [...node.querySelectorAll('input')].map(input => input.getBoundingClientRect());
                return { left: card.left, right: card.right, inputsLeft: inputs.map(box => box.left), inputsRight: inputs.map(box => box.right) };
            }));
            for (const box of boxes) {
                assert.ok(box.inputsLeft.every(left => Math.abs(left - box.inputsLeft[0]) < 0.5), 'inputs share a left edge');
                assert.ok(box.inputsRight.every(right => Math.abs(right - box.inputsRight[0]) < 0.5), 'inputs share a right edge');
                assert.ok(box.inputsRight[0] <= box.right && box.inputsLeft[0] >= box.left);
            }
            assert.deepEqual(await findings(page), []);
        });
    }
});

test('the Cast Behaviour rows stack as a column: the Ripples people rows do not change them', async () => {
    for (const width of [1280, 390]) {
        await withPage({ width, height: 900 }, async page => {
            await load(page);
            await openPerson(page, 'Fenna');
            await page.locator('.cf-list-rows').first().waitFor({ state: 'attached' });
            const look = await page.evaluate(() => [...document.querySelectorAll('.cf-list-rows')].map(node => ({ direction: getComputedStyle(node).flexDirection, over: node.scrollWidth > node.clientWidth + 1 })));
            assert.ok(look.length >= 1);
            for (const row of look) assert.deepEqual(row, { direction: 'column', over: false }, `at ${width} px`);
        });
    }
});
