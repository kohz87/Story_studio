// Real file: workflows. Every request other than the initial document is a test failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';

const APP_URL = pathToFileURL(resolve('dist/story-studio.html')).href;
const base = () => ({ id: 'test', version: '1.0.0', requires: { storyBlock: '^2' }, description: 'Original text',
    screens: [{ id: 'test-screen', title: 'Test screen', mounts: ['tab'], data: { pc: { query: 'party.pc' }, rows: { query: 'inventory.items' } }, template: '<p>{{ q.pc.name }}</p>' }] });
async function pageTest(width, action) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('request', r => { if (r.url() !== APP_URL || !r.isNavigationRequest() || r.frame() !== page.mainFrame()) requests.push(r.url()); });
        await context.route('**/*', route => route.request().url() === APP_URL && route.request().isNavigationRequest() ? route.continue() : route.abort());
        await page.goto(APP_URL);
        await action(page);
        assert.deepEqual(requests, [], 'zero subresource, frame-navigation or network requests');
        assert.deepEqual(errors, [], 'zero page or console errors');
        await context.close();
    } finally { await browser.close(); }
}
const nav = (page, name) => page.locator('.rail').getByRole('button', { name, exact: true }).click();
async function upload(page, input) {
    await page.setInputFiles('#pack-file', { name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)) });
}
async function exported(page) {
    await nav(page, 'Check / export');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export pack file', exact: true }).click();
    const download = await event;
    return readFileSync(await download.path(), 'utf8');
}

for (const width of [1280, 390]) test(`screen form, live host bindings, widgets and escaped author text at ${width}`, async () => pageTest(width, async page => {
    await upload(page, base()); await nav(page, 'Screen builder');
    const body = () => page.frameLocator('iframe').locator('body');
    assert.equal(await body().innerText(), 'River');
    const template = '<h2>{{ q.pc.name }}</h2><ul><li data-each="q.rows as r, i" data-if="r.qty > 1" data-bind-attr="title: r.name">{{ i }}: {{ r.name }}</li></ul><p data-bind="q.pc.name"></p><ss-widget name="ss.meter" data-props=\'{"value":"{{ q.pc.hp.cur }}","max":30,"label":"HP"}\'></ss-widget>';
    await page.locator('#screen-template').fill(template);
    assert.match(await body().innerText(), /0: Rope/);
    assert.doesNotMatch(await body().innerText(), /Torch/);
    assert.equal(await page.frameLocator('iframe').locator('ss-widget .ss-w-meter').count(), 1);
    const hostile = '<img src=x onerror="globalThis.pwned=1"><b>literal</b>';
    await page.locator('#preview-sample').fill(JSON.stringify({ queries: { 'party.pc': { name: hostile, hp: { cur: 15, max: 30 } }, 'inventory.items': [] } }));
    assert.match(await body().innerText(), /<img src=x onerror=/);
    assert.equal(await page.frameLocator('iframe').locator('img,b,script').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.pwned), undefined);
    await page.locator('#screen-title').fill('Camp <b>literal</b>');
    await page.getByRole('button', { name: 'Apply screen', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.locator('#screen-template').inputValue(), base().screens[0].template);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const result = JSON.parse(await exported(page));
    assert.equal(result.screens[0].template, template);
    assert.equal(result.description, base().description);
    assert.equal(validatePack(result).ok, true);
}));

