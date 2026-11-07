// Lookup tables for typed pack references: places, items, races, talents and legacy skills.
//
// referenceLookups builds the resolvers indexReferences uses; the names it maps are the same ones the checker knows.

import { foldKey } from '../../../vendor/story-block/src/text.js';
import { identity } from '../../identity.js';

export function referenceLookups(safeDoc) {
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

    return { prefix, toFull, resolvePlaceRef, resolveStartItemRef, resolveRaceRef, resolveTalentRef, resolveLegacySkillRef };
}
