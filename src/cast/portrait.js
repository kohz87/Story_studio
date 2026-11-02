// A cast portrait: the picture a person's `portrait` file name stands for. Pure except `browserIo`, which is the browser's own
// decoder and encoder (canvas), passed in so the search for a size that fits is testable on its own.
//
// A picture is kept as it is when it is already a WebP, PNG or JPEG of at most `PORTRAIT_LIMITS.bytes` (Story Block's limit) and no
// larger than `PORTRAIT_LIMITS.side` pixels on its long side (600 where the vendored Story Block names none). Otherwise it is drawn smaller and saved as WebP, trying fewer bytes (quality) and then fewer pixels
// until it fits.

import { PORTRAIT_LIMITS, PORTRAIT_NAME } from '../../vendor/story-block/src/v2/packs/limits.js';
import { PORTRAIT_TYPES, sniffImage } from '../../vendor/story-block/src/v2/packs/portraits.js';

export { PORTRAIT_TYPES, sniffImage };
export const PORTRAIT_SIDE = PORTRAIT_LIMITS.side ?? 600;
const QUALITIES = [0.85, 0.7, 0.55, 0.4, 0.3];
const SMALLEST_SIDE = 96;

/** Whole kilobytes, at least 1, the way the list and the check say them. */
export const kb = bytes => Math.max(1, Math.round(bytes / 1024));

/** The file name for a person's picture: `<id>.<ext>`, kept within Story Block's name rule, and not one of `taken`. */
export function portraitFileName(id, type, taken = new Set()) {
    const ext = type === 'jpg' ? 'jpg' : type;
    const stem = String(id || 'portrait').replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[-_]+/, '').slice(0, 50) || 'portrait';
    for (let n = 1; ; n++) {
        const name = `${stem}${n > 1 ? `-${n}` : ''}.${ext}`;
        if (PORTRAIT_NAME.test(name) && !taken.has(name)) return name;
    }
}

/**
 * Fits a picture into the portrait limits. `io`: `{ size(bytes) -> { width, height }, encode(side, quality) -> { bytes, type, width, height } }`.
 * `limits` (default Story Block's `PORTRAIT_LIMITS`) gives the byte and side limits; `maxBytes` and `maxSide` override one of them.
 * Returns `{ bytes, type, width, height, from, changed }` (`from` the size it was given), or throws an Error in plain words.
 */
export async function fitPortrait(bytes, io, { limits = PORTRAIT_LIMITS, maxBytes = limits.bytes, maxSide = limits.side ?? 600 } = {}) {
    const type = sniffImage(bytes);
    if (!bytes?.length) throw new Error('That file is empty.');
    const { width, height } = await io.size(bytes);
    if (type && bytes.length <= maxBytes && Math.max(width, height) <= maxSide) return { bytes, type, width, height, from: bytes.length, changed: false };
    let side = Math.min(maxSide, Math.max(width, height));
    for (;;) {
        for (const quality of QUALITIES) {
            const out = await io.encode(side, quality);
            if (out.bytes.length <= maxBytes) return { ...out, from: bytes.length, changed: true };
        }
        side = Math.floor(side * 0.85);
        if (side < SMALLEST_SIDE) throw new Error(`That picture cannot be made small enough: portraits are at most ${kb(maxBytes)} KB.`);
    }
}

/** The browser's decoder and encoder for `bytes`: `createImageBitmap`, then a canvas saved as WebP (JPEG where WebP is not offered). */
export function browserIo(win, bytes) {
    let bitmap = null;
    const load = async () => {
        if (bitmap) return bitmap;
        if (typeof win.createImageBitmap !== 'function') throw new Error('This browser cannot read pictures.');
        try { bitmap = await win.createImageBitmap(new win.Blob([bytes])); } catch { throw new Error('That file is not a picture this browser can read.'); }
        return bitmap;
    };
    const save = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
    return {
        async size() {
            const image = await load();
            return { width: image.width, height: image.height };
        },
        async encode(side, quality) {
            const image = await load();
            const scale = Math.min(1, side / Math.max(image.width, image.height));
            const canvas = win.document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            let blob = await save(canvas, 'image/webp', quality);
            if (!blob || blob.type !== 'image/webp') blob = await save(canvas, 'image/jpeg', quality);
            if (!blob) throw new Error('This browser cannot save pictures.');
            return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type === 'image/webp' ? 'webp' : 'jpg', width: canvas.width, height: canvas.height };
        },
        close() { bitmap?.close?.(); bitmap = null; },
    };
}

const urls = new WeakMap();
/** A `data:` address for a held picture, for an <img> (the page allows images from data: only). */
export function pictureUrl(picture) {
    if (!picture) return '';
    if (urls.has(picture)) return urls.get(picture);
    let text = '';
    for (let at = 0; at < picture.bytes.length; at += 0x8000) text += String.fromCharCode(...picture.bytes.subarray(at, at + 0x8000));
    const url = `data:${PORTRAIT_TYPES[picture.type] ?? 'image/webp'};base64,${btoa(text)}`;
    urls.set(picture, url);
    return url;
}

/** A picture's size by reading its header: width and height, or null (used for pictures that come from a zip, which `io` is not given). */
export function imageSize(bytes) {
    const type = sniffImage(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    try {
        if (type === 'png') return { width: view.getUint32(16), height: view.getUint32(20) };
        if (type === 'webp') {
            const tag = String.fromCharCode(...bytes.subarray(12, 16));
            if (tag === 'VP8X') return { width: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), height: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16) };
            if (tag === 'VP8L') { const bits = view.getUint32(21, true); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
            if (tag === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        }
        if (type === 'jpg') {
            for (let at = 2; at + 9 < bytes.length;) {
                if (bytes[at] !== 0xff) { at += 1; continue; }
                const marker = bytes[at + 1];
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
                at += 2 + view.getUint16(at + 2);
            }
        }
    } catch { /* a damaged header reads as no size */ }
    return null;
}
