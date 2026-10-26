import test from 'node:test';
import assert from 'node:assert/strict';
import { factions, survival, linked } from './fixtures/data-modules/index.js';
import {
    defaultSchema, newModule, newLabel, newKind, newRule, newTemplate, newTimer, newMigration, newImport, adapterOf, newEffect, effectOps,
    setEnumValues, setMapKeys, syncBindings, renameInRecord, removeInRecord, makeTarget, uniqueName, unknownPaths, starterScreen, sampleView, replaceContents,
} from '../src/data-modules/forms.js';
import { operatorsFor, changeOperator, defaultExpression, fieldSchema, typeOfExpression, measure, slotTypes } from '../src/data-modules/expr.js';
import { OPERATORS, EFFECTS, IMPORT_ADAPTERS, FIELD_TYPES } from '../src/data-modules/hints.js';
import { walkModuleExpressions, getAt, setAt, deleteAt, renameKey, pathText } from '../src/data-modules/dm-model.js';

test('every field type starts with bounds and a default that satisfy their own constraints', () => {
    assert.deepEqual(FIELD_TYPES, ['int', 'bool', 'enum', 'text', 'map']);
    const int = defaultSchema('int');
    assert.ok(int.min <= int.default && int.default <= int.max);
    assert.deepEqual(defaultSchema('bool'), { type: 'bool', default: false });
    const en = defaultSchema('enum');
    assert.ok(en.values.includes(en.default));
    const text = defaultSchema('text');
    assert.ok(text.max >= 1 && text.max <= 240 && text.default === '');
    const map = defaultSchema('map');
    assert.deepEqual(map.keys, ['first']);
    assert.equal(map.values.type, 'int');
    assert.deepEqual(defaultSchema('wobble'), defaultSchema('int'));
});

test('enum edits keep the default among the values; map keys stay unique', () => {
    const schema = defaultSchema('enum');
    setEnumValues(schema, ['a', 'b', 'c']);
    assert.equal(schema.default, 'a');
    schema.default = 'c';
    setEnumValues(schema, ['a', 'c']);
    assert.equal(schema.default, 'c');
    setEnumValues(schema, ['x']);
    assert.equal(schema.default, 'x');
    setEnumValues(schema, []);
    assert.equal(schema.default, '');
    const map = defaultSchema('map');
    setMapKeys(map, ['a', 'b', 'a']);
    assert.deepEqual(map.keys, ['a', 'b']);
});

test('starting records and unique names', () => {
    assert.equal(uniqueName(['a', 'a-2'], 'a'), 'a-3');
    assert.equal(uniqueName([], 'a'), 'a');
    const module = newModule(['new-module']);
    assert.equal(module.slug, 'new-module-2');
    assert.deepEqual([module.schema, module.stateVersion, module.scope, module.state, module.kinds], [1, 1, 'chat', {}, {}]);
    assert.deepEqual(newKind(), { op: '!', labels: {}, effects: [] });
    assert.equal(newLabel('enum').type, 'enum');
    assert.equal(newLabel('anything').type, 'int');
    const draft = { rules: [{ id: 'rule' }], timers: [{ id: 'timer' }], imports: { clock: {} }, stateVersion: 3, migrations: [{ from: 2, to: 4 }] };
    assert.equal(newRule(draft).id, 'rule-2');
    assert.deepEqual(newTimer(draft), { id: 'timer-2', clock: 'clock', every: 60, effects: [] });
    assert.deepEqual(newMigration(draft), { from: 4, to: 5, add: {} });
    assert.deepEqual(newMigration({ stateVersion: 2 }), { from: 2, to: 3, add: {} });
    assert.deepEqual(newTemplate().values.amount, { min: 1, max: 5, pick: 'midpoint' });
});

