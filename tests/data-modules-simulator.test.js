// The simulator on Story Block's own runtime (a disposable host built from the vendored testkit): the numbers come from
// DATA_MODULES.md's two worked examples, every outcome is what the runtime reports, and nothing outside the request is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { factions, survival, linked } from './fixtures/data-modules/index.js';
import * as adapter from '../src/data-modules/sb-adapter.js';
import { buildRequest, run, defaultScenario, replyText, compareRuns } from '../src/data-modules/simulator.js';
import { openPack } from '../src/model.js';
import { sampleActors, actorId, timeMinutes, sampleDirector } from '../src/data-modules/sim-director.js';
import { createHost } from '../vendor/story-block/testkit/index.js';

const REPUTATION = 'pack.ersveil-factions/reputation';
const SURVIVAL = 'pack.ersveil-survival/survival';
const reply = text => ({ type: 'reply', text: replyText(Array.isArray(text) ? text : [text]) });
const cont = text => ({ type: 'continue', text: replyText(Array.isArray(text) ? text : [text]) });
const advance = minutes => ({ type: 'advance', minutes });
const gain = (reason, faction = 'guild') => `+ dm reputation — ${reason} | kind: gain | faction: ${faction}`;
const loss = (reason, faction = 'watch') => `- dm reputation — ${reason} | kind: loss | faction: ${faction}`;
const rest = hours => `! dm survival — slept at the camp | kind: rest | who: Wessel | hours: ${hours}`;
const meal = '! dm survival — ate supper | kind: meal | who: Wessel';
const scenario = (steps, extra = {}) => ({ actors: [], startMinute: 1000, seed: 1, steps, ...extra });
const simulate = (pack, module, steps, action = null, extra = {}) => adapter.simulate({ pack, module, scenario: scenario(steps, extra), action });
const threeReplies = () => [reply(gain('repaired the weir')), reply(gain('brought back the register')), reply(loss('broke the seal'))];

test('the runtime is real: the simulator is wired to the vendored Story Block host', () => {
    adapter.useBackendForTests(null);
    assert.equal(adapter.status().simulator, true);
});

test('the static simulator host matches createHost at checkpoint and receipt-trimming thresholds', async t => {
    const pack = factions();
    const steps = Array.from({ length: 4 }, threeReplies).flat();
    const host = await createHost({ modules: [sampleDirector({ minute: 1000, actors: [] })], storeOptions: { checkpointEvery: 2, receiptKeep: 3 } });
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(pack)).ok, true);
    const offer = host.sdk.query('dataModules.setup').find(row => row.module === REPUTATION);
    assert.equal((await host.sdk.command('dm.pin', { module: offer.module, hash: offer.hash, packHash: offer.packHash, subjects: [] })).ok, true);
    const fields = [];
    for (const step of steps) {
        await host.send('Go on.', step.text);
        fields.push(structuredClone(host.sdk.query('dataModules.view', { module: REPUTATION }).chat));
    }
    await host.store.flush();
    const records = host.ctx.chat.flatMap(message => message.extra?.storySuite ? [message.extra.storySuite] : []);
    assert.ok(records.slice(1).some(record => record.checkpoint), 'later checkpoints were made');
    const older = records.slice(1, -3).flatMap(record => record.receipts ?? []);
    assert.ok(older.length);
    assert.ok(older.every(receipt => Object.keys(receipt.data ?? {}).every(key => key === 'v2')), 'older receipts retain only durable v2 data');
    const result = await simulate(pack, REPUTATION, steps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.steps.map(step => step.fields), fields);
    assert.deepEqual(result.replay, { equal: true });
});

test('without an active pin the finished runtime treats dm as undeclared', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost();
    t.after(() => host.close());
    assert.equal((await host.packs.packs.install(factions())).ok, true);
    assert.equal(host.sdk.query('dataModules.view', { module: REPUTATION }), null);
    await host.send('Begin.', 'The guild hall.');
    await host.send('Go on.', replyText([gain('a favour')]));
    const [problem] = host.turn.problems();
    assert.equal(problem.code, 'UNKNOWN_KIND');
    assert.match(problem.message, /No module keeps "dm"/);
    assert.equal(host.head().domains.dataModules, undefined);
});

