// The code module's zip writer (docs/PART5B_SPEC.md §3.9): every entry STORED, fixed times and attributes, names in
// sorted order, so the same entries always give the same bytes. CRC-32 is the PNG writer's (src/card-png.js).

import { crc32 } from '../card-png.js';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
const MAX_ENTRIES = 65535;
const MAX_BYTES = 2 ** 32;
const NAME_SEGMENT = /^[A-Za-z0-9._-]+$/;

function checkPath(path) {
    if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.includes('\\')) throw new Error(`zip: refused path "${path}"`);
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.' || segment === '..' || !NAME_SEGMENT.test(segment)) throw new Error(`zip: refused path "${path}"`);
    }
}

/** entries: [{ path, data: Uint8Array }] → the zip's bytes, entries sorted by path (JavaScript string order). */
export function zipStore(entries) {
    if (entries.length > MAX_ENTRIES) throw new Error('zip: more than 65,535 entries');
    const seen = new Set();
    let total = END_SIZE;
    for (const entry of entries) {
        checkPath(entry.path);
        if (seen.has(entry.path)) throw new Error(`zip: duplicate path "${entry.path}"`);
        seen.add(entry.path);
        if (!(entry.data instanceof Uint8Array)) throw new Error(`zip: "${entry.path}" is not bytes`);
        total += LOCAL_SIZE + entry.path.length + entry.data.length + CENTRAL_SIZE + entry.path.length;
    }
    if (total >= MAX_BYTES) throw new Error('zip: 4 GiB or more');

    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    const encoder = new TextEncoder();
    const records = [];
    let at = 0;
    for (const { path, data } of sorted) {
        const name = encoder.encode(path);
        const crc = crc32(data);
        records.push({ name, crc, size: data.length, offset: at });
        view.setUint32(at, LOCAL_SIGNATURE, true);
        view.setUint16(at + 4, 10, true);        // version needed
        view.setUint16(at + 6, 0x0800, true);    // flags: UTF-8 names
        view.setUint16(at + 8, 0, true);         // method: stored
        view.setUint16(at + 10, 0, true);        // time 00:00:00
        view.setUint16(at + 12, 0x0021, true);   // date 1980-01-01
        view.setUint32(at + 14, crc, true);
        view.setUint32(at + 18, data.length, true);
        view.setUint32(at + 22, data.length, true);
        view.setUint16(at + 26, name.length, true);
        view.setUint16(at + 28, 0, true);        // extra length
        out.set(name, at + LOCAL_SIZE);
        out.set(data, at + LOCAL_SIZE + name.length);
        at += LOCAL_SIZE + name.length + data.length;
    }
    const centralStart = at;
    for (const { name, crc, size, offset } of records) {
        view.setUint32(at, CENTRAL_SIGNATURE, true);
        view.setUint16(at + 4, 0x031e, true);    // made by: Unix, 3.0
        view.setUint16(at + 6, 10, true);        // version needed
        view.setUint16(at + 8, 0x0800, true);
        view.setUint16(at + 10, 0, true);        // method: stored
        view.setUint16(at + 12, 0, true);        // time
        view.setUint16(at + 14, 0x0021, true);   // date
        view.setUint32(at + 16, crc, true);
        view.setUint32(at + 20, size, true);
        view.setUint32(at + 24, size, true);
        view.setUint16(at + 28, name.length, true);
        view.setUint16(at + 30, 0, true);        // extra length
        view.setUint16(at + 32, 0, true);        // comment length
        view.setUint16(at + 34, 0, true);        // disk number
        view.setUint16(at + 36, 0, true);        // internal attributes
        view.setUint32(at + 38, 0x81a40000, true); // external attributes: regular file, mode 0644
        view.setUint32(at + 42, offset, true);
        out.set(name, at + CENTRAL_SIZE);
        at += CENTRAL_SIZE + name.length;
    }
    view.setUint32(at, END_SIGNATURE, true);
    view.setUint16(at + 4, 0, true);             // this disk
    view.setUint16(at + 6, 0, true);             // central directory's disk
    view.setUint16(at + 8, records.length, true);
    view.setUint16(at + 10, records.length, true);
    view.setUint32(at + 12, at - centralStart, true);
    view.setUint32(at + 16, centralStart, true);
    view.setUint16(at + 20, 0, true);            // comment length
    return out;
}
