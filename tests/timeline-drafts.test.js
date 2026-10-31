import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack, draftsOf, withDrafts } from '../src/model.js';
import { setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';
import { readDraft, writeDraft, DRAFT_KEY } from '../src/session.js';
import { readAnswer } from '../src/timeline/ai-answer.js';
import { makeDraft, addDrafts, discardDraft, keepDraft, keepAll, keepableCount, draftProblems, draftIssues, ackNote, renameDraft, waitingFor, sanitizeDrafts, MAX_DRAFTS, NEWS_PLACEHOLDER } from '../src/timeline/drafts.js';
import { renderProblemGroups } from '../src/screens/problems.js';
import { createTestContext } from './helpers/dom.js';
import { writeCondition } from '../src/timeline/condition.js';

const ersveil = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const answer = [
    { name: 'The Emperor of Highmark dies', when: { on: 'Icewane 4, CY 612, dawn' }, where: ['Highmark Empire'], news: 'Bells toll.', lasting: { name: 'Highmark succession', state: 'looming', keep: true } },
    { name: 'News reaches the north', when: { after: 'The Emperor of Highmark dies', days: 14 }, where: ['Shornmarch', 'Bluewatch Village'], news: 'The news arrives.' },
    { name: 'The Diet splits', when: { after: 'The Emperor of Highmark dies', days: 30 }, where: ['Highmark Capital Nowhere'], news: 'Split.' },
];
const drafted = (m = openPack(ersveil)) => {
    const result = readAnswer(JSON.stringify(answer), m);
    assert.ok(result.ok);
    return addDrafts(m, result.items.map(item => item.draft)).model;
};
const ids = list => list.map(draft => draft.record.id);

test('drafts ride along with the open project but are no part of its pack: document, checks and export are as they were', () => {
    const plain = openPack(ersveil);
    const model = drafted(plain);
    assert.deepEqual(ids(draftsOf(model)), ['the-emperor-of-highmark-dies', 'news-reaches-the-north', 'the-diet-splits']);
    assert.equal(model.document, plain.document);
    assert.deepEqual(model.validation, plain.validation);
    assert.equal(model.packHash, plain.packHash);
    assert.deepEqual(model.references, plain.references);
    assert.equal(exportPack(model), ersveil, 'an untouched pack still exports its own bytes');
    assert.equal(draftsOf(plain).length, 0);
    // A draft the pack checker would refuse changes nothing there either.
    const broken = withDrafts(plain, [makeDraft({ id: 'bad', when: '(((', cue: '' })]);
    assert.equal(broken.validation.ok, true);
    assert.equal(exportPack(broken), ersveil);
    // The Problems list and the check screen read the pack's own validation: no draft in them.
    const ctx = createTestContext(broken);
    const box = ctx.doc.createElement('div');
    renderProblemGroups(ctx, box);
    assert.ok(!/bad/.test(box.textContent));
});

test('an edit keeps the drafts, undo and redo bring back the ones each snapshot had, and one edit is one step', () => {
    const history = createHistory(drafted());
    const before = history.current;
    history.commit(setField(before, ['name'], 'Renamed'));
    assert.equal(draftsOf(history.current).length, 3);
    assert.equal(history.current.document.name, 'Renamed');
    history.commit(discardDraft(history.current, 'the-diet-splits'));
    assert.equal(draftsOf(history.current).length, 2);
    assert.equal(history.current.document.name, 'Renamed');
    assert.equal(draftsOf(history.undo()).length, 3, 'undoing a discard brings the draft back');
    assert.equal(history.current.document.name, 'Renamed');
    assert.equal(draftsOf(history.undo()).length, 3);
    assert.equal(history.current, before);
    assert.equal(draftsOf(history.redo()).length, 3);
    assert.equal(draftsOf(history.redo()).length, 2);
});

test('adding drafts is one step, and undoing it takes them all away', () => {
    const history = createHistory(openPack(ersveil));
    const result = readAnswer(JSON.stringify(answer), history.current);
    assert.ok(history.commit(addDrafts(history.current, result.items.map(item => item.draft))));
    assert.equal(draftsOf(history.current).length, 3);
    assert.equal(draftsOf(history.undo()).length, 0);
    assert.equal(history.canUndo, false);
    assert.equal(draftsOf(history.redo()).length, 3);
    const many = Array.from({ length: MAX_DRAFTS }, (_, i) => makeDraft({ id: `d-${i}`, when: 'true', cue: 'x' }));
    const full = addDrafts(openPack(ersveil), many).model;
    const over = addDrafts(full, [makeDraft({ id: 'one-more', when: 'true', cue: 'x' })]);
    assert.equal(over.ok, false);
    assert.match(over.errors[0].message, /at most 60 drafts/);
});

test('Keep adds the event to the pack, settles what it follows, and is one undo step; Discard drops it, also one', () => {
    const history = createHistory(drafted());
    const first = keepDraft(history.current, 'the-emperor-of-highmark-dies');
    assert.ok(first.ok, JSON.stringify(first.errors));
    history.commit(first);
    assert.equal(history.current.document.content.events.length, 8);
    assert.equal(history.current.document.content.events.at(-1).id, 'the-emperor-of-highmark-dies');
    assert.deepEqual(ids(draftsOf(history.current)), ['news-reaches-the-north', 'the-diet-splits']);
    assert.ok(history.current.document.requires.capabilities.includes('chronicle-lasting'));
    assert.equal(history.current.validation.ok, true);
    history.commit(keepDraft(history.current, 'news-reaches-the-north'));
    assert.equal(history.current.document.content.events.length, 9);
    history.commit(discardDraft(history.current, 'the-diet-splits'));
    assert.equal(draftsOf(history.current).length, 0);
    assert.equal(history.current.document.content.events.length, 9);
    history.undo();
    assert.deepEqual(ids(draftsOf(history.current)), ['the-diet-splits']);
    assert.equal(history.current.document.content.events.length, 9);
    history.undo();
    assert.equal(history.current.document.content.events.length, 8);
    assert.deepEqual(ids(draftsOf(history.current)), ['news-reaches-the-north', 'the-diet-splits']);
    history.undo();
    assert.equal(history.current.document.content.events.length, 7);
    assert.equal(exportPack(history.current), ersveil, 'back to the start, the pack exports its own bytes');
    assert.equal(draftsOf(history.current).length, 3);
});

test('a draft that needs a look cannot be kept until it is fixed, and says why', () => {
    const model = drafted();
    const drafts = draftsOf(model);
    assert.deepEqual(draftProblems(model, drafts, 0), []);
    assert.deepEqual(draftProblems(model, drafts, 2), ['“Highmark Capital Nowhere” is not a place in this pack: pick one in the form.']);
    const refused = keepDraft(model, 'the-diet-splits');
    assert.equal(refused.ok, false);
    assert.match(refused.errors[0].message, /not a place in this pack/);
    assert.equal(keepableCount(model), 2);
    const all = keepAll(model);
    assert.equal(all.kept, 2);
    assert.equal(all.left, 1);
    assert.deepEqual(ids(draftsOf(all.result.model)), ['the-diet-splits']);
    assert.equal(all.result.model.document.content.events.length, 9);
    // Nothing that can be kept: no edit at all.
    assert.equal(keepAll(withDrafts(openPack(ersveil), [makeDraft({ id: 'x', when: 'true', cue: NEWS_PLACEHOLDER })])).result, null);
    assert.equal(keepDraft(model, 'gone').ok, false);
    assert.equal(discardDraft(model, 'gone').ok, false);
});

test('a draft that follows another must wait for it; Keep all keeps the earlier one first', () => {
    const model = drafted();
    assert.deepEqual(waitingFor(model, draftsOf(model), 0), null);
    assert.deepEqual(waitingFor(model, draftsOf(model), 1), { id: 'the-emperor-of-highmark-dies', name: 'The emperor of highmark dies' });
    const early = keepDraft(model, 'news-reaches-the-north');
    assert.equal(early.ok, false);
    assert.match(early.errors[0].message, /Keep “The emperor of highmark dies” first/);
    // The same drafts in the other order still keep parent first.
    const reversed = withDrafts(openPack(ersveil), [...draftsOf(model)].reverse());
    assert.equal(keepableCount(reversed), 2);
    const all = keepAll(reversed);
    assert.equal(all.kept, 2);
    assert.deepEqual(all.result.model.document.content.events.slice(7).map(event => event.id), ['the-emperor-of-highmark-dies', 'news-reaches-the-north']);
});

test('what changes in the pack after a draft was written shows on the draft: a missing earlier event, a taken ID', () => {
    const plain = openPack(ersveil);
    const pack = JSON.parse(ersveil);
    const without = openPack({ ...pack, content: { ...pack.content, events: pack.content.events.slice(0, 2) } });
    assert.equal(without.validation.ok, true);
    const orphan = makeDraft({ id: 'orphan', after: 'the-turning-611', when: 'true', cue: 'x' });
    assert.deepEqual(draftProblems(plain, [orphan], 0).filter(text => /comes after/.test(text)), []);
    assert.match(draftProblems(without, [orphan], 0)[0], /comes after “The turning 611”, which is not an event of the pack/);
    const clash = makeDraft({ id: 'bluewatch-guild-board', when: 'true', cue: 'x' });
    assert.match(draftProblems(plain, [clash], 0)[0], /already has an event with the ID “bluewatch-guild-board”/);
    assert.equal(keepDraft(withDrafts(plain, [clash]), 'bluewatch-guild-board').ok, false);
    const model = drafted(plain);
    assert.equal(draftProblems(model, draftsOf(model), 0).length, 0);
});

test('drafts are saved with the project and come back after a reload, with the pack\'s own bytes', () => {
    const store = new Map();
    const win = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } };
    const model = drafted();
    assert.ok(writeDraft(win, model, false));
    assert.ok(JSON.parse(store.get(DRAFT_KEY)).drafts.length === 3);
    const restored = readDraft(win);
    assert.deepEqual(draftsOf(restored.model), draftsOf(model));
    assert.equal(exportPack(restored.model), ersveil);
    assert.equal(restored.dirty, false);
    // Without drafts nothing is added to what is saved.
    writeDraft(win, openPack(ersveil), false);
    assert.equal('drafts' in JSON.parse(store.get(DRAFT_KEY)), false);
    assert.equal(draftsOf(readDraft(win).model).length, 0);
    // A saved list with rubbish in it keeps only what is a draft.
    const saved = JSON.parse(store.get(DRAFT_KEY));
    store.set(DRAFT_KEY, JSON.stringify({ ...saved, drafts: [null, 7, { record: 'x' }, { record: { when: 'true' } }, { record: { id: 'ok', when: 'true', cue: 'x' }, notes: ['a', 5], seen: 3 }] }));
    const kept = draftsOf(readDraft(win).model);
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].notes, ['a']);
    assert.equal(typeof kept[0].seen, 'string');
    assert.deepEqual(sanitizeDrafts('nope'), []);
});

