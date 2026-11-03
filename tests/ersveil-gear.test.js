// Story Block 2.18.0: the Ersveil 2.6.0 example (items with gear fields, cast with a `gear` list) opens, checks and exports in Studio,
// the cast form keeps a cast member's `gear` list as it is (no UI for it; the JSON is the fallback), and the Items form's gear constants are Story Block's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';
import { GEAR_BUDGET, GEAR_MAX_STATS, GEAR_SLOTS, GEAR_STATS } from '../src/gear-form.js';
import { GEAR } from '../vendor/story-block/src/v2/domains/gear.js';

const text = readFileSync(new URL('./fixtures/ersveil-2.6.0.json', import.meta.url), 'utf8');

test('Ersveil 2.6.0 loads and validates in Studio and exports the very bytes it came in', () => {
    const model = openPack(text);
    assert.deepEqual(model.validation.errors, []);
    assert.equal(model.document.version, '2.6.0');
    assert.ok(model.document.content.items.some(item => item.slot || item.stats), 'the pack has gear items');
    assert.equal(exportPack(model), text);
});

test('the cast form keeps a cast member\'s gear list: an edit elsewhere and an export leave it as written', () => {
    const model = openPack(text);
    const cast = model.document.content.cast;
    const at = cast.findIndex(person => person.id === 'temiwa');
    assert.deepEqual(cast[at].gear, ['flame-cross-pendant']);
    const ctx = createTestContext(model);
    ctx.onRender = renderScreen;
    ctx.select('cast', 'temiwa');
    const voice = ctx.inspector.querySelector(`[data-path='${JSON.stringify(['content', 'cast', at, 'voice'])}']`);
    voice.value = 'Low and dry.';
    voice.dispatchEvent({ type: 'change' });
    const out = JSON.parse(exportPack(ctx.model));
    assert.equal(out.content.cast[at].voice, 'Low and dry.');
    assert.deepEqual(out.content.cast[at].gear, ['flame-cross-pendant']);
    out.content.cast.forEach((person, n) => { if (n !== at) assert.deepEqual(person, cast[n]); });
});

test('Studio\'s gear constants are Story Block\'s own', () => {
    assert.deepEqual(GEAR_STATS, GEAR.stats);
    assert.deepEqual(GEAR_BUDGET, GEAR.budget);
    assert.equal(GEAR_MAX_STATS, GEAR.maxStats);
    assert.deepEqual(GEAR_SLOTS.map(([word]) => word).sort(), [...GEAR.slots].sort());
});
