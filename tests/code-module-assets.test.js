// The generated src/code-module/assets.js (docs/PART5B_SPEC.md §3.8, §8): it is what the generator writes now, its
// stamp and closure are the vendored Story Block's, every copied file decodes to the vendored bytes, the licence is
// Studio's LICENSE, and the text holds no network or loader reference (so it can sit in the bundle unencoded).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeModuleAssets, testkitFiles, TESTKIT_ROOTS, versionText } from '../scripts/code-module-assets.mjs';
import { firstReference } from '../scripts/dist-scan.mjs';
import { SB_STAMP, TEMPLATES, VENDOR_FILES } from '../src/code-module/assets.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const vendorDir = join(root, 'vendor', 'story-block');
const committed = readFileSync(join(root, 'src', 'code-module', 'assets.js'), 'utf8');
const copied = new Map(VENDOR_FILES.map(([path, base64]) => [path, Buffer.from(base64, 'base64')]));

// The baseline these counts describe: Story Block 2.11.0. The closure contains
// 144 files, so the copied set has 147 entries (the closure, plus LICENSE, package.json and the generated VERSION text).
const BASELINE = { version: '2.11.0', commit: '455c10442dc7505908d4fa198a45d0dec2a2bb19', files: 144 };

test('the committed assets.js is exactly what the generator writes now', () => {
    assert.equal(committed, codeModuleAssets(root));
});

test('the stamp names the vendored Story Block version and commit, and the closure has the baseline count', () => {
    assert.deepEqual(SB_STAMP, BASELINE);
    const list = testkitFiles(vendorDir);
    assert.equal(list.length, BASELINE.files);
    assert.deepEqual(list, [...list].sort());
    for (const rel of TESTKIT_ROOTS) assert.ok(list.includes(rel), rel);
    const head = readFileSync(join(vendorDir, 'VERSION'), 'utf8').split('\n');
    assert.equal(head[0], `Story Block ${BASELINE.version}`);
    assert.equal(head[1], `commit ${BASELINE.commit}`);
});

test('the copied set is the closure, plus VERSION, package.json and the licence: 147 entries', () => {
    const list = testkitFiles(vendorDir);
    assert.equal(VENDOR_FILES.length, BASELINE.files + 3);
    const paths = VENDOR_FILES.map(([path]) => path);
    assert.deepEqual(paths, [...paths].sort());
    assert.deepEqual(paths.filter(path => path.startsWith('tests/vendor/story-block/')).map(path => path.slice('tests/vendor/story-block/'.length)).filter(path => !['VERSION', 'package.json'].includes(path)), list);
    assert.ok(copied.has('tests/vendor/LICENSE-story-block'));
});

test('every copied file decodes to the bytes of the vendored copy', () => {
    for (const rel of testkitFiles(vendorDir)) {
        assert.ok(copied.get(`tests/vendor/story-block/${rel}`).equals(readFileSync(join(vendorDir, rel))), rel);
    }
    assert.ok(copied.get('tests/vendor/story-block/package.json').equals(readFileSync(join(vendorDir, 'package.json'))));
});

test('the VERSION file is the four-line text of section 3.8, and the licence is the root LICENSE', () => {
    assert.equal(copied.get('tests/vendor/story-block/VERSION').toString('utf8'), versionText(vendorDir, BASELINE.files));
    assert.equal(copied.get('tests/vendor/story-block/VERSION').toString('utf8'), `Story Block ${BASELINE.version}\ncommit ${BASELINE.commit}\nfiles ${BASELINE.files}\nmatrix none\n`);
    assert.ok(copied.get('tests/vendor/LICENSE-story-block').equals(readFileSync(join(root, 'LICENSE'))));
});

test('the templates in the module are the ones in src/code-module/templates', () => {
    const names = readdirSync(join(root, 'src', 'code-module', 'templates')).filter(name => name.endsWith('.tmpl')).sort();
    assert.deepEqual(Object.keys(TEMPLATES).sort(), names);
    for (const name of names) assert.equal(TEMPLATES[name], readFileSync(join(root, 'src', 'code-module', 'templates', name), 'utf8'), name);
});

test('the generated text holds no network or loader reference', () => {
    assert.equal(firstReference(committed), null);
});
