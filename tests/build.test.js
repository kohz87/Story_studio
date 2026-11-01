import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstReference, NETWORK, LOADERS } from '../scripts/dist-scan.mjs';
import { writeGenerated } from '../scripts/write-generated.mjs';

const html = readFileSync(new URL('../dist/story-studio.html', import.meta.url), 'utf8');
test('distribution has one classic inline script, inline styles, credits, and no runtime network or HTML injection', () => {
    assert.equal((html.match(/<script>/g) || []).length, 1);
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('Copyright (c) 2023 Phosphor Icons'));
    assert.ok(html.includes('THE SOFTWARE IS PROVIDED'));
    assert.doesNotMatch(html, NETWORK);
    assert.doesNotMatch(html, LOADERS);
    assert.ok(html.includes("connect-src 'none'"));
});

test('the build refuses both executable bypasses from review 108 B3 before writing a page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-scan-bypasses-'));
    try {
        for (const [name, source] of [
            ['request', '((...a)=>globalThis.fetch(...a))("/leak")'],
            ['module', '(p=>import(p))("data:text/javascript,export default 7")'],
        ]) {
            const entry = join(dir, `${name}.js`), out = join(dir, `${name}.html`);
            writeFileSync(entry, source);
            const result = spawnSync(process.execPath, ['scripts/build.mjs', '--entry', entry, '--out', out], { encoding: 'utf8' });
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, /Distribution contains a network or loader reference/);
            assert.equal(existsSync(out), false);
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two builds match each other and the committed distribution byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-deterministic-'));
    try {
        const pages = ['first.html', 'second.html'].map(name => {
            const out = join(dir, name);
            execFileSync(process.execPath, ['scripts/build.mjs', '--out', out], { stdio: 'pipe' });
            return readFileSync(out, 'utf8');
        });
        assert.equal(pages[0], pages[1]);
        assert.equal(pages[0], html);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Test files run in parallel and import src/assets/drawings.js and src/code-module/assets.js while this file runs the build. A build that
// truncated them first (a plain writeFile) could show another file an empty module: its import failed and the whole file was reported
// failed, now and then (class-skills-repair.test.js was the one that lost the race).
test('a build leaves the generated sources it did not change untouched, so no other test can import a half-written one', () => {
    const files = ['src/assets/drawings.js', 'src/code-module/assets.js'];
    const stamp = () => files.map(file => { const s = statSync(new URL(`../${file}`, import.meta.url)); return [s.ino, s.mtimeMs, s.size]; });
    const before = stamp();
    const dir = mkdtempSync(join(tmpdir(), 'studio-generated-'));
    try {
        execFileSync(process.execPath, ['scripts/build.mjs', '--out', join(dir, 'page.html')], { stdio: 'pipe' });
        assert.deepEqual(stamp(), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeGenerated writes only a change, through a sibling file renamed into place, and leaves no stray file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-write-generated-'));
    try {
        const path = join(dir, 'generated.js');
        assert.equal(writeGenerated(path, 'one\n'), true, 'a new file is written');
        const first = statSync(path);
        assert.equal(writeGenerated(path, 'one\n'), false, 'the same text is not written again');
        assert.equal(statSync(path).ino, first.ino);
        assert.equal(statSync(path).mtimeMs, first.mtimeMs);
        assert.equal(writeGenerated(path, 'two\n'), true);
        assert.equal(readFileSync(path, 'utf8'), 'two\n');
        assert.deepEqual(readdirSync(dir), ['generated.js']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the static scan rejects network and code loading with no default-function exemptions', () => {
    for (const bad of [
        'fetch(url)', 'globalThis.fetch(url)', 'const f = globalThis.fetch; f(url)',
        'import("./x.js")', 'import /* comment */ (path)', 'q=n=>import(m)',
        'new XMLHttpRequest()', 'new WebSocket(u)', 'new EventSource(u)', 'navigator.sendBeacon(u)',
        'a="https://example.com"', 'el.innerHTML=x', 'eval(code)', '(0, eval)(code)',
        'new Function(code)', 'new /* comment */ Function(code)',
        '"data:text/javascript,export default 7"', '"data:application/javascript;base64,eA=="',
        '"blob:null/module-id"', 'script.src="blob:" + id',
        'x=(...a)=>globalThis.fetch(...a);y=n=>import(n);',
        // Review 108 B3: these executed a request and a data module after the old scan erased the callees.
        '((...a)=>globalThis.fetch(...a))("/leak")',
        '(p=>import(p))("data:text/javascript,export default 7")',
    ]) {
        assert.notEqual(firstReference(bad), null, bad);
    }
    assert.equal(firstReference(html), null);
});

// The code module section embeds the vendored Story Block closure, so the page grows with each sync (Story Block 2.14.0 with the cast: 5.1 MB).
test('the single-file distribution stays under 5.5 MB (part 5b section 11.1 accepts about 4.6 MB)', () => {
    assert.ok(Buffer.byteLength(html) < 5_500_000, `dist is ${Buffer.byteLength(html)} bytes`);
});
