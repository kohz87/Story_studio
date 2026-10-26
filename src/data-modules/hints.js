// Control hints for the Data modules forms (DATA_MODULES.md §§2-4). They shape which controls Studio offers and
// never decide what is valid: acceptance is always Story Block's checker, reached through sb-adapter.js.
// Wherever Story Block exports descriptors (DM_DESCRIPTORS) the lists below come from them, read once when this
// module loads: scopes, field and label types, line ops, pickers, operator arities, effect fields, adapters, and
// the keys of every record. What stays here is presentation only: labels, grouping, slot types for choosing a control.
import { descriptors } from './sb-adapter.js';

const live = descriptors();
const pick = (value, fallback) => (live && value !== undefined ? value : fallback);
const frozen = list => Object.freeze([...list]);

export const HINTS_SOURCE = live ? 'Story Block descriptors' : 'DATA_MODULES.md draft (provisional until Story Block exports descriptors)';

export const SCOPES = frozen(pick(live?.scope, ['chat', 'character']));
export const FIELD_TYPES = frozen(live ? Object.keys(live.fields) : ['int', 'bool', 'enum', 'text', 'map']);
export const SCALAR_TYPES = frozen(FIELD_TYPES.filter(type => type !== 'map'));
export const LABEL_TYPES = frozen(live ? Object.keys(live.labels) : ['int', 'enum']);
// `?` asks code to decide a check, which is v1.1; the forms offer the four ops a v1 kind can use.
export const LINE_OPS = frozen(pick(live?.ops, ['+', '-', '~', '!']).filter(op => op !== '?'));
export const BOUNDS = Object.freeze(['reject', 'clamp']);
export const PICKS = frozen(pick(live?.pick, ['min', 'max', 'midpoint']));
export const IMPORT_MODES = frozen(live ? [...new Set(Object.values(live.adapters).flatMap(adapter => adapter.modes))] : ['prefix', 'recorded']);
export const MOUNTS = Object.freeze(['tab', 'screen', 'card', 'hud', 'dialog']);

// The published import adapters: nothing else may be imported (Story Block refuses the rest).
const UI_ADAPTERS = [
    { id: 'sd-minutes', label: 'Story Director minutes', query: 'director.time', mode: 'prefix', projection: ['minutes'], choices: ['minutes'], capability: 'story-director' },
    { id: 'sd-actors', label: 'Story Director actors', query: 'checks.policy', mode: 'prefix', projection: ['actors.id', 'actors.name'], choices: ['actors.id', 'actors.name'], capability: 'story-director' },
    { id: 'data-module', label: 'Another data module export', query: 'dataModules.public', mode: 'prefix', projection: [], choices: null, capability: null },
];
// A published adapter's modes and projection fields come from Story Block when it says; an adapter it does not list is not offered.
export const IMPORT_ADAPTERS = Object.freeze(UI_ADAPTERS.filter(item => !live || Object.hasOwn(live.adapters, item.query)).map(item => {
    const real = live?.adapters?.[item.query];
    if (!real) return Object.freeze(item);
    const projection = Array.isArray(real.projection) ? real.projection : item.projection;
    return Object.freeze({ ...item, mode: real.modes.includes(item.mode) ? item.mode : real.modes[0], projection: [...projection], choices: Array.isArray(real.projection) ? [...real.projection] : item.choices, args: real.args });
}));

