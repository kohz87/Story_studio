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
export function crc32(data) {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
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
export function exportCardPng(cardJson) {
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
    let binary = '';
    for (const value of bytes(cardJson)) binary += String.fromCharCode(value);
    const header = join([word(width), word(height), Uint8Array.of(8, 2, 0, 0, 0)]);
    return join([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header),
        chunk('IDAT', deflateStored(pixels)), chunk('tEXt', bytes('chara\0' + btoa(binary))), chunk('IEND', new Uint8Array())]);
}
