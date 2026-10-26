import test from 'node:test';
import assert from 'node:assert/strict';
import { factions, survival, linked } from './fixtures/data-modules/index.js';
import { indexDataModuleReferences, inboundReferences, targets, renameTarget, removeTarget } from '../src/data-modules/refs.js';
import { modulesOf, pathText } from '../src/data-modules/dm-model.js';

const ID_A = 'pack.ersveil-factions/reputation';
const ID_B = 'pack.ersveil-survival/survival';
const refsTo = (document, targetKind, targetId) => inboundReferences(document, { targetKind, targetId }).map(ref => pathText(ref.path));

test('the index finds template and label references by position in example A', () => {
    const doc = factions();
    assert.deepEqual(refsTo(doc, 'dm.template', `${ID_A}#favour`), ['content.dataModules[0].kinds.gain.effects[0].template']);
    assert.deepEqual(refsTo(doc, 'dm.label', `${ID_A}#gain.faction`), [
        'content.dataModules[0].kinds.gain.oncePerReply[0]',
        'content.dataModules[0].kinds.gain.effects[0].bind.faction[1]',
    ]);
    assert.deepEqual(refsTo(doc, 'dm.label', `${ID_A}#loss.faction`), [
        'content.dataModules[0].kinds.loss.oncePerReply[0]',
        'content.dataModules[0].kinds.loss.effects[0].path[1][1]',
    ]);
});

test('references to a binding, a reward value and a map key', () => {
    const doc = factions();
    assert.deepEqual(refsTo(doc, 'dm.binding', `${ID_A}#favour.faction`), [
        'content.dataModules[0].kinds.gain.effects[0].bind.faction',
        'content.dataModules[0].rewards.favour.effects[0].path[1][1]',
    ]);
    assert.deepEqual(refsTo(doc, 'dm.value', `${ID_A}#favour.amount`), ['content.dataModules[0].rewards.favour.effects[0].value[1]']);
    assert.deepEqual(refsTo(doc, 'dm.key', `${ID_A}#standing.guild`), ['content.dataModules[0].rules[0].when[1][1][1][1]']);
});

test('field references include effects, conditions, exports and screen bindings', () => {
    const doc = factions();
    assert.deepEqual(refsTo(doc, 'dm.field', `${ID_A}#standing`), [
        'content.dataModules[0].exports.standing.fields[0]',
        'content.dataModules[0].kinds.loss.effects[0].path[0]',
        'content.dataModules[0].rewards.favour.effects[0].path[0]',
        'content.dataModules[0].rules[0].when[1][1][1][0]',
        'content.dataModules[0].screens[0].layout.root.children[0].bind.path',
        'content.dataModules[0].screens[0].layout.root.children[1].bind.path',
        'content.dataModules[0].screens[0].layout.root.children[2].bind.path',
    ]);
    assert.deepEqual(refsTo(doc, 'dm.field', `${ID_A}#title`), [
        'content.dataModules[0].exports.standing.fields[1]',
        'content.dataModules[0].rules[0].then[0].path[0]',
        'content.dataModules[0].rules[0].when[2][1][1][0]',
        'content.dataModules[0].screens[0].layout.root.children[3].bind.path',
    ]);
});

test('enum values that spell a field name are never references', () => {
    const doc = factions();
    doc.content.dataModules[0].kinds.gain.labels.faction.values.push('standing');
    const result = renameTarget(doc, { targetKind: 'dm.field', targetId: `${ID_A}#standing` }, 'renown');
    assert.ok(result.ok);
    const module = result.modules[0];
    assert.ok(Object.hasOwn(module.state, 'renown'));
    assert.ok(module.kinds.gain.labels.faction.values.includes('standing'), 'the enum value is untouched');
    assert.deepEqual(module.exports.standing.fields, ['renown', 'title']);
    assert.deepEqual(module.kinds.loss.effects[0].path, ['renown', ['arg', 'faction']]);
    assert.deepEqual(module.rules[0].when[1][1], ['get', ['renown', 'guild']]);
    assert.equal(module.screens[0].layout.root.children[0].bind.path, 'chat.renown.guild');
    // Key order and unrelated data are preserved.
    assert.deepEqual(Object.keys(module.state), ['renown', 'title']);
});