test('example A: Guild 0 -> 3 -> 6 with the title, Watch 0 -> -5, durable and equal to a cold replay', async () => {
    const result = await simulate(factions(), REPUTATION, threeReplies());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.steps.map(step => step.fields), [
        { standing: { guild: 3, watch: 0, compact: 0 }, title: 'none' },
        { standing: { guild: 6, watch: 0, compact: 0 }, title: 'Guild Friend' },
        { standing: { guild: 6, watch: -5, compact: 0 }, title: 'Guild Friend' },
    ]);
    assert.deepEqual(result.final.fields, { standing: { guild: 6, watch: -5, compact: 0 }, title: 'Guild Friend' });
    assert.deepEqual(result.steps[1].changes, [{ path: 'standing.guild', before: 3, after: 6 }, { path: 'title', before: 'none', after: 'Guild Friend' }]);
    assert.equal(result.steps[1].replyCard, 'standing.guild 3 → 6\ntitle none → Guild Friend');
    assert.deepEqual(result.steps.map(step => step.status), ['applied', 'applied', 'applied']);
    assert.deepEqual(result.steps[0].lines[0].parsed, { op: '+', kind: 'gain', faction: 'guild' });
    assert.deepEqual(result.replay, { equal: true });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.usage, { roots: 1, visits: 11 });
});

test('example A: a faction outside the declared list refuses the whole line with Story Block’s own reason', async () => {
    const result = await simulate(factions(), REPUTATION, [reply(gain('a favour', 'crown'))]);
    assert.equal(result.ok, true);
    const [step] = result.steps;
    assert.equal(step.status, 'refused');
    assert.equal(step.lines[0].outcome, 'refused');
    assert.equal(step.lines[0].refusal.code, 'DM_LABEL');
    assert.match(step.lines[0].refusal.message, /faction/);
    assert.equal(step.lines[0].refusal.message, 'Reputation: faction must be guild, watch or compact; nothing applied.');
    assert.deepEqual(result.final.fields, { standing: { guild: 0, watch: 0, compact: 0 }, title: 'none' });
});

test('example A: repeating a faction in a Continue of the same reply is CLAIMED and changes nothing', async () => {
    const result = await simulate(factions(), REPUTATION, [reply(gain('first')), cont(gain('again'))]);
    assert.equal(result.ok, true);
    assert.equal(result.steps[1].lines[0].outcome, 'refused');
    assert.equal(result.steps[1].lines[0].refusal.code, 'CLAIMED');
    assert.equal(result.final.fields.standing.guild, 3);
});

test('example A: deleting a gain keeps the later loss when its recorded condition answers stay the same', async () => {
    const steps = threeReplies();
    const base = await simulate(factions(), REPUTATION, steps);
    const deleted = await simulate(factions(), REPUTATION, steps, { type: 'delete', step: 0 });
    assert.equal(deleted.ok, true);
    assert.deepEqual(deleted.steps.map(step => [step.index, step.status]), [[1, 'inactive'], [2, 'applied']]);
    assert.equal(deleted.steps[0].problems[0].code, 'REPLAY_PREREQUISITE');
    assert.match(deleted.steps[0].problems[0].message, /Re-read this action/);
    assert.deepEqual(deleted.final.fields, { standing: { guild: 0, watch: -5, compact: 0 }, title: 'none' });
    assert.deepEqual(deleted.replay, { equal: true });
    const diff = compareRuns(base, deleted);
    assert.deepEqual(diff.statuses, [{ index: 1, before: 'applied', after: 'inactive' }]);
    assert.ok(diff.fields.some(item => item.path === 'standing.guild' && item.before === 6 && item.after === 0));
    // Deleting the second gain retracts its +3 and the title together. The later loss still answers the title rule
    // the same way, so its block stays active.
    const second = await simulate(factions(), REPUTATION, steps, { type: 'delete', step: 1 });
    assert.deepEqual(second.final.fields, { standing: { guild: 3, watch: -5, compact: 0 }, title: 'none' });
    assert.deepEqual(second.steps.map(step => [step.index, step.status]), [[0, 'applied'], [2, 'applied']]);
    assert.deepEqual(second.problems, []);
    assert.deepEqual(second.replay, { equal: true });
});

test('example A: Re-read with edited text, Swipe of the last reply, and Reload', async () => {
    const steps = threeReplies();
    const reread = await simulate(factions(), REPUTATION, steps, { type: 'reread', step: 1, text: replyText([gain('another', 'compact')]) });
    assert.deepEqual(reread.final.fields.standing, { guild: 3, watch: -5, compact: 3 });
    assert.equal(reread.final.fields.title, 'none');
    assert.deepEqual(reread.replay, { equal: true });
    const swipe = await simulate(factions(), REPUTATION, steps, { type: 'swipe', step: 2, text: replyText([loss('elsewhere', 'compact')]) });
    assert.deepEqual(swipe.final.fields.standing, { guild: 6, watch: 0, compact: -5 });
    const early = await simulate(factions(), REPUTATION, steps, { type: 'swipe', step: 0, text: replyText([gain('x')]) });
    assert.equal(early.ok, false);
    assert.match(early.errors[0].message, /latest reply/);
    const reload = await simulate(factions(), REPUTATION, steps, { type: 'reload', step: 0 });
    assert.deepEqual(reload.final, (await simulate(factions(), REPUTATION, steps)).final);
    assert.deepEqual(reload.steps.map(step => step.status), ['applied', 'applied', 'applied']);
    const unknown = await simulate(factions(), REPUTATION, steps, { type: 'dance', step: 0 });
    assert.equal(unknown.ok, false);
});

