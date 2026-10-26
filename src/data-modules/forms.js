// Pure draft operations behind the Data modules forms: starting records, type changes that keep a record coherent,
// and typed in-record renames. Everything works on plain JSON drafts in place and never decides validity.
import { entries, list, own, isObject, clone, UNSAFE_KEYS, renameKey } from './dm-model.js';
import { IMPORT_ADAPTERS, EFFECTS, KNOWN_KEYS } from './hints.js';
import { renameTarget, removeTarget } from './refs.js';

export function uniqueName(taken, base) {
    const used = new Set(taken);
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

export function defaultSchema(type) {
    switch (type) {
        case 'bool': return { type: 'bool', default: false };
        case 'enum': return { type: 'enum', values: ['one', 'two'], default: 'one' };
        case 'text': return { type: 'text', max: 80, default: '' };
        case 'map': return { type: 'map', keys: ['first'], values: { type: 'int', min: 0, max: 100, default: 0 } };
        default: return { type: 'int', min: 0, max: 100, default: 0 };
    }
}

export const newModule = taken => ({ slug: uniqueName(taken, 'new-module'), name: 'New module', schema: 1, stateVersion: 1, scope: 'chat', state: {}, kinds: {} });
export const newLabel = type => (type === 'enum' ? { type: 'enum', values: ['one', 'two'] } : { type: 'int', min: 1, max: 10 });
export const newKind = () => ({ op: '!', labels: {}, effects: [] });
export const newRule = draft => ({ id: uniqueName(list(draft.rules).map(rule => rule?.id), 'rule'), when: true, then: [] });
export const newTemplate = () => ({ bindings: {}, values: { amount: { min: 1, max: 5, pick: 'midpoint' } }, effects: [] });
export const newTimer = draft => ({ id: uniqueName(list(draft.timers).map(timer => timer?.id), 'timer'), clock: Object.keys(isObject(draft.imports) ? draft.imports : {})[0] ?? '', every: 60, effects: [] });
export const newMigration = draft => {
    const last = list(draft.migrations).at(-1);
    const from = Number.isInteger(last?.to) ? last.to : Number.isInteger(draft.stateVersion) ? draft.stateVersion : 1;
    return { from, to: from + 1, add: {} };
};

export const isRangeTable = value => isObject(value) && own(value, 'binding') && own(value, 'table');

/** A range table over an enum binding: one fixed range per value of the binding (the checker requires exact cover). */
export function newRangeTable(binding, schema, previous) {
    const table = {};
    for (const value of list(schema?.values)) table[String(value)] = clone(previous?.[String(value)]) ?? { min: 1, max: 5, pick: 'midpoint' };
    return { binding, table };
}

/** Keeps an enum schema's default among its values after the value list changes. Labels and bindings have none. */
export function setEnumValues(schema, values) {
    schema.values = values;
    if (own(schema, 'default') && !values.includes(schema.default)) schema.default = values[0] ?? '';
}

/** Keeps a map's declared keys unique; returns the map keys written. */
export function setMapKeys(schema, keys) {
    schema.keys = [...new Set(keys)];
}

export function newImport(adapterId, draft, document) {
    const adapter = IMPORT_ADAPTERS.find(item => item.id === adapterId) ?? IMPORT_ADAPTERS[0];
    if (adapter.id === 'data-module') {
        const other = list(document?.content?.dataModules).find(module => module && module.slug !== draft.slug && isObject(module.exports) && Object.keys(module.exports).length);
        const exportName = other ? Object.keys(other.exports)[0] : '';
        return { query: adapter.query, args: { module: other ? `pack.${document.id}/${other.slug}` : '', export: exportName, ...(other?.scope === 'character' ? { who: 'ca_actor' } : {}) }, mode: adapter.mode, projection: other ? list(other.exports[exportName]?.fields) : [] };
    }
    return { query: adapter.query, mode: adapter.mode, projection: [...adapter.projection] };
}

/** Which published adapter an import record matches, for showing the right controls. */
export function adapterOf(spec) {
    return IMPORT_ADAPTERS.find(item => item.query === spec?.query) ?? null;
}

/** A new effect of the given op using the module's first suitable field or template. */
export function newEffect(op, draft) {
    const firstField = Object.keys(isObject(draft.state) ? draft.state : {})[0] ?? '';
    const schema = isObject(draft.state?.[firstField]) ? draft.state[firstField] : null;
    const path = schema?.type === 'map' ? [firstField, list(schema.keys)[0] ?? ''] : [firstField];
    const template = Object.keys(isObject(draft.rewards) ? draft.rewards : {})[0] ?? '';
    switch (op) {
        case 'set': return { op, path, value: schema?.type === 'bool' ? false : schema?.type === 'enum' ? list(schema.values)[0] ?? '' : 0 };
        case 'clamp': return { op, path, min: 0, max: 100 };
        case 'reward': return { op, template, bind: {} };
        case 'offer': return { op, template, key: 'offer', bind: {} };
        case 'award': return { op, offer: 'offer' };
        default: return { op: 'add', path, value: 1 };
    }
}

export const effectOps = where => Object.keys(EFFECTS).filter(op => !EFFECTS[op].v11 && EFFECTS[op].where.includes(where));

/** For a reward/offer effect: makes `bind` hold exactly one entry per declared binding of its template. */
export function syncBindings(effect, draft) {
    const bindings = Object.keys(isObject(draft.rewards?.[effect.template]?.bindings) ? draft.rewards[effect.template].bindings : {});
    const next = {};
    for (const name of bindings) next[name] = own(effect.bind, name) ? effect.bind[name] : '';
    for (const [name, value] of entries(effect.bind)) if (!own(next, name)) next[name] = value;
    effect.bind = next;
}

/** The typed target for a name in a record: kind is a TARGET_KINDS value, names are scope then member where scoped. */
export function makeTarget(packId, record, targetKind, ...names) {
    const id = `pack.${packId}/${record?.slug}`;
    return { targetKind, targetId: targetKind === 'dm.module' ? id : `${id}#${names.join('.')}` };
}

/** Typed rename inside one record (field, key, template, alias, label, binding, value). Returns { ok, module, errors }. */
export function renameInRecord(packId, record, target, newName) {
    const document = { id: packId, content: { dataModules: [clone(record)] } };
    const result = renameTarget(document, target, newName);
    if (!result.ok) return result;
    return { ok: true, module: result.modules[0], changed: result.changed };
}

export function removeInRecord(packId, record, target) {
    const document = { id: packId, content: { dataModules: [clone(record)] } };
    const result = removeTarget(document, target);
    if (!result.ok) return result;
    return { ok: true, module: result.modules[0] };
}

/** Replaces the keys and values of `target` with `source`, preserving object identity for the form. */
export function replaceContents(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    for (const [key, value] of Object.entries(source)) target[key] = value;
}

export { UNSAFE_KEYS, renameKey };

/** Keys the forms do not edit, as paths like "kinds.gain.extra"; they stay untouched in the record (JSON view lists them). */
export function unknownPaths(record) {
    const out = [];
    const check = (value, known, prefix) => {
        if (!isObject(value)) return;
        for (const key of Object.keys(value)) if (!known.includes(key)) out.push(prefix ? `${prefix}.${key}` : key);
    };
    check(record, KNOWN_KEYS.module, '');
    for (const [name, kind] of entries(record?.kinds)) check(kind, KNOWN_KEYS.kind, `kinds.${name}`);
    list(record?.rules).forEach((rule, i) => check(rule, KNOWN_KEYS.rule, `rules[${i}]`));
    for (const [name, template] of entries(record?.rewards)) check(template, KNOWN_KEYS.template, `rewards.${name}`);
    list(record?.timers).forEach((timer, i) => check(timer, KNOWN_KEYS.timer, `timers[${i}]`));
    for (const [name, spec] of entries(record?.imports)) check(spec, KNOWN_KEYS.import, `imports.${name}`);
    for (const [name, spec] of entries(record?.exports)) check(spec, KNOWN_KEYS.export, `exports.${name}`);
    list(record?.migrations).forEach((step, i) => check(step, KNOWN_KEYS.migration, `migrations[${i}]`));
    return out;
}

/** A starter screen showing every field of a module through its public view, shaped like the DATA_MODULES.md examples. */
export function starterScreen(record, id) {
    const view = { query: 'dataModules.view', args: { module: id } };
    const text = (label, path) => ({ type: 'text', label, bind: { ...view, path } });
    const slug = typeof record?.slug === 'string' ? record.slug : 'module';
    if (record?.scope === 'character') {
        const item = { type: 'box', title: '$item.name', children: [] };
        for (const [name, schema] of entries(record?.state)) {
            if (schema?.type === 'int') item.children.push({ type: 'meter', label: name, value: `$item.${name}`, max: Number.isInteger(schema.max) ? schema.max : 100 });
            else if (schema?.type !== 'map') item.children.push({ type: 'text', label: name, value: `$item.${name}` });
        }
        return { id: `${slug}-status`, title: record?.name ?? slug, icon: 'fa-list', mounts: ['tab'], layout: { root: { type: 'list', empty: 'Attach a character in Setup.', bind: { ...view, path: 'characters' }, item } } };
    }
    const children = [];
    for (const [name, schema] of entries(record?.state)) {
        if (schema?.type === 'map') for (const key of list(schema.keys)) children.push(text(`${name} ${key}`, `chat.${name}.${key}`));
        else children.push(text(name, `chat.${name}`));
    }
    return { id: `${slug}-status`, title: record?.name ?? slug, icon: 'fa-list', mounts: ['tab'], layout: { root: { type: 'col', children } } };
}

/** Field defaults, shaped like the module's public view, for previewing an attached screen. */
export function sampleView(record) {
    const defaults = {};
    for (const [name, schema] of entries(record?.state)) {
        if (schema?.type === 'map') defaults[name] = Object.fromEntries(list(schema.keys).map(key => [key, schema.values?.default]));
        else defaults[name] = schema?.default;
    }
    return record?.scope === 'character' ? { characters: [{ id: 'ca_sample', name: 'Sample character', ...clone(defaults) }] } : { chat: defaults };
}
