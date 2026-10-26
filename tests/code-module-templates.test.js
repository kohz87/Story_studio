// The code-module templates and the golden scaffold (docs/PART5B_SPEC.md §3.3, §3.6, §4, §8): the eleven template
// files, the placeholders each one may use, the text rules, the network and loader scan, and whether the golden
// JavaScript parses. The bytes themselves are copied from the spec, so this file checks shape, not wording.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
const PLACEHOLDERS = [
    'moduleId', 'domain', 'field', 'kind', 'kindLabel', 'commandType', 'queryName', 'screenId', 'capability', 'min', 'max',
    'initial', 'step', 'nameJs', 'descriptionJs', 'labelJs', 'actionJs', 'nameMd', 'descriptionMd', 'actionMd', 'screens',
];
const BLOCKS = ['capabilities', 'capabilityRow', 'screenConst', 'screenRow'];

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

// Section 3.6: each template ends with exactly one line break, except the block snippet screen-const.js.tmpl, which
// ends with "};" and then a blank line (its gap in the golden part file). No template has trailing spaces.
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
    const files = listFiles(goldenDir).filter(file => !file.startsWith('tests/vendor/'));
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
