// Shared helpers for the code module tests (docs/PART5B_SPEC.md §8, §9 M6): a reader for the zips the writer makes,
// the writer of a scaffold into a folder, and the npm command to run its tests.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32 } from '../../src/card-png.js';

const bytesOf = text => new TextEncoder().encode(text);

// Reads a zip written by zipStore: EOCD → central directory → local headers, checking every field of §3.9 on the way.
export function readZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.ok(bytes.length >= 22, 'at least an end record');
    const end = bytes.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50, 'end record signature');
    assert.equal(view.getUint16(end + 4, true), 0, 'disk number');
    assert.equal(view.getUint16(end + 6, true), 0, 'central directory disk');
    const count = view.getUint16(end + 8, true);
    assert.equal(view.getUint16(end + 10, true), count, 'entries on this disk');
    const cdSize = view.getUint32(end + 12, true);
    const cdOffset = view.getUint32(end + 16, true);
    assert.equal(view.getUint16(end + 20, true), 0, 'comment length');
    assert.equal(cdOffset + cdSize, end, 'central directory ends where the end record starts');

    const central = [];
    let at = cdOffset;
    for (let i = 0; i < count; i++) {
        assert.equal(view.getUint32(at, true), 0x02014b50, 'central entry signature');
        const nameLength = view.getUint16(at + 28, true);
        const entry = {
            madeBy: view.getUint16(at + 4, true), needed: view.getUint16(at + 6, true), flags: view.getUint16(at + 8, true),
            method: view.getUint16(at + 10, true), time: view.getUint16(at + 12, true), date: view.getUint16(at + 14, true),
            crc: view.getUint32(at + 16, true), compressed: view.getUint32(at + 20, true), uncompressed: view.getUint32(at + 24, true),
            extra: view.getUint16(at + 30, true), comment: view.getUint16(at + 32, true), disk: view.getUint16(at + 34, true),
            internal: view.getUint16(at + 36, true), external: view.getUint32(at + 38, true), localOffset: view.getUint32(at + 42, true),
            path: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        };
        central.push(entry);
        at += 46 + nameLength;
    }
    assert.equal(at, end, 'the central directory has exactly the entries the end record counts');

    let expected = 0;
    const records = central.map(entry => {
        assert.equal(entry.localOffset, expected, `${entry.path} starts where the previous entry ends`);
        const local = entry.localOffset;
        assert.equal(view.getUint32(local, true), 0x04034b50, `${entry.path} local signature`);
        assert.equal(view.getUint16(local + 4, true), 10, `${entry.path} version needed`);
        assert.equal(view.getUint16(local + 6, true), 0x0800, `${entry.path} flags`);
        assert.equal(view.getUint16(local + 8, true), 0, `${entry.path} method`);
        assert.equal(view.getUint16(local + 10, true), 0, `${entry.path} time`);
        assert.equal(view.getUint16(local + 12, true), 0x0021, `${entry.path} date`);
        assert.equal(view.getUint32(local + 14, true), entry.crc, `${entry.path} crc in local header`);
        assert.equal(view.getUint32(local + 18, true), entry.compressed, `${entry.path} compressed size`);
        assert.equal(view.getUint32(local + 22, true), entry.uncompressed, `${entry.path} uncompressed size`);
        const nameLength = view.getUint16(local + 26, true);
        assert.equal(view.getUint16(local + 28, true), 0, `${entry.path} extra length`);
        assert.deepEqual(bytes.subarray(local + 30, local + 30 + nameLength), bytesOf(entry.path), `${entry.path} name bytes`);
        assert.equal(entry.compressed, entry.uncompressed, `${entry.path} stored`);
        const data = bytes.slice(local + 30 + nameLength, local + 30 + nameLength + entry.uncompressed);
        assert.equal(crc32(data), entry.crc, `${entry.path} data crc`);
        expected = local + 30 + nameLength + entry.uncompressed;
        return { path: entry.path, data, crc: entry.crc, header: entry };
    });
    assert.equal(expected, cdOffset, 'the local entries end where the central directory starts');
    return records;
}

/** Writes scaffold entries ([{ path, data }], paths relative to the scaffold root) into `dir`. */
export function writeScaffold(dir, entries) {
    for (const { path, data } of entries) {
        const target = join(dir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
    }
}

/** The npm executable for this platform. */
export function npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