test('a note about what could not be written lasts until the date, delay or places it was about are changed', () => {
    const model = openPack(ersveil);
    const result = readAnswer(JSON.stringify([{ name: 'Lost date', when: { on: 'Frostmonth 4, CY 612' }, news: 'x' }]), model);
    const draft = result.items[0].draft;
    assert.equal(draft.notes.length, 1);
    assert.equal(draftProblems(model, [draft], 0).length, 1);
    const changed = { ...draft, record: { ...draft.record, when: 'time() != null && time() >= 317700000' } };
    assert.deepEqual(draftProblems(model, [changed], 0), []);
    const news = { ...draft, record: { ...draft.record, cue: 'Other news.' } };
    assert.equal(draftProblems(model, [news], 0).length, 1, 'changing the news does not answer a question about the date');
});

// ------------------------------------------------------------ review 159

const lostParent = JSON.stringify([{ name: 'Lost parent', when: { after: 'Missing king', days: 3 }, where: ['Not Here'], news: 'A king dies' }]);

test('review 1: a note stays with the field it is about: fixing the place does not answer a missing parent or a dropped delay', () => {
    const plain = openPack(ersveil);
    const draft = readAnswer(lostParent, plain).items[0].draft;
    const text = list => list.join(' | ');
    const before = draftProblems(plain, [draft], 0);
    assert.match(text(before), /comes after “Missing king”, which is not an event in the pack or in this answer/);
    assert.match(text(before), /delay of 3 days but no earlier event to count from/);
    assert.match(text(before), /“Not Here” is not a place in this pack/);
    // Remove only the unknown place: the other two stay.
    const noPlace = { ...draft, record: { ...draft.record, when: 'true' } };
    const left = draftProblems(plain, [noPlace], 0);
    assert.equal(left.length, 2, text(left));
    assert.match(text(left), /Missing king/);
    assert.match(text(left), /delay of 3 days/);
    const held = withDrafts(plain, [noPlace]);
    const refused = keepDraft(held, 'lost-parent');
    assert.equal(refused.ok, false, 'it cannot fire at once, because it was meant to wait');
    assert.equal(keepAll(held).kept, 0);
    assert.equal(keepableCount(held), 0);
    // Changing the news, the end or the once flag changes none of it either.
    for (const record of [{ ...noPlace.record, cue: 'Other news' }, { ...noPlace.record, once: false }]) assert.equal(draftProblems(plain, [{ ...noPlace, record }], 0).length, 2);
    // Following an existing event answers the parent but not the delay; a delay or choosing "right after" answers that.
    const follows = { ...noPlace, record: { ...noPlace.record, after: 'the-turning-611' } };
    assert.deepEqual(draftIssues(plain, [follows], 0).map(issue => issue.text).filter(line => /Missing king/.test(line)), []);
    const delay = draftIssues(plain, [follows], 0).filter(issue => /delay of 3 days/.test(issue.text));
    assert.equal(delay.length, 1);
    assert.equal(delay[0].ack, 'Right after is fine');
    const set = ackNote(withDrafts(plain, [follows]), 'lost-parent', delay[0].note);
    assert.ok(set.ok);
    assert.deepEqual(draftProblems(set.model, draftsOf(set.model), 0), []);
    assert.equal(keepDraft(set.model, 'lost-parent').ok, true);
    // A delay that is set answers the delay note, by itself.
    const lasting = { ...follows, record: { ...follows.record, after: 'bluewatch-guild-board' } };
    const timed = openPack(JSON.stringify({ ...JSON.parse(ersveil), content: { ...JSON.parse(ersveil).content, events: JSON.parse(ersveil).content.events.map(event => (event.id === 'bluewatch-guild-board' ? { ...event, then: [{ command: 'chronicle.lasting', payload: { name: 'Guild board', state: 'ongoing' } }] } : event)) } }));
    const counted = { ...lasting, record: { ...lasting.record, when: "query('chronicle.passed', { name: 'Guild board', minutes: 4320 })" } };
    assert.deepEqual(draftProblems(timed, [counted], 0), []);
});

