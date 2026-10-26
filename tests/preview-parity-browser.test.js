import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { SAMPLE } from '../src/screen-authoring.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';

let browser, directory, url;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-preview-parity-'));
    const bundle = await build({ entryPoints: ['tests/helpers/preview-parity.js'], bundle: true, format: 'iife', write: false });
    const file = join(directory, 'parity.html');
    await writeFile(file, `<!doctype html><html><head></head><body><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
    url = pathToFileURL(file).href;
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.STUDIO_CHROMIUM_PATH ? { executablePath: process.env.STUDIO_CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

const screen = extra => ({ id: 'parity', mounts: ['tab'], ...extra });
async function compare(def, sample = SAMPLE) {
    // Runtime refusal must leave importer acceptance intact.
    assert.equal(validatePack({ id: 'parity', version: '1.0.0', requires: { storyBlock: '^2' }, screens: [def] }).ok, true);
    const page = await browser.newPage();
    const requests = [], errors = [];
    page.on('request', r => { if (r.url() !== url || !r.isNavigationRequest() || r.frame() !== page.mainFrame()) requests.push(r.url()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/*', route => route.request().url() === url && route.request().isNavigationRequest() ? route.continue() : route.abort());
    try {
        await page.goto(url);
        const result = await page.evaluate(({ def, sample }) => globalThis.comparePreview(def, sample), { def, sample });
        assert.deepEqual(requests, [], 'zero network or subresource requests');
        assert.deepEqual(errors, [], 'zero page/console errors');
        if (result.host.ok) {
            assert.equal(result.studio.text, result.host.text);
            assert.deepEqual(result.studio.warnings, []);
        } else {
            assert.equal(result.studio.text, '', 'no preview content on host refusal');
            assert.deepEqual(result.studio.warnings, result.host.errors);
            for (const error of result.host.errors) assert.ok(result.host.text.includes(error));
        }
        return result;
    } finally { await page.close(); }
}

test('binding parity: missing data stays blank despite sample aliases; declared bindings use query answers', async t => {
    const template = '<p>{{ q.pc.name }}</p>';
    const sample = { ...SAMPLE, q: { pc: { name: 'Wrong alias override' } } };
    for (const [name, data, expected] of [
        ['missing binding', undefined, ''],
        ['declared binding', { pc: { query: 'party.pc' } }, 'River'],
        ['missing query answer', { pc: { query: 'unavailable.query' } }, ''],
        ['dependent binding', { pc: { query: 'party.pc', args: { id: '$first.name' } }, first: { query: 'scene.place' } }, 'River'],
    ]) await t.test(name, async () => {
        const result = await compare(screen({ template, ...(data ? { data } : {}) }), sample);
        assert.equal(result.host.ok, true);
        assert.equal(result.host.text, expected);
    });
});

test('screen validation parity: duplicate bodies, cyclic aliases and unknown aliases refuse before rendering', async t => {
    for (const [name, extra, reason] of [
        ['duplicate template/layout', { layout: { root: { type: 'text', value: 'Should not render' } } }, /exactly one/],
        ['cyclic aliases', { data: { a: { query: 'party.pc', args: { id: '$b.name' } }, b: { query: 'party.pc', args: { id: '$a.name' } } } }, /circle/],
        ['unknown alias', { data: { a: { query: 'party.pc', args: { id: '$absent.name' } } } }, /not one of/],
    ]) await t.test(name, async () => {
        const result = await compare(screen({ template: '<p>Should not render</p>', ...extra }));
        assert.equal(result.host.ok, false);
        assert.match(result.studio.warnings.join(' '), reason);
    });
});

test('layout condition parity: strict boolean results and the original state document', async t => {
    for (const [cond, expected] of [['1', ''], ['state.domains.scene.on == true', 'Visible'], ['state.scene.on == true', ''], ['true', 'Visible']]) {
        await t.test(cond, async () => {
            const result = await compare(screen({ layout: { root: { type: 'when', cond, children: [{ type: 'text', value: 'Visible' }] } } }), {
                ...SAMPLE, state: { ...SAMPLE.state, domains: { scene: { on: true } } },
            });
            assert.equal(result.host.ok, true);
            assert.equal(result.host.text, expected);
        });
    }
});

test('layout envelope parity: screen id and root/theme survive ignored nested metadata', async () => {
    const result = await compare(screen({ layout: {
        id: 'ignored-id', title: '', icon: 'ignored-icon', unknown: true,
        root: { type: 'text', value: 'Root renders' }, theme: { tokens: { accent: '#123456' } },
    } }));
    assert.equal(result.host.ok, true);
    assert.equal(result.host.text, 'Root renders');
    assert.equal(result.hostLayout, 'parity');
    assert.equal(result.studioLayout, result.hostLayout);
    assert.equal(result.hostTheme, '#123456');
    assert.equal(result.studioTheme, result.hostTheme);
});
