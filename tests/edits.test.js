import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPack } from './fixtures/world.js';
import { openPack } from '../src/model.js';
import { add, remove, renameId, setField, setSchemaField } from '../src/edits.js';

test('adding a place is pure, validates, and undo restores the original snapshot', () => {
    const model = openPack(worldPack());
    const input = { slug: 'cave', name: 'Crystal Cave', x: 2, y: 5 };
    const result = add(model, 'places', input);
    assert.equal(result.ok, true);
    assert.equal(result.model.validation.ok, true);
    assert.equal(model.document.content.places.length, 2);
    assert.equal(result.model.document.content.places[2].name, 'Crystal Cave');
    assert.equal(Object.isFrozen(input), false);
    assert.equal(result.undo(), model);
    assert.equal(add(model, 'places', input).ok, true);
    assert.equal(add(result.model, 'places', input).errors[0].code, 'dup-id');
    assert.equal(add(model, 'unknownKind', input).ok, false);
});

test('place rename and cascade follow route endpoints without altering unrelated records', () => {
    const pack = worldPack({ routes: [{ slug: 'road', from: 'HAVEN', to: 'Mill', kind: 'road' }] });
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);
    const renamed = renameId(model, 'places', 'haven', 'harbor');
    assert.equal(renamed.ok, true);
    assert.equal(renamed.model.document.content.routes[0].from, 'harbor');
    assert.equal(renamed.model.document.content.routes[0].to, 'Mill');
    assert.equal(renamed.undo(), model);
    assert.equal(remove(model, 'places', 'haven').errors[0].code, 'referenced');
    const deleted = remove(model, 'places', 'haven', { cascade: true });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.model.document.content.routes.length, 0);
    assert.equal(deleted.model.document.content.places[0].slug, 'mill');
    assert.equal(deleted.undo(), model);
});

test('schema edits reject invalid values before history, while raw drafts stay repairable', () => {
    const model = openPack(worldPack());
    const refused = setSchemaField(model, ['content', 'places', 0, 'x'], 'not a number');
    assert.equal(refused.ok, false);
    assert.equal(refused.model, model);
    const draft = setField(model, ['content', 'places', 0, 'x'], 'not a number');
    assert.equal(draft.ok, true);
    assert.equal(draft.model.validation.ok, false);
    const repaired = setSchemaField(draft.model, ['content', 'places', 0, 'x'], 3);
    assert.equal(repaired.ok, true);
    assert.equal(repaired.model.validation.ok, true);
    assert.equal(repaired.undo(), draft.model);
});

test('unsafe paths, values, getters, cycles, and array bounds are refused without mutation', () => {
    const model = openPack(worldPack());
    let invoked = false;
    const getter = { get value() { invoked = true; throw new Error('getter invoked'); } };
    const cyclic = {}; cyclic.self = cyclic;
    for (const [path, value] of [
        [['content', '__proto__', 'polluted'], true],
        [['content', 'places', 0, 'note'], getter],
        [['content', 'places', 0, 'note'], cyclic],
        [['content', 'places', 0, 'note'], 'a'.repeat(4001)],
        [['content', 'places', -1], {}],
        [['content', 'places', 100], {}],
    ]) {
        const result = setField(model, path, value);
        assert.equal(result.ok, false, JSON.stringify(path));
        assert.equal(result.model, model);
    }
    assert.equal(invoked, false);
    assert.equal(setField(model, ['id'], 'other').errors[0].code, 'identity-field');
    assert.equal(setField(model, ['content', 'places', 0, 'slug'], 'other').errors[0].code, 'identity-field');
});