test('review 1: every kind of note is tied to its own field and is set aside only by changing that field or by saying it is fine', () => {
    const plain = openPack(ersveil);
    const read = event => readAnswer(JSON.stringify([{ news: 'x', ...event }]), plain).items[0].draft;
    const other = { name: 'Other', news: 'x', lasting: { name: 'Other change', state: 'ongoing' } };
    const noteFor = (draft, kind) => draft.notes.find(note => note.kind === kind);
    // when / until / once / lasting / news / where: each lasts while its own field is as it was.
    const dated = read({ name: 'A', when: { on: 'sometime' } });
    assert.equal(noteFor(dated, 'when').ack, 'Not dated is fine');
    assert.equal(draftProblems(plain, [{ ...dated, record: { ...dated.record, cue: 'new', once: false } }], 0).length, 1);
    assert.equal(draftProblems(plain, [{ ...dated, record: { ...dated.record, when: 'time() != null && time() >= 317700000' } }], 0).length, 0);
    const ended = read({ name: 'B', when: 'any time', until: 'Icewane 9, CY 612' });
    assert.ok(noteFor(ended, 'until'));
    assert.equal(draftProblems(plain, [{ ...ended, record: { ...ended.record, when: "query('scene.place') != null && (query('scene.place').region == 'Shornmarch')" } }], 0).length, 1, 'changing the places does not answer the end date');
    const once = read({ name: 'C', once: 'no' });
    assert.equal(draftProblems(plain, [once], 0).length, 1);
    assert.equal(draftProblems(plain, [{ ...once, record: { ...once.record, once: false } }], 0).length, 0);
    const lasting = read({ name: 'D', lasting: 'text' });
    assert.equal(draftProblems(plain, [lasting], 0).length, 1);
    assert.equal(draftProblems(plain, [{ ...lasting, record: { ...lasting.record, then: [{ command: 'chronicle.lasting', payload: { name: 'D', state: 'ongoing' } }] } }], 0).length, 0);
    const cut = read({ name: 'E', news: 'n'.repeat(900) });
    assert.equal(draftProblems(plain, [cut], 0).length, 1);
    assert.equal(draftProblems(plain, [{ ...cut, record: { ...cut.record, cue: 'Short.' } }], 0).length, 0);
    // "Fine": the note goes, in one edit, and the draft can be kept.
    const held = withDrafts(plain, [dated]);
    const fine = ackNote(held, 'a', 0);
    assert.ok(fine.ok);
    assert.equal(draftsOf(fine.model)[0].notes.length, 0);
    assert.equal(draftsOf(held)[0].notes.length, 1, 'the earlier snapshot is untouched (undo)');
    assert.equal(ackNote(fine.model, 'a', 0).ok, false);
    assert.equal(ackNote(held, 'nobody', 0).ok, false);
    // A note with no button (the missing earlier event) cannot be set aside.
    const orphan = readAnswer(JSON.stringify([{ name: 'F', news: 'x', when: { after: 'Nobody' } }]), plain).items[0].draft;
    assert.equal(noteFor(orphan, 'after').ack, undefined);
    assert.equal(ackNote(withDrafts(plain, [orphan]), 'f', orphan.notes.findIndex(note => note.kind === 'after')).ok, false);
    void other;
});

