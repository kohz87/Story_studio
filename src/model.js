// Pack model: openPack, exportPack, and indexReferences (pure).

import { validatePack } from './data-modules/sb-adapter.js';
import { lastingProblems } from './timeline/lasting.js';
import { LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { foldKey } from '../vendor/story-block/src/text.js';
import { identity } from './identity.js';

const MAX_DEPTH = LIMITS.depth;
const MAX_ARRAY = LIMITS.array;
const MAX_KEYS = LIMITS.keys;
const MAX_STRING = LIMITS.string;
const MAX_BYTES = LIMITS.packBytes;
// Original text belongs to the frozen snapshot; undo restores the same snapshot and bytes.
const sourceTexts = new WeakMap();
// Drafts (events written with an AI, not yet kept) travel with a snapshot but are no part of its pack: they are not in
// `document`, its validation or its export. A snapshot an edit makes takes its predecessor's drafts (see inheritDrafts).
const draftTable = new WeakMap();

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Deeply freezes an object, array, and nested structures recursively without mutation. */
function deepFreeze(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    if (seen.has(value)) return value;
    seen.add(value);
    Object.freeze(value);
    for (const key of Object.keys(value)) {
        const val = value[key];
        if (val !== null && typeof val === 'object') {
            deepFreeze(val, seen);
        }
    }
    return value;
}

/**
 * Safely clones plain JSON objects/arrays without invoking property getters,
 * bounded by shared limits (depth 16, array 1000, keys 200, string 4000, byte budget 512 KiB).
 * Treats seen as an active ancestor set for cycle detection.
 * Wraps in try/catch to return null on hostile proxy traps or unsupported input.
 * Returns null if unsafe or out-of-limits.
 */
function safeClone(value) {
    try {
        let totalBytes = 0;
        const seen = new Set();
        const encoder = new TextEncoder();

        function clone(val, depth, key = '') {
            if (val === null) {
                totalBytes += 4;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: null };
            }

            const type = typeof val;
            if (type === 'boolean') {
                totalBytes += val ? 4 : 5;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: val };
            }

            if (type === 'number') {
                if (!Number.isFinite(val)) return null;
                totalBytes += encoder.encode(JSON.stringify(val)).length;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: val };
            }

            if (type === 'string') {
                if (val.length > (key === 'template' || key === 'css' ? LIMITS.code : MAX_STRING)) return null;
                totalBytes += encoder.encode(JSON.stringify(val)).length;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: val };
            }

            if (type !== 'object') {
                return null;
            }

            // Primitive leaves at depth 16 are allowed; object/array nodes at or beyond depth 16 are rejected.
            if (depth >= MAX_DEPTH) return null;

            const proto = Object.getPrototypeOf(val);
            if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
                return null;
            }

            if (seen.has(val)) {
                return null;
            }

            seen.add(val);

            try {
                if (Array.isArray(val)) {
                    if (val.length > MAX_ARRAY) return null;
                    const ownKeys = Reflect.ownKeys(val);
                    if (ownKeys.length !== val.length + 1) return null;

                    totalBytes += 1; // '['
                    if (totalBytes > MAX_BYTES) return null;

                    const out = [];
                    for (let i = 0; i < val.length; i++) {
                        if (i > 0) {
                            totalBytes += 1; // ','
                            if (totalBytes > MAX_BYTES) return null;
                        }
                        const desc = Object.getOwnPropertyDescriptor(val, String(i));
                        if (!desc || !desc.enumerable || desc.get || desc.set) return null;
                        const res = clone(desc.value, depth + 1, key);
                        if (!res || !res.ok) return null;
                        out.push(res.value);
                    }
                    totalBytes += 1; // ']'
                    if (totalBytes > MAX_BYTES) return null;
                    return { ok: true, value: out };
                }

                const ownKeys = Reflect.ownKeys(val);
                if (ownKeys.length > MAX_KEYS) return null;

                for (const key of ownKeys) {
                    if (typeof key !== 'string' || UNSAFE_KEYS.has(key)) return null;
                }

                totalBytes += 1; // '{'
                if (totalBytes > MAX_BYTES) return null;

                const out = {};
                for (let i = 0; i < ownKeys.length; i++) {
                    const key = ownKeys[i];
                    if (key.length > MAX_STRING) return null;

                    if (i > 0) {
                        totalBytes += 1; // ','
                        if (totalBytes > MAX_BYTES) return null;
                    }

                    const keyBytes = encoder.encode(JSON.stringify(key)).length;
                    totalBytes += keyBytes + 1; // "key":
                    if (totalBytes > MAX_BYTES) return null;

                    const desc = Object.getOwnPropertyDescriptor(val, key);
                    if (!desc || !desc.enumerable || desc.get || desc.set) return null;
                    const res = clone(desc.value, depth + 1, key);
                    if (!res || !res.ok) return null;
                    out[key] = res.value;
                }
                totalBytes += 1; // '}'
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: out };
            } finally {
                seen.delete(val);
            }
        }

        const result = clone(value, 0);
        if (!result || !result.ok) return null;

        const text = JSON.stringify(result.value);
        if (encoder.encode(text).length > MAX_BYTES) return null;

        return result.value;
    } catch {
        return null;
    }
}

