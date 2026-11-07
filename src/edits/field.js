// setField: the guarded edit of one field at a structured path. It refuses identity changes, unsafe keys, non-JSON values and bad
// indices. The path checks are in field-path.js and the identity guards in guards.js.
import { validateAndCloneValue, cloneDoc } from './values.js';
import { SB_KINDS, getPackId, normalizeId, getRecordIdentity } from './ids.js';
import { commitSnapshot } from './commit.js';
import { parsePath, walkToParent } from './field-path.js';
import { isDefinitionCollectionPath, checkAncestorIdentitiesPreserved } from './guards.js';

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

    const parsed = parsePath(model, path);
    if (parsed.failure) return parsed.failure;
    const safePath = parsed.safePath;

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
    const walked = walkToParent(model, newDoc, safePath, pathStr);
    if (walked.failure) return walked.failure;
    const curr = walked.parent;

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
