// The Code module section in the shipped page (docs/PART5B_SPEC.md §7, §8, §9 M8): at 1280 and 390 px it shows Ready, the
// files and the part file; a typed change updates the viewer; a refused field shows its error, "Not ready", and the notice
// text on Download; a valid Download is the bytes of scaffoldZip(EXAMPLE_INPUTS); focus stays in the field while typing;
// hostile text creates no elements; Download works from the keyboard; a download leaves the pack and Undo as they were.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXAMPLE_INPUTS } from '../src/code-module/inputs.js';
import { scaffoldZip } from '../src/code-module/generate.js';
import { DRAFT_WITH_AI } from '../src/draft-hint.js';
import { SHIPPED, withPage, upload } from './helpers/dm-browser.js';
import { openParts } from './helpers/parts.js';

const pack = readFileSync(new globalThis.URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');

async function openCodeModule(page) {
    await openParts(page);
    await page.locator('.rail').getByRole('button', { name: 'Code module', exact: true }).click();
    await page.locator('main h1', { hasText: 'Code module' }).waitFor();
    await page.locator('#cm-validation[data-ok="true"]').waitFor();
}

async function settle(page) {
    await page.waitForTimeout(300);
}

async function downloadBytes(page, click) {
    const pending = page.waitForEvent('download');
    await click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

for (const width of [1280, 390]) {
    test(`at ${width} px: Ready, the files, the part file, and a typed change updates the viewer`, { timeout: 60000 }, async () => {
        await withPage(SHIPPED, { width }, async page => {
            await openCodeModule(page);
            assert.match(await page.locator('#cm-validation').textContent(), /^Ready: 9 files written by Studio, 147 copied from Story Block 2\.11\.0 \(commit 455c104\)\.$/);
            const names = await page.locator('ul[aria-label="Files in the zip"] li button[aria-pressed]').allTextContents();
            assert.deepEqual(names, ['.gitignore', 'README.md', 'index.js', 'manifest.json', 'package.json', 'src/module.js', 'src/parts/lantern.js', 'tests/module.test.js', 'tests/vendor/README.md']);
            assert.match(await page.locator('#cm-file').textContent(), /export const LABEL = 'Oil';/);
            await page.locator('#cm-label').fill('Fuel');
            await settle(page);
            assert.match(await page.locator('#cm-file').textContent(), /export const LABEL = 'Fuel';/);
            // Narrow screens: the section fits without horizontal page scrolling.
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            assert.ok(overflow <= 0, `horizontal overflow ${overflow}px at ${width}`);
        });
    });
}

test('a refused field shows its error and "Not ready", and Download shows the notice text', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await openCodeModule(page);
        await page.locator('#cm-label').fill('Oil <b>');
        await settle(page);
        assert.match(await page.locator('#cm-validation').textContent(), /^Not ready \(1 problem\):\n- Field label may use only letters/);
        assert.equal(await page.locator('#cm-label').getAttribute('aria-invalid'), 'true');
        assert.equal(await page.locator('#cm-label').getAttribute('aria-describedby'), 'cm-label-error');
        assert.match(await page.locator('#cm-label-error').textContent(), /^Field label may use only letters/);
        assert.equal(await page.locator('#cm-files-empty').isVisible(), true);
        await page.getByRole('button', { name: 'Download zip', exact: true }).click();
        assert.equal(await page.locator('.notice').textContent(), "unsafe-text: Field label may use only letters, digits, spaces and the marks ' ’ , . ! ? : ; ( ) - – —.");
        // Fixing the field clears the error and the attributes that pointed at it.
        await page.locator('#cm-label').fill('Oil');
        await settle(page);
        assert.equal(await page.locator('#cm-label').getAttribute('aria-invalid'), null);
        assert.equal(await page.locator('#cm-label-error').count(), 0);
    });
});

test('a valid Download is the bytes of scaffoldZip(EXAMPLE_INPUTS)', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await openCodeModule(page);
        const { name, bytes } = await downloadBytes(page, () => page.getByRole('button', { name: 'Download zip', exact: true }).click());
        assert.equal(name, 'lantern-oil.zip');
        const expected = scaffoldZip(EXAMPLE_INPUTS).bytes;
        assert.equal(Buffer.compare(bytes, Buffer.from(expected)), 0, 'the download is the generated zip, byte for byte');
    });
});

