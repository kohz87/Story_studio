// Pack model: openPack, exportPack, and indexReferences (pure).

import {
    validateRulesPack,
    exportRulesV2,
    rulesV2Schema,
    RULES_V2_LIMITS,
} from '../vendor/story-block/src/v2/packs/rules-v2.js';
import { foldKey } from '../vendor/story-block/src/text.js';

export { rulesV2Schema };

const MAX_DEPTH = RULES_V2_LIMITS?.depth ?? 16;
const MAX_ARRAY = RULES_V2_LIMITS?.array ?? 1000;
const MAX_KEYS = RULES_V2_LIMITS?.keys ?? 200;
const MAX_STRING = RULES_V2_LIMITS?.string ?? 4000;
const MAX_BYTES = RULES_V2_LIMITS?.packBytes ?? (512 * 1024);
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

        function clone(val, depth) {
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
                if (val.length > MAX_STRING) return null;
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
                        const res = clone(desc.value, depth + 1);
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

                const sortedKeys = [...ownKeys].sort();
                totalBytes += 1; // '{'
                if (totalBytes > MAX_BYTES) return null;

                const out = {};
                for (let i = 0; i < sortedKeys.length; i++) {
                    const key = sortedKeys[i];
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
                    const res = clone(desc.value, depth + 1);
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
 * Indexes all typed references in a rules pack document in traversal order.
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
        const keys = [p.slug, ...[p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]
            .filter(value => typeof value === 'string').map(foldKey)];
        for (const key of keys) {
            if (key && !placeSlugMap.has(key)) placeSlugMap.set(key, p.slug);
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
        const targetId = toFull(it.slug || it.id);
        if (it.id) itemLookup.set(it.id, targetId);
        if (it.slug) itemLookup.set(it.slug, targetId);
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
        const targetId = toFull(r.slug || r.id);
        if (r.id) raceLookup.set(r.id, targetId);
        if (r.slug) raceLookup.set(r.slug, targetId);
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
        const targetId = toFull(t.slug || t.id);
        if (t.id) talentLookup.set(t.id, targetId);
        if (t.slug) talentLookup.set(t.slug, targetId);
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
        const targetId = toFull(s.slug || s.id);
        if (s.id) legacySkillLookup.set(s.id, targetId);
        if (s.slug) legacySkillLookup.set(s.slug, targetId);
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

    const rulesList = Array.isArray(safeDoc.content?.rules) ? safeDoc.content.rules : [];
    for (let rIdx = 0; rIdx < rulesList.length; rIdx++) {
        const m = rulesList[rIdx];
        if (!m || typeof m !== 'object') continue;

        if (Array.isArray(m.classes)) {
            for (let cIdx = 0; cIdx < m.classes.length; cIdx++) {
                const cls = m.classes[cIdx];
                if (!cls || typeof cls !== 'object') continue;
                const ownerId = toFull(cls.slug || cls.id || `class-${cIdx}`);

                if (cls.parent !== null && cls.parent !== undefined) {
                    addRef(refs, 'classes', ownerId, ['content', 'rules', rIdx, 'classes', cIdx, 'parent'], 'classes', toFull(cls.parent));
                }

                if (Array.isArray(cls.skills)) {
                    for (let sIdx = 0; sIdx < cls.skills.length; sIdx++) {
                        const sRef = cls.skills[sIdx];
                        if (typeof sRef === 'string') {
                            addRef(refs, 'classes', ownerId, ['content', 'rules', rIdx, 'classes', cIdx, 'skills', sIdx], 'skills', toFull(sRef));
                        }
                    }
                }
            }
        }

        if (Array.isArray(m.skills)) {
            for (let sIdx = 0; sIdx < m.skills.length; sIdx++) {
                const skl = m.skills[sIdx];
                if (!skl || typeof skl !== 'object') continue;
                const ownerId = toFull(skl.slug || skl.id || `skill-${sIdx}`);

                if (skl.replaces !== null && skl.replaces !== undefined) {
                    addRef(refs, 'skills', ownerId, ['content', 'rules', rIdx, 'skills', sIdx, 'replaces'], 'skills', toFull(skl.replaces));
                }

                if (skl.base && typeof skl.base === 'object' && skl.base.unit && typeof skl.base.unit === 'object') {
                    if (skl.base.unit.class) {
                        addRef(refs, 'skills', ownerId, ['content', 'rules', rIdx, 'skills', sIdx, 'base', 'unit', 'class'], 'classes', toFull(skl.base.unit.class));
                    }
                }
            }
        }

        if (Array.isArray(m.branches)) {
            for (let bIdx = 0; bIdx < m.branches.length; bIdx++) {
                const br = m.branches[bIdx];
                if (!br || typeof br !== 'object') continue;
                const ownerId = toFull(br.slug || br.id || `branch-${bIdx}`);

                if (br.skill) {
                    addRef(refs, 'branches', ownerId, ['content', 'rules', rIdx, 'branches', bIdx, 'skill'], 'skills', toFull(br.skill));
                }

                if (br.fromForm) {
                    addRef(refs, 'branches', ownerId, ['content', 'rules', rIdx, 'branches', bIdx, 'fromForm'], 'forms', toFull(br.fromForm));
                }
            }
        }

        if (Array.isArray(m.itemRules)) {
            for (let irIdx = 0; irIdx < m.itemRules.length; irIdx++) {
                const ir = m.itemRules[irIdx];
                if (!ir || typeof ir !== 'object') continue;
                const ownerId = toFull(ir.def || `itemRule-${irIdx}`);

                if (ir.def) {
                    addRef(refs, 'itemRules', ownerId, ['content', 'rules', rIdx, 'itemRules', irIdx, 'def'], 'items', toFull(ir.def));
                }
            }
        }

        if (Array.isArray(m.trainers)) {
            for (let tIdx = 0; tIdx < m.trainers.length; tIdx++) {
                const trn = m.trainers[tIdx];
                if (!trn || typeof trn !== 'object') continue;
                const ownerId = toFull(trn.slug || trn.id || `trainer-${tIdx}`);

                if (trn.place) {
                    addRef(refs, 'trainers', ownerId, ['content', 'rules', rIdx, 'trainers', tIdx, 'place'], 'places', resolvePlaceRef(trn.place));
                }

                if (Array.isArray(trn.skills)) {
                    for (let sIdx = 0; sIdx < trn.skills.length; sIdx++) {
                        const sRef = trn.skills[sIdx];
                        if (typeof sRef === 'string') {
                            addRef(refs, 'trainers', ownerId, ['content', 'rules', rIdx, 'trainers', tIdx, 'skills', sIdx], 'skills', toFull(sRef));
                        }
                    }
                }

                if (Array.isArray(trn.eventTemplates)) {
                    for (let eIdx = 0; eIdx < trn.eventTemplates.length; eIdx++) {
                        const eRef = trn.eventTemplates[eIdx];
                        if (typeof eRef === 'string') {
                            addRef(refs, 'trainers', ownerId, ['content', 'rules', rIdx, 'trainers', tIdx, 'eventTemplates', eIdx], 'events', toFull(eRef));
                        }
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.creatures)) {
        for (let cIdx = 0; cIdx < safeDoc.content.creatures.length; cIdx++) {
            const foe = safeDoc.content.creatures[cIdx];
            if (!foe || typeof foe !== 'object') continue;
            const ownerId = toFull(foe.slug || foe.id || `creature-${cIdx}`);

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
            const ownerId = toFull(q.slug || q.id || `quest-${qIdx}`);

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

                    if (req.kind === 'class' && Array.isArray(req.classes)) {
                        for (let clIdx = 0; clIdx < req.classes.length; clIdx++) {
                            const cRef = req.classes[clIdx];
                            if (typeof cRef === 'string') {
                                addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'classes', clIdx], 'classes', toFull(cRef));
                            }
                        }
                    } else if (req.kind === 'item' && req.def) {
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
            const ownerId = toFull(shp.slug || shp.id || `shop-${sIdx}`);

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
            const ownerId = toFull(rcp.slug || rcp.id || `recipe-${rIdx}`);

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
            const ownerId = toFull(route.slug || route.id || `route-${rtIdx}`);

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
            const ownerId = toFull(evt.slug || evt.id || `event-${eIdx}`);

            if (evt.after) {
                addRef(refs, 'events', ownerId, ['content', 'events', eIdx, 'after'], 'events', toFull(evt.after));
            }
        }
    }

    if (Array.isArray(safeDoc.content?.presets)) {
        for (let pIdx = 0; pIdx < safeDoc.content.presets.length; pIdx++) {
            const prs = safeDoc.content.presets[pIdx];
            if (!prs || typeof prs !== 'object') continue;
            const ownerId = toFull(prs.slug || prs.id || `preset-${pIdx}`);

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

            // Preset content.skills references legacy Story Block skills (content.skills),
            // not rules-v2 manifest skills. We use targetKind 'legacySkills' to prevent
            // S4 skill renaming from accidentally renaming legacy SB skills.
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

/**
 * Opens a rules pack from a JSON string or plain object.
 * Returns an immutable snapshot model { document, validation, references, hash }.
 */
export function openPack(json) {
    let parsedInput = json;
    let parseError = null;

    if (typeof json === 'string') {
        if (new TextEncoder().encode(json).length > MAX_BYTES) {
            return deepFreeze({
                document: null,
                validation: {
                    ok: false,
                    errors: [{
                        code: 'too-large',
                        path: '',
                        message: 'Pack text exceeds 512 KiB',
                    }],
                    warnings: [],
                },
                references: [],
                hash: null,
            });
        }
        try {
            parsedInput = JSON.parse(json);
        } catch (err) {
            parseError = err;
        }
    }

    if (parseError) {
        return deepFreeze({
            document: null,
            validation: {
                ok: false,
                errors: [{
                    code: 'bad-schema',
                    path: '',
                    message: `Invalid JSON: ${parseError.message}`,
                }],
                warnings: [],
            },
            references: [],
            hash: null,
        });
    }

    if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
        const validation = validateRulesPack(parsedInput);
        return deepFreeze({
            document: null,
            validation: {
                ok: false,
                errors: validation.errors || [{
                    code: 'bad-schema',
                    path: '',
                    message: 'Pack must be a JSON object',
                }],
                warnings: validation.warnings ?? [],
            },
            references: [],
            hash: null,
        });
    }

    const checkResult = validateRulesPack(parsedInput);

    if (checkResult.ok) {
        const exportResult = exportRulesV2(checkResult.pack);
        if (!exportResult.ok) {
            const safeDocument = safeClone(parsedInput);
            const references = safeDocument ? indexReferences(safeDocument) : [];
            return deepFreeze({
                document: safeDocument,
                validation: {
                    ok: false,
                    errors: exportResult.errors ?? [{
                        code: 'too-large',
                        path: '',
                        message: 'Canonical export exceeds 512 KiB',
                    }],
                    warnings: checkResult.warnings ?? [],
                },
                references,
                hash: null,
            });
        }

        const canonicalDocument = JSON.parse(exportResult.text);
        const references = indexReferences(canonicalDocument);

        return deepFreeze({
            document: canonicalDocument,
            validation: {
                ok: true,
                errors: [],
                warnings: checkResult.warnings ?? [],
            },
            references,
            hash: checkResult.hash,
        });
    }

    // When invalid, preserve safely cloned authored input with sorted keys for editing
    const safeDocument = safeClone(parsedInput);
    if (safeDocument === null) {
        return deepFreeze({
            document: null,
            validation: {
                ok: false,
                errors: checkResult.errors ?? [],
                warnings: checkResult.warnings ?? [],
            },
            references: [],
            hash: null,
        });
    }

    const references = indexReferences(safeDocument);

    return deepFreeze({
        document: safeDocument,
        validation: {
            ok: false,
            errors: checkResult.errors ?? [],
            warnings: checkResult.warnings ?? [],
        },
        references,
        hash: null,
    });
}

/**
 * Exports a model to canonical raw envelope JSON text per SPEC §7.
 * Throws Error with an `errors` property on invalid models.
 */
export function exportPack(model) {
    if (!model || !model.document || typeof model.document !== 'object') {
        const err = new Error('Cannot export invalid rules pack');
        err.errors = model?.validation?.errors || [{
            code: 'bad-schema',
            path: '',
            message: 'Model document is missing or not an object',
        }];
        throw err;
    }

    if (model.validation && !model.validation.ok) {
        const err = new Error('Cannot export invalid rules pack');
        err.errors = model.validation.errors;
        throw err;
    }

    const exported = exportRulesV2(model.document);
    if (!exported.ok) {
        const err = new Error('Cannot export invalid rules pack');
        err.errors = exported.errors;
        throw err;
    }

    return exported.text;
}
