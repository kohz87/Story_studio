// World pack model and safety checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPack } from './fixtures/world.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { openPack, exportPack, indexReferences } from '../src/model.js';

test('caller inputs are never mutated; returned model is immutable snapshot', () => {
    const pack = worldPack();
    const rawSnapshot = JSON.stringify(pack);

    const model = openPack(pack);

    // Caller pack was not mutated or frozen
    assert.equal(Object.isFrozen(pack), false);
    assert.equal(JSON.stringify(pack), rawSnapshot);

    // Modifying caller input does not affect model
    pack.name = 'Mutated';
    assert.notEqual(model.document.name, 'Mutated');

    // Model and internal structures are deeply frozen
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.document));
    assert.ok(Object.isFrozen(model.validation));
    assert.ok(Object.isFrozen(model.references));

    assert.throws(() => {
        model.document.name = 'Illegal';
    }, TypeError);

    assert.throws(() => {
        model.validation.ok = false;
    }, TypeError);
});


test('malformed JSON returns null document, structured errors, and export throws', () => {
    const badJson = '{ "id": "broken", invalid }';
    const model = openPack(badJson);

    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.equal(model.packHash, null);
    assert.deepEqual(model.references, []);
    assert.ok(model.validation.errors.length > 0);
    assert.equal(model.validation.errors[0].code, 'NOT_JSON');

    // Exporting invalid model throws Error with errors property
    assert.throws(
        () => exportPack(model),
        err => {
            assert.ok(err instanceof Error);
            assert.ok(Array.isArray(err.errors));
            assert.equal(err.errors[0].code, 'NOT_JSON');
            return true;
        }
    );

    // Non-object inputs also produce structured errors
    for (const nonObj of [null, 123, 'not a json', []]) {
        const m = openPack(nonObj);
        assert.equal(m.document, null);
        assert.equal(m.validation.ok, false);
        assert.ok(m.validation.errors.length > 0);
        assert.throws(() => exportPack(m));
    }
});


test('safeClone handles 10,000 nested objects without RangeError, returning null document with checker errors', () => {
    let deep = { id: 'fixture' };
    let curr = deep;
    for (let i = 0; i < 10000; i++) {
        curr.nested = {};
        curr = curr.nested;
    }

    const model = openPack(deep);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.ok(model.validation.errors.some(e => ['TOO_DEEP', 'TOO_MANY', 'TOO_LARGE'].includes(e.code)));
    assert.deepEqual(model.references, []);

    // indexReferences on deep document also safely returns [] without throwing
    assert.deepEqual(indexReferences(deep), []);
});


test('safeClone preserves duplicated shared (noncyclic) plain objects without treating them as cycles', () => {
    const sameObject = { slug: 'sword', name: 'Iron Sword', kind: 'goods', value: 10 };
    const doc = {
        id: 'fixture',
        content: {
            items: [sameObject, sameObject],
        },
    };

    const model = openPack(doc);
    assert.ok(model.document !== null);
    assert.equal(model.document.content.items.length, 2);
    assert.deepEqual(model.document.content.items[0], sameObject);
    assert.deepEqual(model.document.content.items[1], sameObject);
    assert.notEqual(model.document.content.items[1], null);
});


test('getters on input objects must never run and yield document null', () => {
    let getterRan = false;
    const badObj = {
        id: 'fixture',
        get exploit() {
            getterRan = true;
            return 'malicious';
        },
    };

    const model = openPack(badObj);
    assert.equal(getterRan, false, 'Getter must not run during openPack');
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);

    const refs = indexReferences(badObj);
    assert.equal(getterRan, false, 'Getter must not run during indexReferences');
    assert.deepEqual(refs, []);
});


test('unsafe own __proto__ property yields document null', () => {
    const unsafeProto = JSON.parse('{"id":"fixture","__proto__":{"polluted":true}}');
    const model = openPack(unsafeProto);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(indexReferences(unsafeProto), []);
});


test('cycles yield document null without throwing', () => {
    const cyclic = { id: 'fixture' };
    cyclic.self = cyclic;

    const model = openPack(cyclic);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(indexReferences(cyclic), []);
});


test('oversized array (> 1000 items) yields document null with checker errors', () => {
    const bigArray = new Array(1001).fill('item');
    const doc = {
        id: 'fixture',
        content: {
            items: bigArray,
        },
    };

    const model = openPack(doc);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.ok(model.validation.errors.some(e => ['TOO_DEEP', 'TOO_MANY', 'TOO_LARGE'].includes(e.code)));
});


test('unsupported function values yield document null', () => {
    const docWithFn = {
        id: 'fixture',
        content: {
            customFn: () => 'hello',
        },
    };

    const model = openPack(docWithFn);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(indexReferences(docWithFn), []);
});

// Regression 4: SB item name/alias lookup in start.inventory.items and preset choice names

test('route names and aliases use shared place folding while qualified foreign IDs stay intact', () => {
    const pack = worldPack();
    pack.content.places[0].aliases = ['Safe Haven'];
    pack.content.routes = [
        { slug: 'road', from: 'HAVEN', to: 'Mill', kind: 'road' },
        { slug: 'trail', from: '  ＳＡＦＥ ＨＡＶＥＮ  ', to: 'MILL', kind: 'trail' },
    ];
    assert.equal(validatePack(pack).ok, true);
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);
    for (const [index, field, slug] of [[0, 'from', 'haven'], [0, 'to', 'mill'], [1, 'from', 'haven'], [1, 'to', 'mill']]) {
        const expected = {
            kind: 'routes', id: `pack.fixture/${index ? 'trail' : 'road'}`,
            path: ['content', 'routes', index, field], targetKind: 'places', targetId: `pack.fixture/${slug}`,
        };
        assert.deepEqual(model.references.find(ref => ref.path.join('.') === expected.path.join('.')), expected);
        assert.deepEqual(indexReferences(pack).find(ref => ref.path.join('.') === expected.path.join('.')), expected);
    }
    pack.content.routes[0].from = 'pack.foreign/haven';
    assert.equal(indexReferences(pack).find(ref => ref.path.join('.') === 'content.routes.0.from').targetId, 'pack.foreign/haven');
});

// Canonical indentation must not turn an SB-valid input into an invalid pack.

test('hostile proxy trap does not throw in openPack or indexReferences', () => {
    const hostile = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('trap');
        },
    });

    // openPack must return safe failure without throwing
    const model = openPack(hostile);
    assert.equal(model.validation.ok, false);
    assert.equal(model.document, null);
    assert.equal(model.packHash, null);
    assert.deepEqual(model.references, []);

    // indexReferences must return empty array without throwing
    const refs = indexReferences(hostile);
    assert.deepEqual(refs, []);
});


test('JSON text follows SB duplicate-key semantics before editing', () => {
    const text = JSON.stringify(worldPack()).replace('"id":"fixture"', '"id":"first","id":"fixture"');
    const checked = validatePack(text);
    const model = openPack(text);
    assert.equal(checked.ok, true);
    assert.equal(model.validation.ok, true);
    assert.equal(model.packHash, checked.packHash ?? null);
    assert.equal(exportPack(model), text);
});
