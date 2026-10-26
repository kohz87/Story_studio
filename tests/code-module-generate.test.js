// The generator (docs/PART5B_SPEC.md §3.3, §3.7, §6.2, §8): the golden inputs give the nine golden files byte for byte,
// the same inputs give the same zip, the variants leave no placeholder behind, refused inputs give no files, and the
// timings the spec asks for hold.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateScaffold, scaffoldEntries, scaffoldZip } from '../src/code-module/generate.js';
import { VENDOR_FILES } from '../src/code-module/assets.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const golden = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'code-module', 'golden-inputs.json'), 'utf8'));
const goldenDir = join(root, 'tests', 'golden', 'code-module', 'lantern-oil');
const WRITTEN = ['.gitignore', 'README.md', 'index.js', 'manifest.json', 'package.json', 'src/module.js', 'src/parts/lantern.js', 'tests/module.test.js', 'tests/vendor/README.md'];

test('the golden inputs give the nine golden files, byte for byte', () => {
    const { entries } = scaffoldEntries(golden);
    for (const path of WRITTEN) {
        const entry = entries.find(item => item.path === path);
        assert.ok(entry, `${path} is written`);
        const expected = readFileSync(join(goldenDir, `${path}.golden`));
        assert.equal(Buffer.compare(Buffer.from(entry.data), expected), 0, `${path} differs from its golden`);
    }
});

test('scaffoldEntries lists the nine written files and the copied ones, in path order', () => {
    const { entries } = scaffoldEntries(golden);
    const paths = entries.map(entry => entry.path);
    assert.equal(paths.length, WRITTEN.length + VENDOR_FILES.length);
    assert.equal(scaffoldEntries(golden).inputs.moduleId, 'lantern-oil');
    assert.deepEqual(paths, [...paths].sort());
    assert.deepEqual(paths.filter(path => WRITTEN.includes(path)), WRITTEN);
    assert.deepEqual(paths.filter(path => !WRITTEN.includes(path)), VENDOR_FILES.map(([path]) => path).sort());
});

test('the same inputs give the same zip bytes, twice in one process', () => {
    const first = scaffoldZip(golden);
    const second = scaffoldZip(golden);
    assert.equal(first.ok, true);
    assert.equal(first.filename, 'lantern-oil.zip');
    assert.equal(Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes)), 0);
});

test('the variants render without leftover placeholders, and leave out what they turn off', () => {
    const cold = {
        ...golden, moduleId: 'cold-tally', name: 'Cold', domain: 'chill', field: 'degrees', label: 'Degrees', min: -5, max: 5,
        initial: -5, step: 10, kind: 'chill', kindLabel: 'by', command: 'warm', query: 'now', action: 'Warm up', screen: false,
        capability: '', author: '',
    };
    const hearts = {
        ...golden, moduleId: 'hearts3', name: 'Garðar’s — tally (old)', description: 'Ünïcode: ok; yes! (really) – fine?',
        domain: 'hearts', field: 'left', label: 'Hearts', min: 0, max: 3, initial: 3, step: 1, kind: 'heart', kindLabel: 'n',
        command: 'lose', query: 'count', action: 'Lose one', screen: true,
    };
    for (const variant of [cold, hearts]) {
        const { files } = generateScaffold(variant);
        for (const { path, text } of files) assert.doesNotMatch(text, /\{\{@?[A-Za-z]/, `${path} has a placeholder left`);
    }
    const coldFiles = Object.fromEntries(generateScaffold(cold).files.map(({ path, text }) => [path, text]));
    assert.doesNotMatch(coldFiles['src/module.js'], /capabilities:/);
    assert.doesNotMatch(coldFiles['src/parts/chill.js'], /export const screen/);
    assert.match(coldFiles['src/parts/chill.js'], /screens: \[\]/);
    assert.doesNotMatch(coldFiles['README.md'], /\| Screen |\| Capability /);
    assert.match(coldFiles['manifest.json'], /"author": ""/);
    const heartsFiles = Object.fromEntries(generateScaffold(hearts).files.map(({ path, text }) => [path, text]));
    assert.match(heartsFiles['src/parts/hearts.js'], /export const screen/);
    assert.match(heartsFiles['src/module.js'], /capabilities: \['lantern-oil'\]/);
    assert.match(heartsFiles['src/module.js'], /MODULE_NAME = 'Garðar’s — tally \(old\)'/);
    assert.match(heartsFiles['src/parts/hearts.js'], /ACTION = 'Lose one'/);
});

test('refused inputs give the errors of section 5, and no files', () => {
    const refused = { ...golden, moduleId: 'story-block' };
    const expected = [{ code: 'reserved', field: 'moduleId', message: 'Module id "story-block" is taken by Story Block or another Story Suite module.' }];
    const generated = generateScaffold(refused);
    assert.equal(generated.ok, false);
    assert.deepEqual(generated.errors, expected);
    assert.equal('files' in generated, false);
    const entries = scaffoldEntries(refused);
    assert.equal(entries.ok, false);
    assert.deepEqual(entries.errors, expected);
    assert.equal('entries' in entries, false);
    const zip = scaffoldZip(refused);
    assert.equal(zip.ok, false);
    assert.equal('bytes' in zip, false);
});

test('generateScaffold takes under 50 ms for the golden inputs, and scaffoldZip is logged against 2 s and asserted under 5 s', () => {
    generateScaffold(golden);
    const started = performance.now();
    generateScaffold(golden);
    const generating = performance.now() - started;
    const zipStarted = performance.now();
    scaffoldZip(golden);
    const zipping = performance.now() - zipStarted;
    console.log(`timing: generateScaffold ${generating.toFixed(2)} ms, scaffoldZip ${zipping.toFixed(2)} ms`);
    assert.ok(generating < 50, `generateScaffold took ${generating} ms`);
    assert.ok(zipping < 5000, `scaffoldZip took ${zipping} ms (the logged target is 2000 ms)`);
});