test('renaming a template updates effects but not a same-spelled binding', () => {
    const doc = factions();
    const result = renameTarget(doc, { targetKind: 'dm.template', targetId: `${ID_A}#favour` }, 'goodwill');
    assert.ok(result.ok);
    const module = result.modules[0];
    assert.deepEqual(Object.keys(module.rewards), ['goodwill']);
    assert.equal(module.kinds.gain.effects[0].template, 'goodwill');
    assert.equal(result.references, 1);
});

test('renaming a label rewrites oncePerReply, arg expressions and the label definition', () => {
    const doc = factions();
    const result = renameTarget(doc, { targetKind: 'dm.label', targetId: `${ID_A}#loss.faction` }, 'side');
    assert.ok(result.ok);
    const loss = result.modules[0].kinds.loss;
    assert.deepEqual(Object.keys(loss.labels), ['side']);
    assert.deepEqual(loss.oncePerReply, ['side']);
    assert.deepEqual(loss.effects[0].path, ['standing', ['arg', 'side']]);
    // The same label name on another kind is a different target.
    assert.deepEqual(Object.keys(result.modules[0].kinds.gain.labels), ['faction']);
});

test('renaming a binding rewrites the bind keys that answer it and bind expressions in the template', () => {
    const doc = factions();
    const result = renameTarget(doc, { targetKind: 'dm.binding', targetId: `${ID_A}#favour.faction` }, 'house');
    assert.ok(result.ok);
    const module = result.modules[0];
    assert.deepEqual(Object.keys(module.rewards.favour.bindings), ['house']);
    assert.deepEqual(Object.keys(module.kinds.gain.effects[0].bind), ['house']);
    assert.deepEqual(module.rewards.favour.effects[0].path, ['standing', ['bind', 'house']]);
    // The gain kind's own label keeps its name and is still what feeds the binding.
    assert.deepEqual(module.kinds.gain.effects[0].bind.house, ['arg', 'faction']);
});

test('renaming a map key rewrites key segments and the key list only', () => {
    const doc = factions();
    const result = renameTarget(doc, { targetKind: 'dm.key', targetId: `${ID_A}#standing.guild` }, 'league');
    assert.ok(result.ok);
    const module = result.modules[0];
    assert.deepEqual(module.state.standing.keys, ['league', 'watch', 'compact']);
    assert.deepEqual(module.rules[0].when[1][1], ['get', ['standing', 'league']]);
    assert.ok(module.kinds.gain.labels.faction.values.includes('guild'), 'a label value named guild is a different thing');
});

test('module and export renames reach imports in other modules and screen bindings', () => {
    const doc = linked();
    const slug = renameTarget(doc, { targetKind: 'dm.module', targetId: ID_B }, 'needs-meter');
    assert.ok(slug.ok);
    assert.equal(slug.modules[0].slug, 'needs-meter');
    assert.equal(slug.modules[1].imports.needs.args.module, 'pack.ersveil-survival/needs-meter', 'the full form stays full');
    doc.content.dataModules[1].imports.needs.args.module = 'survival';
    assert.equal(renameTarget(doc, { targetKind: 'dm.module', targetId: ID_B }, 'needs-meter').modules[1].imports.needs.args.module, 'needs-meter', 'a short form stays short');
    assert.equal(slug.modules[0].screens[0].layout.root.bind.args.module, 'pack.ersveil-survival/needs-meter', 'the full form stays full');
    const exported = renameTarget(doc, { targetKind: 'dm.export', targetId: `${ID_B}#needs` }, 'meters');
    assert.ok(exported.ok);
    assert.deepEqual(Object.keys(exported.modules[0].exports), ['meters']);
    assert.equal(exported.modules[1].imports.needs.args.export, 'meters');
});

