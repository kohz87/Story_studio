// The authoring kit (authoring-kit/) is a synchronized copy of Story Block's (npm run sync-kit). These tests keep the copy
// honest and prove the pieces that depend on Studio: the copy's checker runs against Studio's vendored Story Block and agrees
// with Studio's own verdict, and the pointer in the page is plain text. Story Block tests the kit's content (prompts, numbers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MockDocument } from './helpers/dom.js';
import { mountStudio } from '../src/studio.js';
import { DRAFT_WITH_AI } from '../src/draft-hint.js';
import { openPack } from '../src/model.js';
import { KIT, SB_ROOT_FILE, SB_ROOT_LINE, STUDIO_SB_ROOT_LINE, kitFiles, readStamp, stampOf } from '../scripts/sync-kit.mjs';
import { firstReference } from '../scripts/dist-scan.mjs';

const kit = new URL(`../${KIT}/`, import.meta.url).pathname;
const read = rel => readFileSync(join(kit, rel), 'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
const node = (...args) => {
    try { return { status: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (error) { return { status: error.status, out: String(error.stdout ?? ''), err: String(error.stderr ?? '') }; }
};

test('the kit copy matches its stamp: the same files, each with the hash VERSION records', () => {
    const stamp = readStamp(read('VERSION'));
    assert.match(stamp.commit, /^[0-9a-f]{40}$/, 'VERSION names the Story Block commit the kit was copied from');
    assert.equal(stamp.rewritten, SB_ROOT_FILE);
    const files = kitFiles(kit);
    assert.deepEqual(files, Object.keys(stamp.files).sort(), 'a file was added to or removed from authoring-kit/; run npm run sync-kit');
    for (const rel of files) assert.equal(sha(readFileSync(join(kit, rel))), stamp.files[rel], `${KIT}/${rel} differs from its stamp: never edit the kit here, run npm run sync-kit`);
    assert.equal(read('VERSION'), stampOf(kit, stamp.commit), 'VERSION is exactly what the sync writes');
    assert.equal(readStamp(read('VERSION')).files['check.mjs'], sha(readFileSync(join(kit, 'check.mjs'))));
});

test('only the line that says where Story Block is differs from Story Block\'s own kit', () => {
    const root = read(SB_ROOT_FILE);
    assert.ok(root.includes(STUDIO_SB_ROOT_LINE));
    assert.ok(!root.includes(SB_ROOT_LINE));
    assert.ok(existsSync(new URL('../vendor/story-block/src/v2/packs/validate.js', import.meta.url)));
    // A checkout of Story Block next to this one, at the stamped commit, gives the exact comparison; a lone clone skips it.
    const sibling = new URL('../../Story_block/', import.meta.url).pathname;
    if (!existsSync(join(sibling, KIT, 'check.mjs'))) return;
    let head = '';
    try { head = execFileSync('git', ['-C', sibling, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return; }
    if (head !== readStamp(read('VERSION')).commit) return;
    for (const rel of kitFiles(join(sibling, KIT))) {
        const theirs = readFileSync(join(sibling, KIT, rel), 'utf8');
        assert.equal(read(rel), rel === SB_ROOT_FILE ? theirs.replace(SB_ROOT_LINE, STUDIO_SB_ROOT_LINE) : theirs, rel);
    }
});

test('the copy\'s checker runs against the vendored Story Block and agrees with Studio\'s own verdict', async () => {
    for (const rel of ['examples/tiny-world/pack.json', 'reference/data-modules/faction-standing.pack.json', 'reference/data-modules/survival-meters.pack.json']) {
        const text = read(rel);
        const run = node(join(kit, 'check.mjs'), join(kit, rel));
        assert.equal(run.status, 0, `${rel}: ${run.out}${run.err ?? ''}`);
        assert.match(run.out, /^OK /);
        assert.equal(openPack(text).validation.ok, true, `${rel}: Studio's own check`);
    }
    // A broken pack fails both, with the same message at the same path.
    const broken = JSON.parse(read('examples/tiny-world/pack.json'));
    broken.content.routes[0].to = 'missing-place';
    const studio = openPack(JSON.stringify(broken)).validation;
    assert.equal(studio.ok, false);
    const problem = studio.errors.find(error => error.code === 'UNKNOWN_REF');
    assert.ok(problem);
    const { checkPack, report } = await import(pathToFileURL(join(kit, 'check.mjs')).href);
    const result = checkPack(broken);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.code === problem.code && error.path === problem.path && error.message === problem.message));
    assert.match(report('x.json', result), /content\.routes/);
    const written = node(join(kit, 'check.mjs'), join(kit, 'nothing.json'));
    assert.equal(written.status, 1);
});

test('LIMITS.md in the kit matches the vendored Story Block', () => {
    const printed = node(join(kit, 'scripts/limits.mjs'));
    assert.equal(printed.status, 0, printed.err);
    assert.equal(read('reference/LIMITS.md'), printed.out, 'the vendored Story Block and the kit disagree on a limit; run npm run sync-sb and npm run sync-kit from one Story Block commit');
    assert.equal(existsSync(join(kit, 'reference/rules-v2.schema.json')), false);
});

test('the page points to the kit in plain text: no link, no request', async () => {
    const doc = new MockDocument();
    doc.defaultView = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    const root = doc.createElement('div');
    doc.body.append(root);
    const ctx = mountStudio(root);
    const hint = ctx.main.querySelector('.draft-hint');
    assert.equal(hint.textContent, 'Draft with your own AI: see authoring-kit/README.md in this download or repository.');
    assert.equal(hint.textContent, DRAFT_WITH_AI);
    assert.equal(ctx.main.querySelectorAll('a').length, 0);
    assert.equal(firstReference(DRAFT_WITH_AI), null);
    ctx.destroy();
    assert.ok(readFileSync(new URL('../dist/story-studio.html', import.meta.url), 'utf8').includes(DRAFT_WITH_AI));
});

test('Pack settings shows the same pointer once a pack is open', async () => {
    const doc = new MockDocument();
    const storage = new Map();
    doc.defaultView = { localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    const root = doc.createElement('div');
    doc.body.append(root);
    const ctx = mountStudio(root);
    await ctx.openFile({ name: 'pack.json', size: 10, text: async () => read('examples/tiny-world/pack.json') });
    ctx.select('settings');
    const hints = ctx.main.querySelectorAll('.draft-hint');
    assert.equal(hints.length, 1);
    assert.equal(hints[0].textContent, DRAFT_WITH_AI);
    ctx.select('places');
    assert.equal(ctx.main.querySelectorAll('.draft-hint').length, 0);
    ctx.destroy();
});

test('the kit names no model, and only its README names tools', () => {
    const models = /\b(sonnet|opus|haiku|gpt-?\d|chatgpt|openai|anthropic|llama|mistral|gemini-\d|claude-\d)\b/i;
    const tools = /\b(claude code|cursor|gemini cli|antigravity|codex cli|codex|gemini)\b/i;
    for (const rel of kitFiles(kit)) {
        const text = read(rel);
        assert.doesNotMatch(text, models, `${rel} names a model`);
        if (rel !== 'README.md') assert.doesNotMatch(text, tools, `${rel} names a tool`);
    }
});

// The sync, run for real: a small Story Block checkout with a committed kit, and a destination holding a creator's work.
function syncScenario(change = () => {}) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-sync-kit-'));
    const source = join(dir, 'Story_block');
    const dest = join(dir, 'Story_studio');
    const put = (root, rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
    put(source, 'authoring-kit/check.mjs', '// checker\n');
    put(source, 'authoring-kit/README.md', 'the kit\n');
    put(source, 'authoring-kit/scripts/sb-root.mjs', `${SB_ROOT_LINE}\n`);
    put(source, 'authoring-kit/work/README.md', 'your work goes here\n');
    put(source, 'authoring-kit/work/committed-lore.md', 'someone committed this by mistake\n');
    put(source, 'authoring-kit/work/lore/also-committed.md', 'and this\n');
    change(source, put);
    const git = (...args) => execFileSync('git', ['-C', source, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('add', '-f', '-A');
    git('commit', '-q', '-m', 'kit');
    put(dest, 'authoring-kit/work/draft.json', '{"mine":true}\n');
    put(dest, 'authoring-kit/work/lore/world.md', 'my world\n');
    put(dest, 'authoring-kit/work/README.md', 'an older readme\n');
    put(dest, 'authoring-kit/stale-file.md', 'removed by the sync\n');
    const run = () => {
        try { return { status: 0, out: execFileSync(process.execPath, [new URL('../scripts/sync-kit.mjs', import.meta.url).pathname, '--from', source], { cwd: dest, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
        catch (error) { return { status: error.status, out: String(error.stdout ?? ''), err: String(error.stderr ?? '') }; }
    };
    return { dir, source, dest, run, put, head: () => git('rev-parse', 'HEAD').trim() };
}

test('sync-kit keeps the destination\'s work/ whole, copies nothing from the source\'s work/ but its README, and stamps the commit', () => {
    const scenario = syncScenario();
    try {
        const result = scenario.run();
        assert.equal(result.status, 0, result.err);
        const copy = join(scenario.dest, 'authoring-kit');
        assert.equal(readFileSync(join(copy, 'work/draft.json'), 'utf8'), '{"mine":true}\n', 'an ignored draft survives');
        assert.equal(readFileSync(join(copy, 'work/lore/world.md'), 'utf8'), 'my world\n', 'lore survives');
        assert.equal(readFileSync(join(copy, 'work/README.md'), 'utf8'), 'your work goes here\n');
        assert.equal(existsSync(join(copy, 'work/committed-lore.md')), false, 'a committed file under the source work/ is not copied');
        assert.equal(existsSync(join(copy, 'work/lore/also-committed.md')), false);
        assert.equal(existsSync(join(copy, 'stale-file.md')), false, 'the kit itself is replaced');
        assert.equal(readFileSync(join(copy, 'README.md'), 'utf8'), 'the kit\n');
        assert.equal(readFileSync(join(copy, 'scripts/sb-root.mjs'), 'utf8'), `${STUDIO_SB_ROOT_LINE}\n`);
        const version = readFileSync(join(copy, 'VERSION'), 'utf8');
        const stamp = readStamp(version);
        assert.equal(stamp.commit, scenario.head());
        assert.deepEqual(Object.keys(stamp.files).sort(), ['README.md', 'check.mjs', 'scripts/sb-root.mjs', 'work/README.md']);
        assert.equal(version, stampOf(copy, stamp.commit));
        assert.deepEqual(kitFiles(copy), Object.keys(stamp.files).sort(), 'the creator\'s files are not part of the stamp');
        // A second sync changes nothing the creator owns.
        assert.equal(scenario.run().status, 0);
        assert.equal(readFileSync(join(copy, 'work/draft.json'), 'utf8'), '{"mine":true}\n');
    } finally { rmSync(scenario.dir, { recursive: true, force: true }); }
});

test('sync-kit that refuses leaves the destination, its work/ included, exactly as it was', () => {
    const noLine = syncScenario((source, put) => put(source, 'authoring-kit/scripts/sb-root.mjs', 'export const SB_V2 = somethingElse;\n'));
    try {
        const result = noLine.run();
        assert.equal(result.status, 1);
        assert.match(result.err, /no longer has the line this script rewrites/);
        const copy = join(noLine.dest, 'authoring-kit');
        assert.deepEqual(readdirSync(copy).sort(), ['stale-file.md', 'work']);
        assert.equal(readFileSync(join(copy, 'work/draft.json'), 'utf8'), '{"mine":true}\n');
        assert.equal(readFileSync(join(copy, 'work/README.md'), 'utf8'), 'an older readme\n');
    } finally { rmSync(noLine.dir, { recursive: true, force: true }); }

    const dirty = syncScenario();
    try {
        writeFileSync(join(dirty.source, 'authoring-kit/README.md'), 'edited, not committed\n');
        const result = dirty.run();
        assert.equal(result.status, 1);
        assert.match(result.err, /uncommitted changes/);
        assert.equal(readFileSync(join(dirty.dest, 'authoring-kit/work/draft.json'), 'utf8'), '{"mine":true}\n');
        assert.equal(existsSync(join(dirty.dest, 'authoring-kit/stale-file.md')), true);
    } finally { rmSync(dirty.dir, { recursive: true, force: true }); }
});

test('the checker in the copy refuses a capability the suite does not provide, and --with-capability allows it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-kit-cap-'));
    try {
        const pack = JSON.parse(read('examples/tiny-world/pack.json'));
        pack.requires.capabilities = ['mystery-module'];
        const file = join(dir, 'pack.json');
        writeFileSync(file, JSON.stringify(pack));
        const refused = node(join(kit, 'check.mjs'), file);
        assert.equal(refused.status, 1);
        assert.match(refused.out, /This pack needs mystery-module[\s\S]*--with-capability/);
        assert.equal(node(join(kit, 'check.mjs'), file, '--with-capability', 'mystery-module').status, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
