import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack } from '../src/model.js';
import { checkLasting, lastingProblems, readLasting, withLasting, LASTING_COMMAND } from '../src/timeline/lasting.js';

const pack = then => ({ id: 'tl', version: '1.0.0', name: 'Tl', requires: { storyBlock: '^2' }, content: { events: [{ id: 'seal', when: 'true', cue: 'The seal fails.', then }] } });
const good = { name: 'Seventh seal failed', state: 'ongoing', place: 'Auvoth', factions: ['Adventurer Guild', 'Sealwardens'], summary: 'Broken.', keep: true };

test('a payload inside the limits has no problems, and each limit is flagged', () => {
    assert.deepEqual(checkLasting(good), []);
    assert.deepEqual(checkLasting({ name: 'x', state: 'looming' }), []);
    const cases = [
        [{ ...good, name: '' }, 'name'], [{ ...good, name: 'n'.repeat(81) }, 'name'], [{ ...good, state: 'done' }, 'state'],
        [{ ...good, summary: 's'.repeat(241) }, 'summary'], [{ ...good, place: 'p'.repeat(81) }, 'place'],
        [{ ...good, factions: ['1', '2', '3', '4', '5'] }, 'factions'], [{ ...good, factions: ['f'.repeat(81)] }, 'factions'],
        [{ ...good, keep: 'yes' }, 'keep'],
    ];
    for (const [payload, field] of cases) assert.deepEqual(checkLasting(payload).map(problem => problem.field), [field], field);
    assert.equal(checkLasting({ name: 'n'.repeat(80), state: 'resolved', summary: 's'.repeat(240), place: 'p'.repeat(80), factions: Array(4).fill('f'.repeat(80)) }).length, 0);
});

test('the pack checker flags a lasting change outside the limits and refuses to export it', () => {
    const fine = openPack(pack([{ command: LASTING_COMMAND, payload: good }]));
    assert.equal(fine.validation.ok, true, JSON.stringify(fine.validation.errors));
    assert.doesNotThrow(() => exportPack(fine));
    const broken = openPack(pack([{ command: LASTING_COMMAND, payload: { ...good, summary: 's'.repeat(241), keep: 3 } }]));
    assert.equal(broken.validation.ok, false);
    const paths = broken.validation.errors.map(error => error.path);
    assert.ok(paths.includes('content.events.0.then.0.payload.summary'));
    assert.ok(paths.includes('content.events.0.then.0.payload.keep'));
    assert.throws(() => exportPack(broken));
    assert.deepEqual(lastingProblems(pack([{ command: 'wallet.receive', payload: { amount: 1 } }])), []);
});

test('other steps stay when a lasting change is set or removed', () => {
    const base = { id: 'a', when: 'true', cue: 'x', then: [{ command: 'wallet.receive', payload: { amount: 5 } }] };
    const added = withLasting(base, { name: 'N', state: 'looming' });
    assert.deepEqual(added.then.map(step => step.command), ['wallet.receive', LASTING_COMMAND]);
    assert.deepEqual(readLasting(added), { name: 'N', state: 'looming' });
    assert.deepEqual(withLasting(added, null).then, base.then);
    assert.equal(Object.hasOwn(withLasting({ id: 'a', when: 'true', cue: 'x' }, null), 'then'), false);
    assert.equal(readLasting(base), null);
});
