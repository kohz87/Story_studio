// The code module's zip writer (docs/PART5B_SPEC.md §3.9, §8): every field of the local header, the central entry and the
// end record is read back and checked by a small reader written here, the CRC-32 is Node's, and the writer refuses what
// the spec refuses. The reader checks structure only; `unzip -t` and `python3 -m zipfile -t` are run by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { zipStore } from '../src/code-module/zip.js';
import { crc32 } from '../src/card-png.js';

const bytesOf = text => new TextEncoder().encode(text);

import { readZip } from './helpers/code-module.js';

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
