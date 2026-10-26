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
// The replay golden is a trace, not an importable pack. Keep it vendored with the upstream fixtures.
const packs = names.filter(name => !['refusals', 'unused-baseline'].includes(name));

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

// The finished checker's label-data and closed template-payload cases (upstream check.test.js).
const GOOD = { module: 'pack.dm-test/counter', kind: 'ask', labels: { query: 'hello', command: 'bye' } };
const button = payload => `<button data-command="dm.act" data-payload='${JSON.stringify(payload)}'>Ask</button>`;
const screenPack = (screen, layout = false) => {
    const definition = base();
    definition.kinds.ask = { op: '!', ui: true, labels: {
        query: { type: 'enum', values: ['hello', 'bye'] }, command: { type: 'enum', values: ['hello', 'bye'] },
    }, effects: [change()] };
    definition.screens = [{ id: 'ask-screen', title: 'Ask', mounts: ['tab'],
        ...(layout ? { layout: { root: { type: 'col', children: screen } } } : { template: screen }),
    }];
    return wrap([definition]);
};
const layoutButton = payload => ({ type: 'button', label: 'Ask', command: 'dm.act', payload });
const cases = [
    ['layout labels called query and command are data', () => screenPack([layoutButton(GOOD)], true), null],
    ['layout label values still have declared types', () => screenPack([layoutButton({ ...GOOD, labels: { query: 'nope', command: 'bye' } })], true), 'DM_LABEL'],
    ['a real foreign binding beside label data is refused', () => screenPack([layoutButton(GOOD), { type: 'text', label: 'x', bind: { query: 'inventory.items', args: {} } }], true), 'DM_SCHEMA'],
    ['template label data', () => screenPack(button(GOOD)), null],
    ['template label interpolation', () => screenPack(button({ ...GOOD, labels: { query: '{{ item.q }}', command: 'bye' } })), null],
    ['foreign module', () => screenPack(button({ ...GOOD, module: 'pack.other/counter' })), 'DM_SCHEMA'],
    ['kind without ui', () => screenPack(button({ ...GOOD, kind: 'gain' })), 'DM_SCHEMA'],
    ['unknown kind', () => screenPack(button({ ...GOOD, kind: 'nope' })), 'DM_SCHEMA'],
    ['extra payload key', () => screenPack(button({ ...GOOD, extra: 1 })), 'DM_SCHEMA'],
    ['missing labels', () => screenPack(button({ module: GOOD.module, kind: GOOD.kind })), 'DM_LABEL'],
    ['extra label', () => screenPack(button({ ...GOOD, labels: { ...GOOD.labels, more: 'x' } })), 'DM_LABEL'],
    ['who on chat scope', () => screenPack(button({ ...GOOD, who: 'Wessel' })), 'DM_LABEL'],
    ['missing payload', () => screenPack('<button data-command="dm.act">Ask</button>'), 'DM_SCHEMA'],
    ['array payload', () => screenPack(button([1])), 'DM_SCHEMA'],
    ['dynamic module', () => screenPack(button({ ...GOOD, module: '{{ x }}' })), 'DM_SCHEMA'],
    ['form action', () => screenPack('<form data-submit="dm.act"><input data-draft="x"></form>'), 'DM_SCHEMA'],
    ['step template payload', () => {
        const pack = screenPack(button(GOOD));
        pack.content.dataModules[0].screens[0].steps = [{ id: 's', template: button({ ...GOOD, module: 'pack.other/counter' }) }];
        return pack;
    }, 'DM_SCHEMA'],
];

for (const [name, make, code] of cases) test(`finished checker parity: ${name}`, () => {
    const pack = make(), text = JSON.stringify(pack);
    const sb = validatePack(text), model = openPack(text);
    assert.equal(sb.ok, code === null, JSON.stringify(sb.errors));
    if (code) assert.ok(sb.errors.some(error => error.code === code), JSON.stringify(sb.errors));
    assert.deepEqual(model.validation.errors, sb.errors ?? []);
    assert.equal(model.validation.ok, sb.ok);
    const empty = openPack(JSON.stringify(wrap([])));
    const result = replaceModules(empty, pack.content.dataModules);
    assert.equal(result.ok, sb.ok);
    assert.deepEqual(checkModules(empty, pack.content.dataModules).errors, sb.errors ?? []);
    if (sb.ok) assert.equal(exportPack(model), text);
    else {
        assert.deepEqual(result.errors, sb.errors);
        assert.equal(result.model, empty);
    }
});
