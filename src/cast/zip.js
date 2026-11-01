// A pack as one zip (pure; no dependency): `pack.json` first, then `portraits/<file>`. Story Block reads it (vendor .../packs/bundle.js).
//
// writeZip(files, { deflate }) -> Promise<Uint8Array>, files `[{ name, bytes }]`. A file is deflated with the browser's own
// CompressionStream('deflate-raw') when that exists and it makes the file smaller; otherwise it is stored. Names are UTF-8, there are
// no folder entries, no extra fields, and the time stamp is fixed, so the same files always give the same bytes.

import { crc32 } from '../../vendor/story-block/src/v2/packs/zip.js';

const DOS_DATE = (1 << 5) | 1; // 1980-01-01, time 00:00:00
const UTF8 = 0x0800;

async function deflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function writeZip(files, { deflate = typeof CompressionStream === 'function' } = {}) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const { name, bytes } of files) {
        const label = encoder.encode(name);
        const packed = deflate && bytes.length ? await deflateRaw(bytes) : null;
        const method = packed && packed.length < bytes.length ? 8 : 0;
        const body = method === 8 ? packed : bytes;
        const head = new DataView(new ArrayBuffer(30));
        head.setUint32(0, 0x04034b50, true);
        head.setUint16(4, method === 8 ? 20 : 10, true);
        head.setUint16(6, UTF8, true);
        head.setUint16(8, method, true);
        head.setUint16(12, DOS_DATE, true);
        head.setUint32(14, crc32(bytes), true);
        head.setUint32(18, body.length, true);
        head.setUint32(22, bytes.length, true);
        head.setUint16(26, label.length, true);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, method === 8 ? 20 : 10, true);
        entry.setUint16(8, UTF8, true);
        entry.setUint16(10, method, true);
        entry.setUint16(14, DOS_DATE, true);
        entry.setUint32(16, crc32(bytes), true);
        entry.setUint32(20, body.length, true);
        entry.setUint32(24, bytes.length, true);
        entry.setUint16(28, label.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), label);
        parts.push(new Uint8Array(head.buffer), label, body);
        offset += 30 + label.length + body.length;
    }
    const size = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of all) { out.set(part, at); at += part.length; }
    return out;
}