test('pack-level screens that bind a module are rewritten too', () => {
    const doc = factions();
    doc.screens = [{ id: 'top', title: 'Top', mounts: ['tab'], layout: { root: { type: 'text', bind: { query: 'dataModules.view', args: { module: ID_A }, path: 'chat.title' } } } }];
    const result = renameTarget(doc, { targetKind: 'dm.module', targetId: ID_A }, 'standing-board');
    assert.ok(result.ok);
    assert.equal(result.extra.screens[0].layout.root.bind.args.module, 'pack.ersveil-factions/standing-board');
    assert.equal(doc.screens[0].layout.root.bind.args.module, ID_A, 'the input is never mutated');
});

test('character-scope list screens rewrite $item fields that are declared, and only those', () => {
    const doc = survival();
    const result = renameTarget(doc, { targetKind: 'dm.field', targetId: `${ID_B}#hunger` }, 'appetite');
    assert.ok(result.ok);
    const item = result.modules[0].screens[0].layout.root.item.children;
    assert.equal(item[0].value, '$item.appetite');
    assert.equal(item[1].value, '$item.fatigue');
    assert.equal(result.modules[0].screens[0].layout.root.item.title, '$item.name');
    assert.deepEqual(result.modules[0].timers[0].effects[0].path, ['appetite']);
});

test('rename refuses a taken, empty or unsafe name', () => {
    const doc = factions();
    const target = { targetKind: 'dm.field', targetId: `${ID_A}#standing` };
    for (const name of ['title', '', ' spaced ', '__proto__', 'standing']) {
        const result = renameTarget(doc, target, name);
        assert.equal(result.ok, false, JSON.stringify(name));
        assert.ok(result.errors[0].message);
    }
    assert.equal(renameTarget(doc, { targetKind: 'dm.field', targetId: `${ID_A}#missing` }, 'x').ok, false);
});

test('remove refuses while referenced, lists the referencing paths, and succeeds when clear', () => {
    const doc = factions();
    const refused = removeTarget(doc, { targetKind: 'dm.template', targetId: `${ID_A}#favour` });
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].code, 'has-references');
    assert.deepEqual(refused.references.map(ref => pathText(ref.path)), ['content.dataModules[0].kinds.gain.effects[0].template']);
    delete doc.content.dataModules[0].kinds.gain.effects[0];
    doc.content.dataModules[0].kinds.gain.effects = [];
    const removed = removeTarget(doc, { targetKind: 'dm.template', targetId: `${ID_A}#favour` });
    assert.ok(removed.ok);
    assert.deepEqual(Object.keys(removed.modules[0].rewards), []);
});

test('targets lists every definition once with its inbound count', () => {
    const list = targets(factions());
    const byId = Object.fromEntries(list.map(item => [`${item.targetKind} ${item.targetId}`, item.count]));
    assert.equal(byId[`dm.template ${ID_A}#favour`], 1);
    assert.ok(byId[`dm.module ${ID_A}`] >= 0);
    assert.equal(new Set(list.map(item => `${item.targetKind}|${item.targetId}`)).size, list.length);
});

test('the index tolerates arbitrary draft shapes without throwing', () => {
    const hostile = { id: 'x', content: { dataModules: [null, 5, { slug: 3, state: 'x', kinds: { a: null, b: { effects: [1, { op: 'add', path: 7 }], labels: [], oncePerReply: 'x' } }, rules: [null, { when: ['get'] }], timers: [7], rewards: { r: [] }, imports: { q: 7 }, exports: { e: { fields: 'x' } }, migrations: 9, screens: [{ bind: { query: 'dataModules.view', args: 4 } }] }] } };
    assert.doesNotThrow(() => indexDataModuleReferences(hostile));
    assert.doesNotThrow(() => targets(hostile));
    assert.deepEqual(indexDataModuleReferences(null), []);
    assert.equal(modulesOf(hostile).length, 3);
});
