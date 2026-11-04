// The Character card: what the page holds (a plain draft object), how a card is read into it, and how it becomes a V2 card (pure).
//
// The draft is JSON-safe so it can be saved with the pack (session.js). The card image is not in it: it is PNG bytes kept apart.
// Fields the writer has not touched follow the pack (narratorFields); everything the writer typed, or a picked card gave, is in `fields`.

import { narratorFields } from './narrator.js';
import { worldInfo } from './lorebook.js';
import { exportPack } from './model.js';
import { zipPortraits } from './cast/data.js';
import { PORTRAIT_TYPES } from './cast/portrait.js';
import { exportCardPng, readCardPng, stripCardChunks } from './card-png.js';
import STATUS_BAR from '../vendor/story-block-examples/status-bar.regex.json' with { type: 'json' };

export const TEXT_KEYS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
    'system_prompt', 'post_history_instructions', 'creator', 'character_version'];
export const NOTE_ROLES = ['system', 'user', 'assistant'];
export const NOTE_DEPTH = Object.freeze({ min: 0, max: 999, default: 4 });
export const MAX_CARD_BYTES = 24 * 1024 * 1024;
const MAX_LORE_ENTRIES = 5000;
const MAX_GREETINGS = 100;
const MAX_TAGS = 100;
const MAX_TEXT = 1024 * 1024;

/** The limits of a `[storysuite:portraits]` entry (SDK-CARD-CONTRACT addendum D). */
export const PORTRAIT_ENTRY_LIMITS = Object.freeze({ files: 24, fileBytes: 200 * 1024, totalBytes: 3 * 1024 * 1024, shrinkBytes: 40 * 1024 });
export const TAGS = Object.freeze({ pack: '[storysuite:pack]', portraits: '[storysuite:portraits]', settings: '[storysuite:settings]' });
const OWN_TAG = /\[\s*storysuite\s*:\s*(?:pack|portraits|settings)\s*\]/i;

/** The recommended settings a card may carry (the contract's allow-list), in the order the page shows them. */
export const SETTING_ROWS = Object.freeze([
    { key: 'story-block.rpg', id: 'rpg', label: 'RPG', kind: 'toggle', default: true, ticked: true },
    { key: 'story-block.gear', id: 'gear', label: 'Gear', kind: 'toggle', default: true, ticked: true },
    { key: 'story-block.rpgXpRate', id: 'xp', label: 'XP rate', kind: 'number', min: 50, max: 300, step: 25, default: 100, ticked: false, unit: '%' },
    { key: 'npc-state-delta.portraitPromptFormat', id: 'portraits', label: 'NSD portrait prompt', kind: 'choice', default: 'natural', ticked: true,
        choices: [['natural', 'Natural'], ['hybrid', 'Hybrid'], ['tags', 'Tags']] },
    { key: 'npc-state-delta.scanEvery', id: 'scan', label: 'NSD scan every', kind: 'number', min: 1, max: 20, step: 1, default: 5, ticked: false, unit: ' replies' },
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const whole = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function settingRowValid(row, value) {
    if (row.kind === 'toggle') return typeof value === 'boolean';
    if (row.kind === 'choice') return row.choices.some(([id]) => id === value);
    return Number.isInteger(value) && value >= row.min && value <= row.max && (value - row.min) % row.step === 0;
}

/** A card draft with nothing written: every field follows the pack. */
export function emptyCard() {
    return {
        fields: {}, greetings: [], tags: [], note: { prompt: '', depth: NOTE_DEPTH.default, role: 'system' }, talkativeness: '',
        extras: {}, ownLore: [],
        include: { pack: true, lore: true, portraits: true, statusBar: false, settings: true, ownLore: true },
        settings: Object.fromEntries(SETTING_ROWS.map(row => [row.id, { on: row.ticked, value: row.default }])),
    };
}

/** A saved draft (anything JSON) made safe: unknown or damaged parts fall back to the empty draft's. Never throws. */
export function sanitizeCard(raw) {
    const card = emptyCard();
    if (!isObject(raw)) return card;
    if (isObject(raw.fields)) for (const key of TEXT_KEYS) if (typeof raw.fields[key] === 'string') card.fields[key] = raw.fields[key].slice(0, MAX_TEXT);
    if (Array.isArray(raw.greetings)) card.greetings = raw.greetings.filter(item => typeof item === 'string').slice(0, MAX_GREETINGS).map(item => item.slice(0, MAX_TEXT));
    if (Array.isArray(raw.tags)) card.tags = raw.tags.filter(item => typeof item === 'string').slice(0, MAX_TAGS);
    if (isObject(raw.note)) {
        card.note.prompt = text(raw.note.prompt).slice(0, MAX_TEXT);
        card.note.depth = whole(raw.note.depth, NOTE_DEPTH.min, NOTE_DEPTH.max, NOTE_DEPTH.default);
        card.note.role = NOTE_ROLES.includes(raw.note.role) ? raw.note.role : 'system';
    }
    if (typeof raw.talkativeness === 'string') card.talkativeness = raw.talkativeness.slice(0, 20);
    if (isObject(raw.extras)) { card.extras = JSON.parse(JSON.stringify(raw.extras)); delete card.extras.world; delete card.extras.fav; }
    if (Array.isArray(raw.ownLore)) card.ownLore = raw.ownLore.filter(isObject).slice(0, MAX_LORE_ENTRIES);
    if (isObject(raw.include)) for (const key of Object.keys(card.include)) if (typeof raw.include[key] === 'boolean') card.include[key] = raw.include[key];
    if (isObject(raw.settings)) {
        for (const row of SETTING_ROWS) {
            const given = raw.settings[row.id];
            if (!isObject(given)) continue;
            if (typeof given.on === 'boolean') card.settings[row.id].on = given.on;
            if (settingRowValid(row, given.value)) card.settings[row.id].value = given.value;
        }
    }
    return card;
}

/** True when the draft holds anything the writer or a picked card put there (so it is worth saving). */
export function cardTouched(card) {
    return Boolean(card) && JSON.stringify(card) !== JSON.stringify(emptyCard());
}

// --- Reading a card ---------------------------------------------------------------------------------------------------------------

function parseJson(source) {
    return JSON.parse(String(source).replace(/^﻿/, ''), (key, value) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`unsafe key ${key}`);
        return value;
    });
}

