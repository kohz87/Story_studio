// The card picture and the portraits' shrink, in the browser (canvas). The page takes these as `ctx.cardTools` so tests can give their own.

import { fitPortrait, browserIo } from './cast/portrait.js';
import { sniffImage } from '../vendor/story-block/src/v2/packs/portraits.js';
import { stripCardChunks, pngChunks } from './card-png.js';
import { PORTRAIT_ENTRY_LIMITS } from './card.js';

export const CARD_IMAGE_LIMITS = Object.freeze({ source: 10 * 1024 * 1024, side: 1200 });

/** The tools the Character card page uses: `shrink(bytes) -> { bytes, type }` for a portrait, `toPng(bytes) -> PNG bytes` for the card picture. */
export function browserCardTools(win) {
    return {
        async shrink(bytes) {
            const io = browserIo(win, bytes);
            try {
                const out = await fitPortrait(bytes, io, { maxBytes: PORTRAIT_ENTRY_LIMITS.shrinkBytes });
                return { bytes: out.bytes, type: out.type };
            } finally { io.close(); }
        },
        async toPng(bytes) {
            let bitmap;
            try { bitmap = await win.createImageBitmap(new win.Blob([bytes])); } catch { throw new Error('this browser cannot read that picture'); }
            try {
                const scale = Math.min(1, CARD_IMAGE_LIMITS.side / Math.max(bitmap.width, bitmap.height));
                const canvas = win.document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                if (!blob) throw new Error('this browser cannot save a PNG');
                return new Uint8Array(await blob.arrayBuffer());
            } finally { bitmap.close?.(); }
        },
    };
}

/**
 * A picked picture (PNG, JPEG or WebP bytes) → the card's PNG picture. A PNG that is not over the side limit is kept as it is (any card
 * data it carried is dropped); anything else is drawn by `tools.toPng`. Throws an Error in plain words.
 */
export async function cardImageFrom(bytes, tools) {
    if (!bytes?.length) throw new Error('that file is empty');
    if (bytes.length > CARD_IMAGE_LIMITS.source) throw new Error(`that picture is over ${CARD_IMAGE_LIMITS.source / 1024 / 1024} MB`);
    const type = sniffImage(bytes);
    if (!type) throw new Error('the card picture must be a PNG, JPEG or WebP');
    if (type === 'png' && pngChunks(bytes)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (Math.max(view.getUint32(16), view.getUint32(20)) <= CARD_IMAGE_LIMITS.side) return stripCardChunks(bytes);
    }
    const png = await tools.toPng(bytes);
    if (!pngChunks(png)) throw new Error('the picture could not be made into a PNG');
    return stripCardChunks(png);
}