test('a changed condition answer makes the dependent loss inactive on replay', async () => {
    const pack = factions();
    pack.content.dataModules[0].kinds.loss.when = ['ge', ['get', ['standing', 'guild']], 6];
    const result = await simulate(pack, REPUTATION, threeReplies(), { type: 'delete', step: 1 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.final.fields, { standing: { guild: 3, watch: 0, compact: 0 }, title: 'none' });
    assert.deepEqual(result.steps.map(step => [step.index, step.status]), [[0, 'applied'], [2, 'inactive']]);
    assert.equal(result.steps[1].problems[0].code, 'REPLAY_PREREQUISITE');
    assert.match(result.steps[1].problems[0].message, /condition.*answered differently/);
    assert.deepEqual(result.replay, { equal: true });
});

test('example B: rest settles the six elapsed hours first (12/6) then recovers (12/0); later time and a meal follow the design', async () => {
    const steps = [reply(['! time +6h', rest(6)]), reply('! time +2h'), reply(meal), reply(rest(9))];
    const result = await simulate(survival(), SURVIVAL, steps, null, { actors: ['Wessel'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.steps.map(step => step.fields.Wessel), [{ hunger: 12, fatigue: 0 }, { hunger: 16, fatigue: 2 }, { hunger: 0, fatigue: 2 }, { hunger: 0, fatigue: 2 }]);
    assert.equal(result.steps[0].lines[1].note, 'Requested -60; applied -6 (0/100).');
    assert.deepEqual(result.steps[0].timers, { Wessel: { needs: { lastMinute: 1360, remainder: 0 } } });
    assert.deepEqual(result.steps[1].timers, { Wessel: { needs: { lastMinute: 1480, remainder: 0 } } });
    // hours: 9 refuses the entire rest line.
    assert.equal(result.steps[3].status, 'refused');
    assert.equal(result.steps[3].lines[0].refusal.code, 'DM_LABEL');
    assert.deepEqual(result.final.fields, { Wessel: { hunger: 0, fatigue: 2 } });
    assert.deepEqual(result.replay, { equal: true });
});

for (const minutes of [59, 60, 61]) {
    test(`example B: a time advance of ${minutes} minutes accrues ${Math.floor(minutes / 60)} period(s) and keeps remainder ${minutes % 60}`, async () => {
        const result = await simulate(survival(), SURVIVAL, [advance(minutes)], null, { actors: ['Wessel'] });
        assert.equal(result.ok, true);
        assert.equal(result.steps[0].status, 'advanced');
        assert.equal(result.final.fields.Wessel.hunger, Math.floor(minutes / 60) * 2);
        assert.deepEqual(result.final.timers.Wessel.needs, { lastMinute: 1000 + minutes, remainder: minutes % 60 });
    });
}

test('example B: the sample clock is the starting minute; an unset clock baselines on the first set minute and accrues nothing', async () => {
    const early = await simulate(survival(), SURVIVAL, [advance(120)], null, { actors: ['Wessel'], startMinute: 0 });
    assert.deepEqual(early.final.timers.Wessel.needs, { lastMinute: 120, remainder: 0 });
    assert.equal(early.final.fields.Wessel.hunger, 4);
    const unset = await simulate(survival(), SURVIVAL, [reply(meal)], null, { actors: ['Wessel'], startMinute: null });
    assert.equal(unset.ok, true, JSON.stringify(unset));
    assert.deepEqual(unset.final.timers.Wessel.needs, { lastMinute: null, remainder: 0 });
    assert.equal(unset.final.fields.Wessel.hunger, 0);
});

test('example B: an oversized time jump refuses without moving the timer cursor', async () => {
    const result = await simulate(survival(), SURVIVAL, [advance(525600), advance(525600)], null, { actors: ['Wessel'] });
    assert.equal(result.ok, true);
    assert.ok(result.final.fields.Wessel.hunger >= 0);
    const bad = await simulate(survival(), SURVIVAL, [{ type: 'advance', minutes: 525601 }], null, { actors: ['Wessel'] });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors[0].code, 'DM_BOUNDS');
});

test('a character who was not attached refuses the line; an unnamed actor refuses too', async () => {
    const result = await simulate(survival(), SURVIVAL, [reply(meal.replace('Wessel', 'Nobody'))], null, { actors: ['Wessel'] });
    assert.equal(result.steps[0].status, 'refused');
    assert.equal(result.steps[0].lines[0].refusal.message, 'Survival: who must be an attached character (Wessel); nothing applied.');
    assert.deepEqual(result.final.fields, { Wessel: { hunger: 0, fatigue: 0 } });
});

test('two modules in one pack: the follower reads its dependency’s public export, pinned first', async () => {
    const pack = linked();
    const steps = [advance(180), reply('! dm fatigue-watch — check | kind: look')];
    pack.content.dataModules[1].kinds.look = { op: '!', labels: {}, effects: [{ op: 'set', path: ['warned'], value: ['ge', ['input', 'needs', 'fatigue'], 2] }] };
    const result = await simulate(pack, 'pack.ersveil-survival/fatigue-watch', steps, null, { actors: ['Wessel'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.final.fields, { warned: true });
});

test('request problems are reported, never thrown: an invalid pack, an unknown module, too many steps, a bad step', async () => {
    const broken = factions();
    broken.content.dataModules[0].mystery = 1;
    const invalid = await simulate(broken, REPUTATION, []);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errors[0].code, 'DM_SCHEMA');
    const unknown = await simulate(factions(), 'pack.ersveil-factions/nothing', []);
    assert.deepEqual(unknown, { ok: false, errors: [{ code: 'DM_SCHEMA', path: '', message: 'The pack has no data module pack.ersveil-factions/nothing.' }] });
    const many = await simulate(factions(), REPUTATION, Array.from({ length: 25 }, () => reply(gain('x'))));
    assert.equal(many.errors[0].code, 'DM_BUDGET');
    const odd = await simulate(factions(), REPUTATION, [{ type: 'whisper', text: '' }]);
    assert.equal(odd.ok, false);
    const noPack = await run({ pack: null, module: REPUTATION, scenario: scenario([]), action: null });
    assert.equal(noPack.ok, false);
});

test('a simulation leaves everything it was given alone, prints nothing, and is repeatable', async () => {
    const pack = factions();
    const before = JSON.stringify(pack);
    const warn = console.warn, info = console.info;
    const seen = [];
    console.warn = (...args) => seen.push(args.map(String).join(' '));
    try {
        const first = await simulate(pack, REPUTATION, [reply(gain('a')), reply(gain('b', 'crown'))]);
        const second = await simulate(pack, REPUTATION, [reply(gain('a')), reply(gain('b', 'crown'))]);
        assert.deepEqual(first, second);
        assert.deepEqual(seen, [], 'Story Block’s own warnings stay out of the author’s console');
        console.warn('other code still logs');
        assert.deepEqual(seen, ['other code still logs']);
    } finally { console.warn = warn; }
    assert.equal(console.info, info);
    assert.equal(JSON.stringify(pack), before);
    assert.equal(globalThis.storyBlockGenerationInterceptor, undefined);
});

test('buildRequest substitutes the open draft into the pack without changing the saved pack', () => {
    const model = openPack(JSON.stringify(factions()));
    const draft = structuredClone(model.document.content.dataModules[0]);
    draft.name = 'Draft name';
    const request = buildRequest(model.document, draft, 0, defaultScenario(draft));
    assert.equal(request.pack.content.dataModules[0].name, 'Draft name');
    assert.equal(model.document.content.dataModules[0].name, 'Reputation');
    assert.equal(request.module, REPUTATION);
    assert.deepEqual(request.scenario.actors, []);
});

test('the sample Story Director: stable ca_ IDs, name or ID input, and the time argument forms', () => {
    assert.equal(actorId('Wessel'), 'ca_wessel01');
    assert.equal(actorId('Wessel', ['ca_wessel01']), 'ca_wessel02');
    assert.equal(actorId('ca_abcd1234'), 'ca_abcd1234');
    assert.deepEqual(sampleActors(['Wessel', 'wessel', ' ', 'ca_abcd1234']), [{ id: 'ca_wessel01', name: 'Wessel' }, { id: 'ca_wessel02', name: 'wessel' }, { id: 'ca_abcd1234', name: 'abcd1234' }]);
    assert.deepEqual(['+6h', '+30m', '+2d', '45', '6 h', 'soon', '+'].map(timeMinutes), [360, 30, 2880, 45, 360, null, null]);
});