// Operators by name: slot types are for choosing controls (int, bool, same-type "any", path, name, alias, field, positiveInt).
const UI_OPERATORS = {
    get: { group: 'Read', slots: ['path'], result: 'any' },
    arg: { group: 'Read', slots: ['label'], result: 'any' },
    bind: { group: 'Read', slots: ['binding'], result: 'any' },
    input: { group: 'Read', slots: ['alias', 'field'], result: 'any' },
    reward: { group: 'Read', slots: ['value'], result: 'int' },
    timer: { group: 'Read', slots: ['periods'], result: 'int' },
    check: { group: 'Read', slots: ['name'], result: 'any', v11: true },
    eq: { group: 'Compare', slots: ['any', 'any'], result: 'bool' },
    ne: { group: 'Compare', slots: ['any', 'any'], result: 'bool' },
    lt: { group: 'Compare', slots: ['int', 'int'], result: 'bool' },
    le: { group: 'Compare', slots: ['int', 'int'], result: 'bool' },
    gt: { group: 'Compare', slots: ['int', 'int'], result: 'bool' },
    ge: { group: 'Compare', slots: ['int', 'int'], result: 'bool' },
    and: { group: 'Logic', slots: ['bool', 'bool'], result: 'bool' },
    or: { group: 'Logic', slots: ['bool', 'bool'], result: 'bool' },
    not: { group: 'Logic', slots: ['bool'], result: 'bool' },
    add: { group: 'Integer', slots: ['int', 'int'], result: 'int' },
    sub: { group: 'Integer', slots: ['int', 'int'], result: 'int' },
    mul: { group: 'Integer', slots: ['int', 'int'], result: 'int' },
    min: { group: 'Integer', slots: ['int', 'int'], result: 'int' },
    max: { group: 'Integer', slots: ['int', 'int'], result: 'int' },
    floorDiv: { group: 'Integer', slots: ['int', 'positiveInt'], result: 'int' },
    clamp: { group: 'Integer', slots: ['int', 'int', 'int'], result: 'int' },
};
// Arity comes from Story Block. An operator it adds that this table does not know gets plain expression slots,
// and one it drops disappears; a differing arity is taken from Story Block.
export const OPERATORS = Object.freeze(Object.fromEntries((live ? Object.keys(live.arities) : Object.keys(UI_OPERATORS)).map(name => {
    const ui = UI_OPERATORS[name] ?? { group: 'Integer', slots: [], result: 'any' };
    const arity = live ? live.arities[name] : ui.slots.length;
    const slots = ui.slots.length === arity ? ui.slots : Array.from({ length: arity }, () => 'any');
    return [name, Object.freeze({ ...ui, slots: Object.freeze([...slots]), ...(name === 'check' ? { v11: true } : {}) })];
})));

// Effect objects: `op` plus exactly these fields. `where` lists the places an effect may appear.
const UI_EFFECTS = {
    set: { fields: ['path', 'value'], optional: [], where: ['kind', 'rule', 'template'] },
    add: { fields: ['path', 'value'], optional: ['bounds'], where: ['kind', 'rule', 'template', 'timer'] },
    clamp: { fields: ['path', 'min', 'max'], optional: [], where: ['kind', 'rule', 'template', 'timer'] },
    reward: { fields: ['template', 'bind'], optional: [], where: ['kind', 'rule'] },
    offer: { fields: ['template', 'key', 'bind'], optional: [], where: ['kind', 'rule'] },
    award: { fields: ['offer'], optional: [], where: ['kind', 'rule'] },
    grantCoin: { fields: ['amount'], optional: [], where: [], v11: true },
    grantItem: { fields: ['def', 'qty'], optional: [], where: [], v11: true },
    grantXp: { fields: ['amount'], optional: [], where: [], v11: true },
};
// Required and optional fields come from Story Block's effect descriptors; the v1.1 grants from its v11Effects list.
export const EFFECTS = Object.freeze(Object.fromEntries(Object.entries(UI_EFFECTS).map(([op, ui]) => {
    const real = live?.effects?.[op];
    const v11 = live ? live.v11Effects.includes(op) : ui.v11 === true;
    return [op, Object.freeze({ ...ui, ...(real ? { fields: real.required.filter(key => key !== 'op'), optional: [...real.optional] } : {}), ...(v11 ? { v11: true, where: [] } : {}) })];
})));



// Keys the forms know, per level. Anything else is kept untouched in the record and listed in the JSON view.
const keysOf = (spec, fallback) => frozen(spec ? [...spec.required, ...spec.optional] : fallback);
export const KNOWN_KEYS = Object.freeze({
    module: keysOf(live?.definition, ['slug', 'name', 'schema', 'stateVersion', 'scope', 'state', 'kinds', 'imports', 'rules', 'timers', 'rewards', 'exports', 'screens', 'layouts', 'migrations']),
    kind: keysOf(live?.kind, ['op', 'labels', 'oncePerReply', 'when', 'refusal', 'effects', 'ui', 'check']),
    rule: keysOf(live?.rule, ['id', 'when', 'then']),
    template: keysOf(live?.reward, ['bindings', 'values', 'effects', 'when']),
    timer: keysOf(live?.timer, ['id', 'clock', 'every', 'effects']),
    import: keysOf(live?.import, ['query', 'args', 'mode', 'projection']),
    export: keysOf(live?.export, ['fields']),
    migration: keysOf(live?.migration, ['from', 'to', 'add']),
});

export const V11_MESSAGE = 'needs data-modules v1.1';
