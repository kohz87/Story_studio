// Record identity for pack edits: the pack's own ID prefix, the local ID a record is known by, and the kinds that carry identities.
// Pure; every edit that finds, keeps or renames a record goes through these.
import { CASCADE_KINDS } from '../records.js';
import { identity } from '../identity.js';

export const SB_KINDS = new Set(CASCADE_KINDS.filter(k => k !== 'legacySkills'));
export const ALL_KINDS = new Set(CASCADE_KINDS);

export function getPackId(document) { return typeof document?.id === 'string' ? document.id : 'pack'; }
export function normalizeId(id, packId) {
    if (typeof id !== 'string' || !id) return null;
    const prefix = `pack.${packId}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
export function isForeignId(id, packId) { return typeof id === 'string' && id.startsWith('pack.') && !id.startsWith(`pack.${packId}/`); }

/** Returns the property name used as the identity for a record of the given kind. */
export function getIdentityKey(kind, record) {
    if (kind === 'events' || kind === 'races' || kind === 'talents' || kind === 'presets') {
        if (record && 'id' in record && record.id !== undefined) return 'id';
        if (record && 'slug' in record && record.slug !== undefined) return 'slug';
        return 'id';
    }
    if (record && 'slug' in record && record.slug !== undefined) return 'slug';
    if (record && 'id' in record && record.id !== undefined) return 'id';
    return 'slug';
}

/** Extracts the identity string from a record of the given kind: Story Block's own key, so a record without a slug is keyed by its name. */
export function getRecordIdentity(kind, record) {
    if (!record || typeof record !== 'object') return null;
    const key = identity(record, kind);
    return key === '' ? null : key;
}
