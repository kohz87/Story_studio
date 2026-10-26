// Review 116: trace regressions and a differential against the standalone Story Block testkit host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/data-modules/sb-adapter.js';
import { replyText } from '../src/data-modules/simulator.js';
import { createHost } from '../vendor/story-block/testkit/index.js';
import { readRecord } from '../vendor/story-block/src/v2/persist.js';

const MODULE = 'pack.trace/counter';
const line = (kind, extra = '') => `! dm counter — count | kind: ${kind}${extra}`;
const step = (kind, type = 'reply') => ({ type, text: replyText([line(kind)]) });
const pack = () => ({
    id: 'trace', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] },
    content: { dataModules: [{
        slug: 'counter', name: 'Counter', schema: 1, stateVersion: 1, scope: 'chat',
        state: { points: { type: 'int', min: 0, max: 100, default: 0 } },
        kinds: Object.fromEntries([['one', 1], ['ten', 10]].map(([name, value]) => [name, {
            op: '!', labels: {}, oncePerReply: [], effects: [{ op: 'add', path: ['points'], value }],
        }])),
    }] },
});
const run = (steps, action = null) => simulate({ pack: pack(), module: MODULE, scenario: { actors: [], startMinute: 1000, steps }, action });
const points = state => state.domains.dataModules.instances[MODULE].chat.fields.points;
const accepted = result => assert.equal(result.ok, true, JSON.stringify(result));

test('review 116: deleting a +10 Continue removes its line, changes and card from the rebuilt trace', async () => {
    const steps = [step('one'), step('ten', 'continue')];
    const base = await run(steps);
    accepted(base);
    assert.deepEqual(base.steps.map(row => row.changes), [
        [{ path: 'points', before: 0, after: 1 }], [{ path: 'points', before: 1, after: 11 }],
    ]);
    const result = await run(steps, { type: 'delete', step: 1 });
    accepted(result);
    assert.equal(result.final.fields.points, 1);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].replyCard, 'points 0 → 1');
    assert.deepEqual(result.steps[0].fields, { points: 1 });
    assert.deepEqual(result.steps[0].changes, [{ path: 'points', before: 0, after: 1 }]);
    assert.equal(result.steps.flatMap(row => row.lines).some(row => row.raw.includes('kind: ten')), false);
    assert.deepEqual(result.replay, { equal: true });
});

test('review 116: Re-read rebuilds edited lines, refusal text, capture problems and field changes', async () => {
    for (const type of ['reread', 'swipe']) {
        const steps = [step('unknown')];
        const before = await run(steps);
        accepted(before);
        assert.equal(before.steps[0].lines[0].outcome, 'refused');
        const result = await run(steps, { type, step: 0, text: step('ten').text });
        accepted(result);
        assert.equal(result.steps[0].lines[0].raw, line('ten'));
        assert.equal(result.steps[0].lines[0].outcome, 'applied');
        assert.equal(result.steps[0].lines[0].refusal, undefined);
        assert.equal(result.steps[0].replyCard, 'points 0 → 10');
        assert.deepEqual(result.steps[0].changes, [{ path: 'points', before: 0, after: 10 }]);
        assert.deepEqual(result.steps[0].problems, []);
        const malformed = await run([step('one')], { type, step: 0, text: '<Changes>\nthis is not a change\n</Changes>' });
        accepted(malformed);
        assert.equal(malformed.steps[0].lines.length, 0);
        assert.deepEqual(malformed.steps[0].changes, []);
        assert.equal(malformed.steps[0].problems[0].code, 'UNREADABLE');
        const repaired = await run([{ type: 'reply', text: '<Changes>\nthis is not a change\n</Changes>' }], { type, step: 0, text: step('one').text });
        accepted(repaired);
        assert.deepEqual(repaired.steps[0].problems, []);
        assert.equal(repaired.steps[0].replyCard, 'points 0 → 1');
    }
});