test('notes survive a reload as they were, older whole-draft notes are still read, and rubbish is left out', () => {
    const store = new Map();
    const win = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } };
    const plain = openPack(ersveil);
    const draft = readAnswer(lostParent, plain).items[0].draft;
    assert.ok(writeDraft(win, withDrafts(plain, [draft]), false));
    const back = draftsOf(readDraft(win).model)[0];
    assert.deepEqual(back, draft);
    assert.equal(draftProblems(plain, [back], 0).length, 3);
    const saved = JSON.parse(store.get(DRAFT_KEY));
    store.set(DRAFT_KEY, JSON.stringify({ ...saved, drafts: [{ ...saved.drafts[0], notes: ['old note', { kind: 'nope', text: 't', seen: 's' }, { kind: 'delay', text: 't' }, { kind: 'delay', text: 'keeps', seen: '[0]', ack: 'ok' }, 5] }] }));
    assert.deepEqual(draftsOf(readDraft(win).model)[0].notes, ['old note', { kind: 'delay', text: 'keeps', seen: '[0]', ack: 'ok' }]);
});

test('review 7: drafts too big to save are refused when they are added, not lost on reload', () => {
    const plain = openPack(ersveil);
    const big = makeDraft({ id: 'big', when: 'true', cue: 'x'.repeat(3 * 1024 * 1024) });
    const refused = addDrafts(plain, [big]);
    assert.equal(refused.ok, false);
    assert.match(refused.errors[0].message, /too big to be saved with the project/);
    assert.equal(draftsOf(plain).length, 0);
    const store = new Map();
    const win = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } };
    assert.equal(writeDraft(win, withDrafts(plain, [big]), false), false, 'and the save of such a project does fail, as the review found');
    assert.equal(addDrafts(plain, [makeDraft({ id: 'small', when: 'true', cue: 'x' })]).ok, true);
});

