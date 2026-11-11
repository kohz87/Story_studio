// Pack model: openPack, exportPack, and indexReferences (pure).

import { validatePack } from './data-modules/sb-adapter.js';
import { lastingProblems } from './timeline/lasting.js';
import { LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { safeClone } from './model/safe-clone.js';
import { indexReferences } from './model/references.js';

export { indexReferences };

const MAX_BYTES = LIMITS.packBytes;
// Original text belongs to the frozen snapshot; undo restores the same snapshot and bytes.
const sourceTexts = new WeakMap();
// Drafts (events written with an AI, not yet kept) travel with a snapshot but are no part of its pack: they are not in
// `document`, its validation or its export. A snapshot an edit makes takes its predecessor's drafts (see inheritDrafts).
const draftTable = new WeakMap();
// Portrait pictures of the cast travel the same way: a snapshot holds the images its pack's `portrait` names refer to
// (name -> { bytes, type, width, height }); they are no part of its pack, so a swap of a picture is undone and redone with the
// edit that made it, and the pack's bytes and hashes never see them.
const portraitTable = new WeakMap();
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
    if (portraitTable.has(model)) portraitTable.set(next, portraitTable.get(model));
    draftTable.set(next, Object.freeze([...drafts]));
    return next;
}

const NO_PORTRAITS = new Map();
/** The portrait pictures a snapshot carries, as a Map (name -> { bytes, type, width, height }); empty for a snapshot made without. Never change it. */
export function portraitsOf(model) { return (isObjectLike(model) && portraitTable.get(model)) || NO_PORTRAITS; }

/** A new snapshot of the same pack carrying `portraits` (a Map or a list of [name, picture]): the pack itself is untouched. */
export function withPortraits(model, portraits) {
    const next = Object.freeze({ ...model });
    if (sourceTexts.has(model)) sourceTexts.set(next, sourceTexts.get(model));
    if (draftTable.has(model)) draftTable.set(next, draftTable.get(model));
    portraitTable.set(next, new Map(portraits));
    return next;
}

/** Gives `next` the portraits of the snapshot it came from, unless it has some of its own; used when an edit is committed. */
export function inheritPortraits(next, from) {
    if (next === from || !isObjectLike(next) || !isObjectLike(from) || portraitTable.has(next) || !portraitTable.has(from)) return;
    portraitTable.set(next, portraitTable.get(from));
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
    // Story Block 2.31 keeps a pack whose names or ripples section is bad and drops that section, saying so as a warning. Studio is where
    // the section is written, so it counts as a problem: the Problems drawer lists it and the exports stay off until it is fixed.
    const dropped = checked.warnings ?? [];
    const model = deepFreeze({
        document,
        validation: { ok: checked.ok && !lasting.length && !dropped.length, errors: [...checked.errors ?? [], ...lasting, ...dropped], warnings: [] },
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
