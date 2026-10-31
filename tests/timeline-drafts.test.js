import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack, draftsOf, withDrafts } from '../src/model.js';
import { setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';
import { readDraft, writeDraft, DRAFT_KEY } from '../src/session.js';
import { readAnswer } from '../src/timeline/ai-answer.js';
import { makeDraft, addDrafts, discardDraft, keepDraft, keepAll, keepableCount, draftProblems, waitingFor, sanitizeDrafts, MAX_DRAFTS, NEWS_PLACEHOLDER } from '../src/timeline/drafts.js';
import { renderProblemGroups } from '../src/screens/problems.js';
import { createTestContext } from './helpers/dom.js';

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