test('review 5: a draft can be renamed on its own, whatever the pack has: it is a draft, so renaming it never touches the pack', () => {
    const plain = openPack(ersveil);
    const pack = JSON.parse(ersveil);
    const clash = makeDraft({ id: 'bluewatch-guild-board', when: 'true', cue: 'x' });
    const child = makeDraft({ id: 'child', after: 'bluewatch-guild-board', when: 'true', cue: 'y' });
    const held = withDrafts(plain, [clash, child]);
    assert.equal(draftProblems(held, draftsOf(held), 0).length, 1);
    const renamed = renameDraft(held, 0, 'fresh-start');
    assert.ok(renamed.ok);
    assert.equal(renamed.model.document, plain.document, 'the pack is untouched');
    assert.deepEqual(draftsOf(renamed.model).map(draft => draft.record.id), ['fresh-start', 'child']);
    assert.equal(draftsOf(renamed.model)[1].record.after, 'bluewatch-guild-board', 'a draft that follows the pack\'s event of that name keeps following it');
    assert.deepEqual(draftProblems(renamed.model, draftsOf(renamed.model), 0), []);
    assert.equal(keepDraft(renamed.model, 'fresh-start').ok, true);
    // A draft that follows a draft moves with it.
    const parent = makeDraft({ id: 'parent', when: 'true', cue: 'x' });
    const kid = makeDraft({ id: 'kid', after: 'parent', when: 'true', cue: 'y' });
    const moved = renameDraft(withDrafts(plain, [parent, kid]), 0, 'elder');
    assert.equal(draftsOf(moved.model)[1].record.after, 'elder');
    // Refusals: taken by the pack or another draft, not a slug, gone.
    assert.equal(renameDraft(held, 1, 'bluewatch-guild-board').ok, false);
    assert.equal(renameDraft(held, 1, 'child').ok, true);
    assert.equal(renameDraft(held, 0, 'child').ok, false);
    assert.equal(renameDraft(held, 0, 'Not A Slug').ok, false);
    assert.equal(renameDraft(held, 0, '').ok, false);
    assert.equal(renameDraft(held, 9, 'x').ok, false);
    void pack;
});