// The oracle calls upstream's createHost directly. It checks current message prefixes and receipts after
// each action; it never imports the simulator's trace/host helpers or derives expected values from its output.
for (const [name, steps, action] of [
    ['Continue then delete its +10', [step('one'), step('ten', 'continue')], { type: 'delete', step: 1 }],
    ['delete a source reply with a surviving Continue', [step('one'), step('ten'), step('one', 'continue')], { type: 'delete', step: 0 }],
    ['Re-read a refusal in a Continue', [step('one'), step('unknown', 'continue')], { type: 'reread', step: 1, text: step('ten').text }],
    ['Re-read an applied Continue into a refusal', [step('one'), step('ten', 'continue')], { type: 'reread', step: 1, text: step('unknown').text }],
    ['swipe the latest Continue', [step('one'), step('ten', 'continue')], { type: 'swipe', step: 1, text: step('one').text }],
    ['reload Continues across checkpoint and receipt trimming', Array.from({ length: 6 }, () => [step('one'), step('ten', 'continue')]).flat(), { type: 'reload' }],
]) test(`simulator/Story Block differential: ${name}`, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ storeOptions: { checkpointEvery: 2, receiptKeep: 3 } });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(pack())).ok, true);
    const offer = host.sdk.query('dataModules.setup').find(row => row.module === MODULE);
    assert.equal((await host.sdk.command('dm.pin', { module: MODULE, hash: offer.hash, packHash: offer.packHash, subjects: [] })).ok, true);
    const groups = [];
    for (const [index, value] of steps.entries()) {
        if (value.type === 'continue') {
            groups.at(-1).steps.push(index);
            await host.cont(`\n${value.text}`);
        } else {
            groups.push({ steps: [index], message: null });
            await host.send(`Go on (${groups.length}).`, `Step ${groups.length}.\n${value.text}`);
            groups.at(-1).message = host.ctx.chat.at(-1);
        }
    }
    const texts = steps.map(value => value.text);
    const group = groups.find(value => value.steps.includes(action.step));
    const index = group ? host.ctx.chat.indexOf(group.message) : -1;
    if (action.type === 'delete') {
        if (steps[action.step].type === 'continue') {
            group.steps = group.steps.filter(value => value !== action.step);
            await host.st.editMessage(index, `Step ${groups.indexOf(group) + 1}.\n${group.steps.map(value => texts[value]).join('\n')}`);
            await host.sdk.reread(index);
        } else {
            await host.st.deleteMessage(index);
            group.steps = [];
        }
    } else if (action.type === 'reload') {
        await host.store.flush();
        await host.st.loadChat(host.ctx.chat);
    } else {
        texts[action.step] = action.text;
        const combined = `Step ${groups.indexOf(group) + 1}.\n${group.steps.map(value => texts[value]).join('\n')}`;
        if (action.type === 'reread') {
            await host.st.editMessage(index, combined);
            await host.sdk.reread(index);
        } else {
            await host.swipe(combined);
            group.message = host.ctx.chat.at(-1);
        }
    }
    const result = await run(steps, action);
    accepted(result);
    assert.deepEqual(result.final.fields, host.sdk.query('dataModules.view', { module: MODULE }).chat);
    assert.deepEqual(result.problems.map(row => row.code), host.store.problems().map(row => row.code));
    const expected = [];
    for (const group of groups.filter(value => value.steps.length)) {
        const at = host.ctx.chat.findIndex(message => !message.is_user && String(message.mes).startsWith(`Step ${groups.indexOf(group) + 1}.`));
        const record = readRecord(host.ctx.chat[at]);
        const source = host.store.sourceAt(at);
        const prefix = host.store.before(at);
        let before = points(prefix);
        let op = 0;
        const spans = (record.spans ?? []).map(span => {
            op += span.n;
            return { span, after: points(host.store.prefixWitness({ ...source, op }).state) };
        }).filter(({ span }) => span.operation?.type === 'capture.dm');
        let cursor = 0;
        for (const stepIndex of group.steps) {
            const recaptured = group.steps.includes(action.step) && ['reread', 'swipe'].includes(action.type);
            const applied = recaptured ? spans.find(({ span }) => span.operation.payload.index === group.steps.indexOf(stepIndex)) : spans[cursor++];
            const refused = !applied;
            const receipt = applied ? record.receipts.find(receipt => receipt.data?.v2?.source?.ordinal === applied.span.source.ordinal) : null;
            const inactive = receipt && host.store.problems().some(problem => problem.receipts.includes(receipt.id));
            const after = stepIndex === group.steps.at(-1) ? points(host.store.at(at)) : applied?.after ?? before;
            expected.push({ index: stepIndex, outcome: inactive ? 'inactive' : refused ? 'refused' : 'applied', fields: { points: after }, changes: before === after ? [] : [{ path: 'points', before, after }] });
            before = after;
        }
    }
    assert.deepEqual(result.steps.map(row => ({ index: row.index, outcome: row.lines[0].outcome, fields: row.fields, changes: row.changes })), expected);
    for (const row of result.steps) {
        assert.equal(row.replyCard.includes('points'), row.changes.length > 0);
        if (row.lines[0].outcome === 'refused') assert.match(row.replyCard, /nothing applied/);
    }
    assert.deepEqual(result.replay, { equal: true });
});
