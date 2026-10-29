import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { createHistory } from '../src/history.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { validateLayout } from '../vendor/story-block/src/v2/layout/validate.js';
import { SCREEN_FIELDS, MOUNTS, LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { SETTINGS_DEFAULTS, QUERIES, UI_COMMANDS, replacePresentation, checkDefaults, elementSnippet, widgetSnippet, standardWidgets } from '../src/screen-authoring.js';

const pack = () => ({ id: 'test', version: '1.0.0', requires: { storyBlock: '^2' } });
const screen = extra => ({ id: 'camp', template: '<p>Camp</p>', ...extra });
function parity(field, value, accepted) {
    const model = openPack(pack());
    const sb = validatePack({ ...model.document, [field]: value });
    const result = replacePresentation(model, field, value);
    assert.equal(sb.ok, accepted, JSON.stringify(sb.errors));
    assert.equal(result.ok, sb.ok);
    if (sb.ok) {
        assert.equal(result.model.validation.ok, true);
        assert.deepEqual(result.model.document[field], value);
        assert.equal(validatePack(exportPack(result.model)).ok, true);
        assert.equal(result.undo(), model);
    } else {
        assert.equal(result.model, model);
        assert.deepEqual(result.errors, sb.errors);
    }
}

test('settings defaults catalogue is empty because the host has no module-settings transport', async t => {
    assert.deepEqual(SETTINGS_DEFAULTS, []);
    const model = openPack(pack());
    for (const key of ['settings', 'defaults', 'settingsDefaults', 'moduleSettings']) await t.test(key, () => {
        const requested = { [key]: { 'story-director': { enabled: true } } };
        const sb = validatePack({ ...pack(), ...requested });
        assert.equal(sb.ok, false);
        assert.ok(sb.errors.some(e => e.code === 'UNKNOWN_FIELD' && e.path === key));
        assert.deepEqual(checkDefaults(model, requested), sb);
        assert.equal(exportPack(model), JSON.stringify(pack(), null, 2) + '\n');
    });
});

test('all SCREEN_FIELDS accept/refuse through exactly the vendored importer', async t => {
    const cases = [
        ['all fields', [screen({ title: 'Camp', icon: 'fa-tent', mounts: [...MOUNTS], css: '.camp { color: red; }', layout: { root: { type: 'text', value: 'Camp' } }, theme: { '--ss-accent': '#123456' }, data: { pc: { query: 'scene.place' } }, steps: [{ id: 'first', title: 'First', template: '<p>{{ q.pc.name }}</p>' }] })], true],
        ['layout instead of template', [{ id: 'camp', layout: {} }], true],
        ['empty template', [screen({ template: '' })], true],
        ['restyle module id', [screen({ id: 'example-module/board' })], true],
        ['empty list', [], true], ['null list', null, false], ['non-list', {}, false], ['non-object record', [1], false],
        ['duplicate id', [screen({}), screen({})], false], ['unknown field', [screen({ extra: 1 })], false],
        ['id wrong type', [screen({ id: 1 })], false], ['id bad spelling', [screen({ id: 'Bad id' })], false],
        ['id max', [screen({ id: 'a'.repeat(100) })], true], ['id too long', [screen({ id: 'a'.repeat(101) })], false],
        ['title max', [screen({ title: 'x'.repeat(LIMITS.name) })], true], ['title too long', [screen({ title: 'x'.repeat(LIMITS.name + 1) })], false],
        ['title wrong type', [screen({ title: null })], false], ['icon wrong type', [screen({ icon: 1 })], false],
        ['icon max', [screen({ icon: 'x'.repeat(LIMITS.name) })], true], ['icon too long', [screen({ icon: 'x'.repeat(LIMITS.name + 1) })], false],
        ['mount duplicate accepted', [screen({ mounts: ['hud', 'hud'] })], true], ['mount unknown', [screen({ mounts: ['sidebar'] })], false], ['mount wrong type', [screen({ mounts: 'tab' })], false],
        ['no template or layout', [{ id: 'camp' }], false], ['template wrong type', [screen({ template: 1 })], false],
        ['template code max', [screen({ template: 'x'.repeat(LIMITS.code) })], true], ['template over code', [screen({ template: 'x'.repeat(LIMITS.code + 1) })], false],
        ['deep template', [screen({ template: '<div>'.repeat(100) + '</div>'.repeat(100) })], false],
        ['three loops', [screen({ template: '<div data-each="q.rows as a">'.repeat(3) + '</div>'.repeat(3) })], true],
        ['four loops', [screen({ template: '<div data-each="q.rows as a">'.repeat(4) + '</div>'.repeat(4) })], false],
        ['layout arbitrary object', [screen({ layout: { unknown: true } })], true], ['layout wrong type', [screen({ layout: [] })], false],
        ['css code max', [screen({ css: ' '.repeat(LIMITS.code) })], true], ['css over code', [screen({ css: ' '.repeat(LIMITS.code + 1) })], false],
        ['css wrong type', [screen({ css: {} })], false], ['css import', [screen({ css: '@import "https://example.invalid/a.css";' })], false],
        ['css network image accepted', [screen({ css: '.camp { background: url(https://example.invalid/a.png); }' })], true],
        ['css body selector accepted for later scoping', [screen({ css: 'body { color: red; }' })], true],
        ['theme arbitrary variable', [screen({ theme: { '--custom': 12 } })], true], ['theme wrong key', [screen({ theme: { color: 'red' } })], false],
        ['theme unsafe value', [screen({ theme: { '--custom': 'url(https://example.invalid/a)' } })], false],
        ['data open object', [screen({ data: { unknown: [1, true, null] } })], true], ['data wrong type', [screen({ data: [] })], false],
        ['steps open object', [screen({ steps: [{ unknown: true }] })], true], ['steps wrong type', [screen({ steps: {} })], false],
        ['step template wrong type', [screen({ steps: [{ template: 1 }] })], false],
        ['step template over code', [screen({ steps: [{ template: 'x'.repeat(LIMITS.code + 1) }] })], false],
        ['step four loops', [screen({ steps: [{ template: '<div data-each="q.rows as a">'.repeat(4) + '</div>'.repeat(4) }] })], false],
        ['script', [screen({ template: '<script>alert(1)</script>' })], false],
        ['encoded attribute accepted for later sanitizing', [screen({ template: '<img o&#110;error="alert(1)">' })], true],
        ['script link', [screen({ template: '<a href="java&#115;cript:alert(1)">Go</a>' })], false],
        ['binding syntax warns only', [screen({ template: '<p data-if="bad expression">{{ state.constructor }}</p>' })], true],
    ];
    assert.deepEqual(Object.keys(cases[0][1][0]).sort(), [...SCREEN_FIELDS].sort());
    for (const [name, value, accepted] of cases) await t.test(name, () => parity('screens', value, accepted));
});

test('layouts retain pack-level acceptance separately from renderer diagnostics', async t => {
    for (const [name, value, accepted] of [
        ['empty', [], true], ['arbitrary object', [{ unknown: true }], true],
        ['unknown node', [{ root: { type: 'not-installed', mystery: 1 } }], true],
        ['Unicode and authored keys', [{ 'café': 1, 'café': 2, 'line\nkey': 3 }], true],
        ['bad list', {}, false], ['null', null, false], ['non-object', [[]], false],
        ['unsafe key', [JSON.parse('{"constructor":1}')], false], ['unsafe text', [{ note: '<img onerror="bad()">' }], false],
        ['nested layout', [{ root: { type: 'row', children: [{ type: 'text', value: 'Hi' }] } }], true],
    ]) await t.test(name, () => parity('layouts', value, accepted));
    assert.ok(validateLayout({ unknown: true }).length);
});

test('Ersveil presentation edits preserve all other authored data and undo exact source bytes', () => {
    const source = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
    const original = openPack(source);
    assert.equal(exportPack(original), source);
    const history = createHistory(original);
    const draft = copy(original.document.screens ?? []);
    draft.push(screen({ id: 'studio-camp' }));
    const result = replacePresentation(original, 'screens', draft);
    assert.equal(result.ok, true);
    assert.equal(history.commit(result), true);
    const exported = JSON.parse(exportPack(history.current));
    delete exported.screens;
    const rest = copy(original.document); delete rest.screens;
    assert.deepEqual(exported, rest);
    assert.equal(exportPack(history.undo()), source);
    assert.equal(history.redo(), result.model);
    assert.equal(exportPack(history.undo()), source);
});
const copy = value => JSON.parse(JSON.stringify(value));

test('palette snippets escape author markup and include every registered standard widget', () => {
    const snippet = elementSnippet('p', '<img onerror="bad">', 'q.name == "x"');
    assert.ok(snippet.includes('&lt;img'));
    assert.ok(snippet.includes('&quot;x&quot;'));
    assert.throws(() => elementSnippet('script', 'bad'));
    for (const name of Object.keys(standardWidgets)) {
        const template = widgetSnippet(name, { label: '<b>literal</b>' });
        assert.equal(validatePack({ ...pack(), screens: [screen({ template })] }).ok, true);
        assert.ok(template.includes('&lt;b&gt;literal&lt;/b&gt;'));
    }
    assert.equal(Object.keys(standardWidgets).length, 18);
    assert.ok(QUERIES.some(([name]) => name === 'packs.weather'));
});

// What the builder offers is what the suite answers: Story Block's queries resolve on the real host, and a button's
// reader command runs there from a click on a row of the inventory list the builder starts with.
test('the query catalogue names only real providers, and the builder\'s button commands run from a button on the host', async () => {
    const { createHost } = await import('../vendor/story-block/testkit/index.js');
    const { defaultNode } = await import('../src/screens/presentation.js');
    const sword = { name: 'Short Sword', slug: 'short-sword', kind: 'equipment', rarity: 'common', value: 10, slot: 'hand' };
    const kit = { ...pack(), requires: { storyBlock: '^2', capabilities: ['inventory'] }, content: { items: [sword] }, start: { inventory: { items: [{ item: 'short-sword' }] } } };
    const host = await createHost({ settings: { packs: [{ id: kit.id, version: kit.version, enabled: true, source: 'file', origin: 'test', pack: kit }] } });
    try {
        for (const [name, module] of QUERIES) {
            if (module === 'Story Block') assert.equal(host.registry.queryOwner(name), 'story-block', name);
            else {
                assert.ok(['Story Director', 'NPC State Delta'].includes(module), `${name}: ${module}`);
                assert.equal(host.registry.queryOwner(name), null, `${name} is not Story Block's`);
            }
        }
        assert.equal(QUERIES.some(([name]) => ['party.pc', 'scene.map'].includes(name)), false);

        const button = defaultNode('button', true);
        const outside = defaultNode('button');
        assert.equal(outside.command, undefined, 'no row outside a list: the author picks the command');
        const list = { ...defaultNode('list'), item: { type: 'row', children: [{ type: 'text', value: '$item.name' }, button] } };
        const layout = { id: 'bag', title: 'Bag', icon: 'fa-box', root: list };
        assert.deepEqual(validateLayout(layout), []);
        assert.ok(validateLayout({ id: 'bag', root: { type: 'box', children: [outside] } }).length, 'an unset command is reported until it is chosen');
        const model = replacePresentation(openPack(kit), 'layouts', [layout]);
        assert.equal(model.ok, true);
        assert.equal(validatePack(JSON.parse(exportPack(model.model))).ok, true);

        const row = () => host.sdk.query('inventory.items').find(item => item.name === 'Short Sword');
        const fill = payload => JSON.parse(JSON.stringify(payload).replaceAll('"$item.stack"', JSON.stringify(row().stack)));
        for (const [type, , payload] of [UI_COMMANDS.find(([name]) => name === 'inventory.equip'), UI_COMMANDS.find(([name]) => name === 'inventory.unequip'), [button.command, button.label, button.payload]]) {
            const out = await host.sdk.command(type, fill(payload));
            assert.equal(out.ok, true, `${type}: ${out.message}`);
        }
        assert.equal(row(), undefined, 'the default button dropped the sword');
        assert.equal((await host.sdk.command('inventory.grant', { name: 'Rope', qty: 1, owner: 'party' })).code, 'REFUSED', 'never offered: refused from a button');
    } finally { host.close(); }
});
