// Bounded, getter-safe cloning of pack data before it enters the model.
//
// The limits are Story Block's; every value is cloned without running getters or traps.

import { LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';

const MAX_DEPTH = LIMITS.depth;
const MAX_ARRAY = LIMITS.array;
const MAX_KEYS = LIMITS.keys;
const MAX_STRING = LIMITS.string;
const MAX_BYTES = LIMITS.packBytes;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/**
 * Safely clones plain JSON objects/arrays without invoking property getters,
 * bounded by shared limits (depth 16, array 1000, keys 200, string 4000, byte budget 512 KiB).
 * Treats seen as an active ancestor set for cycle detection.
 * Wraps in try/catch to return null on hostile proxy traps or unsupported input.
 * Returns null if unsafe or out-of-limits.
 */
function safeClone(value) {
    try {
        let totalBytes = 0;
        const seen = new Set();
        const encoder = new TextEncoder();

        function clone(val, depth, key = '') {
            if (val === null) {
                totalBytes += 4;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: null };
            }

            const type = typeof val;
            if (type === 'boolean') {
                totalBytes += val ? 4 : 5;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: val };
            }

            if (type === 'number') {
                if (!Number.isFinite(val)) return null;
                totalBytes += encoder.encode(JSON.stringify(val)).length;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: val };
            }

            if (type === 'string') {
                if (val.length > (key === 'template' || key === 'css' ? LIMITS.code : MAX_STRING)) return null;
                totalBytes += encoder.encode(JSON.stringify(val)).length;
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: val };
            }

            if (type !== 'object') {
                return null;
            }

            // Primitive leaves at depth 16 are allowed; object/array nodes at or beyond depth 16 are rejected.
            if (depth >= MAX_DEPTH) return null;

            const proto = Object.getPrototypeOf(val);
            if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
                return null;
            }

            if (seen.has(val)) {
                return null;
            }

            seen.add(val);

            try {
                if (Array.isArray(val)) {
                    if (val.length > MAX_ARRAY) return null;
                    const ownKeys = Reflect.ownKeys(val);
                    if (ownKeys.length !== val.length + 1) return null;

                    totalBytes += 1; // '['
                    if (totalBytes > MAX_BYTES) return null;

                    const out = [];
                    for (let i = 0; i < val.length; i++) {
                        if (i > 0) {
                            totalBytes += 1; // ','
                            if (totalBytes > MAX_BYTES) return null;
                        }
                        const desc = Object.getOwnPropertyDescriptor(val, String(i));
                        if (!desc || !desc.enumerable || desc.get || desc.set) return null;
                        const res = clone(desc.value, depth + 1, key);
                        if (!res || !res.ok) return null;
                        out.push(res.value);
                    }
                    totalBytes += 1; // ']'
                    if (totalBytes > MAX_BYTES) return null;
                    return { ok: true, value: out };
                }

                const ownKeys = Reflect.ownKeys(val);
                if (ownKeys.length > MAX_KEYS) return null;

                for (const key of ownKeys) {
                    if (typeof key !== 'string' || UNSAFE_KEYS.has(key)) return null;
                }

                totalBytes += 1; // '{'
                if (totalBytes > MAX_BYTES) return null;

                const out = {};
                for (let i = 0; i < ownKeys.length; i++) {
                    const key = ownKeys[i];
                    if (key.length > MAX_STRING) return null;

                    if (i > 0) {
                        totalBytes += 1; // ','
                        if (totalBytes > MAX_BYTES) return null;
                    }

                    const keyBytes = encoder.encode(JSON.stringify(key)).length;
                    totalBytes += keyBytes + 1; // "key":
                    if (totalBytes > MAX_BYTES) return null;

                    const desc = Object.getOwnPropertyDescriptor(val, key);
                    if (!desc || !desc.enumerable || desc.get || desc.set) return null;
                    const res = clone(desc.value, depth + 1, key);
                    if (!res || !res.ok) return null;
                    out[key] = res.value;
                }
                totalBytes += 1; // '}'
                if (totalBytes > MAX_BYTES) return null;
                return { ok: true, value: out };
            } finally {
                seen.delete(val);
            }
        }

        const result = clone(value, 0);
        if (!result || !result.ok) return null;

        const text = JSON.stringify(result.value);
        if (encoder.encode(text).length > MAX_BYTES) return null;

        return result.value;
    } catch {
        return null;
    }
}

export { safeClone };
