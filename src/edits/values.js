// Value checks for pack edits: every value an edit writes is a plain JSON value inside Story Block's limits, and is cloned on the way.
import { LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';

export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = LIMITS.depth;
const MAX_ARRAY = LIMITS.array;
const MAX_KEYS = LIMITS.keys;
const MAX_STRING = LIMITS.string;
const MAX_BYTES = LIMITS.packBytes;

export function validateAndCloneValue(val, seen = new Set(), depth = 0, key = '') {
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
export function cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc));
}
