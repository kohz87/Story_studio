// The code module form's inputs (docs/PART5B_SPEC.md §6.1): the 18 keys, the rules and messages of §5, the reserved names
// of §5.4 and the escapers of §3.4. Pure: no DOM, no clock. The identifier rules are narrower than Story Block's on
// purpose (§3.2), so each identifier is safe in every place it is written.

import { HOST_CAPABILITIES, SLUG } from '../../vendor/story-block/src/v2/packs/limits.js';

export const INPUT_KEYS = Object.freeze(['moduleId', 'name', 'description', 'author', 'capability', 'domain', 'field', 'label', 'min', 'max', 'initial', 'step', 'kind', 'kindLabel', 'command', 'action', 'query', 'screen']);
export const LABELS = Object.freeze({
    moduleId: 'Module id', name: 'Name', description: 'Description', author: 'Author', capability: 'Capability',
    domain: 'State name', field: 'Field', label: 'Field label', min: 'Minimum', max: 'Maximum', initial: 'Start value',
    step: 'Most a line may change it', kind: 'Line kind', kindLabel: 'Line label', command: 'Command', action: 'Button label',
    query: 'Query', screen: 'Add a tab screen',
});
export const LIMITS = Object.freeze({ name: 40, description: 160, author: 60, label: 24, action: 32 });
export const NUMBER_LIMIT = 1000000;
export const DISPLAY_TEXT = /^[\p{L}\p{M}\p{N} ',.!?:;()\-–—’]*$/u;
export const EXAMPLE_INPUTS = Object.freeze({
    moduleId: 'lantern-oil',
    name: 'Lantern Oil',
    description: "Counts the oil left in the party's lantern.",
    author: 'Example Author',
    capability: 'lantern-oil',
    domain: 'lantern',
    field: 'oil',
    label: 'Oil',
    min: 0,
    max: 20,
    initial: 10,
    step: 5,
    kind: 'oil',
    kindLabel: 'change',
    command: 'pour',
    action: 'Pour out one',
    query: 'oil',
    screen: true,
});

// Snapshots of what Story Block and the other Story Suite modules own at the baseline (section 5.4).
export const RESERVED_MODULE_IDS = Object.freeze(['fishing-activity', 'npc-state-delta', 'story-block', 'story-director', 'story-studio']);
// Domains and command/query prefixes of Story Block (core) and Story Director
// at the baseline. The state name is also the scaffold's command and query prefix, so both kinds of name are here.
export const RESERVED_NAMES = Object.freeze([
    'arc', 'assist', 'atlas', 'bestiary', 'capture', 'chatter', 'checks', 'chronicle', 'combat', 'craft', 'creation',
    'death', 'director', 'dm', 'domains', 'effects', 'events', 'gear', 'inventory', 'item', 'items', 'journal', 'meta',
    'module', 'npc', 'packs', 'party', 'progress', 'quest', 'quests', 'return', 'rules', 'savepoint', 'savepoints',
    'scene', 'state', 'story', 'threads', 'time', 'trade', 'training', 'wallet', 'world',
]);
// Capture kinds reserved by the suite at the baseline.
export const RESERVED_KINDS = Object.freeze([
    'agenda', 'beat', 'check', 'chatter', 'choice', 'clock', 'coin', 'craft', 'dm', 'effect', 'encounter', 'event',
    'faction', 'hook', 'intervention', 'item', 'join', 'landmark', 'leave', 'lethal', 'loot', 'market', 'place',
    'present', 'quest', 'recipe', 'refine', 'repair', 'rest', 'route', 'secret', 'skill', 'time', 'use', 'weather',
    'world', 'wound', 'xp',
]);
export const RESERVED_FIELDS = Object.freeze(['constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'prototype', 'toLocaleString', 'toString', 'valueOf']);

const DISPLAY = new Set(['name', 'description', 'author', 'label', 'action']);
const REQUIRED = new Set(INPUT_KEYS.filter(key => key !== 'author' && key !== 'capability'));
const NUMBERS = ['min', 'max', 'initial', 'step'];
const MODULE_ID_RULE = 'must be lowercase words joined by "-", like "lantern-oil", at most 64 characters.';
const RESERVED_TEXT = 'is taken by Story Block or another Story Suite module.';

const isNumber = value => Number.isSafeInteger(value) && Math.abs(value) <= NUMBER_LIMIT;

// A JS single-quoted string literal for `text`, quotes included. Validation already refuses everything this escapes
// except the apostrophe; the rest is defence in depth.
export function jsString(text) {
    return `'${text.replace(/[\\'\u0000-\u001f\u007f\u2028\u2029]/g, c => (c === '\\' ? '\\\\' : c === "'" ? "\\'" : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))}'`;
}

// Markdown prose: a backslash before each character that could start Markdown or HTML. Display text never contains
// one (section 5.2), so for valid input this returns the text unchanged.
export function mdText(text) {
    return text.replace(/[\\`*_{}[\]<>#|&]/g, c => `\\${c}`);
}

// Each rule of §5.3 for one key, in the order the rules are written there: the first failing one is [code, message].
function numberProblem(key, raw, numbersOk) {
    const value = raw[key];
    const label = LABELS[key];
    if (!isNumber(value)) return ['bad-number', `${label} must be a whole number from -${NUMBER_LIMIT} to ${NUMBER_LIMIT}.`];
    if (!numbersOk) return null;
    if (key === 'max' && raw.max <= raw.min) return ['bad-range', 'Maximum must be above Minimum.'];
    if (key === 'initial' && (raw.initial < raw.min || raw.initial > raw.max)) return ['bad-range', 'Start value must be from Minimum to Maximum.'];
    if (key === 'step' && (raw.step < 1 || raw.step > raw.max - raw.min)) return ['bad-range', 'Most a line may change it must be from 1 to Maximum minus Minimum.'];
    return null;
}

function displayProblem(key, value) {
    const label = LABELS[key];
    if (value.normalize('NFC') !== value) return ['unsafe-text', `${label} has a character in decomposed form; type it again.`];
    if (!DISPLAY_TEXT.test(value) || value !== value.trim()) return ['unsafe-text', `${label} may use only letters, digits, spaces and the marks ' ’ , . ! ? : ; ( ) - – —.`];
    if ([...value].length > LIMITS[key]) return ['too-long', `${label} is longer than ${LIMITS[key]} characters.`];
    return null;
}

function problemOf(key, raw, numbersOk) {
    const value = raw[key];
    const label = LABELS[key];
    if (key === 'screen') return typeof value === 'boolean' ? null : ['bad-type', `${label} has the wrong type.`];
    if (NUMBERS.includes(key)) return numberProblem(key, raw, numbersOk);
    if (typeof value !== 'string') return ['bad-type', `${label} has the wrong type.`];
    if (REQUIRED.has(key) && value === '') return ['required', `${label} is needed.`];
    if (DISPLAY.has(key)) return displayProblem(key, value);
    switch (key) {
        case 'moduleId':
            if (!SLUG.test(value)) return ['bad-slug', `${label} ${MODULE_ID_RULE}`];
            if (RESERVED_MODULE_IDS.includes(value)) return ['reserved', `${label} "${value}" ${RESERVED_TEXT}`];
            return null;
        case 'capability':
            if (value === '') return null;
            if (!SLUG.test(value)) return ['bad-slug', `${label} ${MODULE_ID_RULE}`];
            if (HOST_CAPABILITIES.includes(value) || RESERVED_MODULE_IDS.includes(value) || RESERVED_NAMES.includes(value)) return ['reserved', `${label} "${value}" ${RESERVED_TEXT}`];
            return null;
        case 'domain':
            if (!/^[a-z][a-z0-9]{1,23}$/.test(value)) return ['bad-name', `${label} must be a lowercase letter, then 1 to 23 lowercase letters or digits.`];
            if (RESERVED_NAMES.includes(value)) return ['reserved', `${label} "${value}" ${RESERVED_TEXT}`];
            return null;
        case 'field':
            if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(value)) return ['bad-name', `${label} must be a lowercase letter, then up to 23 letters or digits.`];
            if (value === 'id' || value.endsWith('Id')) return ['reserved', `${label} "${value}" would have to hold a record id; choose another name.`];
            if (RESERVED_FIELDS.includes(value)) return ['reserved', `${label} "${value}" is a name every JavaScript object already has; choose another.`];
            return null;
        case 'kind':
            if (!/^[a-z][a-z0-9]{1,23}$/.test(value)) return ['bad-name', `${label} must be a lowercase letter, then 1 to 23 lowercase letters or digits.`];
            if (RESERVED_KINDS.includes(value)) return ['reserved', `${label} "${value}" ${RESERVED_TEXT}`];
            return null;
        case 'kindLabel':
            return /^[a-z]{1,16}$/.test(value) ? null : ['bad-name', `${label} must be 1 to 16 lowercase letters.`];
        case 'command':
            return /^[a-z][a-zA-Z0-9]{0,31}$/.test(value) ? null : ['bad-name', `${label} must be a lowercase letter, then up to 31 letters or digits.`];
        case 'query':
            if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(value)) return ['bad-name', `${label} must be a lowercase letter, then up to 31 letters or digits.`];
            if (value === raw.command && /^[a-z][a-zA-Z0-9]{0,31}$/.test(raw.command)) return ['clash', 'Query must not be the same as Command.'];
            return null;
        default:
            return null;
    }
}

/**
 * → { ok: true, inputs } (a frozen copy holding exactly the 18 keys, in INPUT_KEYS order) or { ok: false, errors }.
 * Each error is { code, field, message }. Unknown keys come first, in the order the form gave them; then each field of
 * INPUT_KEYS reports at most its first failing rule. The range rules run only when all four numbers are valid.
 */
export function validateInputs(raw) {
    // A plain object is one whose prototype is Object.prototype or null: a Date, a Map, an array or an object made from
    // another form is not one.
    const proto = raw === null || typeof raw !== 'object' ? undefined : Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) {
        return { ok: false, errors: [{ code: 'bad-type', field: '', message: 'The code module form is not an object.' }] };
    }
    const errors = [];
    for (const key of Object.keys(raw)) {
        if (!INPUT_KEYS.includes(key)) errors.push({ code: 'unknown-field', field: key, message: `"${key}" is not a code module field.` });
    }
    const numbersOk = NUMBERS.every(key => isNumber(raw[key]));
    for (const key of INPUT_KEYS) {
        const problem = problemOf(key, raw, numbersOk);
        if (problem) errors.push({ code: problem[0], field: key, message: problem[1] });
    }
    if (errors.length) return { ok: false, errors };
    const inputs = {};
    for (const key of INPUT_KEYS) inputs[key] = raw[key];
    return { ok: true, inputs: Object.freeze(inputs) };
}