test('imports start from the published adapters only', () => {
    assert.deepEqual(IMPORT_ADAPTERS.map(item => item.query), ['director.time', 'checks.policy', 'dataModules.public']);
    assert.deepEqual(newImport('sd-minutes', {}), { query: 'director.time', mode: 'prefix', projection: ['minutes'] });
    assert.deepEqual(newImport('sd-actors', {}).projection, ['actors.id', 'actors.name']);
    const doc = linked();
    const created = newImport('data-module', doc.content.dataModules[1], doc);
    assert.deepEqual(created, { query: 'dataModules.public', args: { module: 'pack.ersveil-survival/survival', export: 'needs', who: 'ca_actor' }, mode: 'prefix', projection: ['hunger', 'fatigue'] });
    assert.deepEqual(newImport('data-module', {}, {}).args, { module: '', export: '' });
    assert.deepEqual(newImport('data-module', { slug: 'x' }, { id: 'p', content: { dataModules: [{ slug: 'y', scope: 'chat', exports: { e: { fields: ['f'] } } }] } }).args, { module: 'pack.p/y', export: 'e' });
    assert.equal(adapterOf({ query: 'director.time' }).id, 'sd-minutes');
    assert.equal(adapterOf({ query: 'anything.else' }), null);
});

test('effects offered per place follow the design; v1.1 grants are never offered', () => {
    assert.deepEqual(effectOps('kind'), ['set', 'add', 'clamp', 'reward', 'offer', 'award']);
    assert.deepEqual(effectOps('timer'), ['add', 'clamp']);
    assert.deepEqual(effectOps('template'), ['set', 'add', 'clamp']);
    assert.ok(['grantCoin', 'grantItem', 'grantXp'].every(op => EFFECTS[op].v11 && !effectOps('kind').includes(op)));
    const draft = factions().content.dataModules[0];
    assert.deepEqual(newEffect('add', draft), { op: 'add', path: ['standing', 'guild'], value: 1 });
    assert.deepEqual(newEffect('set', draft), { op: 'set', path: ['standing', 'guild'], value: 0 });
    assert.deepEqual(newEffect('clamp', draft), { op: 'clamp', path: ['standing', 'guild'], min: 0, max: 100 });
    assert.deepEqual(newEffect('reward', draft), { op: 'reward', template: 'favour', bind: {} });
    assert.deepEqual(newEffect('offer', draft), { op: 'offer', template: 'favour', key: 'offer', bind: {} });
    assert.deepEqual(newEffect('award', draft), { op: 'award', offer: 'offer' });
    assert.deepEqual(newEffect('add', { state: {} }).path, ['']);
    const set = newEffect('set', { state: { flag: { type: 'bool', default: false }, mood: { type: 'enum', values: ['calm'], default: 'calm' } } });
    assert.deepEqual(set, { op: 'set', path: ['flag'], value: false });
});

test('a reward effect keeps one bind entry per declared binding and keeps unknown ones visible', () => {
    const draft = factions().content.dataModules[0];
    const effect = { op: 'reward', template: 'favour', bind: { stray: 1 } };
    syncBindings(effect, draft);
    assert.deepEqual(effect.bind, { faction: '', stray: 1 });
    effect.bind.faction = ['arg', 'faction'];
    syncBindings(effect, draft);
    assert.deepEqual(effect.bind.faction, ['arg', 'faction']);
});

test('operators are offered by slot type, never offer v1.1, and respect where an expression lives', () => {
    assert.ok(!operatorsFor('any').includes('check'));
    assert.ok(OPERATORS.check.v11);
    const bool = operatorsFor('bool', { where: 'rule' });
    assert.ok(bool.includes('and') && bool.includes('ge') && !bool.includes('add'));
    const int = operatorsFor('int', { where: 'rule' });
    assert.ok(int.includes('add') && int.includes('clamp') && !int.includes('and'));
    assert.ok(!operatorsFor('int', { where: 'rule' }).includes('arg'));
    assert.ok(operatorsFor('int', { where: 'kind' }).every(name => name !== 'bind'));
    assert.ok(operatorsFor('any', { where: 'kind' }).includes('arg'));
    assert.ok(operatorsFor('any', { where: 'template' }).includes('bind'));
    assert.ok(operatorsFor('any', { where: 'template' }).includes('reward'));
    assert.ok(operatorsFor('int', { where: 'timer' }).includes('timer'));
    assert.ok(!operatorsFor('any', { where: 'rule' }).includes('timer'));
    assert.ok(!operatorsFor('any', { where: 'kind', module: {} }).includes('input'));
    assert.ok(operatorsFor('any', { where: 'kind', module: { imports: { clock: {} } } }).includes('input'));
    assert.deepEqual(slotTypes('clamp'), ['int', 'int', 'int']);
    assert.deepEqual(slotTypes('floorDiv'), ['int', 'positiveInt']);
    assert.deepEqual(slotTypes('nope'), []);
});

