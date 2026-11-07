// setSchemaField: the schema-driven edit every UI field commit goes through. It checks the value against the field's schema, moves a
// record's references when its name changes, and hands the write to setField.
import { LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { slugify } from '../../vendor/story-block/src/v2/packs/validate.js';
import { identity } from '../identity.js';
import { schemaForKind, validateChange } from '../form-schema.js';
import { validateAndCloneValue, UNSAFE_KEYS } from './values.js';
import { ALL_KINDS } from './ids.js';
import { renameId } from './record-ops.js';
import { setField } from './field.js';

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