test('focus stays in the field while typing, and hostile text creates no elements, in each text control', { timeout: 120000 }, async () => {
    const hostile = '<img src=x onerror=1><b>x</b><script>1</script>';
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await openCodeModule(page);
        for (const id of ['cm-author', 'cm-domain', 'cm-kind', 'cm-kind-label', 'cm-step']) {
            await page.locator(`#${id}`).fill('');
            await page.locator(`#${id}`).click();
            await page.keyboard.type(hostile);
            await settle(page);
            assert.equal(await page.evaluate(() => document.activeElement?.id), id, `focus stays in ${id}`);
            assert.equal(await page.locator(`#${id}`).inputValue(), hostile, id);
            assert.equal(await page.locator('main img, main b, main script').count(), 0, `no element from ${id}`);
        }
    });
});

test('Tab from the last form control reaches Download, and Enter downloads', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await openCodeModule(page);
        await page.locator('#cm-screen').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'cm-download');
        const { name } = await downloadBytes(page, () => page.keyboard.press('Enter'));
        assert.equal(name, 'lantern-oil.zip');
    });
});

test('Reset to example restores Ready after a refused field', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await openCodeModule(page);
        await page.locator('#cm-label').fill('Oil <b>');
        await settle(page);
        assert.match(await page.locator('#cm-validation').textContent(), /^Not ready/);
        await page.getByRole('button', { name: 'Reset to example', exact: true }).click();
        await page.locator('#cm-validation[data-ok="true"]').waitFor();
        assert.match(await page.locator('#cm-validation').textContent(), /^Ready: 9 files written by Studio/);
        assert.equal(await page.locator('#cm-label').inputValue(), 'Oil');
    });
});

test('the selected file is kept by path while typing', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await openCodeModule(page);
        await page.getByRole('button', { name: 'src/module.js', exact: true }).click();
        await page.locator('#cm-file-name', { hasText: 'src/module.js' }).waitFor();
        await page.locator('#cm-label').fill('Fuel');
        await settle(page);
        assert.equal(await page.locator('#cm-file-name').textContent(), 'src/module.js');
        assert.equal(await page.locator('ul[aria-label="Files in the zip"] button[aria-pressed="true"]').textContent(), 'src/module.js');
    });
});

test('every control in the section has an accessible name', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 390 }, async page => {
        await openCodeModule(page);
        const unlabelled = await page.locator('.code-module-workspace input, .code-module-workspace textarea').evaluateAll(
            controls => controls.filter(control => !control.getAttribute('aria-label')).map(control => control.id || control.outerHTML.slice(0, 60)),
        );
        assert.deepEqual(unlabelled, []);
    });
});

test('a download leaves the pack, its export button and Undo as they were', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        await upload(page, pack);
        await page.locator('#pack-name').waitFor();
        assert.equal(await page.locator('#pack-name').inputValue(), 'Ersveil (open world)');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        assert.equal(await undo.isDisabled(), true);
        // One edit that goes into history, so Undo is available.
        await page.locator('#pack-name').fill('Edited Pack');
        await page.locator('#pack-name').press('Enter');
        await settle(page);
        assert.equal(await undo.isDisabled(), false);
        const exportButton = page.getByRole('button', { name: 'Export', exact: true });
        const exportDisabled = await exportButton.isDisabled();
        await openCodeModule(page);
        await downloadBytes(page, () => page.getByRole('button', { name: 'Download zip', exact: true }).click());
        await settle(page);
        assert.equal(await page.locator('#pack-name').inputValue(), 'Edited Pack');
        assert.equal(await undo.isDisabled(), false);
        assert.equal(await exportButton.isDisabled(), exportDisabled);
        // One Undo returns the pack name, so the download added nothing to history.
        await undo.click();
        await settle(page);
        assert.equal(await page.locator('#pack-name').inputValue(), 'Ersveil (open world)');
    });
});

test('the landing page keeps its "Draft with your own AI" hint', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 1280 }, async page => {
        assert.equal(await page.locator('main .draft-hint').textContent(), DRAFT_WITH_AI);
    });
});
