// Identity guards for structural edits: replacing an ancestor or a definition collection may not change or drop an existing identity.
import { SB_KINDS, normalizeId, getRecordIdentity } from './ids.js';

export function isDefinitionCollectionPath(path) {
    return path[0] === 'content' && (path.length === 1 || (path.length === 2 && (path[1] === 'skills' || SB_KINDS.has(path[1]))));
}

/** Recursively verifies that existing definition identities are not altered or removed when replacing an ancestor. */
export function checkAncestorIdentitiesPreserved(oldContainer, newContainer, packId) {
    if (!oldContainer || typeof oldContainer !== 'object' || !newContainer || typeof newContainer !== 'object') {
        return false;
    }
    for (const kind of SB_KINDS) {
        const oldList = oldContainer[kind];
        if (Array.isArray(oldList)) {
            const newList = newContainer[kind];
            if (!Array.isArray(newList)) return false;
            for (const oldItem of oldList) {
                if (!oldItem || typeof oldItem !== 'object') continue;
                const oldId = normalizeId(getRecordIdentity(kind, oldItem), packId);
                if (!oldId) continue;
                const found = newList.some(newItem => newItem && typeof newItem === 'object' && normalizeId(getRecordIdentity(kind, newItem), packId) === oldId);
                if (!found) return false;
            }
        }
    }
    if (Array.isArray(oldContainer.skills)) {
        const newList = newContainer.skills;
        if (!Array.isArray(newList)) return false;
        for (const oldItem of oldContainer.skills) {
            if (!oldItem || typeof oldItem !== 'object') continue;
            const oldId = normalizeId(getRecordIdentity('legacySkills', oldItem), packId);
            if (!oldId) continue;
            const found = newList.some(newItem => newItem && typeof newItem === 'object' && normalizeId(getRecordIdentity('legacySkills', newItem), packId) === oldId);
            if (!found) return false;
        }
    }
    return true;
}