test('every operator has fixed arity, and changing operator keeps arguments that still fit', () => {
    const arity = Object.fromEntries(Object.entries(OPERATORS).map(([name, spec]) => [name, spec.slots.length]));
    assert.deepEqual(arity, { get: 1, arg: 1, bind: 1, input: 2, reward: 1, timer: 1, check: 1, eq: 2, ne: 2, lt: 2, le: 2, gt: 2, ge: 2, and: 2, or: 2, not: 1, add: 2, sub: 2, mul: 2, min: 2, max: 2, floorDiv: 2, clamp: 3 });
    const module = factions().content.dataModules[0];
    assert.deepEqual(changeOperator(['add', 1, 2], 'mul', module), ['mul', 1, 2]);
    assert.deepEqual(changeOperator(['add', 1, 2], 'clamp', module), ['clamp', 1, 2, 0]);
    assert.deepEqual(changeOperator(['clamp', 1, 2, 3], 'min', module), ['min', 1, 2]);
    assert.deepEqual(changeOperator(['and', true, false], 'not', module), ['not', true]);
    assert.deepEqual(changeOperator(5, 'add', module), ['add', 5, 0]);
    assert.deepEqual(changeOperator(['get', ['standing', 'guild']], 'get', module), ['get', ['standing', 'guild']]);
    assert.deepEqual(changeOperator(['add', 1, 2], 'get', module), ['get', ['standing']]);
    assert.deepEqual(changeOperator(['add', 1, 2], 'timer', module), ['timer', 'periods']);
    assert.deepEqual(changeOperator(['arg', 'x'], 'bind', module), ['bind', '']);
    assert.equal(changeOperator(['add', 1, 2], 'nope', module).join(), 'add,1,2');
    assert.equal(defaultExpression('bool', module), true);
    assert.equal(defaultExpression('positiveInt', module), 1);
    assert.equal(defaultExpression('int', {}), 0);
    assert.deepEqual(defaultExpression('int', survival().content.dataModules[0]), ['get', ['hunger']]);
});

test('type hints come from declarations and never reject anything', () => {
    const module = factions().content.dataModules[0];
    assert.deepEqual(fieldSchema(module, ['standing', 'guild']), module.state.standing.values);
    assert.equal(fieldSchema(module, ['standing']).type, 'map');
    assert.equal(fieldSchema(module, ['missing']), null);
    assert.deepEqual(typeOfExpression(['get', ['title']], { module }), { type: 'enum', values: ['none', 'Guild Friend'] });
    assert.deepEqual(typeOfExpression(['get', ['standing', 'guild']], { module }), { type: 'int' });
    assert.deepEqual(typeOfExpression(['arg', 'faction'], { module, owner: 'gain' }), { type: 'enum', values: ['guild', 'watch', 'compact'] });
    assert.deepEqual(typeOfExpression(['bind', 'faction'], { module, owner: 'favour' }), { type: 'enum', values: ['guild', 'watch', 'compact'] });
    assert.deepEqual(typeOfExpression(['ge', 1, 2]), { type: 'bool' });
    assert.deepEqual(typeOfExpression(['add', 1, 2]), { type: 'int' });
    assert.equal(typeOfExpression(['wobble']), null);
    assert.equal(typeOfExpression(['input', 'a', 'b']), null);
    assert.equal(typeOfExpression(null), null);
    assert.deepEqual(typeOfExpression('x'), { type: 'text' });
    assert.deepEqual(measure(['and', ['ge', ['get', ['a']], 6], true]), { nodes: 6, depth: 3 });
    assert.deepEqual(measure(5), { nodes: 1, depth: 1 });
});

test('walkers visit every expression with its place', () => {
    const module = factions().content.dataModules[0];
    const seen = [];
    walkModuleExpressions(module, (expr, path, context) => seen.push(`${context.where}:${pathText(path)}:${expr[0]}`));
    assert.ok(seen.includes('rule:rules[0].when:and'));
    assert.ok(seen.includes('rule:rules[0].when[1]:ge'));
    assert.ok(seen.includes('kind:kinds.gain.effects[0].bind.faction:arg'));
    assert.ok(seen.includes('template:rewards.favour.effects[0].value:reward'));
    assert.ok(seen.includes('template:rewards.favour.effects[0].path[1]:bind'));
});

