// The authoring kit (authoring-kit/) is a synchronized copy of Story Block's (npm run sync-kit). These tests keep the copy
// honest and prove the pieces that depend on Studio: the copy's checker runs against Studio's vendored Story Block and agrees
// with Studio's own verdict, and the pointer in the page is plain text. Story Block tests the kit's content (prompts, numbers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
    for (const rel of ['examples/tiny-world/pack.json', 'reference/example-rules-pack.json', 'reference/data-modules/faction-standing.pack.json', 'reference/data-modules/survival-meters.pack.json']) {
        const text = read(rel);
        const run = node(join(kit, 'check.mjs'), join(kit, rel));
        assert.equal(run.status, 0, `${rel}: ${run.out}${run.err ?? ''}`);
        assert.match(run.out, /^OK /);
        assert.equal(openPack(text).validation.ok, true, `${rel}: Studio's own check`);
    }
    // A broken pack fails both, with the same message at the same path.
    const broken = JSON.parse(read('examples/tiny-world/pack.json'));
    broken.content.rules[0].skills[0].base.effects[0].target = 'all';
    const studio = openPack(JSON.stringify(broken)).validation;
    assert.equal(studio.ok, false);
    const budget = studio.errors.find(error => error.code === 'budget-closure');
    assert.ok(budget);
    const { checkPack, report } = await import(pathToFileURL(join(kit, 'check.mjs')).href);
    const result = checkPack(broken);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.code === budget.code && error.path === budget.path && error.message === budget.message));
    assert.match(report('x.json', result), /^1 problem in x\.json\n\n 1\. content\.rules\[0\]\.skills\[0\]\.base\.powerScore/);
    const written = node(join(kit, 'check.mjs'), join(kit, 'nothing.json'));
    assert.equal(written.status, 1);
});

test('LIMITS.md and the schema in the kit are what the vendored Story Block says', () => {
    const printed = node(join(kit, 'scripts/limits.mjs'));
    assert.equal(printed.status, 0, printed.err);
    assert.equal(read('reference/LIMITS.md'), printed.out, 'the vendored Story Block and the kit disagree on a limit; run npm run sync-sb and npm run sync-kit from one Story Block commit');
    assert.equal(read('reference/rules-v2.schema.json'), readFileSync(new URL('../vendor/story-block/src/v2/packs/rules-v2.schema.json', import.meta.url), 'utf8'));
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
    ctx.select('classes');
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
