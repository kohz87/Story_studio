// Open trainer templates (docs/v2/OPEN_TRAINERS_SPEC.md, Story Block 2.4.0): the 1.6.0 example pack opens, keeps its bytes,
// and its templates add no place reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { records } from '../src/records.js';
import { schemaForRecord } from '../src/form-schema.js';

const text = readFileSync(new URL('./fixtures/ersveil-bluewatch-1.6.0.json', import.meta.url), 'utf8');

test('Ersveil 1.6.0 opens with seven fixed trainers and four templates, and exports its own bytes', () => {
    const model = openPack(text);
    assert.equal(model.validation.ok, true);
    assert.equal(model.rulesHash.slice(0, 8), '2a56f0cf');
    const trainers = records(model, 'trainers');
    assert.equal(trainers.length, 11);
    assert.equal(trainers.filter(t => t.open === true).length, 4);
    assert.equal(exportPack(model), text);
});

test('a template has no place, so it adds no reference to a place', () => {
    const model = openPack(text);
    const places = model.references.filter(ref => ref.kind === 'trainers' && ref.targetKind === 'places');
    assert.equal(places.length, 7, 'one per fixed trainer');
    assert.ok(places.every(ref => ref.path[4] < 7), 'none of the four templates, which come after the seven fixed trainers');
});

test('a trainer is edited against its own variant: fixed has a place and no open marker, a template has a rank and a fee range', () => {
    const fixed = schemaForRecord('trainers', { slug: 'a', place: 'haven' });
    assert.ok(fixed.properties.place);
    assert.equal(fixed.properties.open, undefined);
    assert.equal(fixed.oneOf, undefined);
    const template = schemaForRecord('trainers', { slug: 'a', open: true });
    assert.equal(template.properties.place, undefined);
    assert.ok(template.properties.rank);
    assert.deepEqual(Object.keys(template.properties.fee.properties), ['coinMin', 'coinMax']);
    assert.equal(schemaForRecord('quests', {}).oneOf.length, 2, 'other kinds are untouched');
});
