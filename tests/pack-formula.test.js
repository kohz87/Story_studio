// Packs are always Standard: Pack settings has no Stat formula card and Studio writes no formula. A loaded pack that says 'standard'
// stays valid; one that says 'classic' gets Story Block's own refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as edits from '../src/edits.js';
import { openPack, exportPack } from '../src/model.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';

const worldPack = () => JSON.parse(readFileSync(new URL('../authoring-kit/examples/tiny-world/pack.json', import.meta.url), 'utf8'));
const withRpg = rpg => { const pack = worldPack(); pack.content = { ...pack.content, rpg }; return pack; };

function open(pack = worldPack()) {
    const ctx = createTestContext(openPack(pack));
    ctx.onRender = renderScreen;
    ctx.selection = { kind: 'settings' };
    ctx.render();
    return ctx;
}

test('Pack settings shows no Stat formula card and no formula buttons; the JSON fields stay', () => {
    const ctx = open();
    assert.equal(ctx.main.querySelector('[data-cf=formula]'), null);
    assert.equal(ctx.main.querySelector('[data-formula]'), null);
    assert.doesNotMatch(ctx.main.textContent, /Stat formula|Classic|Reader's choice/);
    const kids = ctx.main.childNodes.map(node => node.tagName?.toLowerCase());
    assert.deepEqual(kids.slice(0, 4), ['h1', 'p', 'p', 'details']);
});

test('Studio has no edit that writes a formula', () => {
    assert.equal(edits.setRpgFormula, undefined);
});

test('a pack that says standard stays valid, is shown as JSON and exports unchanged', () => {
    const ctx = open(withRpg({ formula: 'standard', numbers: { foeBase: 5 } }));
    assert.equal(ctx.model.validation.ok, true);
    assert.ok(ctx.main.querySelector('details textarea[data-path=\'["content","rpg"]\']') || ctx.main.querySelectorAll('details').length > 0);
    assert.deepEqual(openPack(exportPack(ctx.model)).document.content.rpg, { formula: 'standard', numbers: { foeBase: 5 } });
});

test('a pack that says classic shows Story Block\'s refusal and is not valid', () => {
    const ctx = open(withRpg({ formula: 'classic' }));
    const error = ctx.model.validation.errors.find(item => item.path === 'content.rpg.formula');
    assert.ok(error);
    assert.match(error.message, /"classic" is no longer supported/);
    assert.match(error.message, /Use "standard" or leave the formula out/);
    assert.equal(ctx.model.validation.ok, false);
    assert.equal(ctx.main.querySelector('[data-cf=formula]'), null);
});

test('opening and exporting a pack with no formula adds none', () => {
    const ctx = open();
    assert.equal(ctx.model.document.content.rpg, undefined);
    assert.equal(Object.hasOwn(openPack(exportPack(ctx.model)).document.content ?? {}, 'rpg'), false);
});