/** Helper to push a reference if targetId is present. */
function addRef(refs, kind, id, path, targetKind, targetId) {
    if (typeof targetId === 'string' && targetId) {
        refs.push({ kind, id, path, targetKind, targetId });
    }
}

/**
 * Indexes typed references in a pack document in traversal order.
 * Returns an array of { kind, id, path, targetKind, targetId }.
 */
export function indexReferences(document) {
    if (!document || typeof document !== 'object') return [];

    const safeDoc = safeClone(document);
    if (!safeDoc || typeof safeDoc !== 'object') return [];

    const packId = typeof safeDoc.id === 'string' && safeDoc.id ? safeDoc.id : 'pack';
    const prefix = `pack.${packId}/`;

    function toFull(ref) {
        if (typeof ref !== 'string' || !ref) return ref;
        if (!ref.startsWith('pack.') && !ref.startsWith('story/')) {
            return `${prefix}${ref}`;
        }
        return ref;
    }

    const contentPlaces = Array.isArray(safeDoc.content?.places) ? safeDoc.content.places : [];
    const placeSlugMap = new Map();
    for (const p of contentPlaces) {
        if (!p || typeof p !== 'object') continue;
        const slug = identity(p, 'places');
        const keys = [slug, ...[p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]
            .filter(value => typeof value === 'string').map(foldKey)];
        for (const key of keys) {
            if (key && !placeSlugMap.has(key)) placeSlugMap.set(key, slug);
        }
    }

    function resolvePlaceRef(ref) {
        if (typeof ref !== 'string' || !ref) return ref;
        if (ref.startsWith(prefix)) {
            const local = ref.slice(prefix.length);
            if (placeSlugMap.has(local)) return `${prefix}${placeSlugMap.get(local)}`;
            return ref;
        }
        if (ref.startsWith('pack.') || ref.startsWith('story/') || ref.includes('/')) return ref;
        const slug = placeSlugMap.get(ref) ?? placeSlugMap.get(foldKey(ref));
        if (slug) return `${prefix}${slug}`;
        return ref;
    }

    const contentItems = Array.isArray(safeDoc.content?.items) ? safeDoc.content.items : [];
    const itemLookup = new Map();
    for (const it of contentItems) {
        if (!it || typeof it !== 'object') continue;
        const key = identity(it, 'items');
        const targetId = toFull(key || it.id);
        if (it.id) itemLookup.set(it.id, targetId);
        if (key) itemLookup.set(key, targetId);
        if (it.name) {
            itemLookup.set(it.name, targetId);
            itemLookup.set(it.name.trim().toLowerCase(), targetId);
        }
        if (Array.isArray(it.aliases)) {
            for (const alias of it.aliases) {
                if (typeof alias === 'string' && alias.trim()) {
                    itemLookup.set(alias, targetId);
                    itemLookup.set(alias.trim().toLowerCase(), targetId);
                }
            }
        }
    }

    function resolveStartItemRef(ref) {
        if (typeof ref !== 'string' || !ref) return ref;
        if (ref.startsWith('pack.') || ref.startsWith('story/') || (ref.includes('/') && !ref.includes(' '))) {
            return ref;
        }
        if (itemLookup.has(ref)) return itemLookup.get(ref);
        const folded = ref.trim().toLowerCase();
        if (itemLookup.has(folded)) return itemLookup.get(folded);
        return toFull(ref);
    }

    const contentRaces = Array.isArray(safeDoc.content?.races) ? safeDoc.content.races : [];
    const raceLookup = new Map();
    for (const r of contentRaces) {
        if (!r || typeof r !== 'object') continue;
        const key = identity(r, 'races');
        const targetId = toFull(key || r.id);
        if (r.id) raceLookup.set(r.id, targetId);
        if (key) raceLookup.set(key, targetId);
        if (r.name) {
            raceLookup.set(r.name, targetId);
            raceLookup.set(r.name.trim().toLowerCase(), targetId);
        }
    }

    function resolveRaceRef(ref) {
        if (typeof ref !== 'string' || !ref) return ref;
        if (ref.startsWith('pack.') || ref.startsWith('story/')) return ref;
        if (raceLookup.has(ref)) return raceLookup.get(ref);
        const folded = ref.trim().toLowerCase();
        if (raceLookup.has(folded)) return raceLookup.get(folded);
        return toFull(ref);
    }

    const contentTalents = Array.isArray(safeDoc.content?.talents) ? safeDoc.content.talents : [];
    const talentLookup = new Map();
    for (const t of contentTalents) {
        if (!t || typeof t !== 'object') continue;
        const key = identity(t, 'talents');
        const targetId = toFull(key || t.id);
        if (t.id) talentLookup.set(t.id, targetId);
        if (key) talentLookup.set(key, targetId);
        if (t.name) {
            talentLookup.set(t.name, targetId);
            talentLookup.set(t.name.trim().toLowerCase(), targetId);
        }
    }

    function resolveTalentRef(ref) {
        if (typeof ref !== 'string' || !ref) return ref;
        if (ref.startsWith('pack.') || ref.startsWith('story/')) return ref;
        if (talentLookup.has(ref)) return talentLookup.get(ref);
        const folded = ref.trim().toLowerCase();
        if (talentLookup.has(folded)) return talentLookup.get(folded);
        return toFull(ref);
    }

    const contentLegacySkills = Array.isArray(safeDoc.content?.skills) ? safeDoc.content.skills : [];
    const legacySkillLookup = new Map();
    for (const s of contentLegacySkills) {
        if (!s || typeof s !== 'object') continue;
        const key = identity(s, 'legacySkills');
        const targetId = toFull(key || s.id);
        if (s.id) legacySkillLookup.set(s.id, targetId);
        if (key) legacySkillLookup.set(key, targetId);
        if (s.name) {
            legacySkillLookup.set(s.name, targetId);
            legacySkillLookup.set(s.name.trim().toLowerCase(), targetId);
        }
    }

    function resolveLegacySkillRef(ref) {
        if (typeof ref !== 'string' || !ref) return ref;
        if (ref.startsWith('pack.') || ref.startsWith('story/')) return ref;
        if (legacySkillLookup.has(ref)) return legacySkillLookup.get(ref);
        const folded = ref.trim().toLowerCase();
        if (legacySkillLookup.has(folded)) return legacySkillLookup.get(folded);
        return toFull(ref);
    }

    const refs = [];

    if (Array.isArray(safeDoc.content?.creatures)) {
        for (let cIdx = 0; cIdx < safeDoc.content.creatures.length; cIdx++) {
            const foe = safeDoc.content.creatures[cIdx];
            if (!foe || typeof foe !== 'object') continue;
            const ownerId = toFull(identity(foe, 'creatures') || `creature-${cIdx}`);

            if (Array.isArray(foe.skills)) {
                for (let sIdx = 0; sIdx < foe.skills.length; sIdx++) {
                    const sRef = foe.skills[sIdx];
                    if (typeof sRef === 'string') {
                        addRef(refs, 'creatures', ownerId, ['content', 'creatures', cIdx, 'skills', sIdx], 'skills', toFull(sRef));
                    }
                }
            }

            if (Array.isArray(foe.loot)) {
                for (let lIdx = 0; lIdx < foe.loot.length; lIdx++) {
                    const loot = foe.loot[lIdx];
                    if (loot && typeof loot === 'object' && loot.def) {
                        addRef(refs, 'creatures', ownerId, ['content', 'creatures', cIdx, 'loot', lIdx, 'def'], 'items', toFull(loot.def));
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.quests)) {
        for (let qIdx = 0; qIdx < safeDoc.content.quests.length; qIdx++) {
            const q = safeDoc.content.quests[qIdx];
            if (!q || typeof q !== 'object') continue;
            const ownerId = toFull(identity(q, 'quests') || `quest-${qIdx}`);

            // quest.giver is explicitly an external NSD NPC ID (§7), NOT a creature reference.
            if (q.giver) {
                addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'giver'], 'npcs', q.giver);
            }

            if (q.turnInPlace) {
                addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'turnInPlace'], 'places', resolvePlaceRef(q.turnInPlace));
            }

            if (Array.isArray(q.requirements)) {
                for (let rIdx = 0; rIdx < q.requirements.length; rIdx++) {
                    const req = q.requirements[rIdx];
                    if (!req || typeof req !== 'object') continue;

                    if (req.kind === 'item' && req.def) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'def'], 'items', toFull(req.def));
                    } else if (req.kind === 'quest' && req.template) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'template'], 'quests', toFull(req.template));
                    } else if (req.kind === 'place' && req.place) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'place'], 'places', resolvePlaceRef(req.place));
                    } else if (req.kind === 'thread' && req.thread) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'thread'], 'threads', req.thread);
                    }
                }
            }

            if (Array.isArray(q.objectives)) {
                for (let oIdx = 0; oIdx < q.objectives.length; oIdx++) {
                    const obj = q.objectives[oIdx];
                    if (!obj || typeof obj !== 'object') continue;

                    if (obj.kind === 'kill' && obj.foe) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'objectives', oIdx, 'foe'], 'creatures', toFull(obj.foe));
                    } else if (obj.kind === 'collect' && obj.def) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'objectives', oIdx, 'def'], 'items', toFull(obj.def));
                    } else if (obj.kind === 'visit' && obj.place) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'objectives', oIdx, 'place'], 'places', resolvePlaceRef(obj.place));
                    }
                }
            }

            if (Array.isArray(q.reward?.items)) {
                for (let riIdx = 0; riIdx < q.reward.items.length; riIdx++) {
                    const ri = q.reward.items[riIdx];
                    if (ri && typeof ri === 'object' && ri.def) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'reward', 'items', riIdx, 'def'], 'items', toFull(ri.def));
                    }
                }
            }

            if (q.chain && typeof q.chain === 'object') {
                if (q.chain.previous) {
                    addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'chain', 'previous'], 'quests', toFull(q.chain.previous));
                }
                if (q.chain.next) {
                    addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'chain', 'next'], 'quests', toFull(q.chain.next));
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.shops)) {
        for (let sIdx = 0; sIdx < safeDoc.content.shops.length; sIdx++) {
            const shp = safeDoc.content.shops[sIdx];
            if (!shp || typeof shp !== 'object') continue;
            const ownerId = toFull(identity(shp, 'shops') || `shop-${sIdx}`);

            if (shp.place) {
                addRef(refs, 'shops', ownerId, ['content', 'shops', sIdx, 'place'], 'places', resolvePlaceRef(shp.place));
            }

            if (Array.isArray(shp.stock)) {
                for (let stIdx = 0; stIdx < shp.stock.length; stIdx++) {
                    const stock = shp.stock[stIdx];
                    const itemRef = typeof stock === 'string' ? stock : (stock && typeof stock === 'object' ? stock.item : null);
                    if (itemRef) {
                        addRef(
                            refs,
                            'shops',
                            ownerId,
                            typeof stock === 'string'
                                ? ['content', 'shops', sIdx, 'stock', stIdx]
                                : ['content', 'shops', sIdx, 'stock', stIdx, 'item'],
                            'items',
                            toFull(itemRef)
                        );
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.recipes)) {
        for (let rIdx = 0; rIdx < safeDoc.content.recipes.length; rIdx++) {
            const rcp = safeDoc.content.recipes[rIdx];
            if (!rcp || typeof rcp !== 'object') continue;
            const ownerId = toFull(identity(rcp, 'recipes') || `recipe-${rIdx}`);

            if (rcp.makes) {
                addRef(refs, 'recipes', ownerId, ['content', 'recipes', rIdx, 'makes'], 'items', toFull(rcp.makes));
            }

            if (Array.isArray(rcp.materials)) {
                for (let mIdx = 0; mIdx < rcp.materials.length; mIdx++) {
                    const mat = rcp.materials[mIdx];
                    if (mat && typeof mat === 'object' && mat.item) {
                        addRef(refs, 'recipes', ownerId, ['content', 'recipes', rIdx, 'materials', mIdx, 'item'], 'items', toFull(mat.item));
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.routes)) {
        for (let rtIdx = 0; rtIdx < safeDoc.content.routes.length; rtIdx++) {
            const route = safeDoc.content.routes[rtIdx];
            if (!route || typeof route !== 'object') continue;
            const ownerId = toFull(identity(route, 'routes') || `route-${rtIdx}`);

            if (route.from) {
                addRef(refs, 'routes', ownerId, ['content', 'routes', rtIdx, 'from'], 'places', resolvePlaceRef(route.from));
            }
            if (route.to) {
                addRef(refs, 'routes', ownerId, ['content', 'routes', rtIdx, 'to'], 'places', resolvePlaceRef(route.to));
            }
        }
    }

    if (Array.isArray(safeDoc.content?.events)) {
        for (let eIdx = 0; eIdx < safeDoc.content.events.length; eIdx++) {
            const evt = safeDoc.content.events[eIdx];
            if (!evt || typeof evt !== 'object') continue;
            const ownerId = toFull(identity(evt, 'events') || `event-${eIdx}`);

            if (evt.after) {
                addRef(refs, 'events', ownerId, ['content', 'events', eIdx, 'after'], 'events', toFull(evt.after));
            }
        }
    }

    if (Array.isArray(safeDoc.content?.presets)) {
        for (let pIdx = 0; pIdx < safeDoc.content.presets.length; pIdx++) {
            const prs = safeDoc.content.presets[pIdx];
            if (!prs || typeof prs !== 'object') continue;
            const ownerId = toFull(identity(prs, 'presets') || `preset-${pIdx}`);

            if (prs.race && typeof prs.race === 'string') {
                addRef(refs, 'presets', ownerId, ['content', 'presets', pIdx, 'race'], 'races', resolveRaceRef(prs.race));
            }

            if (Array.isArray(prs.talents)) {
                for (let tIdx = 0; tIdx < prs.talents.length; tIdx++) {
                    const tRef = prs.talents[tIdx];
                    if (typeof tRef === 'string') {
                        addRef(refs, 'presets', ownerId, ['content', 'presets', pIdx, 'talents', tIdx], 'talents', resolveTalentRef(tRef));
                    }
                }
            }

            // Presets refer to the host's content.skills collection.
            if (Array.isArray(prs.skills)) {
                for (let sIdx = 0; sIdx < prs.skills.length; sIdx++) {
                    const sRef = prs.skills[sIdx];
                    if (typeof sRef === 'string') {
                        addRef(refs, 'presets', ownerId, ['content', 'presets', pIdx, 'skills', sIdx], 'legacySkills', resolveLegacySkillRef(sRef));
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.start?.inventory?.items)) {
        const ownerId = `${prefix}start`;
        for (let iIdx = 0; iIdx < safeDoc.start.inventory.items.length; iIdx++) {
            const entry = safeDoc.start.inventory.items[iIdx];
            const itemRef = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.item : null);
            if (itemRef && typeof itemRef === 'string') {
                addRef(
                    refs,
                    'start',
                    ownerId,
                    typeof entry === 'string'
                        ? ['start', 'inventory', 'items', iIdx]
                        : ['start', 'inventory', 'items', iIdx, 'item'],
                    'items',
                    resolveStartItemRef(itemRef)
                );
            }
        }
    }

    return refs;
}

// The host owns acceptance, including the envelope's looser text rules and ordinary packs.
function checkPack(input) {
    try { return validatePack(input); }
    catch { return { ok: false, errors: [{ code: 'NOT_PLAIN', path: '', message: 'Cannot read pack data' }] }; }
}

const isObjectLike = value => value !== null && typeof value === 'object';

/** The drafts a snapshot carries, `{ record, notes, seen }` each (see timeline/drafts.js); none for a snapshot made without. */
export function draftsOf(model) { return (isObjectLike(model) && draftTable.get(model)) || NO_DRAFTS; }
const NO_DRAFTS = Object.freeze([]);

/** A new snapshot of the same pack carrying `drafts`: the pack, its validation and the bytes it exports stay as they are. */
export function withDrafts(model, drafts) {
    const next = Object.freeze({ ...model });
    if (sourceTexts.has(model)) sourceTexts.set(next, sourceTexts.get(model));
    draftTable.set(next, Object.freeze([...drafts]));
    return next;
}

/** Gives `next` the drafts of the snapshot it came from `from`, unless it has some of its own; used when an edit is committed. */
export function inheritDrafts(next, from) {
    if (next === from || !isObjectLike(next) || !isObjectLike(from) || draftTable.has(next) || !draftTable.has(from)) return;
    draftTable.set(next, draftTable.get(from));
}

/** Original file text retained for draft persistence; absent for object inputs and edited snapshots. */
export function sourceTextOf(model) { return sourceTexts.get(model); }

/** Opens a pack as an immutable editing snapshot with the host's validation and fingerprints. */
export function openPack(json) {
    const checked = checkPack(json);
    let document = null;
    if (checked.ok) {
        // Edit the detached authored structure, never the host's normalized runtime copy.
        // Normalization can merge distinct keys even when both fingerprints stay equal.
        document = checked.raw;
    } else {
        let parsed = json;
        if (typeof json === 'string') {
            if (new TextEncoder().encode(json).length > MAX_BYTES) parsed = null;
            else {
                try { parsed = JSON.parse(json.replace(/^\uFEFF/, '')); }
                catch { parsed = null; }
            }
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) document = safeClone(parsed);
    }
    // Story Block does not know the commands of other modules; Story Director refuses a lasting change outside its limits, so it is flagged here.
    const lasting = document ? lastingProblems(document) : [];
    const model = deepFreeze({
        document,
        validation: { ok: checked.ok && !lasting.length, errors: [...checked.errors ?? [], ...lasting], warnings: checked.warnings ?? [] },
        references: document ? indexReferences(document) : [],
        packHash: checked.ok ? checked.packHash ?? null : null,
    });
    if (checked.ok && typeof json === 'string') sourceTexts.set(model, json);
    return model;
}

/**
 * Exports original file bytes, or deterministic host-valid JSON for an edited/object snapshot.
 * Throws Error with an `errors` property on invalid models.
 */
export function exportPack(model) {
    if (!model || !model.document || typeof model.document !== 'object') {
        const err = new Error('Cannot export invalid pack');
        err.errors = model?.validation?.errors || [{
            code: 'bad-schema',
            path: '',
            message: 'Model document is missing or not an object',
        }];
        throw err;
    }

    if (model.validation && !model.validation.ok) {
        const err = new Error('Cannot export invalid pack');
        err.errors = model.validation.errors;
        throw err;
    }

    const source = sourceTexts.get(model);
    const checked = checkPack(source ?? model.document);
    if (!checked.ok) {
        const err = new Error('Cannot export invalid pack');
        err.errors = checked.errors;
        throw err;
    }

    if (source !== undefined) return source;
    // Serialize raw data so unrelated edits cannot re-key, trim, or add defaults to subtrees.
    const document = checked.raw;
    const pretty = JSON.stringify(document, null, 2) + '\n';
    if (new TextEncoder().encode(pretty).length <= MAX_BYTES) return pretty;
    return JSON.stringify(document);
}
