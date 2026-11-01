// Pictures for tests, made in code: a PNG of a smooth gradient with a little noise (large, but it shrinks well), and tiny headers.
import { deflateSync } from 'node:zlib';
import { crc32 } from '../../vendor/story-block/src/v2/packs/zip.js';

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

/** A width x height RGB PNG. `noise` is how far each value may stray from the gradient (0 gives a tiny file). */
export function pngBytes(width = 400, height = 500, noise = 12) {
    const row = 1 + width * 3;
    const raw = Buffer.alloc(row * height);
    let seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 0x100000000; };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = y * row + 1 + x * 3;
            raw[at] = Math.max(0, Math.min(255, Math.round(255 * x / width + (random() - 0.5) * noise)));
            raw[at + 1] = Math.max(0, Math.min(255, Math.round(255 * y / height + (random() - 0.5) * noise)));
            raw[at + 2] = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.sin(x / 30) * Math.cos(y / 40) + (random() - 0.5) * noise)));
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; header[9] = 2;
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** The first bytes of a WebP (a lossy VP8 header of the given size), enough to be recognised and measured. */
export function webpBytes(width = 48, height = 60, size = 40) {
    const out = Buffer.alloc(30 + size);
    out.write('RIFF', 0, 'ascii'); out.writeUInt32LE(out.length - 8, 4); out.write('WEBP', 8, 'ascii'); out.write('VP8 ', 12, 'ascii');
    out.writeUInt32LE(out.length - 20, 16);
    out.writeUInt16LE(width, 26); out.writeUInt16LE(height, 28);
    return new Uint8Array(out);
}