test('typed in-record rename and remove work on a detached copy', () => {
    const record = factions().content.dataModules[0];
    const target = makeTarget('ersveil-factions', record, 'dm.field', 'title');
    assert.deepEqual(target, { targetKind: 'dm.field', targetId: 'pack.ersveil-factions/reputation#title' });
    const renamed = renameInRecord('ersveil-factions', record, target, 'rank');
    assert.equal(renamed.ok, true);
    assert.deepEqual(Object.keys(renamed.module.state), ['standing', 'rank']);
    assert.ok(Object.hasOwn(record.state, 'title'), 'the original is untouched');
    const refused = removeInRecord('ersveil-factions', record, target);
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].code, 'has-references');
    const copy = { a: 1, b: 2 };
    replaceContents(copy, { c: 3 });
    assert.deepEqual(copy, { c: 3 });
    assert.deepEqual(makeTarget('p', { slug: 's' }, 'dm.module'), { targetKind: 'dm.module', targetId: 'pack.p/s' });
});

test('keys the forms do not show are listed and survive form edits', () => {
    const record = factions().content.dataModules[0];
    record.note = 'kept';
    record.kinds.gain.futureFlag = true;
    record.rules[0].tag = 'x';
    record.rewards.favour.future = [1];
    record.exports.standing.mode = 'm';
    record.imports = { clock: { query: 'director.time', mode: 'prefix', projection: ['minutes'], later: 1 } };
    record.migrations = [{ from: 1, to: 2, add: {}, memo: 1 }];
    record.timers = [{ id: 't', clock: 'clock', every: 5, effects: [], extra: 0 }];
    assert.deepEqual(unknownPaths(record), ['note', 'kinds.gain.futureFlag', 'rules[0].tag', 'rewards.favour.future', 'timers[0].extra', 'imports.clock.later', 'exports.standing.mode', 'migrations[0].memo']);
    assert.deepEqual(unknownPaths(factions().content.dataModules[0]), []);
    assert.deepEqual(unknownPaths(null), []);
});

test('a generated starter screen binds each field through the public view', () => {
    const chat = factions().content.dataModules[0];
    const screen = starterScreen(chat, 'pack.ersveil-factions/reputation');
    assert.equal(screen.id, 'reputation-status');
    assert.deepEqual(screen.layout.root.children.map(child => child.bind.path), ['chat.standing.guild', 'chat.standing.watch', 'chat.standing.compact', 'chat.title']);
    assert.ok(screen.layout.root.children.every(child => child.bind.query === 'dataModules.view' && child.bind.args.module === 'pack.ersveil-factions/reputation'));
    const people = starterScreen(survival().content.dataModules[0], 'pack.ersveil-survival/survival');
    assert.equal(people.layout.root.type, 'list');
    assert.equal(people.layout.root.bind.path, 'characters');
    assert.deepEqual(people.layout.root.item.children.map(child => [child.type, child.value, child.max]), [['meter', '$item.hunger', 100], ['meter', '$item.fatigue', 100]]);
});

test('sample view answers mirror the public view for chat and character scope', () => {
    assert.deepEqual(sampleView(factions().content.dataModules[0]), { chat: { standing: { guild: 0, watch: 0, compact: 0 }, title: 'none' } });
    assert.deepEqual(sampleView(survival().content.dataModules[0]), { characters: [{ id: 'ca_sample', name: 'Sample character', hunger: 0, fatigue: 0 }] });
});

test('path helpers refuse unsafe keys and keep key order on rename', () => {
    const root = {};
    setAt(root, ['a', 'b', 'c'], 1);
    assert.deepEqual(root, { a: { b: { c: 1 } } });
    setAt(root, ['list', 0], 'x');
    assert.deepEqual(root.list, ['x']);
    assert.throws(() => setAt(root, ['__proto__', 'x'], 1), /Unsafe key/);
    assert.equal(({}).x, undefined);
    assert.equal(getAt(root, ['a', 'b', 'c']), 1);
    assert.equal(getAt(root, ['a', 'z', 'c']), undefined);
    deleteAt(root, ['a', 'b', 'c']);
    assert.deepEqual(root.a.b, {});
    deleteAt(root, ['list', 0]);
    assert.deepEqual(root.list, []);
    assert.deepEqual(Object.keys(renameKey({ a: 1, b: 2, c: 3 }, 'b', 'z')), ['a', 'z', 'c']);
});
