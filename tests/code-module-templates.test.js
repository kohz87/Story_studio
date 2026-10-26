// The code module templates and the golden scaffold (docs/PART5B_SPEC.md §3.3, §3.6, §4, §8): the bytes of every copied
// file against its SHA-256 in section 4.3, the eleven template files, the golden paths, the placeholders each template
// may use, the text rules, the network and loader scan, and whether the golden JavaScript parses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstReference } from '../scripts/dist-scan.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const templateDir = join(root, 'src', 'code-module', 'templates');
const goldenDir = join(root, 'tests', 'golden', 'code-module', 'lantern-oil');

const TEMPLATES = [
    'README.md.tmpl', 'capabilities.js.tmpl', 'capability-row.md.tmpl', 'gitignore.tmpl', 'index.js.tmpl',
    'module.js.tmpl', 'module.test.js.tmpl', 'part.js.tmpl', 'screen-const.js.tmpl', 'screen-row.md.tmpl', 'vendor-README.md.tmpl',
];
// The golden tree's files of section 4.2, with `.golden` appended in the repository.
const GOLDEN_PATHS = [
    '.gitignore', 'README.md', 'index.js', 'manifest.json', 'package.json', 'src/module.js', 'src/parts/lantern.js',
    'tests/module.test.js', 'tests/vendor/README.md',
];
const PLACEHOLDERS = [
    'moduleId', 'domain', 'field', 'kind', 'kindLabel', 'commandType', 'queryName', 'screenId', 'capability', 'min', 'max',
    'initial', 'step', 'nameJs', 'descriptionJs', 'labelJs', 'actionJs', 'nameMd', 'descriptionMd', 'actionMd', 'screens',
];
const BLOCKS = ['capabilities', 'capabilityRow', 'screenConst', 'screenRow'];

// The 21 SHA-256 values of section 4.3, keyed by path in the repository.
const SHA256 = {
    'tests/fixtures/code-module/golden-inputs.json': '0b961eca7105cb0f6a7fc8aa83b971ff2d54dd535affa28f0639c877ad11419f',
    'tests/golden/code-module/lantern-oil/.gitignore.golden': '4d56952b0fb13bf8f9b6c13a6d4c34a075bac3af447636a1df4335d7576e2f97',
    'tests/golden/code-module/lantern-oil/README.md.golden': 'a917a085e84f1290c6fa9520b440a35d5da040b020725cb8989ebe90bcc7b2dd',
    'tests/golden/code-module/lantern-oil/index.js.golden': 'b8bcb33664348a2f528fec6a883757212e1e3bab1c80db609a2aebf789256057',
    'tests/golden/code-module/lantern-oil/manifest.json.golden': '50395097f8c5bde0c56375a7adbab92df0ec4c12590131e43927ae02a706d812',
    'tests/golden/code-module/lantern-oil/package.json.golden': '001472b0d1ab6c21140932ccd9a5debc0a55ae48de05565bc71d9b6fb1a80760',
    'tests/golden/code-module/lantern-oil/src/module.js.golden': '7543e5c7fa006ed8d5f4941f911a86bcba508fcdcd38c2d24c87ea990d762d2c',
    'tests/golden/code-module/lantern-oil/src/parts/lantern.js.golden': '6f9044bc60029d98b4649cf938a2025542e965370839b4cb817b4042ee82d7b2',
    'tests/golden/code-module/lantern-oil/tests/module.test.js.golden': 'e1f28ee62a7860e4c3bc159735dd83eb56b9229fd2c44272b3cb4a4ca435369d',
    'tests/golden/code-module/lantern-oil/tests/vendor/README.md.golden': 'ed5eb30368ec4e0f9209892b5dea53fd42a94de992e0480030b391a1cba35c24',
    'src/code-module/templates/README.md.tmpl': '6f8359ca65f00d04a266be9b26f4c1ec106f2f7f343fcaf7f37ceed3150d9a77',
    'src/code-module/templates/capabilities.js.tmpl': 'b0a14a036f525984260b647f1cf9bfb2cbcdcac5e39645b9d7c4534dd4985d4f',
    'src/code-module/templates/capability-row.md.tmpl': '377066533d5bb8dfe109f49198e680458c77bf7f4abd0cbf2842a9a630dd9f7b',
    'src/code-module/templates/gitignore.tmpl': '4d56952b0fb13bf8f9b6c13a6d4c34a075bac3af447636a1df4335d7576e2f97',
    'src/code-module/templates/index.js.tmpl': '365c3fe0a2981361a0712643eef2113819fe77113aa041ce396bb0b02254695e',
    'src/code-module/templates/module.js.tmpl': 'b619f8fdee3a2672bf50fc1a20fe4987c69b9dd7590c9f54af7023bbbd354bf1',
    'src/code-module/templates/module.test.js.tmpl': '9923be2069229aa290e40dabc7217e69b1178adb38dee6fabc5f7d3c13e98813',
    'src/code-module/templates/part.js.tmpl': 'a6f759ca0f5c7049685208b46adb0657342c87d57dae8dbc5c5bbb0d5c09e8ab',
    'src/code-module/templates/screen-const.js.tmpl': '6e79eef7aa7f1c69096119e73742635f11b67a3c0f76d22a7d9cba91a9150293',
    'src/code-module/templates/screen-row.md.tmpl': '886cc41617f74c97b56d27a43aca24fe6a73870fb3726c65d2a6c76170982c7f',
    'src/code-module/templates/vendor-README.md.tmpl': 'ed5eb30368ec4e0f9209892b5dea53fd42a94de992e0480030b391a1cba35c24',
};

