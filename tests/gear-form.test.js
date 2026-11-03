import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPack } from './fixtures/world.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { exportPack, openPack } from '../src/model.js';
import { GEAR_BUDGET, GEAR_STATS, GEAR_SLOTS, statsProblem } from '../src/gear-form.js';
import { RARITIES } from '../vendor/story-block/src/v2/packs/limits.js';

function open(item) {
    const pack = worldPack();
    pack.content.items = [item];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', item.slug);
    return ctx;
}
const one = (ctx, tag, key) => ctx.inspector.querySelectorAll(tag).filter(node => {
    const raw = node.getAttribute('data-path');
    return raw && JSON.parse(raw).at(-1) === key;
})[0];
const set = (control, value) => { control.value = value; control.dispatchEvent({ type: 'change' }); };
const gear = ctx => ctx.model.document.content.items[0];
const errorText = ctx => ctx.inspector.querySelectorAll('p').filter(p => p.getAttribute('role') === 'alert').map(p => p.textContent).join('');
const addStat = ctx => ctx.inspector.querySelector('button[aria-label="Add stat"]').click();
const sword = { slug: 'cane-blade', name: 'Cane-Blade', kind: 'equipment', rarity: 'rare', value: 600 };

test('gear form: the slot and rarity selects list Story Block\'s words and the rarity shows its budget', () => {
    const ctx = open(sword);
    const slot = one(ctx, 'select', 'slot');
    assert.deepEqual(slot.querySelectorAll('option').map(o => o.textContent), ['none', ...GEAR_SLOTS.map(([, label]) => label)]);
    assert.ok(!slot.querySelectorAll('option').some(o => /bag/i.test(o.textContent)));
    const rarity = one(ctx, 'select', 'rarity');
    assert.deepEqual(rarity.querySelectorAll('option').map(o => o.textContent), RARITIES.map(word => `${word} (+${GEAR_BUDGET[word]})`));
    assert.deepEqual(GEAR_BUDGET, { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 });
    assert.deepEqual(GEAR_STATS, ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);
});

test('gear form: load, edit, export gives a shape Story Block accepts', () => {
    const ctx = open(sword);
    set(one(ctx, 'select', 'slot'), 'weapon');
    set(one(ctx, 'select', 'rarity'), 'epic');
    addStat(ctx);
    set(ctx.inspector.querySelector('select[data-gear-stat="0"]'), 'DEX');
    set(ctx.inspector.querySelector('input[data-gear-points="0"]'), '2');
    addStat(ctx);
    set(ctx.inspector.querySelector('input[data-gear-points="1"]'), '1');
    ctx.inspector.querySelector('button[aria-label="Enable carry"]').click();
    set(one(ctx, 'input', 'carry'), '5');
    assert.equal(errorText(ctx), '');
    assert.equal(gear(ctx).slot, 'weapon');
    assert.equal(gear(ctx).rarity, 'epic');
    assert.deepEqual(gear(ctx).stats, { DEX: 2, STR: 1 });
    assert.equal(gear(ctx).carry, 5);
    const reopened = openPack(exportPack(ctx.model));
    assert.equal(reopened.validation.ok, true, JSON.stringify(reopened.validation));
    assert.deepEqual(reopened.document.content.items[0], gear(ctx));
    // Set to none removes the slot instead of storing a null.
    set(one(ctx, 'select', 'slot'), '');
    assert.equal(Object.hasOwn(gear(ctx), 'slot'), false);
});

test('gear form: stat points never pass the rarity budget', () => {
    const ctx = open({ ...sword, slot: 'weapon', stats: { STR: 2 } });
    assert.equal(errorText(ctx), '');
    set(ctx.inspector.querySelector('input[data-gear-points="0"]'), '3');
    assert.equal(errorText(ctx), 'STR 3 would use 3 points; rare gives 2.');
    assert.equal(ctx.inspector.querySelector('input[data-gear-points="0"]').value, '2');
    assert.deepEqual(gear(ctx).stats, { STR: 2 });
    addStat(ctx);
    assert.match(errorText(ctx), /All 2 points are used/);
    assert.deepEqual(gear(ctx).stats, { STR: 2 });
    set(ctx.inspector.querySelector('input[data-gear-points="0"]'), '1');
    assert.equal(errorText(ctx), '');
    assert.deepEqual(gear(ctx).stats, { STR: 1 });
    assert.equal(statsProblem({ STR: 1 }, 'common'), 'The points add up to 1; common gives 0.');
    const bare = open({ ...sword, rarity: 'common' });
    addStat(bare);
    assert.match(errorText(bare), /no stat points/);
    assert.equal(Object.hasOwn(gear(bare), 'stats'), false);
});

test('gear form: a refused edit names what was tried and the fields show the stored points', () => {
    const ctx = open({ ...sword, slot: 'weapon', stats: { STR: 1, DEX: 1 } });
    set(ctx.inspector.querySelector('input[data-gear-points="1"]'), '3');
    assert.equal(errorText(ctx), 'DEX 3 would use 4 points; rare gives 2.');
    assert.equal(ctx.inspector.querySelector('input[data-gear-points="0"]').value, '1');
    assert.equal(ctx.inspector.querySelector('input[data-gear-points="1"]').value, '1');
    assert.deepEqual(gear(ctx).stats, { STR: 1, DEX: 1 });
    // A stat change that repeats another row's stat is refused, and the picker goes back to the stored stat.
    set(ctx.inspector.querySelector('select[data-gear-stat="0"]'), 'DEX');
    assert.equal(errorText(ctx), 'A stat can be chosen once.');
    assert.equal(ctx.inspector.querySelector('select[data-gear-stat="0"]').value, 'STR');
    assert.deepEqual(gear(ctx).stats, { STR: 1, DEX: 1 });
});

test('gear form: a piece raises at most two stats', () => {
    const ctx = open({ ...sword, rarity: 'legendary', slot: 'weapon', stats: { STR: 1, DEX: 1 } });
    addStat(ctx);
    assert.match(errorText(ctx), /at most 2 stats/);
    assert.deepEqual(gear(ctx).stats, { STR: 1, DEX: 1 });
    set(ctx.inspector.querySelector('select[data-gear-stat="1"]'), 'STR');
    assert.match(errorText(ctx), /once/);
    assert.deepEqual(gear(ctx).stats, { STR: 1, DEX: 1 });
    assert.match(statsProblem({ STR: 1, DEX: 1, AGI: 1 }, 'legendary'), /at most 2 stats/);
    ctx.inspector.querySelector('button[aria-label="Remove stat 1"]').click();
    assert.deepEqual(gear(ctx).stats, { DEX: 1 });
});

test('gear form: an old pack with no gear fields loads and exports byte for byte', () => {
    const old = { slug: 'herb', name: 'Herb', kind: 'consumable', rarity: 'common', effect: { heal: 10 } };
    const ctx = open(old);
    const before = exportPack(ctx.model);
    assert.equal(one(ctx, 'select', 'slot').value, '');
    assert.equal(ctx.inspector.querySelectorAll('select').some(s => s.getAttribute('data-gear-stat') !== null), false);
    set(one(ctx, 'select', 'slot'), '');
    assert.equal(exportPack(ctx.model), before);
    assert.equal(ctx.history.canUndo, false);
    const second = open({ ...old, slot: 'hand', stats: { speed: 2 } });
    const kept = exportPack(second.model);
    assert.match(one(second, 'select', 'slot').querySelectorAll('option').map(o => o.textContent).join('|'), /other: hand/);
    assert.equal(exportPack(second.model), kept);
    assert.deepEqual(gear(second).stats, { speed: 2 });
});