test('review 161-1: a note belongs to its own field only: changing another field, the start mode included, never answers it', () => {
    const plain = openPack(ersveil);
    const written = (spec, more = {}) => {
        const condition = writeCondition({ from: null, until: null, since: null, where: [], ...spec });
        assert.ok(condition.ok, condition.reason);
        return { id: 'probe', when: condition.when, cue: 'News.', ...more };
    };
    const base = written({ from: 600000 });
    // Each way to change an event, and the fields of the notes it touches.
    const changes = [
        [['when', 'after'], written({ from: null }, { after: 'bluewatch-guild-board' })],
        [['when', 'after', 'delay'], written({ from: null, since: { name: 'Board change', minutes: 1440 } }, { after: 'bluewatch-guild-board' })],
        [['until'], written({ from: 600000, until: 700000 })],
        [['where'], written({ from: 600000, where: [{ kind: 'place', name: 'Auvoth' }] })],
        [['after'], { ...base, after: 'bluewatch-guild-board' }],
        [['once'], { ...base, once: false }],
        [['news'], { ...base, cue: 'Other news.' }],
        [['lasting'], { ...base, then: [{ command: 'chronicle.lasting', payload: { name: 'Probe', state: 'ongoing' } }] }],
    ];
    const kinds = ['when', 'until', 'after', 'delay', 'where', 'once', 'news', 'lasting'];
    for (const kind of kinds) {
        const draft = makeDraft(base, [{ kind, text: `NOTE ${kind}` }]);
        const said = record => draftIssues(plain, [{ ...draft, record }], 0).some(issue => issue.text === `NOTE ${kind}`);
        assert.ok(said(base), `${kind}: said for the event it was made for`);
        for (const [touches, record] of changes) {
            // A note about the date or the delay is answered by a change of the date or the delay: the start moved off the date.
            if (touches.includes(kind)) assert.ok(!said(record), `${kind}: answered by a change of its own field`);
            else assert.ok(said(record), `${kind}: still said after a change of ${touches.join(', ')}`);
        }
    }
});
