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
        const names = await page.locator('.rail .parts-list > button').evaluateAll(nodes => nodes.slice(0, 9).map(node => node.querySelector('span').textContent));
        assert.deepEqual(names, ['Places', 'Routes', 'Timeline', 'Items', 'People / creatures', 'Cast', 'Races', 'Talents', 'Presets']);
        assert.equal(await page.locator('.rail').getByRole('button', { name: /^Cast/ }).locator('small').innerText(), '2');
        await navigate(page, 'Cast');
        await page.locator('main h1', { hasText: 'Cast' }).waitFor();
        assert.equal(await page.locator('main .record-card').count(), 2);
        assert.match(await page.locator('main .records-subtitle').innerText(), /^2 people · hidden from players until met$/);
        assert.equal(await page.locator('.rail .parts-list > button[aria-current=page]').count(), 1);
    });
});

test('a big picture is made smaller to fit 64 KB as a WebP, named after the person, and its size is shown', async () => {
    await withPage({}, async page => {
        await load(page);
        await openPerson(page, 'Fenna');
        const big = pngBytes(480, 600, 14);
        assert.ok(big.length > 500 * 1024);
        await choose(page, big);
        await page.locator('.cf-face img').waitFor();
        const text = await facts(page);
        assert.match(text, /^fenna\.webp · 480 × 600 · \d+ KB \(made smaller from \d+ KB PNG\)\. Pictures are made smaller automatically to fit 64 KB; JPEG, PNG or WebP\.$/);
        const { type, bytes } = await pictureBytes(page);
        assert.equal(type, 'data:image/webp;base64');
        assert.ok(bytes.length <= 64 * 1024, `${bytes.length} bytes`);
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
        assert.match(await page.locator('.cf-list').innerText(), /Portraits: 1 file, \d+ KB together \(each under 64 KB\)\./);
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
        assert.match(lines.find(line => line.startsWith('Portraits')), /^Portraits: 1 file, \d+ KB together \(each under 64 KB\)\.$/);
        assert.match(await page.locator('.cf-zip').innerText(), /^fixture-2\.0\.0\.zip\n {2}pack\.json +\d+ KB\n {2}portraits\/fenna\.webp +\d+ KB$/);
        const zip = await downloaded(page, '#export-zip');
        assert.equal(zip.name, 'fixture-2.0.0.zip');
        const read = await readPackZip(zip.bytes);
        assert.equal(read.ok, true, read.message);
        assert.equal(JSON.parse(read.text).content.cast[0].portrait, 'fenna.webp');
        assert.deepEqual(read.files.map(file => file.name), ['fenna.webp']);
        const picture = await read.files[0].read();
        assert.equal(sniffImage(picture), 'webp');
        assert.ok(picture.length <= 64 * 1024);
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
        assert.match(await page.locator('.notice').innerText(), /portrait: fenna\.png is over 64 KB; left out\./);
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
