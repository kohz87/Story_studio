// The generated module on Studio's vendored Story Block host (docs/PART5B_SPEC.md §8, §9 M7): it registers with no problem,
// warning or refusal; its narrator line is cut and claimed once per reply and replays; its command's guard holds live,
// goes off when the reply it needed is deleted, and asks only its replay queries; and a guard that asks an undeclared
// query makes the command fail with Story Block's replay-rule sentence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHost } from '../vendor/story-block/testkit/index.js';
import { definitionProblems, definitionWarnings } from '../vendor/story-block/src/v2/registry.js';
import { scaffoldEntries } from '../src/code-module/generate.js';
import { writeScaffold } from './helpers/code-module.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/code-module/golden-inputs.json', import.meta.url)), 'utf8'));
const MODULE_ID = 'lantern-oil';
const decoder = new TextDecoder();
const encoder = new TextEncoder();

// Writes the entries to a temp folder, imports the module and its part from it, and removes the folder again.
async function loadScaffold(entries, domain = 'lantern') {
    const dir = mkdtempSync(join(tmpdir(), 'studio-code-module-host-'));
    try {
        writeScaffold(dir, entries);
        const module = await import(pathToFileURL(join(dir, 'src', 'module.js')).href);
        const part = await import(pathToFileURL(join(dir, 'src', 'parts', `${domain}.js`)).href);
        return { module, part };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const lineOf = (kind, change) => `~ ${kind} Test — a test line | by: ${change > 0 ? '+' : ''}${change}`;
const replyWith = (...lines) => `The story goes on.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;

// The two variants that register on the host: the golden inputs (a capability and a screen) and cold-tally (neither).
const cold = {
    ...golden, moduleId: 'cold-tally', name: 'Cold', domain: 'chill', field: 'degrees', label: 'Degrees', min: -5, max: 5,
    initial: -5, step: 10, kind: 'chill', kindLabel: 'by', command: 'warm', query: 'now', action: 'Warm up', screen: false,
    capability: '', author: '',
};
for (const [name, inputs] of [['golden', golden], ['cold-tally', cold]]) {
    test(`the ${name} module registers with no problem, warning or refusal, and shows its capability`, async () => {
        const { module } = await loadScaffold(scaffoldEntries(inputs).entries, inputs.domain);
        const def = module.createModule();
        assert.deepEqual(definitionProblems(def), []);
        assert.deepEqual(definitionWarnings(def), []);
        const warnings = [];
        const warn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        let host;
        try {
            host = await createHost({ modules: [def] });
        } finally {
            console.warn = warn;
        }
        try {
            assert.deepEqual(warnings.filter(text => text.includes(inputs.moduleId)), []);
            assert.deepEqual(host.registry.refusals(), []);
            const entry = host.sdk.modules().find(item => item.id === inputs.moduleId);
            assert.equal(entry.status, 'ready');
            assert.deepEqual(entry.capabilities ?? [], inputs.capability ? [inputs.capability] : []);
        } finally {
            host.close();
        }
    });
}

test('a narrator line is cut by code, claimed once per reply, rebuilds to the same state and takes back on a swipe', async () => {
    const { module, part } = await loadScaffold(scaffoldEntries(golden).entries);
    const { DOMAIN, FIELD, INITIAL, KIND, KIND_LABEL, MAX, MIN, STEP } = part;
    const host = await createHost({ modules: [module.createModule()] });
    try {
        const valueOf = () => host.head().domains[DOMAIN][FIELD];
        const rebuildIsLive = () => {
            const live = structuredClone(host.head());
            host.store.rebuild();
            assert.deepEqual(host.head(), live);
        };
        const line = change => `~ ${KIND} Test — a test line | ${KIND_LABEL}: ${change > 0 ? '+' : ''}${change}`;
        await host.send('Go on.', replyWith(line(STEP + 1), line(1)));
        assert.equal(valueOf(), Math.max(MIN, Math.min(MAX, INITIAL + STEP)));
        rebuildIsLive();
        await host.swipe('The story goes on another way.');
        assert.equal(valueOf(), INITIAL, 'a swipe without the lines takes the change back');
        rebuildIsLive();
        assert.equal(valueOf(), INITIAL);
    } finally {
        host.close();
    }
});

test('the guard holds live, goes off when the reply it needed is deleted, and asks only its replay queries', async () => {
    const { module, part } = await loadScaffold(scaffoldEntries(golden).entries);
    const { COMMAND, DOMAIN, FIELD, KIND, KIND_LABEL, MIN, STEP } = part;
    const def = module.createModule();
    // Record every query name the replay guard asks, without changing what it answers.
    const asked = [];
    const original = def.hooks.replayGuard;
    def.hooks.replayGuard = (view, info) => original({
        ...view,
        query(name, args) {
            asked.push(name);
            return view.query(name, args);
        },
    }, info);
    const host = await createHost({ modules: [def] });
    try {
        const valueOf = () => host.head().domains[DOMAIN][FIELD];
        const rebuildIsLive = () => {
            const live = structuredClone(host.head());
            host.store.rebuild();
            assert.deepEqual(host.head(), live);
        };
        const line = change => `~ ${KIND} Test — a test line | ${KIND_LABEL}: ${change > 0 ? '+' : ''}${change}`;
        await host.send('Go on.', replyWith(line(-STEP)));
        const low = valueOf();
        await host.send('Go on.', replyWith(line(STEP)));
        const high = valueOf();
        assert.ok(high > low);
        await host.send('Go on.', 'Nothing changes.');
        const done = await host.sdk.command(COMMAND, { amount: high - MIN });
        assert.equal(done.ok, true, done.message);
        assert.equal(valueOf(), MIN);
        rebuildIsLive();
        assert.deepEqual(host.store.problems().filter(problem => /may ask on replay|replayGuard/.test(`${problem.why} ${problem.message}`)), []);
        assert.ok(asked.length > 0, 'the guard was asked on replay');
        const allowed = [...def.replayQueries, 'story.evidence'];
        for (const name of asked) assert.ok(allowed.includes(name), `the guard asked "${name}"`);

        // The reply that raised the value goes: the command no longer has what it took, so it stays off.
        await host.st.deleteMessage(4);
        assert.equal(valueOf(), low);
        assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
        rebuildIsLive();
        assert.equal(valueOf(), low);
    } finally {
        host.close();
    }
});

test('a guard that asks a query it did not declare makes the command fail with the replay-rule sentence', async () => {
    const entries = scaffoldEntries(golden).entries.map(entry => {
        if (entry.path !== 'src/parts/lantern.js') return entry;
        const text = decoder.decode(entry.data);
        const from = 'const now = view.query(QUERY);';
        assert.equal(text.split(from).length, 2, 'the guard reads its query exactly once');
        return { path: entry.path, data: encoder.encode(text.replace(from, () => "const now = view.query('scene.place') ?? view.query(QUERY);")) };
    });
    const { module, part } = await loadScaffold(entries);
    const host = await createHost({ modules: [module.createModule()] });
    try {
        await host.send('Go on.', replyWith(`~ ${part.KIND} Test — a test line | ${part.KIND_LABEL}: +${part.STEP}`));
        const result = await host.sdk.command(part.COMMAND, { amount: 1 });
        assert.equal(result.ok, false);
        assert.match(result.message, /is not a query a guard may ask on replay/);
    } finally {
        host.close();
    }
});
