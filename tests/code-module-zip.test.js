// The code module's zip writer (docs/PART5B_SPEC.md §3.9, §8): every field of the local header, the central entry and the
// end record is read back and checked by a small reader written here, the CRC-32 is Node's, and the writer refuses what
// the spec refuses. The reader checks structure only; `unzip -t` and `python3 -m zipfile -t` are run by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { zipStore } from '../src/code-module/zip.js';
import { crc32 } from '../src/card-png.js';

const bytesOf = text => new TextEncoder().encode(text);

// Reads a zip written by zipStore: EOCD → central directory → local headers, checking every field of §3.9 on the way.
function readZip(bytes) {
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

const sample = () => [
    { path: 'pack/README.md', data: bytesOf('# Pack\n') },
    { path: 'pack/src/module.js', data: bytesOf('export const x = 1;\n') },
    { path: 'pack/tests/vendor/LICENSE', data: new Uint8Array(300).map((_, i) => i & 255) },
];

test('the bytes of each field are the ones section 3.9 gives, read back', () => {
    const zip = zipStore(sample());
    const entries = readZip(zip);
    assert.deepEqual(entries.map(entry => entry.path), ['pack/README.md', 'pack/src/module.js', 'pack/tests/vendor/LICENSE']);
    for (const { path, data } of sample()) {
        const found = entries.find(entry => entry.path === path);
        assert.deepEqual(found.data, data, path);
        assert.equal(found.header.madeBy, 0x031e, path);
        assert.equal(found.header.needed, 10, path);
        assert.equal(found.header.flags, 0x0800, path);
        assert.equal(found.header.method, 0, path);
        assert.equal(found.header.time, 0, path);
        assert.equal(found.header.date, 0x0021, path);
        assert.equal(found.header.compressed, data.length, path);
        assert.equal(found.header.uncompressed, data.length, path);
        assert.equal(found.header.extra, 0, path);
        assert.equal(found.header.comment, 0, path);
        assert.equal(found.header.disk, 0, path);
        assert.equal(found.header.internal, 0, path);
        assert.equal(found.header.external, 0x81a40000, path);
    }
});

test('CRC-32 is zlib.crc32 for the same bytes, and is the PNG writer\'s function', () => {
    const inputs = [new Uint8Array(0), bytesOf('123456789'), new Uint8Array(4096).map((_, i) => (i * 37) & 255)];
    for (const data of inputs) assert.equal(crc32(data), zlib.crc32(data));
    assert.equal(crc32(bytesOf('123456789')), 0xcbf43926);
});

test('an empty zip is only the end record, and reads back with no entries', () => {
    const zip = zipStore([]);
    assert.equal(zip.length, 22);
    assert.deepEqual([...zip], [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(readZip(zip), []);
});

test('the same entries give the same bytes, and the order they are given in does not matter', () => {
    const first = zipStore(sample());
    const second = zipStore(sample());
    assert.equal(Buffer.compare(Buffer.from(first), Buffer.from(second)), 0);
    const reversed = zipStore([...sample()].reverse());
    assert.equal(Buffer.compare(Buffer.from(first), Buffer.from(reversed)), 0);
});

test('entries are written in JavaScript string order (code units), uppercase before lowercase', () => {
    const names = ['b.txt', 'a/z', 'a/B', 'A.txt', 'a-b', 'a/a'];
    const zip = zipStore(names.map(path => ({ path, data: new Uint8Array(0) })));
    assert.deepEqual(readZip(zip).map(entry => entry.path), [...names].sort());
});

test('paths the spec refuses are refused', () => {
    const refused = ['', '/a', 'a\\b', 'a/./b', 'a/../b', 'a//b', 'a/', 'a b', 'ü', 'a:b', 'a?', '..'];
    for (const path of refused) assert.throws(() => zipStore([{ path, data: new Uint8Array(0) }]), /refused path/, JSON.stringify(path));
    assert.doesNotThrow(() => zipStore([{ path: 'lantern-oil/src/parts/lantern.js', data: new Uint8Array(0) }]));
    assert.doesNotThrow(() => zipStore([{ path: 'a/.gitignore', data: new Uint8Array(0) }]));
});

test('a duplicate path is refused', () => {
    assert.throws(() => zipStore([{ path: 'a.txt', data: new Uint8Array(0) }, { path: 'a.txt', data: new Uint8Array(1) }]), /duplicate path "a.txt"/);
});

test('more than 65,535 entries are refused, and exactly 65,535 are not', () => {
    const many = count => Array.from({ length: count }, (_, i) => ({ path: `f${i}`, data: new Uint8Array(0) }));
    assert.throws(() => zipStore(many(65536)), /more than 65,535 entries/);
    assert.equal(readZip(zipStore(many(65535))).length, 65535);
});

test('a total of 4 GiB or more is refused before any byte is copied', () => {
    // One entry of 2^32 - 112 bytes makes 2^32 with its headers and the end record (name "big.bin": 7 bytes).
    const size = 2 ** 32 - 112;
    assert.throws(() => zipStore([{ path: 'big.bin', data: { length: size } }]), /4 GiB or more/);
    assert.throws(() => zipStore([{ path: 'big.bin', data: { length: size + 1 } }]), /4 GiB or more/);
});

test('data that is not bytes is refused', () => {
    assert.throws(() => zipStore([{ path: 'a.txt', data: 'text' }]), /not bytes/);
});
