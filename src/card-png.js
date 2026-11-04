// A deterministic book cover, PNG chunks and stored DEFLATE blocks: no canvas or codec dependency.
const bytes = text => new TextEncoder().encode(text);
const join = parts => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
};
function word(value) {
    const result = new Uint8Array(4);
    new DataView(result.buffer).setUint32(0, value);
    return result;
}
const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
});
export function crc32(data) {
    let crc = 0xffffffff;
    for (const value of data) crc = TABLE[(crc ^ value) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const body = join([bytes(type), data]);
    return join([word(data.length), body, word(crc32(body))]);
}
function deflateStored(data) {
    const parts = [Uint8Array.of(0x78, 0x01)];
    for (let at = 0; at < data.length; at += 65535) {
        const length = Math.min(65535, data.length - at);
        parts.push(Uint8Array.of(at + length === data.length ? 1 : 0, length & 255, length >>> 8,
            (~length) & 255, ((~length) >>> 8) & 255), data.subarray(at, at + length));
    }
    let a = 1, b = 0;
    for (const value of data) { a = (a + value) % 65521; b = (b + a) % 65521; }
    return join([...parts, word(((b << 16) | a) >>> 0)]);
}
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const CARD_KEYWORDS = ['chara', 'ccv3'];

/** The default cover: the 128 x 192 book Studio has always drawn. */
function coverPng() {
    const width = 128, height = 192;
    const pixels = new Uint8Array(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const border = (x === 12 || x === 115) && y >= 12 && y <= 179 ||
                (y === 12 || y === 179) && x >= 12 && x <= 115;
            const book = x >= 31 && x <= 96 && y >= 61 && y <= 125;
            const line = book && (x === 63 || x === 64 || y === 61 || y === 125 || x === 31 || x === 96 ||
                (y === 78 || y === 92 || y === 106) && (x >= 39 && x <= 55 || x >= 72 && x <= 88));
            const color = border || line ? [198, 181, 245] : book ? [71, 58, 110] : [26, 29, 46];
            pixels.set(color, y * (1 + width * 3) + 1 + x * 3);
        }
    }
    const header = join([word(width), word(height), Uint8Array.of(8, 2, 0, 0, 0)]);
    return join([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateStored(pixels)), chunk('IEND', new Uint8Array())]);
}
let cover = null;
/** The default cover as PNG bytes (no card data in it). */
export function defaultCoverPng() { return cover ??= coverPng(); }

/** The chunks of a PNG as `{ type, data }`, or null when the bytes are not a PNG (or a chunk runs past the end). */
export function pngChunks(png) {
    if (!(png instanceof Uint8Array) || png.length < 20 || SIGNATURE.some((value, at) => png[at] !== value)) return null;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const chunks = [];
    for (let at = 8; at < png.length;) {
        if (at + 12 > png.length) return null;
        const length = view.getUint32(at);
        if (at + 12 + length > png.length) return null;
        chunks.push({ type: String.fromCharCode(...png.subarray(at + 4, at + 8)), data: png.subarray(at + 8, at + 8 + length) });
        at += 12 + length;
    }
    return chunks.length && chunks[0].type === 'IHDR' && chunks.at(-1).type === 'IEND' ? chunks : null;
}
const keywordOf = data => { const end = data.indexOf(0); return end < 0 || end > 79 ? '' : String.fromCharCode(...data.subarray(0, end)); };
const isCardText = ({ type, data }) => ['tEXt', 'zTXt', 'iTXt'].includes(type) && CARD_KEYWORDS.includes(keywordOf(data));

/** The picture alone: the PNG without any card data chunk, or null when it is not a PNG. */
export function stripCardChunks(png) {
    const chunks = pngChunks(png);
    if (!chunks) return null;
    return join([SIGNATURE, ...chunks.filter(item => !isCardText(item)).map(item => chunk(item.type, item.data))]);
}

/**
 * The card JSON text a PNG carries (a `ccv3` tEXt chunk first, else `chara`), or null. The chunk holds the card as base64 of its UTF-8 text.
 */
export function readCardPng(png) {
    const chunks = pngChunks(png);
    if (!chunks) return null;
    for (const keyword of ['ccv3', 'chara']) {
        const found = chunks.find(item => item.type === 'tEXt' && keywordOf(item.data) === keyword);
        if (!found) continue;
        try {
            const binary = atob(new TextDecoder('latin1').decode(found.data.subarray(keyword.length + 1)).replace(/\s+/g, ''));
            return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
        } catch { continue; }
    }
    return null;
}

/**
 * The card as a PNG: `image` (PNG bytes, default the book cover) with the card JSON in a `chara` tEXt chunk, set just before IEND.
 * Any card data the image already had is dropped. The same inputs give the same bytes.
 */
export function exportCardPng(cardJson, image = null) {
    const chunks = pngChunks(image ?? defaultCoverPng());
    if (!chunks) throw new Error('The card image is not a PNG');
    const bytes = new TextEncoder().encode(cardJson);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    const text = chunk('tEXt', join([new TextEncoder().encode('chara\0'), new TextEncoder().encode(btoa(binary))]));
    const kept = chunks.filter(item => !isCardText(item));
    const end = kept.pop();
    return join([SIGNATURE, ...kept.map(item => chunk(item.type, item.data)), text, chunk(end.type, end.data)]);
}
