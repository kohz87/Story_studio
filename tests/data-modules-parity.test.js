// Studio's verdict must equal Story Block's checker verdict for every fixture Story Block ships (vendored beside the
// checker by `npm run sync-sb`): the two complete worked examples and one refusal vector per DM_* code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { DM_DIAGNOSTICS, DM_LIMITS } from '../vendor/story-block/src/v2/data-modules/check.js';
import { openPack, exportPack } from '../src/model.js';
import { replaceModules, checkModules } from '../src/data-modules/dm-edits.js';
import { status } from '../src/data-modules/sb-adapter.js';
import { grammarPreview } from '../src/data-modules/grammar.js';

const DIR = new URL('../vendor/story-block-fixtures/data-modules/', import.meta.url);
const read = name => readFileSync(new URL(`${name}.json`, DIR), 'utf8');
const names = readdirSync(DIR).map(file => file.replace(/\.json$/, '')).sort();
const packs = names.filter(name => name !== 'refusals');

// The base definition the refusal vectors are applied to (tests/v2/data-modules/check.test.js in Story Block).
const change = () => ({ op: 'add', path: ['points'], value: 1, bounds: 'clamp' });
const base = () => ({
    slug: 'counter', name: 'Counter', schema: 1, stateVersion: 1, scope: 'chat',
    state: { points: { type: 'int', min: 0, max: 100, default: 0 } }, kinds: { gain: { op: '+', labels: {}, effects: [change()] } },
});
const wrap = definitions => ({ id: 'dm-test', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] }, content: { dataModules: definitions } });
const set = (value, path, next) => { let cursor = value; for (const key of path.slice(0, -1)) cursor = cursor[key]; cursor[path.at(-1)] = structuredClone(next); };

test('the vendored Story Block ships the checker, its fixtures and one refusal vector per DM_* code', () => {
    assert.ok(status().checker, 'wire status: checker');
    assert.deepEqual(packs, ['reputation', 'survival']);
    const vectors = JSON.parse(read('refusals'));
    assert.deepEqual(vectors.map(vector => vector.code).sort(), Object.keys(DM_DIAGNOSTICS).sort());
});

for (const name of packs) test(`fixture ${name}: Studio opens it with Story Block's exact verdict and exports its bytes`, () => {
    const text = read(name);
    const sb = validatePack(text);
    const model = openPack(text);
    assert.equal(model.validation.ok, sb.ok);
    assert.deepEqual(model.validation.errors, sb.errors ?? []);
    assert.equal(sb.ok, true);
    assert.equal(model.packHash, sb.packHash);
    assert.equal(exportPack(model), text);
    const verdict = checkModules(model, model.document.content.dataModules);
    assert.deepEqual({ ok: verdict.ok, errors: verdict.errors }, { ok: true, errors: [] });
    // Applying the unchanged definitions is accepted and keeps the authored data.
    const result = replaceModules(model, model.document.content.dataModules);
    assert.equal(result.ok, true);
    assert.deepEqual(result.model.document, model.document);
    // The grammar preview reads every kind of the shipped definition.
    const [module] = model.document.content.dataModules;
    assert.deepEqual(grammarPreview(model.document, module).kinds.map(kind => kind.name), Object.keys(module.kinds));
});

for (const vector of JSON.parse(read('refusals'))) test(`refusal fixture ${vector.code}: Studio shows Story Block's exact diagnostics, and Apply refuses with them`, () => {
    const definition = base();
    set(definition, vector.target, vector.repeat ? Array.from({ length: vector.repeat }, change) : vector.value);
    const file = wrap([definition]);
    const sb = validatePack(file);
    assert.equal(sb.ok, false);
    const found = sb.errors.find(error => error.code === vector.code && error.path === vector.path);
    assert.ok(found, JSON.stringify(sb.errors));
    assert.equal(found.message, vector.message);
    // Opened as text: a safe invalid draft carrying the checker's errors in order.
    const model = openPack(JSON.stringify(file));
    assert.equal(model.validation.ok, false);
    assert.deepEqual(model.validation.errors, sb.errors);
    assert.ok(model.document, 'the draft stays editable');
    // The edit path reports the same codes, paths, messages and order, and leaves the pack alone.
    const empty = openPack(JSON.stringify(wrap([])));
    assert.equal(empty.validation.ok, true);
    const refused = replaceModules(empty, [definition]);
    assert.equal(refused.ok, false);
    assert.equal(refused.model, empty);
    assert.deepEqual(refused.errors, sb.errors);
    const verdict = checkModules(empty, [definition]);
    assert.deepEqual(verdict.errors, sb.errors);
    assert.equal(sb.errors.length <= DM_LIMITS.errors, true);
});

test('limits at plus and minus one: Studio and Story Block agree on the boundary', () => {
    const cases = [
        ['fields', n => { const d = base(); d.state = Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, { type: 'bool', default: false }])); d.kinds = {}; return d; }, DM_LIMITS.fields],
        ['kinds', n => { const d = base(); d.kinds = Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { op: '!', labels: {}, effects: [] }])); return d; }, DM_LIMITS.kinds],
        ['effects', n => { const d = base(); d.kinds.gain.effects = Array.from({ length: n }, change); return d; }, DM_LIMITS.effects],
    ];
    for (const [label, make, limit] of cases) for (const [n, ok] of [[limit - 1, true], [limit, true], [limit + 1, false]]) {
        const file = wrap([make(n)]);
        const sb = validatePack(file);
        const model = openPack(JSON.stringify(file));
        assert.equal(sb.ok, ok, `${label} ${n}`);
        assert.equal(model.validation.ok, ok, `${label} ${n}`);
        assert.deepEqual(model.validation.errors, sb.errors ?? [], `${label} ${n}`);
    }
});

test('definitions not in a pack leave other packs byte-identical: an old pack gains no data fields through Studio', () => {
    const old = { id: 'old', version: '1.0.0', name: 'Old', requires: { storyBlock: '^2' }, content: {} };
    const text = JSON.stringify(old, null, 2);
    const model = openPack(text);
    assert.equal(model.validation.ok, true);
    assert.equal(exportPack(model), text);
    assert.equal(Object.hasOwn(model.document.content, 'dataModules'), false);
    assert.equal(model.packHash, null);
});
