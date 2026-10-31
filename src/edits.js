// Pure edits to ordinary pack records. Story Block validates each resulting snapshot.
import { LIMITS, SLUG } from '../vendor/story-block/src/v2/packs/limits.js';
import { openPack } from './model.js';
import { identity } from './identity.js';
import { schemaForKind, validateChange } from './form-schema.js';
import { CASCADE_KINDS } from './records.js';
import { slugify } from '../vendor/story-block/src/v2/packs/validate.js';

const SB_KINDS = new Set(CASCADE_KINDS.filter(k => k !== 'legacySkills'));
const ALL_KINDS = new Set(CASCADE_KINDS);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = LIMITS.depth;
const MAX_ARRAY = LIMITS.array;
const MAX_KEYS = LIMITS.keys;
const MAX_STRING = LIMITS.string;
const MAX_BYTES = LIMITS.packBytes;

function getPackId(document) { return typeof document?.id === 'string' ? document.id : 'pack'; }
function normalizeId(id, packId) {
    if (typeof id !== 'string' || !id) return null;
    const prefix = `pack.${packId}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
function isForeignId(id, packId) { return typeof id === 'string' && id.startsWith('pack.') && !id.startsWith(`pack.${packId}/`); }

function validateAndCloneValue(val, seen = new Set(), depth = 0, key = '') {
    try {
        if (val === null) return { ok: true, value: null };

        const type = typeof val;
        if (type === 'boolean') return { ok: true, value: val };
        if (type === 'number') {
            if (!Number.isFinite(val)) return { ok: false, error: 'Non-finite number' };
            return { ok: true, value: val };
        }
        if (type === 'string') {
            const max = key === 'template' || key === 'css' ? LIMITS.code : MAX_STRING;
            if (val.length > max) return { ok: false, error: `String length exceeds limit of ${max}` };
            return { ok: true, value: val };
        }
        if (type !== 'object') return { ok: false, error: `Unsupported non-JSON type: ${type}` };

        if (depth >= MAX_DEPTH) return { ok: false, error: 'Maximum depth exceeded' };

        const proto = Object.getPrototypeOf(val);
        if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
            return { ok: false, error: 'Unsupported object prototype' };
        }

        if (seen.has(val)) return { ok: false, error: 'Cyclic value detected' };
        seen.add(val);

        try {
            if (Array.isArray(val)) {
                if (val.length > MAX_ARRAY) return { ok: false, error: `Array length exceeds limit of ${MAX_ARRAY}` };
                const keys = Reflect.ownKeys(val);
                if (keys.length !== val.length + 1) {
                    return { ok: false, error: 'Array has non-index own properties' };
                }
                const out = [];
                for (let i = 0; i < val.length; i++) {
                    const desc = Object.getOwnPropertyDescriptor(val, String(i));
                    if (!desc || !desc.enumerable || desc.get || desc.set) {
                        return { ok: false, error: 'Array element accessor or non-enumerable' };
                    }
                    const res = validateAndCloneValue(desc.value, seen, depth + 1, key);
                    if (!res.ok) return res;
                    out.push(res.value);
                }
                if (depth === 0) {
                    const text = JSON.stringify(out);
                    if (new TextEncoder().encode(text).length > MAX_BYTES) {
                        return { ok: false, error: 'Value exceeds byte limit' };
                    }
                }
                return { ok: true, value: out };
            }

            const keys = Reflect.ownKeys(val);
            if (keys.length > MAX_KEYS) return { ok: false, error: `Object key count exceeds limit of ${MAX_KEYS}` };
            const out = {};
            for (const key of keys) {
                if (typeof key !== 'string') return { ok: false, error: 'Symbol property key' };
                if (UNSAFE_KEYS.has(key)) return { ok: false, error: `Unsafe property key: ${key}` };
                if (key.length > MAX_STRING) return { ok: false, error: 'Object key exceeds length limit' };

                const desc = Object.getOwnPropertyDescriptor(val, key);
                if (!desc || !desc.enumerable || desc.get || desc.set) {
                    return { ok: false, error: `Getter or accessor on key: ${key}` };
                }
                const res = validateAndCloneValue(desc.value, seen, depth + 1, key);
                if (!res.ok) return res;
                out[key] = res.value;
            }
            if (depth === 0) {
                const text = JSON.stringify(out);
                if (new TextEncoder().encode(text).length > MAX_BYTES) {
                    return { ok: false, error: 'Value exceeds byte limit' };
                }
            }
            return { ok: true, value: out };
        } finally {
            seen.delete(val);
        }
    } catch {
        return { ok: false, error: 'Error inspecting value (possible hostile proxy)' };
    }
}

/** Deeply clones a verified plain document object. */
function cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc));
}

/** Returns the property name used as the identity for a record of the given kind. */
function getIdentityKey(kind, record) {
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
function getRecordIdentity(kind, record) {
    if (!record || typeof record !== 'object') return null;
    const key = identity(record, kind);
    return key === '' ? null : key;
}


function commitSnapshot(newDoc, originalModel) {
    const snapshot = openPack(newDoc);
    if (!snapshot || snapshot.document === null) {
        return {
            ok: false,
            model: originalModel,
            errors: (snapshot?.validation?.errors?.length) ? snapshot.validation.errors : [{
                code: 'unsafe-edit',
                path: '',
                message: 'Edit produced unsafe or out-of-limits document',
            }],
        };
    }
    return {
        ok: true,
        model: snapshot,
        undo: () => originalModel,
    };
}


function readKindList(doc, kind) {
    const key = kind === 'legacySkills' ? 'skills' : kind;
    const list = doc?.content?.[key];
    return Array.isArray(list) ? list : null;
}
function ensureKindList(doc, kind) {
    if (!doc?.content || typeof doc.content !== 'object' || Array.isArray(doc.content)) return null;
    const key = kind === 'legacySkills' ? 'skills' : kind;
    if (doc.content[key] === undefined) doc.content[key] = [];
    return Array.isArray(doc.content[key]) ? doc.content[key] : null;
}
function setValueAtPath(doc, path, value) {
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
function findRecord(model, kind, id) {
    const packId = getPackId(model.document);
    const local = normalizeId(id, packId);
    const list = readKindList(model.document, kind);
    return { list, local, index: list?.findIndex(item => normalizeId(getRecordIdentity(kind, item), packId) === local) ?? -1 };
}

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
    return commitSnapshot(doc, model);
}

function isDefinitionCollectionPath(path) {
    return path[0] === 'content' && (path.length === 1 || (path.length === 2 && (path[1] === 'skills' || SB_KINDS.has(path[1]))));
}

/** Recursively verifies that existing definition identities are not altered or removed when replacing an ancestor. */
function checkAncestorIdentitiesPreserved(oldContainer, newContainer, packId) {
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

/**
 * Replaces or sets a field at a structured path rooted in the document.
 * Refuses identity field modifications, unsafe keys, getters, non-JSON values, and array index errors.
 * Traverses only own properties and valid numeric array indices at every segment.
 */
export function setField(model, path, value) {
    if (!model || !model.document || typeof model.document !== 'object' || Array.isArray(model.document)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: '', message: 'Model document is missing or invalid' }],
        };
    }

    if (!Array.isArray(path)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: 'Path must be a non-empty array' }],
        };
    }

    // Inspect and safely clone path BEFORE for-of, join, or getter invocations
    const validatedPath = validateAndCloneValue(path);
    if (!validatedPath.ok || !Array.isArray(validatedPath.value)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: validatedPath.error || 'Path must be a plain array' }],
        };
    }

    const safePath = validatedPath.value;
    if (safePath.length === 0) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: 'Path must be a non-empty array' }],
        };
    }

    if (safePath.length > 32) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: 'Path exceeds maximum supported depth' }],
        };
    }

    let pathParent = model.document;
    for (let i = 0; i < safePath.length; i++) {
        const seg = safePath[i];
        if (typeof seg !== 'string' && typeof seg !== 'number') {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: '', message: 'Path segments must be strings or numbers' }],
            };
        }
        if (typeof seg === 'number' && !Number.isFinite(seg)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: '', message: 'Path numeric segments must be finite' }],
            };
        }
        if (typeof seg === 'string' && UNSAFE_KEYS.has(seg)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'unsafe-key', path: '', message: `Unsafe path segment: ${seg}` }],
            };
        }
        // Traversal accepts canonical numeric strings as array indices. Identity guards
        // must see the same path, including when a record or its ancestor is replaced.
        if (Array.isArray(pathParent) && typeof seg === 'string') {
            const index = Number(seg);
            if (Number.isInteger(index) && index >= 0 && String(index) === seg) safePath[i] = index;
        }
        pathParent = pathParent !== null && typeof pathParent === 'object'
            ? Object.getOwnPropertyDescriptor(pathParent, safePath[i])?.value
            : undefined;
    }

    const pathStr = safePath.join('.');
    const last = safePath[safePath.length - 1];

    if (safePath.length === 1 && last === 'id') {
        return {
            ok: false,
            model,
            errors: [{ code: 'identity-field', path: 'id', message: 'Cannot modify pack id directly; use renameId instead' }],
        };
    }
    if (last === 'slug' || last === 'id') {
        return {
            ok: false,
            model,
            errors: [{
                code: 'identity-field',
                path: pathStr,
                message: `Cannot modify identity field "${last}" directly; use renameId instead`,
            }],
        };
    }

    if (isDefinitionCollectionPath(safePath)) {
        return {
            ok: false,
            model,
            errors: [{
                code: 'identity-field',
                path: pathStr,
                message: `Cannot replace collection "${last}" directly; use add, remove, renameId, or leaf setField instead`,
            }],
        };
    }

    const validated = validateAndCloneValue(value, new Set(), 0, String(last));
    if (!validated.ok) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-value', path: pathStr, message: validated.error }],
        };
    }

    const packId = getPackId(model.document);

    // Guard direct replacement of identity-bearing definition records
    const isRecordPath = safePath.length === 3 && safePath[0] === 'content' && (SB_KINDS.has(safePath[1]) || safePath[1] === 'skills') && typeof safePath[2] === 'number';

    if (isRecordPath) {
        if (validated.value === null || typeof validated.value !== 'object' || Array.isArray(validated.value)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot replace identity-bearing record with null, non-object, or array' }],
            };
        }
        const recordKind = safePath[1] === 'skills' ? 'legacySkills' : safePath[1];
        const existingRecord = model.document.content?.[safePath[1]]?.[safePath[2]];

        if (existingRecord && typeof existingRecord === 'object') {
            const oldId = normalizeId(getRecordIdentity(recordKind, existingRecord), packId);
            const newId = normalizeId(getRecordIdentity(recordKind, validated.value), packId);
            if (!newId || newId !== oldId) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot modify or remove identity field through structural replacement; use renameId instead' }],
                };
            }
        }
    }

    // Guard ancestor containers against removal or alteration of existing identities
    const isAncestorPath = safePath.length === 1 && safePath[0] === 'content';

    if (isAncestorPath) {
        let oldContainer = model.document;
        for (const seg of safePath) {
            oldContainer = oldContainer?.[seg];
        }
        if (!checkAncestorIdentitiesPreserved(oldContainer, validated.value, packId)) {
            return {
                ok: false,
                model,
                errors: [{
                    code: 'identity-field',
                    path: pathStr,
                    message: 'Existing identities cannot be changed or removed when replacing an ancestor container; use renameId or remove',
                }],
            };
        }
    }

    const newDoc = cloneDoc(model.document);
    let curr = newDoc;

    for (let i = 0; i < safePath.length - 1; i++) {
        const seg = safePath[i];

        if (Array.isArray(curr)) {
            const idx = typeof seg === 'number' ? seg : Number(seg);
            if (!Number.isInteger(idx) || idx < 0 || String(idx) !== String(seg) || idx >= curr.length) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-index', path: pathStr, message: `Invalid array index segment: ${seg}` }],
                };
            }
            const desc = Object.getOwnPropertyDescriptor(curr, String(idx));
            if (!desc || desc.get || desc.set) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Accessor on array index: ${seg}` }],
                };
            }
            curr = curr[idx];
        } else if (curr !== null && typeof curr === 'object') {
            if (typeof seg !== 'string') {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Object key must be string, got: ${typeof seg}` }],
                };
            }
            if (!Object.prototype.hasOwnProperty.call(curr, seg)) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Parent path segment not found: ${seg}` }],
                };
            }
            const desc = Object.getOwnPropertyDescriptor(curr, seg);
            if (!desc || desc.get || desc.set) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Accessor on property key: ${seg}` }],
                };
            }
            curr = curr[seg];
        } else {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: pathStr, message: 'Parent is not an object or array' }],
            };
        }
    }

    if (curr === null || typeof curr !== 'object') {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: pathStr, message: 'Parent is not an object or array' }],
        };
    }

    if (Array.isArray(curr)) {
        if (last === 'length') {
            return {
                ok: false,
                model,
                errors: [{ code: 'out-of-bounds', path: pathStr, message: 'Cannot set array length directly' }],
            };
        }
        const idx = typeof last === 'number' ? last : Number(last);
        if (!Number.isInteger(idx) || idx < 0 || String(idx) !== String(last)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-index', path: pathStr, message: 'Array index must be a non-negative integer' }],
            };
        }
        if (idx >= curr.length) {
            return {
                ok: false,
                model,
                errors: [{ code: 'out-of-bounds', path: pathStr, message: 'Array index out of bounds' }],
            };
        }

        const existingItem = curr[idx];
        if (existingItem !== null && typeof existingItem === 'object' && validated.value !== null && typeof validated.value === 'object') {
            const oldId = existingItem.slug ?? existingItem.id ?? existingItem.def;
            const newId = validated.value.slug ?? validated.value.id ?? validated.value.def;
            if (oldId !== undefined && oldId !== newId) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot modify identity field through structural replacement; use renameId instead' }],
                };
            }
        }

        curr[idx] = validated.value;
    } else {
        if (typeof last !== 'string') {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: pathStr, message: 'Object key must be string' }],
            };
        }

        const existingField = curr[last];
        if (existingField !== null && typeof existingField === 'object' && validated.value !== null && typeof validated.value === 'object') {
            const oldId = existingField.slug ?? existingField.id ?? existingField.def;
            const newId = validated.value.slug ?? validated.value.id ?? validated.value.def;
            if (oldId !== undefined && oldId !== newId) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot modify identity field through structural replacement; use renameId instead' }],
                };
            }
        }

        curr[last] = validated.value;
    }

    return commitSnapshot(newDoc, model);
}

/** Schema-driven edits share one guard; the pure engine still supports damaged drafts. */
export function setSchemaField(model, path, value, scope) {
    const safePath = validateAndCloneValue(path);
    const lastKey = safePath.ok && Array.isArray(safePath.value) ? safePath.value.at(-1) : null;
    const safeValue = validateAndCloneValue(value, new Set(), 0, typeof lastKey === 'string' ? lastKey : '');
    if (!safePath.ok || !Array.isArray(safePath.value) || !safeValue.ok) return setField(model, path, value);
    path = safePath.value;
    if (path.some(key => typeof key === 'string' && UNSAFE_KEYS.has(key))) return setField(model, path, value);
    let rootPath = scope?.rootPath;
    let schema = scope?.rootSchema;
    let kind;
    if (!rootPath) {
        kind = path[1] === 'skills' ? 'legacySkills' : path[1];
        rootPath = path[0] === 'content' && schemaForKind(kind) ? path.slice(0, 3) : [];
        schema = rootPath.length ? schemaForKind(kind) : { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: LIMITS.name } } };
    }
    let current = model?.document;
    for (const key of rootPath) current = current?.[key];
    const checked = validateChange(schema, current, path.slice(rootPath.length), safeValue.value);
    if (!checked.ok) return { ok: false, model, errors: [{ ...checked, path: path.join('.') }] };
    // A record without an explicit ID is keyed by its name. Move its references
    // in the same edit when the name changes, so the world remains connected.
    if (path.length === 4 && path[0] === 'content' && typeof path[2] === 'number' && path[3] === 'name') {
        const recordKind = path[1] === 'skills' ? 'legacySkills' : path[1];
        const record = model?.document?.content?.[path[1]]?.[path[2]];
        if (ALL_KINDS.has(recordKind) && record && !Object.hasOwn(record, 'slug') && !Object.hasOwn(record, 'id')) {
            const before = identity(record, recordKind);
            const after = slugify(safeValue.value);
            if (before && after && before !== after) {
                const moved = renameId(model, recordKind, before, after);
                if (!moved.ok) return moved;
                const named = setField(moved.model, path, safeValue.value);
                return named.ok ? { ...named, undo: () => model } : named;
            }
        }
    }
    return setField(model, path, safeValue.value);
}
