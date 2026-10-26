// The scaffold runs its own tests (docs/PART5B_SPEC.md §8, §9 M6): the golden inputs and two variants are written to temp
// folders from scaffoldEntries, `npm test` runs in each, and it must pass all six of its tests. The golden one is also
// unpacked from scaffoldZip's bytes with the test reader, so the zip carries a working module too.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldEntries, scaffoldZip } from '../src/code-module/generate.js';
import { npmCommand, readZip, writeScaffold } from './helpers/code-module.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/code-module/golden-inputs.json', import.meta.url)), 'utf8'));
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

// Runs the scaffold's own `npm test` in `dir` and asserts it passes all six of its tests. The variable the test runner
// sets for its own children is removed, or the scaffold's `node --test` would refuse to run inside this test.
function runOwnTests(dir) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(npmCommand(), ['test'], { cwd: dir, encoding: 'utf8', timeout: 120000, env });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    // Node 22 prints the TAP summary (`# pass 6`) to a pipe; Node 24, which CI uses, prints the spec one (`ℹ pass 6`).
    assert.match(output, /^(?:# |ℹ )pass 6$/m, output);
    assert.match(output, /^(?:# |ℹ )fail 0$/m, output);
    return output;
}

// Writes entries into a fresh temp folder, runs the scaffold's tests there, and removes the folder.
function passesOwnTests(entries) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-code-module-run-'));
    try {
        writeScaffold(dir, entries);
        return runOwnTests(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('the golden scaffold, written from its entries, passes its own six tests', () => {
    const { entries } = scaffoldEntries(golden);
    passesOwnTests(entries);
});

test('the cold-tally variant (no screen, no capability, no author) passes its own six tests', () => {
    const { entries } = scaffoldEntries(cold);
    passesOwnTests(entries);
});

test('the hearts3 variant (a second name, Unicode text, a screen) passes its own six tests', () => {
    const { entries } = scaffoldEntries(hearts);
    passesOwnTests(entries);
});

test('the golden scaffold, unpacked from its zip with the test reader, passes its own six tests', () => {
    const { bytes } = scaffoldZip(golden);
    const prefix = 'lantern-oil/';
    const entries = readZip(bytes).map(({ path, data }) => {
        assert.ok(path.startsWith(prefix), path);
        return { path: path.slice(prefix.length), data };
    });
    passesOwnTests(entries);
});
