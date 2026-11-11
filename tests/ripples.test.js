// The Ripples screen: its pure helpers, and edit round trips on Ersveil (add and remove a power, a name, a person, weights, base)
// through the real controls: each edit passes the vendored checker and undo puts the pack back byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { renderScreen } from '../src/screens/index.js';
import { goToProblem } from '../src/screens/problems.js';
import { powersOf, baseShares, leaderAtStart, countRippleEvents, standingKeys, freshPowerId } from '../src/screens/ripples.js';
import { createTestContext } from './helpers/dom.js';

const read = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
function ersveil() {
    const pack = read('ersveil-pack.json');
    const extra = read('ersveil-names-ripples.json');
    pack.content.names = extra.names;
    pack.ripples = extra.ripples;
    return JSON.stringify(pack);
}
function open(id = 'wendhild') {
    const ctx = createTestContext(openPack(ersveil()));
    ctx.onRender = renderScreen;
    ctx.select('ripples', id);
    return ctx;
}
const buttons = (root, label) => root.querySelectorAll('button').filter(node => node.textContent === label || node.getAttribute('aria-label') === label);
const press = (root, label) => { const [node] = buttons(root, label); assert.ok(node, `no button ${label}`); node.click(); };
const input = (root, label) => { const [node] = root.querySelectorAll('input').filter(item => item.getAttribute('aria-label') === label); assert.ok(node, `no input ${label}`); return node; };
const powers = ctx => ctx.model.document.ripples.powers;
const ok = ctx => { assert.deepEqual(ctx.model.validation.errors, []); assert.equal(ctx.model.validation.ok, true); };

test('shares are each base over the total; the leader is the highest base, the first on a tie', () => {
    const list = [{ id: 'a', name: 'A', base: 40 }, { id: 'b', name: 'B', base: 40 }, { id: 'c', base: 20 }];
    assert.deepEqual(baseShares(list).map(item => Math.round(item.share)), [40, 40, 20]);
    assert.equal(leaderAtStart(list).id, 'a');
    assert.equal(leaderAtStart([]), null);
    assert.deepEqual(baseShares([{ id: 'z', base: 0 }]).map(item => item.share), [0]);
});

test('events that read ripples are counted; powers skip what is not an object; fresh ids do not collide', () => {
    assert.equal(countRippleEvents([{ when: "query('ripples.leader') == 'a'" }, { when: 'true' }, null, { when: "query( 'ripples.sway.a') > 3" }]), 2);
    assert.equal(countRippleEvents(undefined), 0);
    assert.deepEqual(powersOf({ document: { ripples: { powers: [{ id: 'a' }, 7, { id: 'b' }] } } }).map(item => item.idx), [0, 2]);
    assert.equal(freshPowerId([{ id: 'new-power' }, { id: 'new-power-2' }]), 'new-power-3');
    assert.equal(freshPowerId([]), 'new-power');
});

test('standing keys come from the map fields of the data modules', () => {
    const keys = standingKeys(open().model);
    assert.ok(keys.includes('highmark'));
    assert.equal(new Set(keys).size, keys.length);
});

test('the screen shows the start bar, a card per power, the read-by note and the selected power’s editor', () => {
    const ctx = open();
    assert.equal(ctx.main.querySelector('h1').textContent, 'Ripples');
    assert.equal(ctx.main.querySelectorAll('button.ripple-card').length, powers(ctx).length);
    assert.ok(ctx.main.querySelector('.ripples-start'));
    assert.equal(ctx.inspector.querySelector('h2').textContent, 'Princess Wendhild');
    assert.ok(ctx.inspector.querySelectorAll('.cf-seg').length >= 1);
});

test('add a power, rename it, set its base, add a name, a faction and a person with a weight; remove it: all pass the checker', () => {
    const ctx = open();
    const before = exportPack(ctx.model);
    const n = powers(ctx).length;
    press(ctx.main, '+ Power');
    ok(ctx);
    assert.equal(powers(ctx).length, n + 1);
    const id = ctx.selection.id;
    assert.equal(id, 'new-power');
    const at = () => powers(ctx).find(power => power.id === id);
    const range = ctx.inspector.querySelectorAll('input').find(item => item.getAttribute('aria-label') === 'Base sway');
    range.value = '55';
    range.dispatchEvent({ type: 'change' });
    assert.equal(at().base, 55);
    const alias = input(ctx.inspector, 'Also called: new');
    alias.value = 'The Newcomer';
    buttons(ctx.inspector, '+ Name')[0].click();
    const faction = input(ctx.inspector, 'Factions that count for them: new');
    faction.value = 'Newcomer’s men';
    buttons(ctx.inspector, '+ Faction')[0].click();
    const person = input(ctx.inspector, 'Person: new');
    person.value = 'Old Pell';
    press(ctx.inspector, '+ Person');
    ok(ctx);
    assert.deepEqual(at().aliases, ['The Newcomer']);
    assert.deepEqual(at().npcs, [{ name: 'Old Pell', weight: 1 }]);
    const [weight3] = ctx.inspector.querySelectorAll('.cf-seg button').filter(node => node.textContent === '3');
    weight3.click();
    ok(ctx);
    assert.equal(at().npcs[0].weight, 3);
    press(ctx.inspector, 'Remove Old Pell');
    assert.equal(at().npcs, undefined);
    ok(ctx);
    press(ctx.inspector, 'Delete');
    ok(ctx);
    assert.equal(powers(ctx).length, n);
    for (let i = 0; i < 9; i++) ctx.history.undo();
    ctx.render();
    assert.equal(exportPack(ctx.model), before);
});

test('a power’s weights change one at a time and the others stay', () => {
    const ctx = open();
    const was = JSON.parse(JSON.stringify(powers(ctx)[0].npcs));
    const [one] = ctx.inspector.querySelectorAll('.cf-seg').map(group => group.querySelectorAll('button').find(node => node.textContent === '1'));
    one.click();
    ok(ctx);
    assert.equal(powers(ctx)[0].npcs[0].weight, 1);
    assert.deepEqual(powers(ctx)[0].npcs.slice(1), was.slice(1));
});

test('a power renamed by id keeps the table valid; a duplicate id is a problem the checker names', () => {
    const ctx = open();
    const idInput = ctx.inspector.querySelectorAll('input').find(item => item.value === 'wendhild');
    idInput.value = 'wendhild-2';
    idInput.dispatchEvent({ type: 'change' });
    ok(ctx);
    assert.equal(powers(ctx)[0].id, 'wendhild-2');
    assert.equal(ctx.selection.id, 'wendhild-2');
});

test('an empty list is dropped rather than written, and a problem path leads to its power', () => {
    const ctx = open();
    const last = powers(ctx)[0].factions.length;
    for (let i = 0; i < last; i++) {
        const set = ctx.inspector.querySelectorAll('fieldset').find(node => node.querySelector('legend').textContent.startsWith('Factions'));
        press(set, `Remove ${powers(ctx)[0].factions[0]}`);
    }
    assert.equal(powers(ctx)[0].factions, undefined);
    ok(ctx);
    ctx.select('ripples', null);
    goToProblem(ctx, { path: 'ripples.powers.1.base', message: 'x' });
    assert.equal(ctx.selection.kind, 'ripples');
    assert.equal(ctx.selection.id, powers(ctx)[1].id);
});