test('screen refusals, palette insertion, steps, and inactive commands are visible', async () => pageTest(1280, async page => {
    await upload(page, base()); await nav(page, 'Screen builder');
    await page.locator('#screen-title').fill('x'.repeat(81));
    await page.getByRole('button', { name: 'Apply screen', exact: true }).click();
    assert.match(await page.locator('#presentation-validation').innerText(), /BAD_SCREENS/);
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
    assert.equal(await page.locator('#screen-title').inputValue(), 'Test screen');
    await page.locator('#screen-data').fill('{broken');
    await page.getByRole('button', { name: 'Apply screen', exact: true }).click();
    assert.match(await page.locator('.notice').innerText(), /correct the JSON/);
    await page.locator('#screen-data').fill('{}');
    await page.getByRole('button', { name: 'Insert widget', exact: true }).click();
    assert.match(await page.locator('#screen-template').inputValue(), /ss.meter/);
    await page.getByRole('button', { name: 'Add query binding', exact: true }).click();
    assert.equal(JSON.parse(await page.locator('#screen-data').inputValue()).pc.query, 'party.pc');
    await page.getByRole('button', { name: 'Add query binding', exact: true }).click();
    assert.match(await page.locator('.notice').innerText(), /already exists/);
    await page.locator('#screen-steps').fill(JSON.stringify([{ id: 'first', template: '<p>Step {{ q.pc.name }}</p>' }]));
    await page.getByRole('checkbox', { name: 'Mount tab', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Mount dialog', exact: true }).check();
    await page.getByLabel('Preview source', { exact: true }).selectOption('0');
    assert.equal(await page.frameLocator('iframe').locator('body').innerText(), 'Step River');
    await page.getByLabel('Preview source', { exact: true }).selectOption('');
    await page.locator('#screen-template').fill('<button data-command="party.create">Act</button>');
    await page.frameLocator('iframe').getByRole('button', { name: 'Act', exact: true }).click();
    assert.match(await page.locator('#preview-warnings').innerText(), /commands are inactive/);
    await page.getByRole('button', { name: 'Apply screen', exact: true }).click();
    assert.equal(JSON.parse(await exported(page)).screens[0].title, 'Test screen');
}));

test('preview prevents external resource writes, CSS escapes and navigation before network attempts', async () => pageTest(1280, async page => {
    await upload(page, base()); await nav(page, 'Screen builder');
    const remote = 'https://example.invalid/image.png';
    const template = `<p>Safe</p><img src="${remote}"><img src="#same-document"><img data-bind-attr="src: q.picture"><svg><image href="${remote}"></image></svg><a href="${remote}">Link</a><span style="background:url(${remote})">Style</span><ss-widget name="ss.portrait" data-props='{"src":"${remote}","name":"River"}'></ss-widget><ss-widget name="ss.hero" data-props='{"name":"Hero","portraits":["${remote}"]}'></ss-widget>`;
    await page.locator('#screen-template').fill(template);
    await page.locator('#screen-css').fill(`p { background: url(${remote}); }`);
    await page.locator('#screen-data').fill(JSON.stringify({ picture: { query: 'sample.picture' } }));
    await page.locator('#preview-sample').fill(JSON.stringify({ queries: { 'sample.picture': remote } }));
    assert.match(await page.locator('#preview-warnings').innerText(), /omitted/);
    assert.equal(await page.frameLocator('iframe').locator('[src],a[href],image[href]').count(), 0);
    await page.frameLocator('iframe').locator('a').click();
    await page.locator('#screen-template').fill('<img o&#110;error="globalThis.pwned=1"><p>{{ state.constructor }}</p>');
    assert.equal(await page.frameLocator('iframe').locator('[onerror]').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.pwned), undefined);
}));

test('layout node form, renderer diagnostics and pack acceptance remain separate', async () => pageTest(1280, async page => {
    await upload(page, base()); await nav(page, 'Screen builder');
    await page.getByRole('button', { name: 'Layouts', exact: true }).click();
    await page.getByRole('button', { name: 'New layout', exact: true }).click();
    await page.getByRole('button', { name: 'Add child node', exact: true }).click();
    await page.getByLabel('Selected layout node', { exact: true }).selectOption('["children",0]');
    await page.getByLabel('Node value', { exact: true }).fill('A <b>literal</b> child');
    assert.match(await page.frameLocator('iframe').locator('body').innerText(), /A <b>literal<\/b> child/);
    assert.equal(await page.frameLocator('iframe').locator('b').count(), 0);
    await page.getByRole('button', { name: 'Apply layout', exact: true }).click();
    await page.getByLabel('root JSON', { exact: true }).fill('{"type":"unknown-widget","arbitrary":true}');
    assert.equal(await page.locator('#presentation-validation').innerText(), 'Accepted by Story Block.');
    assert.match(await page.locator('#preview-warnings').innerText(), /unknown|type|widget/);
    await page.getByRole('button', { name: 'Apply layout', exact: true }).click();
    const result = JSON.parse(await exported(page));
    assert.deepEqual(result.layouts[0].root, { type: 'unknown-widget', arbitrary: true });
    assert.deepEqual(result.screens, base().screens);
}));

test('Ersveil stays byte-faithful across defaults refusals, presentation apply/undo and reload', async () => pageTest(1280, async page => {
    const source = readFileSync(new URL('./fixtures/ersveil-bluewatch.json', import.meta.url), 'utf8');
    await upload(page, source); await nav(page, 'Settings defaults');
    assert.match(await page.locator('main').innerText(), /accepts no per-module settings defaults/);
    assert.match(await page.locator('#defaults-result').innerText(), /UNKNOWN_FIELD/);
    for (const key of ['defaults', 'settingsDefaults']) {
        await page.locator('#defaults-request').fill(JSON.stringify({ [key]: { 'rpg-battle': { levelCap: 100 } } }));
        assert.match(await page.locator('#defaults-result').innerText(), /UNKNOWN_FIELD/);
    }
    assert.equal(await exported(page), source);
    await nav(page, 'Screen builder');
    await page.getByRole('button', { name: 'New screen', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.locator('#screen-data').inputValue()), { pc: { query: 'party.pc' } });
    assert.equal(await page.frameLocator('iframe').locator('body').innerText(), 'River');
    await page.locator('#screen-template').fill('<p>New {{ q.pc.name }}</p>');
    await page.getByRole('button', { name: 'Apply screen', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await exported(page), source);
    await page.reload();
    assert.equal(await exported(page), source);
}));
