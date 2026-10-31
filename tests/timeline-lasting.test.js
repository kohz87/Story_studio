import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack } from '../src/model.js';
import { setSchemaField, setRecords, remove } from '../src/edits.js';
import { checkLasting, lastingProblems, readLasting, withLasting, withLastingCapability, LASTING_COMMAND, LASTING_CAPABILITY } from '../src/timeline/lasting.js';
import { timelineNotes, missingWorldEvents } from '../src/timeline/notes.js';

const pack = then => ({ id: 'tl', version: '1.0.0', name: 'Tl', requires: { storyBlock: '^2' }, content: { events: [{ id: 'seal', when: 'true', cue: 'The seal fails.', ...then && { then } }] } });
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

test('Story Director\'s own rules: a blank faction, unknown keys and padding are judged as it judges them', () => {
    const fields = payload => checkLasting({ name: 'N', state: 'looming', ...payload }).map(problem => problem.field);
    assert.deepEqual(fields({ factions: ['Guild', ''] }), ['factions']);
    assert.deepEqual(fields({ factions: ['  '] }), ['factions']);
    assert.deepEqual(fields({ factions: ['**'] }), ['factions']);
    assert.deepEqual(fields({ aka: ['Other'] }), ['aka']);
    assert.deepEqual(fields({ Keep: true, summary: 's' }), ['Keep']);
    assert.deepEqual(fields({ 'a.b': 1 }), ['']);
    assert.deepEqual(checkLasting({ name: '**', state: 'looming' }).map(problem => problem.field), ['name']);
    // Padding is trimmed before it is measured.
    assert.deepEqual(checkLasting({ name: ` ${'n'.repeat(80)} `, state: 'ongoing', summary: ` ${'s'.repeat(240)}  `, place: `  ${'p'.repeat(80)} `, factions: [` ${'f'.repeat(80)} `] }), []);
    assert.deepEqual(fields({ summary: ` ${'s'.repeat(241)}` }), ['summary']);
    const broken = openPack(pack([{ command: LASTING_COMMAND, payload: { ...good, aka: 'x', factions: [''] } }]));
    assert.deepEqual(broken.validation.errors.map(error => error.path).sort(), ['content.events.0.then.0.payload.aka', 'content.events.0.then.0.payload.factions']);
});

test('the pack lists chronicle-lasting while an event has a lasting change, and drops it when none does', () => {
    const plain = openPack(pack(undefined));
    assert.equal(plain.document.requires.capabilities, undefined);
    const step = [{ command: LASTING_COMMAND, payload: good }];
    const event = plain.document.content.events[0];
    const added = setSchemaField(plain, ['content', 'events', 0], { ...event, then: step });
    assert.equal(added.ok, true, JSON.stringify(added.errors));
    assert.deepEqual(added.model.document.requires, { storyBlock: '^2', capabilities: [LASTING_CAPABILITY] });
    assert.equal(added.model.validation.ok, true);
    assert.deepEqual(JSON.parse(exportPack(added.model)).requires.capabilities, ['chronicle-lasting']);
    // Every route that changes events keeps it: another edit, several events at once, and taking the step away.
    const again = setRecords(added.model, 'events', [{ ...added.model.document.content.events[0], cue: 'Changed.' }]);
    assert.deepEqual(again.model.document.requires.capabilities, [LASTING_CAPABILITY]);
    const dropped = setSchemaField(added.model, ['content', 'events', 0], event);
    assert.equal(Object.hasOwn(dropped.model.document.requires, 'capabilities'), false);
    assert.equal(remove(added.model, 'events', 'seal').model.document.requires.capabilities, undefined);
    // Capabilities the pack needs for other reasons stay, in order; nothing else about the pack moves.
    const other = openPack({ ...pack(undefined), requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] } });
    const both = setSchemaField(other, ['content', 'events', 0], { ...event, then: step });
    assert.deepEqual(both.model.document.requires.capabilities, ['data-modules-v1', LASTING_CAPABILITY]);
    assert.deepEqual(setSchemaField(both.model, ['content', 'events', 0], event).model.document.requires.capabilities, ['data-modules-v1']);
    const same = pack(undefined);
    assert.equal(withLastingCapability(same), same);
    assert.equal(withLastingCapability({ ...same, requires: { storyBlock: '^2', capabilities: 'x' } }).requires.capabilities, 'x');
});

test('Problems tells what a lasting change needs, and which waits have nothing to wait for', () => {
    const lasting = openPack(pack([{ command: LASTING_COMMAND, payload: good }]));
    assert.deepEqual(timelineNotes(lasting.document), [{ kind: 'warning', path: 'requires.capabilities', message: timelineNotes(lasting.document)[0].message }]);
    assert.match(timelineNotes(lasting.document)[0].message, /need Story Director with world-event support.*does not list “chronicle-lasting”/);
    const listed = setSchemaField(lasting, ['content', 'events', 0, 'cue'], 'The seal fails again.').model;
    const [info] = timelineNotes(listed.document);
    assert.equal(info.kind, 'info');
    assert.match(info.message, /need Story Director with world-event support.*lists “chronicle-lasting”.*will not turn on and Story Block says why/);
    assert.deepEqual(timelineNotes(openPack(pack(undefined)).document), []);
    const document = pack([{ command: LASTING_COMMAND, payload: good }]);
    document.content.events.push(
        { id: 'fails', when: "query('chronicle.passed', { name: 'seventh SEAL failed', minutes: 1440 })", cue: 'x' },
        { id: 'lost', when: "query('chronicle.passed', { name: 'Cracks', minutes: 1440 })", cue: 'x' },
        { id: 'hand', when: "query(\"chronicle.passed\", { name: \"Old news\", minutes: 10 }) || false", cue: 'x' },
    );
    assert.deepEqual([...missingWorldEvents(document)], [[2, ['Cracks']], [3, ['Old news']]]);
    const notes = timelineNotes(document).filter(note => note.path.endsWith('.when'));
    assert.deepEqual(notes.map(note => note.path), ['content.events.2.when', 'content.events.3.when']);
    assert.match(notes[0].message, /Event "lost" waits for “Cracks”, which no event in this pack adds/);
});
