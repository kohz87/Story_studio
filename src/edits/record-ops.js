// Record edits: add a record, replace a kind's records in place, rename a record's ID, and remove records with their dependants.
// Each builds one new document and returns it through commitSnapshot, or refuses with the model unchanged.
import { SLUG } from '../../vendor/story-block/src/v2/packs/limits.js';
import { validateAndCloneValue, cloneDoc } from './values.js';
import { getPackId, normalizeId, isForeignId, getIdentityKey, getRecordIdentity, ALL_KINDS } from './ids.js';
import { refuse, commitSnapshot } from './commit.js';
import { settleGuards } from '../timeline/event.js';
import { findRecord, readKindList, ensureKindList, setValueAtPath } from './lists.js';

export function add(model, kind, record) {
    if (!model?.document || typeof model.document !== 'object') return refuse(model, 'bad-model', '', 'Open a pack first.');
    if (!ALL_KINDS.has(kind)) return refuse(model, 'unsupported-kind', kind, 'This kind cannot be edited here.');
    const safe = validateAndCloneValue(record);
    if (!safe.ok || !safe.value || typeof safe.value !== 'object' || Array.isArray(safe.value)) return refuse(model, 'bad-value', kind, safe.error || 'The record must be an object.');
    const packId = getPackId(model.document);
    const raw = safe.value[getIdentityKey(kind, safe.value)];
    if (typeof raw !== 'string' || !raw.trim()) return refuse(model, 'missing-id', kind, 'The record needs an ID.');
    if (isForeignId(raw, packId)) return refuse(model, 'bad-ref', kind, 'The record ID must belong to this pack.');
    const { list, local } = findRecord(model, kind, raw);
    if (list?.some(item => normalizeId(getRecordIdentity(kind, item), packId) === local)) return refuse(model, 'dup-id', kind, `Duplicate ID: ${raw}`);
    const doc = cloneDoc(model.document);
    const target = ensureKindList(doc, kind);
    if (!target) return refuse(model, 'bad-container', kind, 'The record list is not an array.');
    target.push(safe.value);
    return commitSnapshot(doc, model);
}

/** Replaces the records of a kind that already exist with `list` (same identities, same order) as one edit: several events changed together. */
export function setRecords(model, kind, list) {
    if (!model?.document || !ALL_KINDS.has(kind)) return refuse(model, 'bad-model', kind, 'Open a supported record first.');
    const safe = validateAndCloneValue(list);
    const current = readKindList(model.document, kind);
    if (!safe.ok || !Array.isArray(safe.value) || !current) return refuse(model, 'bad-value', kind, safe.error || 'The records must be a list.');
    const packId = getPackId(model.document);
    const keys = items => items.map(item => normalizeId(getRecordIdentity(kind, item), packId));
    if (JSON.stringify(keys(safe.value)) !== JSON.stringify(keys(current))) return refuse(model, 'identity-field', kind, 'Records cannot be added, removed or renamed here.');
    const doc = cloneDoc(model.document);
    doc.content[kind === 'legacySkills' ? 'skills' : kind] = safe.value;
    return commitSnapshot(doc, model);
}

export function renameId(model, kind, id, nextId) {
    if (!model?.document || !ALL_KINDS.has(kind)) return refuse(model, 'bad-model', kind, 'Open a supported record first.');
    const packId = getPackId(model.document);
    if (isForeignId(id, packId) || isForeignId(nextId, packId)) return refuse(model, 'bad-ref', kind, 'The ID must belong to this pack.');
    const { list, local, index } = findRecord(model, kind, id);
    const next = normalizeId(nextId, packId);
    if (index < 0) return refuse(model, 'not-found', kind, `Record ${id} was not found.`);
    if (!next || !SLUG.test(next)) return refuse(model, 'bad-id', kind, 'Use a lowercase ID with hyphens.');
    if (list.some((item, at) => at !== index && normalizeId(getRecordIdentity(kind, item), packId) === next)) return refuse(model, 'dup-id', kind, `Duplicate ID: ${next}`);
    if (local === next) return { ok: true, model, undo: () => model };
    const doc = cloneDoc(model.document);
    const record = ensureKindList(doc, kind)[index];
    record[getIdentityKey(kind, record)] = next;
    for (const ref of model.references ?? []) {
        if (ref.targetKind !== kind || normalizeId(ref.targetId, packId) !== local) continue;
        const replacement = kind === 'places' && ref.kind !== 'routes' ? `pack.${packId}/${next}` : next;
        setValueAtPath(doc, ref.path, replacement);
    }
    return commitSnapshot(doc, model);
}

export function remove(model, kind, id, { cascade = false } = {}) {
    if (!model?.document || !ALL_KINDS.has(kind)) return refuse(model, 'bad-model', kind, 'Open a supported record first.');
    const packId = getPackId(model.document);
    const { local, index } = findRecord(model, kind, id);
    if (index < 0 || isForeignId(id, packId)) return refuse(model, 'not-found', kind, `Record ${id} was not found.`);
    const refs = model.references ?? [];
    const inbound = refs.filter(ref => ref.targetKind === kind && normalizeId(ref.targetId, packId) === local && !(ref.kind === kind && normalizeId(ref.id, packId) === local));
    if (!cascade && inbound.length) return refuse(model, 'referenced', kind, `Other records refer to ${id}.`, { references: inbound });
    const queue = [{ kind, id: local }];
    const visited = new Set();
    while (queue.length) {
        const item = queue.shift();
        const key = `${item.kind}:${item.id}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (!cascade) continue;
        for (const ref of refs) {
            if (ref.targetKind !== item.kind || normalizeId(ref.targetId, packId) !== item.id || !ALL_KINDS.has(ref.kind)) continue;
            const owner = normalizeId(ref.id, packId);
            if (owner) queue.push({ kind: ref.kind, id: owner });
        }
    }
    const doc = cloneDoc(model.document);
    // Start inventory entries have no record owner and must be removed individually.
    if (Array.isArray(doc.start?.inventory?.items)) {
        const indices = new Set(refs.filter(ref => ref.kind === 'start' && ref.targetKind === 'items' && visited.has(`items:${normalizeId(ref.targetId, packId)}`)).map(ref => ref.path[3]));
        doc.start.inventory.items = doc.start.inventory.items.filter((_, i) => !indices.has(i));
    }
    for (const name of ALL_KINDS) {
        const list = readKindList(doc, name);
        if (!list) continue;
        const key = name === 'legacySkills' ? 'skills' : name;
        doc.content[key] = list.filter(item => !visited.has(`${name}:${normalizeId(getRecordIdentity(name, item), packId)}`));
    }
    settleParents(doc, model, packId, visited);
    return commitSnapshot(doc, model);
}

// An event that others count days from waits for the story's date (`time() != null`): once the last of them is removed the
// guard goes too, so each event left that a removed one followed is settled as the Timeline form settles it.
function settleParents(doc, model, packId, visited) {
    const before = readKindList(model.document, 'events');
    const list = readKindList(doc, 'events');
    if (!before || !list || before.length === list.length) return;
    const parents = new Set(before.filter(item => visited.has(`events:${normalizeId(getRecordIdentity('events', item), packId)}`)).map(item => item?.after).filter(ref => typeof ref === 'string' && ref));
    let next = list;
    list.forEach((item, at) => { if (parents.has(getRecordIdentity('events', item))) next = settleGuards(next, at, next[at]); });
    doc.content.events = next;
}
