// Source deletion through the simulator must retract outcomes whose runtime witnesses no longer hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/data-modules/sb-adapter.js';
import { replyText } from '../src/data-modules/simulator.js';

const definition = () => ({
    slug: 'counter', name: 'Counter', schema: 1, stateVersion: 1, scope: 'chat',
    state: { score: { type: 'int', min: 1, max: 5, default: 1 }, title: { type: 'bool', default: false } },
    kinds: {},
});
const set = (path, value) => ({ op: 'set', path: [path], value });
const kind = effects => ({ op: '!', labels: {}, effects });
const reply = (slug, name) => ({ type: 'reply', text: replyText([`! dm ${slug} — test | kind: ${name}`]) });
const run = (definitions, steps, action = null, module = 'counter') => simulate({
    pack: { id: 'witness', version: '1.0.0', requires: { storyBlock: '^2', capabilities: ['data-modules-v1', 'story-director'] }, content: { dataModules: definitions } },
    module: `pack.witness/${module}`, scenario: { actors: [], startMinute: 1000, steps }, action,
});
function accepted(result, fields) {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.final.fields, fields);
    assert.deepEqual(result.replay, { equal: true });
}
function retracted(result, fields) {
    accepted(result, fields);
    assert.deepEqual(result.steps.map(step => step.status), ['inactive']);
    assert.deepEqual(result.problems.map(problem => problem.code), ['REPLAY_PREREQUISITE']);
}

for (const [name, effect] of [
    ['set', set('score', 5)],
    ['clamped add', { op: 'add', path: ['score'], value: 1, bounds: 'clamp' }],
    ['clamp', { op: 'clamp', path: ['score'], min: 1, max: 5 }],
]) test(`simulator: a no-op ${name} keeps the original write witness for its reward`, async () => {
    const d = definition();
    d.rewards = { title: { bindings: {}, values: {}, when: ['ge', ['get', ['score']], 5], effects: [set('title', true)] } };
    d.kinds = {
        prime: kind([set('score', 5)]),
        repeat: kind([effect, { op: 'reward', template: 'title', bind: {} }]),
    };
    const steps = [reply('counter', 'prime'), reply('counter', 'repeat')];
    accepted(await run([d], steps), { score: 5, title: true });
    retracted(await run([d], steps, { type: 'delete', step: 0 }), { score: 1, title: false });
});

test('simulator: repeated writes keep the original prefix rather than an intermediate draft', async () => {
    const d = definition();
    d.kinds.write = kind([2, 3, 3].map(value => set('score', value)));
    const steps = [reply('counter', 'write')];
    for (const action of [null, { type: 'reload' }]) {
        const result = await run([d], steps, action);
        accepted(result, { score: 3, title: false });
        assert.deepEqual(result.problems, []);
        assert.deepEqual(result.steps.map(step => step.status), ['applied']);
    }
});

for (const mode of ['recorded', 'prefix']) for (const gate of ['kind', 'rule', 'reward']) {
    test(`simulator: ${mode} clock eligibility in a ${gate} needs its source reply`, async () => {
        const d = definition();
        d.imports = { clock: { query: 'director.time', mode, projection: ['minutes'] } };
        const when = ['ge', ['input', 'clock', 'minutes'], 1060];
        const effects = [set('title', true)];
        d.kinds.earn = kind(gate === 'kind' ? effects : []);
        if (gate === 'kind') d.kinds.earn.when = when;
        if (gate === 'rule') d.rules = [{ id: 'late', when, then: effects }];
        if (gate === 'reward') {
            d.rewards = { title: { bindings: {}, values: {}, when, effects } };
            d.kinds.earn.effects = [{ op: 'reward', template: 'title', bind: {} }];
        }
        const steps = [{ type: 'advance', minutes: 60 }, reply('counter', 'earn')];
        accepted(await run([d], steps), { score: 1, title: true });
        retracted(await run([d], steps, { type: 'delete', step: 0 }), { score: 1, title: false });
    });
}

for (const mode of ['recorded', 'prefix']) for (const indirect of [false, true]) test(`simulator: ${mode} public eligibility ${indirect ? 'through a write' : 'in a condition'} needs its source`, async () => {
    const source = definition();
    source.exports = { score: { fields: ['score'] } };
    source.kinds.prime = kind([set('score', 5)]);
    const d = definition(); d.slug = 'follower';
    d.imports = { source: { query: 'dataModules.public', args: { module: 'pack.witness/counter', export: 'score' }, mode, projection: ['score'] } };
    const input = ['input', 'source', 'score'];
    d.kinds.earn = kind(indirect ? [set('score', input)] : []);
    d.rules = [{ id: 'eligible', when: ['ge', indirect ? ['get', ['score']] : input, 5], then: [set('title', true)] }];
    const steps = [reply('counter', 'prime'), reply('follower', 'earn')];
    accepted(await run([source, d], steps, null, 'follower'), { score: indirect ? 5 : 1, title: true });
    retracted(await run([source, d], steps, { type: 'delete', step: 0 }, 'follower'), { score: 1, title: false });
});
