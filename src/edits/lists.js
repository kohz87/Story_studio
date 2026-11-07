// Finds and writes records in a pack document: a kind's list, a value at a path, and a record by its ID.
import { getPackId, normalizeId, getRecordIdentity } from './ids.js';

export function readKindList(doc, kind) {
    const key = kind === 'legacySkills' ? 'skills' : kind;
    const list = doc?.content?.[key];
    return Array.isArray(list) ? list : null;
}
export function ensureKindList(doc, kind) {
    if (!doc?.content || typeof doc.content !== 'object' || Array.isArray(doc.content)) return null;
    const key = kind === 'legacySkills' ? 'skills' : kind;
    if (doc.content[key] === undefined) doc.content[key] = [];
    return Array.isArray(doc.content[key]) ? doc.content[key] : null;
}
export function setValueAtPath(doc, path, value) {
    let node = doc;
    for (const key of path.slice(0, -1)) {
        if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) return false;
        node = node[key];
    }
    if (!node || typeof node !== 'object') return false;
    node[path.at(-1)] = value;
    return true;
}
function refuse(model, code, path, message, extra = {}) { return { ok: false, model, errors: [{ code, path, message }], ...extra }; }
export function findRecord(model, kind, id) {
    const packId = getPackId(model.document);
    const local = normalizeId(id, packId);
    const list = readKindList(model.document, kind);
    return { list, local, index: list?.findIndex(item => normalizeId(getRecordIdentity(kind, item), packId) === local) ?? -1 };
}
