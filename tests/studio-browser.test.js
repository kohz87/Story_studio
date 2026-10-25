// Browser workflows against the committed offline distribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { makeValidExtendedPack } from './fixtures/builders.js';
import { openPack, exportPack } from '../src/model.js';

const URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const RULES_HASH = 'bbcf96a8f04da8e007c2fb3840a3939a1d30e3820ddcb48c3e4632186e816f5b';
const PACK_HASH = '19d91d55a09d3d21bf9ea865e1cadc63561a44be65745d61530046c39b718625';

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

async function selectClass(page, slug) {
    await navigate(page, 'Classes');
    await closeInspector(page);
    await page.locator('.class-card[data-slug="' + slug + '"]').click();
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
    test('offline workflow ' + theme + ' ' + width, { timeout: 60000 }, async () => {
        await withPage({ theme, width }, async page => {
            assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
            const other = theme === 'dark' ? 'light' : 'dark';
            await page.emulateMedia({ colorScheme: other });
            await page.waitForFunction(value => document.documentElement.dataset.theme === value, other);
            await page.getByRole('button', { name: 'Switch to ' + theme + ' theme', exact: true }).click();
            await page.emulateMedia({ colorScheme: other });
            assert.equal(await page.locator('html').getAttribute('data-theme'), theme);

            const golden = smallRulesPack();
            await upload(page, golden);
            assert.equal(await page.locator('.fingerprint').getAttribute('title'), RULES_HASH);
            await checkPrimaryContrast(page);
            await checkAccessibility(page);
            await navigate(page, 'Check / export');
            assert.deepEqual(await page.locator('.fp-val').allTextContents(), [RULES_HASH, PACK_HASH]);
            await checkAccessibility(page);

            await selectClass(page, 'c0');
            await change(page, '#class-id', 'haven');
            await page.locator('.class-card[data-slug="haven"]').waitFor();
            await selectClass(page, 'c1');
            assert.equal(await page.locator('#class-parent').inputValue(), 'haven');
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            await selectClass(page, 'c1');
            assert.equal(await page.locator('#class-parent').inputValue(), 'c0');

            await selectClass(page, 'c3');
            await page.locator('.inspector-body').getByRole('button', { name: 'Remove…', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Remove class', exact: true });
            const expected = ['Class 3 (Classes)'];
            for (const slug of ['s30', 's31', 's32']) {
                expected.push(slug + ' (Skills)', slug + '-base (Base form)');
                for (const suffix of ['-g', '-g-g', '-a-g', '-b-g']) expected.push(slug + '-base' + suffix + ' (Generated form)');
            }
            expected.push(...golden.content.rules[0].branches.map(b => b.name + ' (Branches)'));
            assert.deepEqual((await dialog.locator('li').allTextContents()).sort(), expected.sort());
            await checkAccessibility(page);
            await dialog.getByRole('button', { name: 'Remove all ' + expected.length, exact: true }).click();
            assert.equal(await page.locator('.class-card[data-slug="c3"]').count(), 0);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            await page.locator('.class-card[data-slug="c3"]').waitFor();

            await selectClass(page, 'c0');
            await page.locator('#class-skills select').nth(2).selectOption('');
            assert.equal(await page.locator('#class-skills select').nth(2).inputValue(), 's02');
            assert.match(await page.locator('.notice').textContent(), /^bad-value:/);
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            const damaged = smallRulesPack();
            damaged.content.rules[0].classes[0].skills.pop();
            await upload(page, damaged);
            await page.waitForFunction(() => document.querySelector('.topbar button.primary').disabled);
            assert.equal(await page.locator('.topbar button.primary').isDisabled(), true);
            await page.getByRole('button', { name: /^Problems \(/ }).click();
            const drawer = page.getByRole('region', { name: 'Problems', exact: true });
            assert.ok((await drawer.locator('.problem-chip').allTextContents()).includes('class-skills'));
            await drawer.locator('.problem-row').filter({ hasText: 'classes[0].skills' }).first().getByRole('button').click();
            assert.equal(await page.evaluate(() => document.activeElement.id), 'class-skills');
            if (width === 1024) assert.ok((await page.locator('.studio').getAttribute('class')).includes('inspector-open'));
            await page.locator('#class-skills select').nth(2).selectOption('s02');
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);

            await selectClass(page, 'c3');
            await page.locator('#class-parent').selectOption('c0');
            await page.getByRole('button', { name: /^Problems \(/ }).click();
            await page.locator('.problems-drawer .problem-row').filter({ hasText: 'classes[3].tier' }).first().getByRole('button').click();
            assert.equal(await page.evaluate(() => document.activeElement.id), 'class-parent');
            await checkAccessibility(page);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();

            const bytes = await download(page);
            assert.deepEqual(bytes, Buffer.from(exportPack(openPack(golden))));
            const reopened = openPack(bytes.toString('utf8'));
            assert.equal(reopened.rulesHash, RULES_HASH);
            assert.equal(reopened.packHash, PACK_HASH);
            assert.deepEqual(await page.locator('.fp-val').allTextContents(), [RULES_HASH, PACK_HASH]);

            await selectClass(page, 'c3');
            await page.getByRole('button', { name: 'Open s30 in skills', exact: true }).click();
            assert.equal(await page.locator('.path-node').count(), 13);
            assert.equal(await page.locator('.pathway-column-title').count(), 3);
            assert.equal(await page.locator('.path-node-gen').count(), 4);
            await checkAccessibility(page);
            await closeInspector(page);
            await page.locator('.path-node[data-form-id="pack.fixture/s30-base-g"]').click();
            assert.equal(await page.locator('.generated-explanation').isVisible(), true);
            assert.equal(await page.locator('.inspector-body input,.inspector-body select,.inspector-body textarea').count(), 0);
            assert.equal(await page.locator('.path-node-gen').first().evaluate(node => getComputedStyle(node).borderTopStyle), 'dashed');
            await closeInspector(page);
            await page.locator('.path-node[data-form-id="pack.fixture/s30-base-g-a"]').click();
            assert.equal(await page.locator('#form-name').isEditable(), true);
            await change(page, '#form-name', '[WRITTEN FORM]');
            assert.equal(await page.locator('#form-name').inputValue(), '[WRITTEN FORM]');
            await page.getByRole('button', { name: 'Undo', exact: true }).click();

            await selectClass(page, 'c0');
            await page.getByRole('button', { name: 'Open s00 in skills', exact: true }).click();
            assert.equal(await page.locator('.lower-tier-card').count(), 3);
            assert.equal(await page.locator('.path-node').count(), 0);
            await checkAccessibility(page);

            const extended = makeValidExtendedPack();
            extended.name = '[EXTENDED FIXTURE]';
            extended.content.rules[0].trainers[0].skills.push('s00');
            await upload(page, extended);
            await navigate(page, 'Trainers');
            await closeInspector(page);
            await page.locator('.record-card').first().click();
            const place = page.locator('.inspector-body input[list]').first();
            const listId = await place.getAttribute('list');
            assert.ok((await page.locator('[id="' + listId + '"] option').evaluateAll(nodes => nodes.map(n => n.value))).includes('pack.fixture/haven'));
            assert.ok(await page.locator('.inspector-body select option[value="s00"]').count() > 0);
            await place.fill('pack.fixture/mill'); await place.press('Tab');
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            const saved = await page.evaluate(() => localStorage.getItem('story-studio-draft'));
            const trainerSkill = page.locator("select[data-path='[\"content\",\"rules\",0,\"trainers\",0,\"skills\",1]']");
            await trainerSkill.selectOption('s30');
            assert.equal(await trainerSkill.inputValue(), 's00');
            assert.match(await page.locator('.notice').textContent(), /^bad-value:/);
            assert.equal(await page.evaluate(() => localStorage.getItem('story-studio-draft')), saved);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            assert.equal(await place.inputValue(), 'pack.fixture/haven', 'Refused edits never enter history');
            await page.getByRole('button', { name: 'Redo', exact: true }).click();
            await checkAccessibility(page);

            await navigate(page, 'Foes'); await closeInspector(page);
            await page.locator('.record-card').first().click();
            const level = page.locator("input[data-path='[\"content\",\"creatures\",0,\"level\"]']");
            await level.fill('0'); await level.press('Tab');
            assert.equal(await level.inputValue(), '1');
            assert.match(await page.locator('.notice').textContent(), /^bad-value:/);
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            await checkAccessibility(page);

            await selectClass(page, 'c0');
            await page.getByRole('button', { name: 'Open s00 in skills', exact: true }).click();
            await page.locator('#form-effects').evaluate(node => { node.closest('details').open = true; });
            const effectsBefore = await page.locator('#form-effects').inputValue();
            const effects = JSON.parse(effectsBefore); effects[0].power = 1001;
            const effectsSaved = await page.evaluate(() => localStorage.getItem('story-studio-draft'));
            await change(page, '#form-effects', JSON.stringify(effects));
            assert.equal(await page.locator('#form-effects').inputValue(), effectsBefore);
            assert.match(await page.locator('.notice').textContent(), /^bad-value:/);
            assert.equal(await page.evaluate(() => localStorage.getItem('story-studio-draft')), effectsSaved);
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);

            await selectClass(page, 'c3');
            await page.getByRole('button', { name: 'Open s30 in skills', exact: true }).click();
            await closeInspector(page);
            await page.locator('.path-node[data-form-id="pack.fixture/s30-base-a"]').click();
            await page.locator('#form-transforms').evaluate(node => { node.closest('details').open = true; });
            const transformsBefore = await page.locator('#form-transforms').inputValue();
            await change(page, '#form-transforms', JSON.stringify([{ op: 'set-power', at: 0, value: 1001 }]));
            assert.equal(await page.locator('#form-transforms').inputValue(), transformsBefore);
            assert.match(await page.locator('.notice').textContent(), /^bad-value:/);
            assert.equal(await page.evaluate(() => localStorage.getItem('story-studio-draft')), effectsSaved);
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);

            await navigate(page, 'Quests'); await closeInspector(page);
            await page.locator('.record-card').first().click();
            await page.getByRole('button', { name: 'Add requirements item', exact: true }).click();
            const requirement = page.locator("select[data-path='[\"content\",\"quests\",0,\"requirements\",0]']");
            await requirement.selectOption({ label: 'class' });
            const classPicker = page.locator("select[data-path='[\"content\",\"quests\",0,\"requirements\",0,\"classes\",0]']");
            assert.equal(await classPicker.inputValue(), 'c0');
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            await requirement.selectOption({ label: 'thread' });
            const requiredPicker = page.getByRole('dialog', { name: 'Choose required values', exact: true });
            assert.equal(await requiredPicker.isVisible(), true);
            await checkAccessibility(page);
            await requiredPicker.locator('input[list]').fill('th_00000001');
            await requiredPicker.locator('input[list]').press('Tab');
            await requiredPicker.getByRole('button', { name: 'Add', exact: true }).click();
            assert.equal(await requiredPicker.count(), 0);
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            await checkAccessibility(page);

            await upload(page, golden);
            await selectClass(page, 'c2');
            await page.getByRole('button', { name: '+ Child class', exact: true }).click();
            for (let n = 0; n < 3; n++) {
                await page.getByRole('button', { name: '+ Skill', exact: true }).click();
                await checkAccessibility(page);
            }
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            assert.equal(await page.locator('.topbar button.primary').isDisabled(), true);
            await page.getByRole('button', { name: 'Redo', exact: true }).click();
            assert.equal(await page.locator('.topbar button.primary').isEnabled(), true);
            await page.getByRole('button', { name: 'Open new-skill in skills', exact: true }).click();
            assert.equal(await page.locator('.path-node-gen').count(), 4);
            await checkAccessibility(page);
        });
    });
}

test('hostile packs stay literal and unsafe input preserves the current draft', { timeout: 30000 }, async () => {
    await withPage({}, async page => {
        const hostile = smallRulesPack();
        hostile.name = '<b>x</b>';
        hostile.content.rules[0].classes[0].name = { toString: null };
        hostile.content.rules[0].skills[0].name = { toString: null };
        hostile.content.rules[0].classes[0].slug = '<b>x</b>';
        await upload(page, hostile);
        assert.ok((await page.locator('.classes-screen').textContent()).includes('<b>x</b>'));
        assert.ok((await page.locator('.classes-screen').textContent()).includes('{"toString":null}'));
        assert.equal(await page.locator('#studio b,#studio script,#studio iframe').count(), 0);
        assert.equal(await page.locator('.topbar button.primary').isDisabled(), true);
        await upload(page, '{"id":"fixture","__proto__":{"polluted":true}}');
        await page.waitForFunction(() => /unsafe-key/.test(document.querySelector('.notice').textContent));
        assert.equal(await page.locator('#pack-name').inputValue(), '<b>x</b>');
        assert.equal(await page.evaluate(() => ({}).polluted), undefined);
        await upload(page, JSON.stringify({ name: 'x'.repeat(600000) }));
        await page.waitForFunction(() => /too-large/.test(document.querySelector('.notice').textContent));
        assert.equal(await page.locator('#pack-name').inputValue(), '<b>x</b>');
        assert.equal(await page.locator('#studio b,#studio script,#studio iframe').count(), 0);
    });
});

test('denied storage still allows open edit undo and canonical export', { timeout: 30000 }, async () => {
    await withPage({ storageDenied: true }, async page => {
        const golden = smallRulesPack();
        await upload(page, golden);
        await change(page, '#pack-name', '[PRIVATE DRAFT]');
        assert.equal(await page.locator('#pack-name').inputValue(), '[PRIVATE DRAFT]');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(await page.locator('#pack-name').inputValue(), golden.name);
        assert.deepEqual(await download(page), Buffer.from(exportPack(openPack(golden))));
    });
});
