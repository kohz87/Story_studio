import { add } from './edits.js';
import { LIMITS, RECORD_LIMITS, SLUG } from '../vendor/story-block/src/v2/packs/limits.js';
import { slugify } from '../vendor/story-block/src/v2/packs/validate.js';

export const MAX_LORE_BYTES = 2 * 1024 * 1024;
const KINDS = ['places', 'factions', 'npcs', 'creatures', 'items'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];

// Text only, including nested text fields; never resolve references or consult another pack.
function textLines(record, prefix = '') {
    const result = [];
    for (const key of Object.keys(record).sort()) {
        if (['slug', 'id', 'pack', 'aliases'].includes(key)) continue;
        const value = record[key];
        const label = prefix + key;
        if (typeof value === 'string' && value) result.push(`${label}: ${value}`);
        else if (Array.isArray(value)) {
            const strings = value.filter(entry => typeof entry === 'string');
            if (strings.length) result.push(`${label}: ${strings.join(', ')}`);
            value.forEach((entry, index) => { if (isObject(entry)) result.push(...textLines(entry, `${label}.${index}.`)); });
        } else if (isObject(value)) result.push(...textLines(value, `${label}.`));
    }
    return result;
}

export function worldInfo(pack) {
    if (!isObject(pack)) throw new Error('Open a pack first');
    const entries = {};
    let uid = 0;
    for (const kind of KINDS) {
        const records = pack.content?.[kind];
        if (records === undefined) continue;
        if (!Array.isArray(records)) throw new Error(`${kind}: collection must be an array`);
        for (const record of records) {
            if (!isObject(record)) throw new Error(`${kind}: record must be an object`);
            if (!text(record.name).trim()) throw new Error(`${kind}: record needs a name`);
            entries[uid] = {
                uid, key: unique([record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])]),
                keysecondary: [], comment: record.name, content: textLines(record).join('\n'),
                constant: false, selective: false, selectiveLogic: 0, order: 100, position: 0,
                disable: false, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: false,
                probability: 100, useProbability: true, depth: 4, group: '', groupOverride: false,
                groupWeight: 100, scanDepth: null, caseSensitive: false, matchWholeWords: true,
                displayIndex: uid, extensions: { story_studio: { kind } },
            };
            uid++;
        }
    }
    return { entries };
}

export function exportWorldInfo(pack) { return JSON.stringify(worldInfo(pack), null, 2) + '\n'; }

export function importWorldInfo(source) {
    if (typeof source !== 'string') throw new Error('World Info must be JSON text');
    if (new TextEncoder().encode(source).length > MAX_LORE_BYTES) throw new Error('World Info exceeds 2 MiB');
    const root = JSON.parse(source.replace(/^\uFEFF/, ''), (key, value) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Unsafe key: ${key}`);
        return value;
    });
    if (!isObject(root) || !(isObject(root.entries) || Array.isArray(root.entries))) throw new Error('World Info needs an entries object or array');
    const entries = Object.entries(root.entries);
    if (entries.length > LIMITS.array) throw new Error(`World Info has more than ${LIMITS.array} entries`);
    return entries.map(([id, entry]) => {
        const errors = [];
        if (!isObject(entry)) errors.push('Entry must be an object');
        const keys = Array.isArray(entry?.key) ? entry.key : [];
        if (!Array.isArray(entry?.key) || keys.some(key => typeof key !== 'string')) errors.push('key must be an array of text');
        if (typeof entry?.content !== 'string') errors.push('content must be text');
        const name = text(keys[0]) || text(entry?.comment);
        if (!name.trim()) errors.push('Entry needs a name or a primary key');
        const sourceKind = entry?.extensions?.story_studio?.kind;
        const kind = sourceKind === 'items' ? 'items' : ['npcs', 'creatures'].includes(sourceKind) ? 'creatures' : 'places';
        const content = text(entry?.content);
        return {
            id, comment: text(entry?.comment), status: errors.length ? 'refused' : 'pending', errors,
            draft: { kind, name, slug: slugify(name) || 'lore-entry',
                aliases: unique(keys.slice(1)), content, region: /^region:\s*(.*)$/mi.exec(content)?.[1] ?? '' },
        };
    });
}

export function acceptLoreDraft(model, draft) {
    const errors = [];
    const fail = message => errors.push({ code: 'lore-draft', path: '', message });
    if (!['places', 'creatures', 'items'].includes(draft?.kind)) fail('Choose Place, NPC / creature or Item');
    if (typeof draft?.name !== 'string' || !draft.name.trim() || draft.name.length > LIMITS.name) fail(`Name must be 1–${LIMITS.name} characters`);
    if (typeof draft?.slug !== 'string' || !SLUG.test(draft.slug)) fail('ID must be a slug of at most 64 characters');
    if (typeof draft?.content !== 'string' || draft.content.length > RECORD_LIMITS.note) fail(`Text must be at most ${RECORD_LIMITS.note} characters; shorten the draft explicitly`);
    if (!Array.isArray(draft?.aliases) || draft.aliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.length > LIMITS.name)) fail('Aliases must be nonempty names of at most 80 characters');
    if (typeof draft?.region !== 'string' || draft.region.length > LIMITS.name) fail('Region must be text of at most 80 characters');
    if (errors.length) return { ok: false, model, errors };
    const existing = model?.document?.content?.[draft.kind];
    const prefix = `pack.${model?.document?.id}/`;
    if (Array.isArray(existing) && existing.some(record => {
        const id = record?.slug ?? record?.id ?? slugify(record?.name);
        return (typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : id) === draft.slug;
    })) return { ok: false, model, errors: [{ code: 'dup-id', path: '', message: `Duplicate ${draft.kind} id: ${draft.slug}` }] };
    const record = { name: draft.name, slug: draft.slug, aliases: [...draft.aliases], note: draft.content };
    if (draft.kind === 'places') Object.assign(record, { x: 0, y: 0, region: draft.region });
    if (draft.kind === 'items') Object.assign(record, { kind: 'goods', rarity: 'common', value: 0, stack: true });
    // NPCs are narrative creature drafts. Rules packs require combat fields to be authored afterward.
    return add(model, draft.kind, record);
}