const numeric = value => {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/**
 * A card (V1, V2 or V3 JSON text, or a PNG with a `chara` or `ccv3` chunk) → `{ card, image, spec, notes, found }` (`found` says whether the card held Studio's status bar and settings entries).
 * `card` is a draft with every field the card has; `image` is the PNG picture of a PNG card (its card data removed), else null.
 * The card's own lorebook entries are kept as `card.ownLore`, except the ones Studio wrote itself (the three storysuite
 * entries and the pack's lore), which come back from the pack. Throws an Error in plain words.
 */
export function readCard(source) {
    let image = null;
    let json = source;
    if (source instanceof Uint8Array) {
        if (source.length > MAX_CARD_BYTES) throw new Error('that file is too large for a card');
        if (source[0] === 137 && source[1] === 80) {
            json = readCardPng(source);
            if (json === null) throw new Error('that PNG has no card in it (no chara or ccv3 chunk)');
            image = stripCardChunks(source);
        } else json = new TextDecoder().decode(source);
    }
    if (typeof json !== 'string') throw new Error('a card is JSON text or a PNG');
    let root;
    try { root = parseJson(json); } catch (err) { throw new Error(`the card is not readable JSON (${err.message})`); }
    if (!isObject(root)) throw new Error('the card is not a JSON object');
    const spec = typeof root.spec === 'string' ? root.spec : '';
    if (spec && !['chara_card_v2', 'chara_card_v3'].includes(spec)) throw new Error(`card spec ${spec.slice(0, 40)} is not one Studio reads (V2 or V3)`);
    const data = spec ? root.data : root;
    if (!isObject(data)) throw new Error('the card has no data');
    if (!spec && typeof data.name !== 'string') throw new Error('that file is not a character card (no spec and no name)');

    const card = emptyCard();
    for (const key of TEXT_KEYS) card.fields[key] = text(data[key]).slice(0, MAX_TEXT);
    card.greetings = (Array.isArray(data.alternate_greetings) ? data.alternate_greetings : []).filter(item => typeof item === 'string').slice(0, MAX_GREETINGS);
    card.tags = (Array.isArray(data.tags) ? data.tags : []).filter(item => typeof item === 'string' && item.trim()).slice(0, MAX_TAGS);
    const extensions = isObject(data.extensions) ? { ...data.extensions } : {};
    const note = isObject(extensions.depth_prompt) ? extensions.depth_prompt : {};
    card.note = {
        prompt: text(note.prompt),
        depth: whole(typeof note.depth === 'string' ? Number(note.depth) : note.depth, NOTE_DEPTH.min, NOTE_DEPTH.max, NOTE_DEPTH.default),
        role: NOTE_ROLES.includes(note.role) ? note.role : 'system',
    };
    const talk = numeric(extensions.talkativeness);
    card.talkativeness = talk !== null && talk >= 0 && talk <= 1 ? String(talk) : '';
    delete extensions.depth_prompt;
    delete extensions.talkativeness;
    // A linked world and the favourite mark belong to the card's old home: the lorebook is embedded, and a link would win over it.
    delete extensions.world;
    delete extensions.fav;
    const notes = [];
    const found = { statusBar: false, settings: false };
    if (Array.isArray(extensions.regex_scripts)) {
        const own = extensions.regex_scripts.some(script => isObject(script) && script.id === STATUS_BAR.id);
        if (own) { card.include.statusBar = true; found.statusBar = true; }
        const rest = extensions.regex_scripts.filter(script => !(isObject(script) && script.id === STATUS_BAR.id));
        if (rest.length) extensions.regex_scripts = rest; else delete extensions.regex_scripts;
    }
    card.extras = JSON.parse(JSON.stringify(extensions));

    const book = data.character_book;
    const entries = isObject(book) ? (Array.isArray(book.entries) ? book.entries : isObject(book.entries) ? Object.values(book.entries) : []) : [];
    for (const entry of entries.slice(0, MAX_LORE_ENTRIES)) {
        if (!isObject(entry) || typeof entry.content !== 'string') continue;
        if (OWN_TAG.test(text(entry.comment)) || OWN_TAG.test(text(entry.name))) {
            if (/\[\s*storysuite\s*:\s*settings\s*\]/i.test(text(entry.comment) + text(entry.name))) {
                const read = readSettingsEntry(entry.content);
            const rows = read?.rows;
            if (read) notes.push(...read.left);
                if (rows) { card.settings = rows; card.include.settings = true; found.settings = true; }
            }
            continue;
        }
        if (isObject(entry.extensions) && isObject(entry.extensions.story_studio)) continue;
        card.ownLore.push(JSON.parse(JSON.stringify(entry)));
    }
    if (entries.length > MAX_LORE_ENTRIES) notes.push(`only the first ${MAX_LORE_ENTRIES} lorebook entries were read`);
    return { card, image, spec: spec || 'v1', notes, found };
}

/** A settings entry's text → the draft's settings rows (only the keys it holds are ticked), or null. */
function readSettingsEntry(content) {
    const left = [];
    try {
        const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(content.trim());
        const data = parseJson(fenced ? fenced[1] : content);
        if (!isObject(data) || data.v !== 1 || !isObject(data.settings)) return null;
        const rows = emptyCard().settings;
        for (const row of SETTING_ROWS) {
            rows[row.id].on = false;
            if (!Object.hasOwn(data.settings, row.key)) continue;
            const value = data.settings[row.key];
            if (settingRowValid(row, value)) {
                rows[row.id].on = true;
                rows[row.id].value = value;
            } else {
                // Said, not dropped silently: the pick note lists what was left out.
                const shown = `${row.label} ${typeof value === 'number' ? `${value}${row.unit ?? ''}` : JSON.stringify(value)}`;
                left.push(row.kind === 'number' && typeof value === 'number' && Number.isInteger(value) && value >= row.min && value <= row.max
                    ? `${shown} is not a step of ${row.step}; left out` : `${shown} is not a value this setting takes; left out`);
            }
        }
        return { rows, left };
    } catch { return null; }
}

// --- Writing a card ---------------------------------------------------------------------------------------------------------------

const utf8 = text => new TextEncoder().encode(text).length;
// What a rebuild would compute again and again while the writer types: kept per pack snapshot, picture or shrink result.
const packText = new WeakMap(), loreEntries = new WeakMap(), uris = new WeakMap(), portraitText = new WeakMap();
const cached = (table, key, make) => { if (!table.has(key)) table.set(key, make()); return table.get(key); };
export const jsonBytes = value => utf8(JSON.stringify(value));

/** The text fields as the card holds them now: the pack's, changed by what was written. */
export function fieldValues(pack, card) {
    const defaults = narratorFields(pack);
    return Object.fromEntries(TEXT_KEYS.map(key => [key, Object.hasOwn(card.fields, key) ? card.fields[key] : defaults[key]]));
}

/** A lorebook entry in the V2 card's own shape, from SillyTavern's World Info shape (the one the Lorebook page builds). */
function v2Entry(entry, id) {
    return {
        id, keys: [...entry.key], secondary_keys: [...(entry.keysecondary ?? [])], comment: entry.comment, name: entry.comment,
        content: entry.content, constant: entry.constant, selective: entry.selective, insertion_order: entry.order, enabled: !entry.disable,
        position: 'before_char', priority: entry.order, case_sensitive: entry.caseSensitive,
        extensions: {
            position: entry.position, exclude_recursion: entry.excludeRecursion, display_index: entry.displayIndex, probability: entry.probability,
            useProbability: entry.useProbability, depth: entry.depth, selectiveLogic: entry.selectiveLogic, group: entry.group, group_override: entry.groupOverride,
            group_weight: entry.groupWeight, prevent_recursion: entry.preventRecursion, delay_until_recursion: entry.delayUntilRecursion,
            scan_depth: entry.scanDepth, match_whole_words: entry.matchWholeWords, use_group_scoring: false, case_sensitive: entry.caseSensitive,
            ...entry.extensions,
        },
    };
}

/** A disabled entry that carries Story Suite data: the tag is in the title (Title/Memo), the content is JSON. */
function suiteEntry(tag, pack, content, id) {
    const comment = `${tag} ${text(pack?.name)}`.trim();
    return {
        id, keys: [], secondary_keys: [], comment, name: comment, content, constant: false, selective: false, insertion_order: 100, enabled: false,
        position: 'before_char', priority: 100, case_sensitive: false,
        extensions: { position: 0, exclude_recursion: true, display_index: id, probability: 100, useProbability: true, depth: 4, selectiveLogic: 0,
            group: '', group_override: false, group_weight: 100, prevent_recursion: true, delay_until_recursion: false, scan_depth: null,
            match_whole_words: null, use_group_scoring: false, case_sensitive: null },
    };
}

const dataUri = (bytes, type) => {
    return cached(uris, bytes, () => {
        let binary = '';
        for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
        return `data:${PORTRAIT_TYPES[type] ?? 'image/webp'};base64,${btoa(binary)}`;
    });
};

// Only the files are cached; the pack's id and version are read on every build, so a new version is never left out of the entry.
function portraitsContent(pack, portraits) {
    const files = cached(portraitText, portraits, () => JSON.stringify(Object.fromEntries(portraits.files.map(file => [file.name, dataUri(file.bytes, file.type)]))));
    return `{"v":1,"pack":${JSON.stringify(pack.id)},"version":${JSON.stringify(pack.version)},"files":${files}}`;
}

/**
 * The pictures a card carries: every held portrait the cast names, shrunk by `shrink(bytes, name) -> { bytes, type }` (the browser
 * shrinks to webp of 40 KB or less; tests give their own). → `{ files: [{ name, bytes, type }], lines }`. A picture the shrink
 * refuses, or that would break the entry's limits (24 files, 200 KB each, 3 MB together), is left out with a line saying why.
 */
export async function shrinkPortraits(model, shrink, limits = PORTRAIT_ENTRY_LIMITS) {
    const files = [], lines = [];
    let total = 0;
    for (const { name, picture } of zipPortraits(model).files) {
        if (files.length >= limits.files) { lines.push(`${name} left out: a card holds at most ${limits.files} portraits`); continue; }
        let out;
        try { out = await shrink(picture.bytes, name); } catch (err) { lines.push(`${name} left out: ${err?.message || 'it could not be shrunk'}`); continue; }
        if (!out?.bytes?.length) { lines.push(`${name} left out: it could not be shrunk`); continue; }
        if (out.bytes.length > limits.fileBytes) { lines.push(`${name} left out: ${Math.round(out.bytes.length / 1024)} KB is over ${Math.round(limits.fileBytes / 1024)} KB`); continue; }
        if (total + out.bytes.length > limits.totalBytes) { lines.push(`${name} left out: the portraits would pass ${Math.round(limits.totalBytes / 1024 / 1024)} MB together`); continue; }
        total += out.bytes.length;
        files.push({ name, bytes: out.bytes, type: out.type });
    }
    return { files, lines };
}

/** The values of the ticked settings rows, as `{ 'owner.key': value }`. */
export function settingValues(card) {
    const values = {};
    for (const row of SETTING_ROWS) {
        const given = card.settings[row.id];
        if (given?.on && settingRowValid(row, given.value)) values[row.key] = given.value;
    }
    return values;
}

/** The parts of "Put in the card", in order, with whether the pack can give them. */
export const PARTS = Object.freeze(['pack', 'lore', 'portraits', 'statusBar', 'settings', 'ownLore']);

/**
 * The card for these inputs → `{ card, json, parts }`. `portraits` is shrinkPortraits' answer (or null when not shrunk yet).
 * Throws an Error in plain words when the card cannot be written (a blank name, a talkativeness outside 0 to 1, an invalid pack).
 * `parts` says which parts went in. `json` is the one text both the .json download and the PNG's `chara` chunk hold.
 */
export function buildCard(model, card, { portraits = null, only = PARTS } = {}) {
    const pack = model?.document;
    if (!pack || typeof pack !== 'object') throw new Error('Open a pack first');
    const fields = fieldValues(pack, card);
    if (!fields.name.trim()) throw new Error('Card name must not be empty');
    let talk;
    if (card.talkativeness.trim() !== '') {
        talk = numeric(card.talkativeness.trim());
        if (talk === null || talk < 0 || talk > 1) throw new Error('Talkativeness must be a number from 0 to 1');
    }
    const extensions = { ...card.extras };
    if (talk !== undefined) extensions.talkativeness = talk;
    if (card.note.prompt.trim() !== '') extensions.depth_prompt = { prompt: card.note.prompt, depth: card.note.depth, role: card.note.role };
    const included = new Set(only.filter(part => card.include[part]));
    const parts = [];
    const entries = [];
    const generated = new Set();
    const byPart = {};
    const add = (part, make) => {
        if (!included.has(part)) return;
        const made = make();
        if (!made) return;
        parts.push(part);
        byPart[part] = made;
        if (part !== 'ownLore') for (const entry of made) generated.add(entry);
        entries.push(...made);
    };
    // A pack with problems cannot go in: the page shows the part as unavailable, and it is left out here.
    add('pack', () => model.validation?.ok ? [suiteEntry(TAGS.pack, pack, cached(packText, model, () => exportPack(model)), 0)] : null);
    add('lore', () => {
        // Cached per pack snapshot; the entries are copied, because each build numbers its own.
        const lore = cached(loreEntries, pack, () => Object.values(worldInfo(pack).entries).map(entry => v2Entry(entry, 0)));
        return lore.length ? lore.map(entry => ({ ...entry, extensions: { ...entry.extensions } })) : null;
    });
    add('portraits', () => portraits?.files.length ? [suiteEntry(TAGS.portraits, pack, portraitsContent(pack, portraits), 0)] : null);
    if (included.has('statusBar')) {
        parts.push('statusBar');
        const kept = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts.filter(script => !(isObject(script) && script.id === STATUS_BAR.id)) : [];
        extensions.regex_scripts = [...kept, JSON.parse(JSON.stringify(STATUS_BAR))];
    }
    add('settings', () => {
        const values = settingValues(card);
        return Object.keys(values).length ? [suiteEntry(TAGS.settings, pack, JSON.stringify({ v: 1, settings: values }), 0)] : null;
    });
    add('ownLore', () => card.ownLore.length ? card.ownLore.map(entry => ({ ...JSON.parse(JSON.stringify(entry)), id: 0 })) : null);
    entries.forEach((entry, at) => {
        entry.id = at;
        if (generated.has(entry)) entry.extensions.display_index = at;
    });
    // With a lorebook embedded, a linked world would win over it in SillyTavern.
    if (entries.length) delete extensions.world;
    const data = {
        name: fields.name, description: fields.description, personality: fields.personality, scenario: fields.scenario, first_mes: fields.first_mes,
        mes_example: fields.mes_example, creator_notes: fields.creator_notes, system_prompt: fields.system_prompt,
        post_history_instructions: fields.post_history_instructions, alternate_greetings: card.greetings.filter(item => item.trim() !== ''),
        ...entries.length ? { character_book: { name: text(pack.name), description: '', recursive_scanning: false, extensions: {}, entries } } : {},
        tags: [...card.tags], creator: fields.creator, character_version: fields.character_version, extensions,
    };
    const value = { spec: 'chara_card_v2', spec_version: '2.0', data };
    return { card: value, json: JSON.stringify(value) + '\n', parts, entries: byPart };
}

/**
 * What each part adds to the card, in bytes of its JSON, plus the whole: `{ rows: { part: bytes }, base, total, png, parts }`.
 * A part's size is its entries as they sit in the card (each with its comma); the status bar's is its script. `base` is the rest (the
 * fields and the wrappers), so base + the rows = total exactly. `png` is the size of the card PNG for `image` (PNG bytes; the default
 * cover when null): the card as base64 plus the picture. The card is built once.
 */
export function cardSizes(model, card, { portraits = null, image = null } = {}) {
    const full = buildCard(model, card, { portraits });
    const rows = {};
    for (const part of full.parts) {
        rows[part] = part === 'statusBar' ? jsonBytes(STATUS_BAR) + 1 : full.entries[part].reduce((sum, entry) => sum + jsonBytes(entry) + 1, 0);
    }
    const total = utf8(full.json);
    return { rows, base: total - Object.values(rows).reduce((a, b) => a + b, 0), total, png: exportCardPng(full.json, image).length, parts: full.parts };
}

export { STATUS_BAR };
