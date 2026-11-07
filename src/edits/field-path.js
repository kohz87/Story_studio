// setField's path steps: checks the path an edit names, then walks a copy of the document down to the parent the edit changes.
// Each refusal is the same `{ ok: false, model, errors }` setField returned before the split: here it comes back as `{ failure }`.
import { validateAndCloneValue, UNSAFE_KEYS } from './values.js';
import { refuse } from './commit.js';

/** Checks `path` (1 to 32 segments, strings or finite numbers) and returns `{ safePath }`, a copy whose canonical numeric strings are indices, or `{ failure }`. */
export function parsePath(model, path) {
    if (!Array.isArray(path)) return { failure: refuse(model, 'bad-path', '', 'Path must be a non-empty array') };

    // Inspect and safely clone path BEFORE for-of, join, or getter invocations
    const validatedPath = validateAndCloneValue(path);
    if (!validatedPath.ok || !Array.isArray(validatedPath.value)) return { failure: refuse(model, 'bad-path', '', validatedPath.error || 'Path must be a plain array') };

    const safePath = validatedPath.value;
    if (safePath.length === 0) return { failure: refuse(model, 'bad-path', '', 'Path must be a non-empty array') };

    if (safePath.length > 32) return { failure: refuse(model, 'bad-path', '', 'Path exceeds maximum supported depth') };

    let pathParent = model.document;
    for (let i = 0; i < safePath.length; i++) {
        const seg = safePath[i];
        if (typeof seg !== 'string' && typeof seg !== 'number') return { failure: refuse(model, 'bad-path', '', 'Path segments must be strings or numbers') };
        if (typeof seg === 'number' && !Number.isFinite(seg)) return { failure: refuse(model, 'bad-path', '', 'Path numeric segments must be finite') };
        if (typeof seg === 'string' && UNSAFE_KEYS.has(seg)) return { failure: refuse(model, 'unsafe-key', '', `Unsafe path segment: ${seg}`) };
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
    return { safePath };
}

/** Walks `safePath` from the copy `newDoc` to the parent of the last segment: `{ parent }`, or `{ failure }` when the path does not hold. */
export function walkToParent(model, newDoc, safePath, pathStr) {
    let curr = newDoc;

    for (let i = 0; i < safePath.length - 1; i++) {
        const seg = safePath[i];

        if (Array.isArray(curr)) {
            const idx = typeof seg === 'number' ? seg : Number(seg);
            if (!Number.isInteger(idx) || idx < 0 || String(idx) !== String(seg) || idx >= curr.length) {
                return { failure: refuse(model, 'bad-index', pathStr, `Invalid array index segment: ${seg}`) };
            }
            const desc = Object.getOwnPropertyDescriptor(curr, String(idx));
            if (!desc || desc.get || desc.set) {
                return { failure: refuse(model, 'bad-path', pathStr, `Accessor on array index: ${seg}`) };
            }
            curr = curr[idx];
        } else if (curr !== null && typeof curr === 'object') {
            if (typeof seg !== 'string') {
                return { failure: refuse(model, 'bad-path', pathStr, `Object key must be string, got: ${typeof seg}`) };
            }
            if (!Object.prototype.hasOwnProperty.call(curr, seg)) {
                return { failure: refuse(model, 'bad-path', pathStr, `Parent path segment not found: ${seg}`) };
            }
            const desc = Object.getOwnPropertyDescriptor(curr, seg);
            if (!desc || desc.get || desc.set) {
                return { failure: refuse(model, 'bad-path', pathStr, `Accessor on property key: ${seg}`) };
            }
            curr = curr[seg];
        } else {
            return { failure: refuse(model, 'bad-path', pathStr, 'Parent is not an object or array') };
        }
    }

    if (curr === null || typeof curr !== 'object') {
        return { failure: refuse(model, 'bad-path', pathStr, 'Parent is not an object or array') };
    }
    return { parent: curr };
}
