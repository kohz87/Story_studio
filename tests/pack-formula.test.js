// The "Stat formula" card of Pack settings: the choice is written as content.rpg.formula through the edit pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { setRpgFormula } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';

const worldPack = () => JSON.parse(readFileSync(new URL('../authoring-kit/examples/tiny-world/pack.json', import.meta.url), 'utf8'));
const withRpg = rpg => { const pack = worldPack(); pack.content = { ...pack.content, rpg }; return pack; };
const SKILL_SET = { name: 'Wayfarer', skills: [{ name: 'Spark', about: 'A small burst of magic.', stat: 'int', uses: 'mana' }] };

function open(pack = worldPack()) {
    const ctx = createTestContext(openPack(pack));
    ctx.onRender = renderScreen;
    ctx.selection = { kind: 'settings' };
    ctx.render();
    return ctx;
}
const card = ctx => ctx.main.querySelector('[data-cf=formula]');
const choices = ctx => card(ctx).querySelectorAll('button');
const pressed = ctx => choices(ctx).filter(node => node.getAttribute('aria-pressed') === 'true').map(node => node.textContent);
const help = ctx => card(ctx).querySelector('[data-cf=formula-help]').textContent;
const press = (ctx, label) => { const node = choices(ctx).find(item => item.textContent === label); assert.ok(node, label); node.click(); };
const rpg = ctx => ctx.model.document.content.rpg;

test('the card comes first in Pack settings, under the hint lines and above the JSON fields', () => {
    const ctx = open();
    const kids = ctx.main.childNodes.map(node => node.tagName?.toLowerCase());
    assert.deepEqual(kids.slice(0, 4), ['h1', 'p', 'p', 'section']);
    assert.equal(card(ctx).querySelector('h3').textContent, 'Stat formula');
    assert.equal(ctx.main.querySelectorAll('details')[0].parentElement, ctx.main);
    assert.ok(kids.indexOf('details') > 3);
    assert.deepEqual(choices(ctx).map(node => node.textContent), ["Reader's choice", 'Standard', 'Classic']);
    assert.equal(card(ctx).querySelector('.cf-seg').getAttribute('aria-label'), 'Stat formula');
    assert.match(card(ctx).textContent, /Plays on/);
});

test('with no formula the reader decides, and the help line follows each choice', () => {
    const ctx = open();
    assert.deepEqual(pressed(ctx), ["Reader's choice"]);
    assert.equal(help(ctx), 'The reader picks in Settings → RPG; a chat that never chose plays Standard.');
    press(ctx, 'Standard');
    assert.deepEqual(pressed(ctx), ['Standard']);
    assert.equal(help(ctx), 'A main stat plus half a second one, stats start at 5 and grow, and the bars grow with VIT, AGI and INT.');
    press(ctx, 'Classic');
    assert.deepEqual(pressed(ctx), ['Classic']);
    assert.equal(help(ctx), 'One stat on its own, stats start at 10, and the bars are fixed.');
    press(ctx, "Reader's choice");
    assert.deepEqual(pressed(ctx), ["Reader's choice"]);
});

test('choosing writes content.rpg.formula, creates the field when missing, and the pack stays valid', () => {
    const ctx = open();
    assert.equal(ctx.model.document.content.rpg, undefined);
    press(ctx, 'Classic');
    assert.deepEqual(rpg(ctx), { formula: 'classic' });
    assert.equal(ctx.model.validation.ok, true);
    assert.deepEqual(openPack(exportPack(ctx.model)).document.content.rpg, { formula: 'classic' });
    assert.ok(ctx.main.querySelector('details textarea[data-path=\'["content","rpg"]\']').value.includes('classic'), 'the JSON card shows the same value');
});

test('Undo and Redo walk the choice back and forth', () => {
    const ctx = open();
    press(ctx, 'Standard');
    press(ctx, 'Classic');
    ctx.history.undo(); ctx.render();
    assert.deepEqual(pressed(ctx), ['Standard']);
    ctx.history.undo(); ctx.render();
    assert.deepEqual(pressed(ctx), ["Reader's choice"]);
    assert.equal(ctx.model.document.content.rpg, undefined);
    ctx.history.redo(); ctx.render();
    assert.deepEqual(pressed(ctx), ['Standard']);
});

test("Reader's choice removes the formula but keeps numbers and skill sets; an empty rpg is dropped", () => {
    const ctx = open(withRpg({ formula: 'classic', numbers: { foeBase: 5 }, skillSets: [SKILL_SET] }));
    assert.deepEqual(pressed(ctx), ['Classic']);
    press(ctx, "Reader's choice");
    assert.deepEqual(rpg(ctx), { numbers: { foeBase: 5 }, skillSets: [SKILL_SET] });
    press(ctx, 'Standard');
    assert.deepEqual(rpg(ctx), { numbers: { foeBase: 5 }, skillSets: [SKILL_SET], formula: 'standard' });
    const only = open(withRpg({ formula: 'standard' }));
    press(only, "Reader's choice");
    assert.equal(Object.hasOwn(only.model.document.content, 'rpg'), false);
    assert.equal(only.model.validation.ok, true);
});

test('choosing the formula already set does nothing', () => {
    const ctx = open(withRpg({ formula: 'classic' }));
    const before = ctx.model;
    press(ctx, 'Classic');
    assert.equal(ctx.model, before);
    const none = open();
    const start = none.model;
    press(none, "Reader's choice");
    assert.equal(none.model, start);
});

test('a formula Story Block does not know shows no choice and the check names it; a choice replaces it', () => {
    const ctx = open(withRpg({ formula: 'wild' }));
    assert.deepEqual(pressed(ctx), []);
    assert.match(help(ctx), /not a formula Story Block knows/);
    assert.ok(ctx.model.validation.errors.some(error => error.path === 'content.rpg.formula'));
    press(ctx, 'Classic');
    assert.equal(rpg(ctx).formula, 'classic');
    assert.equal(ctx.model.validation.ok, true);
});

test('a content.rpg that is not an object is left alone: the choices are off and the edit refuses', () => {
    const ctx = open(withRpg([{ slug: 'formula', formula: 'classic' }]));
    assert.ok(choices(ctx).every(node => node.disabled));
    assert.match(help(ctx), /not an object/);
    const refused = setRpgFormula(ctx.model, 'classic');
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].code, 'bad-container');
    assert.deepEqual(rpg(ctx), [{ slug: 'formula', formula: 'classic' }]);
});

test('setRpgFormula refuses a value that is not a formula and never touches the other fields', () => {
    const model = openPack(withRpg({ numbers: { foeBase: 5 } }));
    assert.equal(setRpgFormula(model, 'turbo').ok, false);
    assert.equal(setRpgFormula(model, undefined).ok, false);
    const set = setRpgFormula(model, 'standard');
    assert.equal(set.ok, true);
    assert.deepEqual(set.model.document.content.rpg, { numbers: { foeBase: 5 }, formula: 'standard' });
    assert.equal(set.undo(), model);
    assert.deepEqual(model.document.content.rpg, { numbers: { foeBase: 5 } });
});
