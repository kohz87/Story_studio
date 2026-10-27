// Generative offers fields (Story Block 2.5.0): the generic record form shows and edits countMin and countMax on an open kill or
// collect objective, offerType on an open quest, aliases on a foe and offerWords in the rules options, and Story Block's checker
// refuses what it refuses (an inverted range, an offerType the first objective cannot settle, an alias that names another foe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { schemaForKind } from '../src/form-schema.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';

const text = readFileSync(new URL('./fixtures/ersveil-bluewatch-1.6.0.json', import.meta.url), 'utf8');

function context(mutate) {
    const pack = JSON.parse(text);
    mutate?.(pack);
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    return ctx;
}
function control(ctx, tag, ...tail) {
    return ctx.inspector.querySelectorAll(tag).find(node => {
        const raw = node.getAttribute('data-path');
        const path = raw && JSON.parse(raw);
        return path && tail.every((part, i) => path.at(-tail.length + i) === part);
    });
}
function button(ctx, label) { return ctx.inspector.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label); }
function change(node, value) { node.value = value; node.dispatchEvent({ type: 'change' }); }
const quest = (ctx, slug) => ctx.model.document.content.quests.find(q => q.slug === slug);

test('the foe, quest and objective schemas carry the 2.5.0 fields with their bounds', () => {
    const foe = schemaForKind('creatures');
    assert.equal(foe.properties.aliases.maxItems, 8);
    assert.equal(foe.properties.aliases.items.maxLength, 80);
    const open = schemaForKind('quests').oneOf.find(variant => variant.defName === 'openQuest');
    assert.deepEqual(open.properties.offerType.enum, ['hunt', 'cull', 'gather', 'deliver', 'explore', 'escort', 'task']);
    const kinds = open.properties.objectives.items.oneOf ?? [open.properties.objectives.items];
    const bounded = kinds.filter(variant => variant.properties?.countMin);
    assert.equal(bounded.length, 2, 'kill and collect');
    for (const variant of bounded) {
        assert.deepEqual([variant.properties.countMin.minimum, variant.properties.countMin.maximum], [1, 999]);
        assert.deepEqual([variant.properties.countMax.minimum, variant.properties.countMax.maximum], [1, 999]);
    }
});

test('an open kill quest takes countMin, countMax and offerType from its form, and undo restores it', () => {
    const ctx = context();
    ctx.select('quests', 'open-hunt-d');
    const before = ctx.model;
    button(ctx, 'Enable offerType').click();
    assert.equal(quest(ctx, 'open-hunt-d').offerType, 'hunt');
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    change(control(ctx, 'select', 'offerType'), 'cull');
    assert.equal(quest(ctx, 'open-hunt-d').offerType, 'cull');
    button(ctx, 'Enable countMin').click();
    button(ctx, 'Enable countMax').click();
    change(control(ctx, 'input', 'countMin'), '2');
    change(control(ctx, 'input', 'countMax'), '6');
    assert.deepEqual(quest(ctx, 'open-hunt-d').objectives[0], { id: 'ob_00000001', kind: 'kill', count: 1, allowVariants: true, countMin: 2, countMax: 6 });
    assert.ok(ctx.model.validation.errors.some(e => e.path === 'content.quests[' + ctx.model.document.content.quests.findIndex(q => q.slug === 'open-hunt-d') + '].objectives[0].count'),
        'count 1 is below countMin 2 and Story Block says so at the count');
    change(control(ctx, 'input', 'count'), '3');
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    const objective = openPack(exportPack(ctx.model)).document.content.quests.find(q => q.slug === 'open-hunt-d').objectives[0];
    assert.deepEqual([objective.countMin, objective.count, objective.countMax], [2, 3, 6]);
    while (ctx.history.canUndo) ctx.history.undo();
    assert.equal(ctx.model, before);
});

test('a collect objective takes the same range, and the form refuses a value outside 1 to 999', () => {
    const ctx = context();
    ctx.select('quests', 'open-delivery-f');
    button(ctx, 'Enable countMax').click();
    const countMax = control(ctx, 'input', 'countMax');
    const notes = ctx.notifications.length;
    change(countMax, '1000');
    assert.equal(ctx.notifications.length, notes + 1);
    assert.match(ctx.notifications.at(-1), /^bad-value:/);
    change(countMax, '4');
    assert.equal(quest(ctx, 'open-delivery-f').objectives[0].countMax, 4);
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
});

test('an offerType the first objective cannot settle, and an inverted range, show as Story Block problems', () => {
    const ctx = context();
    ctx.select('quests', 'open-delivery-e');
    button(ctx, 'Enable offerType').click();
    change(control(ctx, 'select', 'offerType'), 'hunt');
    const index = ctx.model.document.content.quests.findIndex(q => q.slug === 'open-delivery-e');
    const refused = ctx.model.validation.errors.find(e => e.path === `content.quests[${index}].offerType`);
    assert.equal(refused?.code, 'bad-schema');
    change(control(ctx, 'select', 'offerType'), 'gather');
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    button(ctx, 'Enable countMin').click();
    button(ctx, 'Enable countMax').click();
    change(control(ctx, 'input', 'countMin'), '5');
    change(control(ctx, 'input', 'countMax'), '3');
    const inverted = ctx.model.validation.errors.find(e => e.path === `content.quests[${index}].objectives[0].countMax`);
    assert.equal(inverted?.code, 'bad-schema');
});

test('a foe takes aliases from its form, and an alias that is another foe refuses at the alias', () => {
    const ctx = context();
    ctx.select('creatures', 'sluice-leech');
    const index = ctx.model.document.content.creatures.findIndex(foe => foe.slug === 'sluice-leech');
    button(ctx, 'Enable aliases').click();
    assert.deepEqual(ctx.model.document.content.creatures[index].aliases, []);
    button(ctx, 'Add aliases item').click();
    const alias = control(ctx, 'input', 'aliases', 0);
    assert.ok(alias);
    change(alias, 'Drain Worm');
    assert.deepEqual(ctx.model.document.content.creatures[index].aliases, ['Drain Worm']);
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    const other = ctx.model.document.content.creatures.find(foe => foe.slug !== 'sluice-leech').name;
    change(control(ctx, 'input', 'aliases', 0), other.toUpperCase());
    const error = ctx.model.validation.errors.find(e => e.path === `content.creatures[${index}].aliases[0]`);
    assert.equal(error?.code, 'bad-schema');
    assert.match(error.message, /another foe/);
});

test('the rules options list offerWords, a lower case word table edited as JSON', () => {
    const ctx = context();
    ctx.selection = { kind: 'settings' };
    renderScreen(ctx);
    const paths = ctx.main.querySelectorAll('textarea').map(node => JSON.parse(node.getAttribute('data-path')).join('.'));
    assert.ok(paths.includes('content.rules.0.offerWords'));
    const area = ctx.main.querySelectorAll('textarea').find(node => JSON.parse(node.getAttribute('data-path')).join('.') === 'content.rules.0.offerWords');
    change(area, JSON.stringify({ hunt: ['slay', 'track'], easy: ['simple'] }));
    assert.deepEqual(ctx.model.document.content.rules[0].offerWords, { hunt: ['slay', 'track'], easy: ['simple'] });
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    change(area, JSON.stringify({ hunt: ['Slay'] }));
    const error = ctx.model.validation.errors.find(e => e.path === 'content.rules[0].offerWords.hunt[0]');
    assert.equal(error?.code, 'bad-schema');
});