const read = path => readFileSync(path, 'utf8');
const listFiles = (dir, base = dir) => readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, base) : [relative(base, path).split('\\').join('/')];
});

// Every `{{name}}` or whole-line `{{@name}}` in a template; `{{ x.y }}` with spaces is Story Block's own binding, not ours.
const PLACEHOLDER = /\{\{(@?)([A-Za-z][A-Za-z0-9]*)\}\}/g;
function placeholdersOf(text) {
    const names = { inline: [], block: [] };
    for (const match of text.matchAll(PLACEHOLDER)) {
        if (match[1]) {
            const line = text.slice(text.lastIndexOf('\n', match.index - 1) + 1, text.indexOf('\n', match.index));
            assert.equal(line, match[0], `{{@${match[2]}}} must be the whole line`);
            names.block.push(match[2]);
        } else {
            names.inline.push(match[2]);
        }
    }
    return names;
}

test('the copied files have the SHA-256 values of section 4.3, and there are 21 of them', () => {
    assert.equal(Object.keys(SHA256).length, 21);
    for (const [path, expected] of Object.entries(SHA256)) {
        const actual = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
        assert.equal(actual, expected, path);
    }
});

test('the golden tree holds exactly the nine golden files of section 4.2, with .golden appended', () => {
    assert.deepEqual(listFiles(goldenDir), GOLDEN_PATHS.map(path => `${path}.golden`).sort());
});

test('the eleven templates are the ones section 3.6 names', () => {
    assert.deepEqual(listFiles(templateDir), [...TEMPLATES].sort());
});

test('each template uses only the placeholders and blocks of section 3.3, and each one is used somewhere', () => {
    const inline = new Set();
    const blocks = new Set();
    for (const name of TEMPLATES) {
        const text = read(join(templateDir, name));
        const found = placeholdersOf(text);
        // What is left once the placeholders are removed must hold no unfilled `{{`, except Story Block's spaced bindings.
        const rest = text.replace(PLACEHOLDER, '').replace(/\{\{ [^\n]*? \}\}/g, '');
        assert.doesNotMatch(rest, /\{\{/, `${name} has a placeholder the spec does not name`);
        for (const key of found.inline) { assert.ok(PLACEHOLDERS.includes(key), `${name}: {{${key}}}`); inline.add(key); }
        for (const key of found.block) { assert.ok(BLOCKS.includes(key), `${name}: {{@${key}}}`); blocks.add(key); }
    }
    assert.deepEqual([...inline].sort(), [...PLACEHOLDERS].sort());
    assert.deepEqual([...blocks].sort(), [...BLOCKS].sort());
});

// Section 3.6: each template ends with exactly one line break (screen-const with a blank line) and has no trailing spaces.
// The blank line is kept under git diff --check by .gitattributes, which names screen-const.js.tmpl and nothing else.
test('each template ends with exactly one line break (screen-const with a blank line) and has no trailing spaces', () => {
    for (const name of TEMPLATES) {
        const text = read(join(templateDir, name));
        if (name === 'screen-const.js.tmpl') {
            assert.ok(text.endsWith('};\n\n'), `${name} ends with "};" and a blank line`);
            assert.ok(!text.endsWith('\n\n\n'), `${name} has no second blank line`);
        } else {
            assert.ok(text.endsWith('\n'), `${name} ends with a line break`);
            assert.ok(!text.endsWith('\n\n'), `${name} has one final line break, not two`);
        }
        assert.doesNotMatch(text, /[ \t]+$/m, `${name} has no trailing spaces`);
    }
});

test('no template and no golden file holds a network or loader reference', () => {
    for (const name of TEMPLATES) assert.equal(firstReference(read(join(templateDir, name))), null, name);
    for (const file of listFiles(goldenDir)) assert.equal(firstReference(read(join(goldenDir, file))), null, file);
});

test('the golden scaffold holds the expected files, and its JavaScript and JSON parse', () => {
    const files = listFiles(goldenDir);
    assert.ok(files.every(file => file.endsWith('.golden')), 'every golden file ends in .golden');
    const dir = mkdtempSync(join(tmpdir(), 'studio-code-module-golden-'));
    try {
        for (const file of files) {
            const target = join(dir, file.slice(0, -'.golden'.length));
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, readFileSync(join(goldenDir, file)));
        }
        for (const file of files) {
            const target = join(dir, file.slice(0, -'.golden'.length));
            if (target.endsWith('.js')) execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
            if (target.endsWith('.json')) JSON.parse(readFileSync(target, 'utf8'));
        }
        assert.equal(files.filter(file => file.endsWith('.js.golden')).length, 4);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
