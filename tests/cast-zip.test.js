import test from 'node:test';
import assert from 'node:assert/strict';
import { writeZip } from '../src/cast/zip.js';
import { readPackZip } from '../vendor/story-block/src/v2/packs/bundle.js';
import { readZip, crc32 } from '../vendor/story-block/src/v2/packs/zip.js';
import { pngBytes } from './helpers/images.js';
import { castPack } from './fixtures/cast.js';

const text = bytes => new TextDecoder().decode(bytes);
const files = () => [
    { name: 'pack.json', bytes: new TextEncoder().encode(JSON.stringify(castPack(), null, 2).repeat(1)) },
    { name: 'portraits/fenna.webp', bytes: pngBytes(40, 50, 6) },
];

test('the zip Studio writes is read by Story Block’s own reader: the pack text and each portrait come back byte for byte', async () => {
    const given = files();
    const zip = await writeZip(given);
    const read = await readPackZip(zip);
    assert.equal(read.ok, true, read.message);
    assert.equal(read.text, text(given[0].bytes));
    assert.deepEqual(read.files.map(file => file.name), ['fenna.webp']);
    assert.deepEqual(await read.files[0].read(), given[1].bytes);
});

test('a text file is deflated when that makes it smaller, a picture that does not shrink is stored, and the checksums are right', async () => {
    const mixed = Uint8Array.from({ length: 64 }, (_, n) => (n * 97 + 13) % 251);
    const raw = await writeZip([{ name: 'a.txt', bytes: new Uint8Array(5000) }, { name: 'b.bin', bytes: mixed }]);
    const view = new DataView(raw.buffer);
    // Local headers in order: the method is at byte 8, the packed size at 18, the name length at 26.
    const methods = [];
    for (let at = 0, n = 0; n < 2; n++) {
        methods.push(view.getUint16(at + 8, true));
        at += 30 + view.getUint16(at + 26, true) + view.getUint32(at + 18, true);
    }
    assert.deepEqual(methods, [8, 0]);
    assert.ok(raw.length < 5000);
    const [zeroes, kept] = readZip(raw);
    // read() checks the stored checksum and the size, so a wrong one would throw.
    assert.equal((await zeroes.read()).length, 5000);
    assert.deepEqual(await kept.read(), mixed);
    assert.equal(crc32(mixed), new DataView(raw.buffer).getUint32(30 + 5 + view.getUint32(18, true) + 14, true));
});

test('the same files always give the same zip bytes, and with deflate off every file is stored', async () => {
    const one = await writeZip(files());
    const two = await writeZip(files());
    assert.deepEqual(one, two);
    const stored = await writeZip(files(), { deflate: false });
    assert.ok(stored.length > one.length);
    const read = await readPackZip(stored);
    assert.equal(read.ok, true);
    assert.equal(read.text, text(files()[0].bytes));
});

test('a zip with no portraits is just pack.json, and an empty file is allowed', async () => {
    const zip = await writeZip([{ name: 'pack.json', bytes: new TextEncoder().encode('{}') }]);
    const read = await readPackZip(zip);
    assert.equal(read.ok, true);
    assert.deepEqual(read.files, []);
    assert.equal(readZip(await writeZip([{ name: 'pack.json', bytes: new Uint8Array(0) }])).length, 1);
});
