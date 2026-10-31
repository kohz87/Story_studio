import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack, draftsOf } from '../src/model.js';
import { readLasting } from '../src/timeline/lasting.js';
import { readCondition } from '../src/timeline/condition.js';
import { readEvent } from '../src/timeline/event.js';
import { readAnswer } from '../src/timeline/ai-answer.js';
import { setSchemaField } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';
import { buildPrompt, wordCount } from '../src/timeline/ai-prompt.js';
import { withDrafts } from '../src/model.js';
import { makeDraft } from '../src/timeline/drafts.js';
import { writeCondition } from '../src/timeline/condition.js';
import { mountStudio } from '../src/studio.js';
import { MockDocument } from './helpers/dom.js';
import { DRAFT_KEY, readDraft, writeDraft } from '../src/session.js';

const ersveil = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const idea = 'The Emperor of Highmark dies in early winter CY 612. The news reaches the north about two weeks later.';
const answer = JSON.stringify([
    { name: 'The Emperor of Highmark dies', when: { on: 'Icewane 4, CY 612, dawn' }, where: ['Highmark Empire'], news: 'Bells toll.', lasting: { name: 'Highmark succession', state: 'looming', keep: true } },
    { name: 'News reaches the north', when: { after: 'The Emperor of Highmark dies', days: 14 }, where: ['Shornmarch', 'Bluewatch Village'], news: 'The news arrives.' },
    { name: 'The Diet splits', when: { after: 'The Emperor of Highmark dies', days: 30 }, where: ['Highmark Capital Nowhere'], news: 'Split.' },
], null, 2);

const open = () => {
    const ctx = createTestContext(openPack(ersveil));
    ctx.onRender = renderScreen;
    ctx.select('events', null);
    return ctx;
};
const buttons = ctx => [...ctx.inspector.querySelectorAll('button'), ...ctx.main.querySelectorAll('button')];
const named = (ctx, text) => buttons(ctx).find(node => node.textContent === text);
const click = (ctx, text) => { const node = named(ctx, text); assert.ok(node, `no button “${text}”`); assert.ok(!node.disabled, `“${text}” is disabled`); node.click(); };
const field = (ctx, label) => {
    const node = ctx.inspector.querySelectorAll('label').find(item => item.textContent.startsWith(label) || item.textContent.trim().startsWith(label));
    assert.ok(node, `no label “${label}”`);
    return node.querySelector('textarea') ?? node.querySelector('input') ?? node.querySelector('select');
};
const aria = (ctx, label) => { const node = ctx.inspector.querySelector(`[aria-label="${label}"]`); assert.ok(node, `no control “${label}”`); return node; };
const type = (node, value) => { node.value = value; node.dispatchEvent({ type: 'input', target: node }); };
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent({ type: 'change', target: node, preventDefault() {} }); };
const tick = (ctx, label, on) => {
    const row = ctx.inspector.querySelectorAll('label').find(item => item.textContent.includes(label));
    assert.ok(row, label);
    const box = row.querySelector('input');
    box.checked = on;
    change(box);
};
const prompt = ctx => ctx.inspector.querySelector('pre').textContent;
const drafts = ctx => draftsOf(ctx.model);
const rows = ctx => ctx.main.querySelectorAll('button.tl-row');
const pasteAndCheck = ctx => {
    click(ctx, 'Next: paste the answer');
    type(field(ctx, 'Paste it here'), answer);
    click(ctx, 'Check it');
};
const addAll = ctx => { pasteAndCheck(ctx); click(ctx, 'Add 3 as drafts'); };

test('the Timeline has ✦ Write with an AI beside + Add event, and it opens the panel in the inspector', () => {
    const ctx = open();
    const header = ctx.main.querySelector('.records-header');
    const labels = header.querySelectorAll('button').map(node => node.textContent);
    assert.deepEqual(labels.slice(-2), ['✦ Write with an AI', '+ Add event']);
    assert.match(ctx.inspector.textContent, /Select an event from the timeline/);
    click(ctx, '✦ Write with an AI');
    assert.equal(ctx.inspector.querySelector('h2').textContent, 'Write events with an AI');
    assert.equal(named(ctx, '✦ Write with an AI').getAttribute('aria-pressed'), 'true');
    assert.equal(ctx.inspector.querySelector('[aria-current]').textContent, '1 · Ask');
    // Choosing an event puts it away; the button brings it back, and what was typed is still there.
    type(field(ctx, 'Your idea'), idea);
    ctx.select('events', 'the-turning-611');
    assert.equal(named(ctx, '✦ Write with an AI').getAttribute('aria-pressed'), 'false');
    assert.ok(!/Write events with an AI/.test(ctx.inspector.textContent));
    click(ctx, '✦ Write with an AI');
    assert.equal(field(ctx, 'Your idea').value, idea);
    click(ctx, 'Close');
    assert.match(ctx.inspector.textContent, /Select an event from the timeline/);
});

test('step 1: the idea, four include switches, and the prompt with its word count follow each other', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    const copy = named(ctx, 'Copy prompt'), save = named(ctx, 'Save as .txt');
    assert.ok(copy.disabled && save.disabled, 'no idea, nothing to copy');
    assert.match(ctx.inspector.textContent, /Studio sends nothing anywhere/);
    type(field(ctx, 'Your idea'), idea);
    assert.ok(!named(ctx, 'Copy prompt').disabled);
    const expected = buildPrompt(JSON.parse(ersveil), { idea });
    assert.equal(prompt(ctx), expected.text);
    assert.equal(ctx.inspector.querySelector('summary').textContent, `The prompt (${wordCount(expected.words)})`);
    assert.match(ctx.inspector.textContent, new RegExp(`${idea.length} / 2000`));
    const labels = ctx.inspector.querySelectorAll('label').map(node => node.textContent.trim());
    for (const label of ['Calendar and the story’s start', 'Regions and places (30 · 320)', 'Factions and lore names (from the lorebook: none yet)', 'The 7 events already here']) assert.ok(labels.includes(label), label);
    tick(ctx, 'Calendar and the story’s start', false);
    assert.ok(!/CALENDAR/.test(prompt(ctx)));
    tick(ctx, 'The 7 events already here', false);
    assert.ok(!/EVENTS ALREADY/.test(prompt(ctx)));
    assert.equal(ctx.inspector.querySelector('summary').textContent, `The prompt (${wordCount(buildPrompt(JSON.parse(ersveil), { idea, include: { calendar: false, events: false } }).words)})`);
    tick(ctx, 'Regions and places', false);
    assert.ok(!/PLACES/.test(prompt(ctx)));
    tick(ctx, 'Calendar and the story’s start', true);
    assert.match(prompt(ctx), /CALENDAR: 12 months/);
    assert.equal(ctx.inspector.querySelector('details').hasAttribute('open'), true);
    assert.ok(ctx.inspector.querySelector('pre').getAttribute('tabindex') === '0', 'the scrolling prompt can be reached by keyboard');
});

test('Copy prompt copies it, or says what to do when the browser refuses; Save as .txt saves the same text', async () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    type(field(ctx, 'Your idea'), idea);
    const text = prompt(ctx);
    const copied = [];
    ctx.win = { navigator: { clipboard: { writeText: async value => { copied.push(value); } } } };
    click(ctx, 'Copy prompt');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(copied, [text]);
    assert.match(ctx.inspector.querySelector('[role=status]').textContent, /^Copied\./);
    ctx.win = { navigator: { clipboard: { writeText: async () => { throw new Error('refused'); } } } };
    ctx.inspector.querySelector('details').open = false;
    click(ctx, 'Copy prompt');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(ctx.inspector.querySelector('[role=status]').textContent, /would not copy it\. The prompt is selected below: press Ctrl\+C/);
    assert.equal(ctx.inspector.querySelector('details').open, true, 'the prompt is shown so it can be copied by hand');
    ctx.win = undefined;
    ctx.inspector.querySelector('[role=status]').textContent = '';
    click(ctx, 'Copy prompt');
    assert.match(ctx.inspector.querySelector('[role=status]').textContent, /would not copy it/);
    // Saving.
    const saved = [];
    ctx.root = ctx.doc.body;
    ctx.win = { Blob: class { constructor(parts, options) { saved.push({ parts, options }); } }, URL: { createObjectURL: () => 'blob:prompt', revokeObjectURL() {} }, setTimeout() {} };
    click(ctx, 'Save as .txt');
    assert.deepEqual(saved.map(item => item.parts), [[text]]);
    assert.equal(saved[0].options.type, 'text/plain;charset=utf-8');
    assert.match(ctx.inspector.textContent, /Saved\. Open the file/);
});

test('step 2: the answer is checked event by event, then added as drafts with a chip, a dashed row and a warning', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    pasteAndCheck(ctx);
    assert.equal(ctx.inspector.querySelector('[aria-current]').textContent, '2 · Paste the answer');
    const cards = ctx.inspector.querySelectorAll('.tl-ai-draft');
    assert.equal(cards.length, 3);
    assert.match(cards[0].textContent, /^✓ ReadyThe Emperor of Highmark diesIcewane 4, CY 612 at dawn · Highmark Empire · lasting change: Highmark succession \(looming, keep in mind\)$/);
    assert.match(cards[1].textContent, /^✓ ReadyNews reaches the northat least 14 days after “The emperor of highmark dies” · Shornmarch, Bluewatch Village$/);
    assert.match(cards[2].textContent, /^⚠ Needs a lookThe Diet splitsat least 30 days after .* · Highmark Capital Nowhere“Highmark Capital Nowhere” is not a place in this pack: pick one in the form\.$/);
    assert.match(ctx.inspector.textContent, /3 events found/);
    assert.match(ctx.inspector.textContent, /stay out of the exported pack until you keep them/);
    click(ctx, 'Add 3 as drafts');
    assert.equal(drafts(ctx).length, 3);
    assert.match(ctx.main.querySelector('.records-subtitle').textContent, /^7 events \+ 3 drafts · hidden from players$/);
    const list = rows(ctx);
    assert.equal(list.length, 10);
    const draftRows = list.filter(row => row.classList.contains('tl-draft-row'));
    assert.deepEqual(draftRows.map(row => row.getAttribute('data-id')), ['the-emperor-of-highmark-dies', 'news-reaches-the-north', 'the-diet-splits']);
    assert.ok(draftRows.every(row => row.querySelector('.tl-chips .chip').textContent === 'draft'));
    assert.deepEqual(draftRows.map(row => row.querySelector('.tl-warn') !== null), [false, false, true]);
    assert.equal(draftRows[2].querySelector('.tl-warn').getAttribute('aria-label'), 'Needs a look');
    assert.ok(draftRows[1].classList.contains('tl-chain') && draftRows[2].classList.contains('tl-chain'));
    assert.match(draftRows[1].textContent, /14 days later/);
    assert.ok(list.filter(row => !row.classList.contains('tl-draft-row')).every(row => !row.querySelector('.tl-draft')));
    // The first draft is open, in the normal event form with a banner.
    assert.equal(ctx.selection.id, 'the-emperor-of-highmark-dies');
    assert.equal(ctx.inspector.querySelector('.inspector-title-row .chip').textContent, 'Draft');
    assert.match(ctx.inspector.querySelector('.tl-banner').textContent, /Draft from the AI\. Check it in the form below like any event\. It is not in the pack until you keep it\./);
    assert.deepEqual(['Keep', 'Discard', 'Keep the 2 that are ready'].map(text => !!named(ctx, text)), [true, true, true]);
    assert.equal(aria(ctx, 'Event name').value, 'The emperor of highmark dies');
    assert.equal(aria(ctx, 'From day').value, '4');
    assert.equal(aria(ctx, 'From time of day').value, 'dawn');
    assert.ok(ctx.inspector.querySelector('.tl-pick'));
    assert.equal(ctx.inspector.querySelectorAll('button').find(node => node.textContent === 'Remove…'), undefined, 'a draft is discarded, not removed');
    // The pack itself, and its export, are as they were.
    assert.equal(ctx.model.document.content.events.length, 7);
    assert.equal(exportPack(ctx.model), ersveil);
    assert.ok(!ctx.notifications.some(note => /refused|error/i.test(note)), ctx.notifications.join('\n'));
});

test('a bad answer says why, and nothing is added', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    click(ctx, 'Next: paste the answer');
    click(ctx, 'Check it');
    assert.match(ctx.inspector.textContent, /Paste the AI’s answer first\./);
    type(field(ctx, 'Paste it here'), 'I am sorry, I cannot help.');
    click(ctx, 'Check it');
    assert.match(ctx.inspector.textContent, /could not find a JSON list/);
    assert.equal(named(ctx, 'Add 3 as drafts'), undefined);
    type(field(ctx, 'Paste it here'), answer);
    click(ctx, 'Check it');
    assert.ok(named(ctx, 'Add 3 as drafts'));
    type(field(ctx, 'Paste it here'), `${answer} `);
    assert.equal(named(ctx, 'Add 3 as drafts'), undefined, 'a changed answer must be checked again');
    click(ctx, 'Back to the prompt');
    assert.equal(ctx.inspector.querySelector('[aria-current]').textContent, '1 · Ask');
    assert.equal(drafts(ctx).length, 0);
});

test('a draft is edited in the usual form: the draft changes, the pack does not, and it is one undo step', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    addAll(ctx);
    const before = ctx.model.document;
    const undoable = ctx.history.canUndo;
    change(aria(ctx, 'News the AI is told'), 'The Emperor is dead; the roads close.');
    assert.equal(drafts(ctx)[0].record.cue, 'The Emperor is dead; the roads close.');
    assert.equal(ctx.model.document, before, 'the pack is the same object');
    assert.equal(ctx.model.document.content.events.length, 7);
    change(aria(ctx, 'From day'), '5');
    assert.match(drafts(ctx)[0].record.when, /time\(\) >= 317698920/);
    ctx.history.undo(); ctx.changed();
    assert.equal(drafts(ctx)[0].record.cue, 'The Emperor is dead; the roads close.');
    ctx.history.undo(); ctx.changed();
    assert.equal(drafts(ctx)[0].record.cue, 'Bells toll.');
    assert.equal(ctx.history.canUndo, undoable);
    // Renaming a draft moves what follows it, as for any event.
    change(aria(ctx, 'Event name'), 'The Emperor dies');
    assert.deepEqual(drafts(ctx).map(draft => draft.record.id), ['the-emperor-dies', 'news-reaches-the-north', 'the-diet-splits']);
    assert.equal(drafts(ctx)[1].record.after, 'the-emperor-dies');
    assert.equal(ctx.selection.id, 'the-emperor-dies');
});

test('a draft that follows a draft chooses among drafts too; the pack\'s event form never offers a draft', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    addAll(ctx);
    ctx.select('events', 'news-reaches-the-north');
    const options = aria(ctx, 'After').querySelectorAll('option').map(node => node.value);
    assert.ok(options.includes('the-emperor-of-highmark-dies') && options.includes('bluewatch-guild-board'));
    ctx.select('events', 'the-turning-611');
    assert.ok(!ctx.inspector.querySelector('.tl-banner'));
    ctx.select('events', 'ghost-fleet-waters');
    click(ctx, 'After another event');
    const pack = aria(ctx, 'After').querySelectorAll('option').map(node => node.value);
    assert.ok(pack.includes('bluewatch-guild-board'));
    assert.ok(!pack.some(value => /emperor|news-reaches|diet/.test(value)));
    assert.equal(drafts(ctx).length, 3);
});

test('Keep is off, with the reason, until a draft that needs a look is fixed in the form; then Keep adds it to the pack', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    addAll(ctx);
    ctx.select('events', 'the-diet-splits');
    assert.ok(named(ctx, 'Keep').disabled);
    assert.match(ctx.inspector.querySelector('.tl-banner').textContent, /not a place in this pack: pick one in the form\./);
    assert.match(ctx.inspector.querySelector('.tl-banner').textContent, /Fix what needs a look first\./);
    // It also waits for the draft it follows.
    assert.equal(drafts(ctx).length, 3);
    ctx.inspector.querySelectorAll('.tl-chips button').find(node => /Highmark Capital Nowhere/.test(node.textContent)).click();
    assert.ok(named(ctx, 'Keep').disabled, 'it still follows a draft');
    assert.match(ctx.inspector.querySelector('.tl-banner').textContent, /Keep “The emperor of highmark dies” first: this event comes after it\./);
    ctx.select('events', 'the-emperor-of-highmark-dies');
    click(ctx, 'Keep');
    assert.equal(ctx.model.document.content.events.length, 8);
    assert.equal(ctx.selection.id, 'the-emperor-of-highmark-dies');
    assert.ok(!ctx.inspector.querySelector('.tl-banner'), 'it is an event of the pack now');
    assert.ok(!rows(ctx).find(row => row.getAttribute('data-id') === 'the-emperor-of-highmark-dies').classList.contains('tl-draft-row'));
    assert.ok(ctx.inspector.querySelector('button.danger'), 'with the pack\'s own Remove');
    ctx.select('events', 'the-diet-splits');
    assert.ok(!named(ctx, 'Keep').disabled);
    click(ctx, 'Keep');
    assert.equal(ctx.model.document.content.events.length, 9);
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    assert.equal(drafts(ctx).length, 1);
    ctx.history.undo(); ctx.changed();
    assert.equal(ctx.model.document.content.events.length, 8);
    assert.equal(drafts(ctx).length, 2);
});

test('Keep all keeps what is ready, parents first, and leaves what needs a look; Discard is one undo step', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    addAll(ctx);
    ctx.select('events', 'news-reaches-the-north');
    assert.ok(named(ctx, 'Keep').disabled);
    click(ctx, 'Keep the 2 that are ready');
    assert.deepEqual(ctx.model.document.content.events.slice(7).map(event => event.id), ['the-emperor-of-highmark-dies', 'news-reaches-the-north']);
    assert.deepEqual(drafts(ctx).map(draft => draft.record.id), ['the-diet-splits']);
    assert.match(ctx.notifications.at(-1), /Kept 2 drafts; 1 still needs a look\./);
    ctx.select('events', 'the-diet-splits');
    assert.equal(named(ctx, 'Keep all 1 drafts'), undefined, 'one draft: no Keep all');
    click(ctx, 'Discard');
    assert.equal(drafts(ctx).length, 0);
    assert.match(ctx.inspector.textContent, /Select an event from the timeline/);
    ctx.history.undo(); ctx.changed();
    assert.equal(drafts(ctx).length, 1);
    assert.equal(ctx.model.document.content.events.length, 9);
    ctx.history.undo(); ctx.changed();
    assert.equal(ctx.model.document.content.events.length, 7);
    assert.equal(drafts(ctx).length, 3);
    assert.equal(exportPack(ctx.model), ersveil);
});

test('Keep all N drafts when every one is ready; the List view and the check screen leave drafts out', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    pasteAndCheck(ctx);
    type(field(ctx, 'Paste it here'), answer.replace('Highmark Capital Nowhere', 'Highmark Empire'));
    click(ctx, 'Check it');
    click(ctx, 'Add 3 as drafts');
    assert.ok(named(ctx, 'Keep all 3 drafts'));
    click(ctx, 'List');
    assert.equal(ctx.main.querySelectorAll('button.record-card').length, 7);
    click(ctx, 'Timeline');
    ctx.select('events', 'the-emperor-of-highmark-dies');
    click(ctx, 'Keep all 3 drafts');
    assert.equal(ctx.model.document.content.events.length, 10);
    assert.equal(drafts(ctx).length, 0);
    assert.match(ctx.notifications.at(-1), /^Kept 3 drafts\.$/);
});

test('the check screen says drafts are not in the export', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    addAll(ctx);
    ctx.select('check');
    assert.match(ctx.main.textContent, /3 events written with an AI are drafts on the Timeline: not checked here and not in the export until kept\./);
});

// ------------------------------------------------------------ review 159

const paste = (ctx, value) => {
    click(ctx, 'Next: paste the answer');
    type(field(ctx, 'Paste it here'), typeof value === 'string' ? value : JSON.stringify(value));
    click(ctx, 'Check it');
};
const banner = ctx => ctx.inspector.querySelector('.tl-banner')?.textContent ?? '';
const lostParent = [{ name: 'Lost parent', when: { after: 'Missing king', days: 3 }, where: ['Not Here'], news: 'A king dies' }];

test('review 1: removing the unknown place leaves the missing parent and the dropped delay, and Keep stays off until each is answered', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, lostParent);
    click(ctx, 'Add 1 as a draft');
    assert.equal(ctx.selection.id, 'lost-parent');
    assert.match(banner(ctx), /Missing king/);
    assert.match(banner(ctx), /delay of 3 days/);
    assert.match(banner(ctx), /“Not Here” is not a place/);
    assert.ok(named(ctx, 'Keep').disabled);
    // Remove only the place chip.
    aria(ctx, 'Remove Not Here').click();
    assert.ok(!/Not Here/.test(banner(ctx)));
    assert.match(banner(ctx), /Missing king/, 'the missing parent is still said');
    assert.match(banner(ctx), /delay of 3 days/, 'and so is the dropped delay');
    assert.ok(named(ctx, 'Keep').disabled, 'Keep stays off');
    // Following an event answers the parent, not the delay: that needs a delay, or "Right after is fine".
    click(ctx, 'After another event');
    assert.ok(!/Missing king/.test(banner(ctx)), 'it follows an event of the pack now');
    assert.match(banner(ctx), /delay of 3 days/);
    assert.ok(named(ctx, 'Keep').disabled);
    click(ctx, 'Right after is fine');
    assert.equal(banner(ctx).includes('delay of 3 days'), false);
    assert.ok(!named(ctx, 'Keep').disabled);
    click(ctx, 'Keep');
    assert.equal(ctx.model.document.content.events.length, 8);
    assert.equal(ctx.model.document.content.events[7].id, 'lost-parent');
    assert.ok(ctx.model.document.content.events[7].after, 'it follows the event it was given');
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    // Keep, and "Right after is fine" before it, are one undo step each.
    ctx.history.undo(); ctx.changed();
    assert.equal(drafts(ctx).length, 1);
    ctx.history.undo(); ctx.changed();
    ctx.select('events', 'lost-parent', 'draft');
    assert.match(banner(ctx), /delay of 3 days/);
});

test('review 2: a malformed date or place is a warning on the card, and the draft cannot be kept as it is', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Report', when: { on: 12345 }, where: { name: 'Restricted City' }, news: 'It happened' }]);
    const card = ctx.inspector.querySelector('.tl-ai-draft').textContent;
    assert.match(card, /^⚠ Needs a lookReport/);
    assert.match(card, /The date should be words like/);
    assert.match(card, /“where” should be “anywhere” or a list of region and place names, not an object/);
    click(ctx, 'Add 1 as a draft');
    assert.ok(named(ctx, 'Keep').disabled);
    assert.ok(named(ctx, 'Not dated is fine') && named(ctx, 'Anywhere is fine'));
    click(ctx, 'Not dated is fine');
    assert.ok(named(ctx, 'Keep').disabled, 'the place is still open');
    click(ctx, 'Anywhere is fine');
    assert.ok(!named(ctx, 'Keep').disabled);
});

test('review 5: a draft named like a new event does not hide it, and a draft that shares an ID with an event can still be opened, renamed, kept and discarded', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'New event', when: 'any time', news: 'A draft.' }]);
    click(ctx, 'Add 1 as a draft');
    assert.deepEqual(drafts(ctx).map(draft => draft.record.id), ['new-event']);
    click(ctx, '+ Add event');
    // The new event takes another ID, so the draft and the event are two rows.
    const added = ctx.model.document.content.events.at(-1);
    assert.equal(added.id, 'new-event-2');
    assert.deepEqual(rows(ctx).filter(row => /^new-event/.test(row.getAttribute('data-id'))).map(row => row.getAttribute('data-id')).sort(), ['new-event', 'new-event-2']);
    const draftRow = rows(ctx).find(row => row.getAttribute('data-id') === 'new-event');
    assert.ok(draftRow.classList.contains('tl-draft-row'));
    draftRow.click();
    assert.ok(ctx.inspector.querySelector('.tl-banner'), 'the draft opens with its banner');
    assert.ok(named(ctx, 'Discard'));
    // A project that already has both (a pack changed under the draft): the draft row opens the draft, the event row the event.
    const clash = withDrafts(ctx.model, [makeDraft({ id: 'new-event-2', when: 'true', cue: 'Draft news.' })]);
    const both = createTestContext(clash);
    both.onRender = renderScreen;
    both.select('events', null);
    const sameRows = rows(both).filter(row => row.getAttribute('data-id') === 'new-event-2');
    assert.equal(sameRows.length, 2);
    sameRows.find(row => row.classList.contains('tl-draft-row')).click();
    assert.ok(both.inspector.querySelector('.tl-banner'), 'the draft opens although the pack has an event of that ID');
    assert.equal(rows(both).filter(row => row.getAttribute('aria-pressed') === 'true').length, 1, 'one row is the chosen one');
    assert.match(banner(both), /already has an event with the ID “new-event-2”: rename this one in the form/);
    assert.ok(named(both, 'Keep').disabled);
    change(aria(both, 'Event name'), 'Second draft');
    assert.deepEqual(drafts(both).map(draft => draft.record.id), ['second-draft']);
    assert.equal(both.model.document.content.events.at(-1).id, 'new-event-2', 'the pack\'s event kept its name');
    assert.equal(both.selection.id, 'second-draft');
    assert.ok(both.inspector.querySelector('.tl-banner'));
    assert.ok(!named(both, 'Keep').disabled);
    click(both, 'Keep');
    assert.deepEqual(both.model.document.content.events.slice(-2).map(event => event.id), ['new-event-2', 'second-draft']);
    // The event row opens the event, with its own Remove, even when a draft shares its ID.
    const again = createTestContext(clash);
    again.onRender = renderScreen;
    again.select('events', null);
    rows(again).filter(row => row.getAttribute('data-id') === 'new-event-2' && !row.classList.contains('tl-draft-row'))[0].click();
    assert.ok(!again.inspector.querySelector('.tl-banner'));
    assert.ok(again.inspector.querySelector('button.danger'));
    // And a draft of that ID can be discarded.
    rows(again).find(row => row.classList.contains('tl-draft-row') && row.getAttribute('data-id') === 'new-event-2').click();
    click(again, 'Discard');
    assert.equal(drafts(again).length, 0);
    assert.equal(again.model.document.content.events.at(-1).id, 'new-event-2');
});

test('review 7: if the browser would not save the project with the new drafts, they are taken back out and the writer is told', () => {
    const ctx = open();
    let saved = true;
    ctx.changed = () => { ctx.saved = saved; ctx.render(); };
    click(ctx, '✦ Write with an AI');
    pasteAndCheck(ctx);
    saved = false;
    click(ctx, 'Add 3 as drafts');
    assert.equal(drafts(ctx).length, 0, 'nothing was added');
    assert.equal(ctx.model.document.content.events.length, 7);
    assert.match(ctx.notifications.at(-1), /The browser would not save the project with these drafts, so they were not added/);
    assert.equal(ctx.history.canUndo, false, 'and no step is left behind to undo');
    // The panel is still on the answer, so it can be tried again.
    assert.equal(field(ctx, 'Paste it here').value, answer);
    saved = true;
    click(ctx, 'Check it');
    click(ctx, 'Add 3 as drafts');
    assert.equal(drafts(ctx).length, 3);
    assert.match(ctx.notifications.at(-1), /Added 3 drafts/);
});

test('review 8: the prompt stays within the limit for a big pack, and the note under it says what was cut', () => {
    const pad = (p, i, n = 75) => `${p}${i} ${String.fromCharCode(65 + i % 26).repeat(n - p.length - String(i).length - 1)}`;
    const places = Array.from({ length: 80 }, (_, i) => ({ slug: `place-${i}`, name: pad('Place', i), region: pad('Region', i), x: 0, y: 0 }));
    const creatures = Array.from({ length: 100 }, (_, i) => ({ slug: `npc-${i}`, name: pad('Lore', i) }));
    const events = Array.from({ length: 40 }, (_, i) => ({ id: `event-${i}-${'e'.repeat(48)}`, when: writeCondition({ where: places.slice(0, 3).map(p => ({ kind: 'place', name: p.name })) }).when, cue: 'News' }));
    const calendar = { era: 'CY', months: Array.from({ length: 60 }, (_, i) => ({ name: pad('Month', i, 38), days: 30 })), start: { year: 1, month: 1, day: 1 } };
    const ctx = createTestContext(openPack({ id: 'big', version: '1.0.0', name: 'Big', requires: { storyBlock: '^2' }, calendar, content: { places, creatures, events } }));
    ctx.onRender = renderScreen;
    ctx.select('events', null);
    click(ctx, '✦ Write with an AI');
    type(field(ctx, 'Your idea'), 'a'.repeat(2000));
    assert.ok(prompt(ctx).length <= 24000, String(prompt(ctx).length));
    const note = ctx.inspector.querySelectorAll('p.tl-small').find(node => /to keep the prompt short|could not all fit/.test(node.textContent));
    assert.ok(note && !note.hidden, 'the cut is said');
    assert.match(note.textContent, /place list/);
    tick(ctx, 'Regions and places', false);
    assert.ok(prompt(ctx).length <= 24000, String(prompt(ctx).length));
});

// ------------------------------------------------------------ review 161

test('review 161-1: an end date that was not words stays a problem when only the start is changed, until it is set or accepted', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Weather report', when: { on: 'Icewane 4, CY 612, dawn' }, until: 123, news: 'The storm arrives.' }]);
    click(ctx, 'Add 1 as a draft');
    assert.match(banner(ctx), /The end date should be words/);
    assert.ok(named(ctx, 'Keep').disabled);
    // The start now follows an event, with no end set and none accepted: the end is still open.
    click(ctx, 'After another event');
    assert.match(banner(ctx), /The end date should be words/, 'changing only the start mode does not answer the end date');
    assert.ok(named(ctx, 'Keep').disabled);
    assert.ok(named(ctx, 'No end date is fine'));
    // And back to a date and to any time: still open.
    click(ctx, 'On a date');
    assert.match(banner(ctx), /The end date should be words/);
    // The writer's own button is what answers it.
    click(ctx, 'After another event');
    click(ctx, 'No end date is fine');
    assert.ok(!/end date/.test(banner(ctx)));
    assert.ok(!/The end date/.test(banner(ctx)));
});

test('review 161-2/4/5: through the controls, null fields, a name used twice and a text of dragons behave as the lead decided', () => {
    const cards = ctx => ctx.inspector.querySelectorAll('.tl-ai-draft').map(card => card.textContent);
    // 2: the child with null delay, place and repeat setting is not Ready, and Keep all keeps only the parent.
    let ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Parent', news: 'P', lasting: { name: 'P changed', state: 'ongoing' } }, { name: 'Child', when: { after: 'Parent', days: null }, where: null, once: null, news: 'C' }]);
    assert.match(cards(ctx)[0], /^✓ Ready/);
    assert.match(cards(ctx)[1], /^⚠ Needs a look/);
    click(ctx, 'Add 2 as drafts');
    click(ctx, 'Keep the 1 that is ready');
    assert.deepEqual(ctx.model.document.content.events.slice(7).map(event => event.id), ['parent']);
    assert.deepEqual(drafts(ctx).map(draft => draft.record.id), ['child']);
    // 4: two names that make the same ID: the child follows the one whose name it used.
    ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Dawn-Watch Falls', news: 'The fort falls.', lasting: { name: 'Fort falls', state: 'ongoing' } }, { name: 'Dawn Watch Falls', news: 'The guard falls.', lasting: { name: 'Guard falls', state: 'ongoing' } }, { name: 'The guard is mourned', when: { after: 'Dawn Watch Falls', days: 2 }, news: 'The guard is mourned.' }]);
    click(ctx, 'Add 3 as drafts');
    click(ctx, 'Keep all 3 drafts');
    const events = ctx.model.document.content.events;
    assert.equal(events.find(event => event.id === 'the-guard-is-mourned').after, 'dawn-watch-falls-2');
    assert.match(events.find(event => event.id === 'the-guard-is-mourned').when, /Guard falls/);
    // 5: a summary of exactly 240 characters, dragons at its end, is kept whole.
    const summary = `${'The southern road remains closed as the city prepares for winter. '.repeat(3)}The council has received warnings. ${'🐉'.repeat(7)}`;
    ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Road closes', news: 'The road closes.', lasting: { name: 'Road closed', state: 'ongoing', summary } }]);
    assert.match(cards(ctx)[0], /^✓ Ready/);
    click(ctx, 'Add 1 as a draft');
    click(ctx, 'Keep');
    assert.equal(ctx.model.document.content.events.at(-1).then[0].payload.summary, summary);
});

// A browser that keeps the project but throws on a write that holds drafts (its quota is full).
function mountWithStorage() {
    const store = new Map();
    const refuse = { drafts: false };
    const win = {
        localStorage: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem(key, value) { if (refuse.drafts && /"drafts":\[/.test(value)) throw new Error('quota'); store.set(key, String(value)); },
            removeItem: key => store.delete(key),
        },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        addEventListener() {}, removeEventListener() {},
    };
    const doc = new MockDocument();
    doc.defaultView = win;
    const root = doc.createElement('div');
    doc.body.append(root);
    const ctx = mountStudio(root);
    ctx.loadText(ersveil);
    ctx.onRender = renderScreen;
    ctx.select('events', null);
    const toolbar = label => { const node = root.querySelectorAll('button').find(item => item.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
    return { ctx, refuse, store, toolbar, root };
}
const noticeOf = root => root.querySelector('.notice').textContent;

test('review 161-3: a failed draft save leaves nothing to redo, and the redo history from before is kept', () => {
    const { ctx, refuse, toolbar, root } = mountWithStorage();
    // An earlier step that was undone: its redo must survive the failed addition.
    ctx.apply(setName(ctx.model, 'Renamed pack'));
    toolbar('Undo').click();
    assert.equal(toolbar('Redo').disabled, false);
    click(ctx, '✦ Write with an AI');
    pasteAndCheck(ctx);
    refuse.drafts = true;
    click(ctx, 'Add 3 as drafts');
    assert.equal(drafts(ctx).length, 0);
    assert.match(noticeOf(root), /The browser would not save the project with these drafts, so they were not added/);
    // The redo that is left is the earlier step, not the refused drafts.
    assert.equal(toolbar('Redo').disabled, false);
    toolbar('Redo').click();
    assert.equal(drafts(ctx).length, 0, 'Redo does not bring the refused drafts back');
    assert.equal(ctx.model.document.name, 'Renamed pack');
    assert.equal(toolbar('Redo').disabled, true);
    assert.equal(ctx.saved, true);
    // With no earlier redo history, nothing is left to redo at all.
    const bare = mountWithStorage();
    click(bare.ctx, '✦ Write with an AI');
    pasteAndCheck(bare.ctx);
    bare.refuse.drafts = true;
    click(bare.ctx, 'Add 3 as drafts');
    assert.equal(bare.toolbar('Redo').disabled, true);
    assert.equal(bare.toolbar('Undo').disabled, true);
    assert.equal(bare.ctx.history.canRedo, false);
});

test('review 161-3: Undo and Redo of a draft change whose save fails say so and put the history back', () => {
    const { ctx, refuse, toolbar, root } = mountWithStorage();
    click(ctx, '✦ Write with an AI');
    pasteAndCheck(ctx);
    click(ctx, 'Add 3 as drafts');
    assert.equal(drafts(ctx).length, 3);
    // Undo the addition (saves fine), then the browser refuses a project with drafts: Redo is refused and nothing moves.
    toolbar('Undo').click();
    assert.equal(drafts(ctx).length, 0);
    assert.equal(toolbar('Redo').disabled, false);
    refuse.drafts = true;
    toolbar('Redo').click();
    assert.equal(drafts(ctx).length, 0, 'the drafts were not brought back');
    assert.match(noticeOf(root), /The browser would not save the project with these drafts, so Redo left them as they were/);
    assert.equal(toolbar('Redo').disabled, false, 'the step is still there to redo once there is room');
    assert.equal(ctx.saved, true, 'the project as it is was saved');
    refuse.drafts = false;
    toolbar('Redo').click();
    assert.equal(drafts(ctx).length, 3);
    assert.equal(ctx.saved, true);
    // The same for Undo: drop the drafts one at a time (a discard saves fine), then Undo it with the store refusing.
    click(ctx, 'Discard');
    assert.equal(drafts(ctx).length, 2);
    refuse.drafts = true;
    toolbar('Undo').click();
    assert.equal(drafts(ctx).length, 2, 'the discarded draft was not brought back');
    assert.match(noticeOf(root), /so Undo left them as they were/);
    assert.equal(toolbar('Undo').disabled, false);
    assert.equal(toolbar('Redo').disabled, true, 'and no redo step was made for it');
});
const setName = (model, name) => setSchemaField(model, ['name'], name);

// ------------------------------------------------------------ review 162

// What the browser would load after a reload: the project as saved in `store`, opened in a fresh context.
const reopen = store => {
    const win = { localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem() {} } };
    const saved = readDraft(win);
    assert.ok(saved, 'the saved project reads back');
    const ctx = createTestContext(saved.model);
    ctx.onRender = renderScreen;
    ctx.select('events', null);
    return ctx;
};

test('review 162-1: a draft saved before notes were tied to one field keeps its end-date warning after the update, and Keep stays off', () => {
    const plain = openPack(ersveil);
    const made = readAnswer(JSON.stringify([{ name: 'Weather report', when: { on: 'Icewane 4, CY 612, dawn' }, until: 123, news: 'The storm arrives.' }]), plain).items[0].draft;
    const info = readEvent(made.record);
    const older = { ...made, notes: made.notes.map(item => ({ ...item, seen: JSON.stringify([info.mode, info.until]) })) };
    assert.equal(older.notes[0].seen, '["date",null]');
    const store = new Map();
    assert.ok(writeDraft({ localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } }, withDrafts(plain, [older]), true));
    const ctx = reopen(store);
    ctx.select('events', 'weather-report', 'draft');
    assert.match(banner(ctx), /The end date should be words/);
    assert.ok(named(ctx, 'Keep').disabled);
    assert.ok(named(ctx, 'No end date is fine'));
    click(ctx, 'After another event');
    assert.match(banner(ctx), /The end date should be words/, 'a change of how it starts does not answer it');
    assert.ok(named(ctx, 'Keep').disabled);
    click(ctx, 'No end date is fine');
    assert.ok(!/end date/.test(banner(ctx)));
});

const harbor = [{
    name: 'Harbor closes', once: null, when: { on: null }, until: null, where: null, news: 'x'.repeat(600),
    lasting: { name: 'N'.repeat(100), state: 'ongoing', place: 'P'.repeat(100), summary: 'S'.repeat(300), factions: Array(6).fill('F'.repeat(100)) },
}];

test('review 162-2: every warning of a draft comes back after a reload, and Keep still waits for each', () => {
    const { ctx, store } = mountWithStorage();
    click(ctx, '✦ Write with an AI');
    paste(ctx, harbor);
    click(ctx, 'Add 1 as a draft');
    const before = banner(ctx);
    assert.match(before, /“where” should be/);
    assert.match(before, /only the first 500 were kept/);
    const saved = drafts(ctx)[0].notes.length;
    const back = reopen(store);
    assert.equal(drafts(back)[0].notes.length, saved, 'no note was dropped on the way to the store and back');
    back.select('events', 'harbor-closes', 'draft');
    assert.equal(banner(back), before, 'the same things are said');
    // Turn off the invalid lasting change and set aside the start, end, repeat and place: the cut news still stops Keep.
    tick(back, 'Add to Story Director', false);
    for (const label of ['Once is fine', 'Not dated is fine', 'No end date is fine', 'Anywhere is fine']) click(back, label);
    assert.match(banner(back), /only the first 500 were kept/);
    assert.ok(named(back, 'Keep').disabled, 'the shortened news has not been accepted');
    click(back, 'The cut news is fine');
    assert.ok(!named(back, 'Keep').disabled);
});

test('review 162-3: a delay field that is null beside a good one is not Ready, and Keep all keeps only the parent', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Parent', news: 'P', lasting: { name: 'P changed', state: 'ongoing' } }, { name: 'Child', when: { after: 'Parent', days: 2, hours: null }, news: 'C' }]);
    const cards = ctx.inspector.querySelectorAll('.tl-ai-draft').map(card => card.textContent);
    assert.match(cards[0], /^✓ Ready/);
    assert.match(cards[1], /^⚠ Needs a look/);
    assert.match(cards[1], /delay of null hours is not a whole number/);
    click(ctx, 'Add 2 as drafts');
    click(ctx, 'Keep the 1 that is ready');
    assert.deepEqual(drafts(ctx).map(draft => draft.record.id), ['child']);
});

test('review 162-4: two invalid lasting fields are filled one at a time in the form, each saved, and each warning clears as its field is filled', () => {
    const { ctx, store } = mountWithStorage();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Harbor crisis', news: 'Harbor closes.', lasting: { name: 'Harbor crisis', state: 'ongoing', place: null, summary: null } }]);
    click(ctx, 'Add 1 as a draft');
    assert.match(banner(ctx), /place must be text, not null/);
    assert.match(banner(ctx), /summary must be text, not null/);
    assert.ok(named(ctx, 'Keep').disabled);
    change(aria(ctx, 'Place'), 'Auvoth');
    assert.equal(aria(ctx, 'Place').value, 'Auvoth', 'the place is taken');
    assert.ok(!/place must be text/.test(banner(ctx)), 'its warning is gone');
    assert.match(banner(ctx), /summary must be text, not null/);
    assert.equal(readLasting(drafts(ctx)[0].record).place, 'Auvoth');
    assert.equal(readLasting(readDraftRecord(store)).place, 'Auvoth', 'and saved');
    assert.ok(named(ctx, 'Keep').disabled);
    change(aria(ctx, 'Summary'), 'The harbor is closed.');
    assert.equal(aria(ctx, 'Summary').value, 'The harbor is closed.');
    assert.ok(!/summary must be text/.test(banner(ctx)));
    assert.deepEqual(readLasting(readDraftRecord(store)), { name: 'Harbor crisis', state: 'ongoing', place: 'Auvoth', summary: 'The harbor is closed.' });
    assert.ok(!named(ctx, 'Keep').disabled);
    click(ctx, 'Keep');
    assert.equal(ctx.model.document.content.events.at(-1).id, 'harbor-crisis');
});
const readDraftRecord = store => JSON.parse(store.get(DRAFT_KEY)).drafts[0].record;

test('review 162-4: a warning about a lasting field the writer would rather leave blank can be set aside', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Harbor crisis', news: 'Harbor closes.', lasting: { name: 'Harbor crisis', state: 'ongoing', place: null, summary: null } }]);
    click(ctx, 'Add 1 as a draft');
    click(ctx, 'No place is fine');
    assert.ok(named(ctx, 'Keep').disabled, 'the summary is still open');
    click(ctx, 'No summary is fine');
    assert.ok(!named(ctx, 'Keep').disabled);
});

test('review 162-5: through the controls, a name the answer did not use is not guessed from its slug, and the superscript is its own name', () => {
    const cards = ctx => ctx.inspector.querySelectorAll('.tl-ai-draft').map(card => card.textContent);
    let ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Dawn-Watch Falls', news: 'The fort falls.', lasting: { name: 'Fort falls', state: 'ongoing' } }, { name: 'The guard is mourned', when: { after: 'Dawn Watch Falls', days: 2 }, news: 'The guard is mourned.' }]);
    assert.match(cards(ctx)[0], /^✓ Ready/);
    assert.match(cards(ctx)[1], /^⚠ Needs a look/);
    click(ctx, 'Add 2 as drafts');
    click(ctx, 'Keep the 1 that is ready');
    assert.deepEqual(ctx.model.document.content.events.slice(7).map(event => event.id), ['dawn-watch-falls']);
    ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Gate ² opens', news: 'Opens.', lasting: { name: 'Superscript', state: 'ongoing' } }, { name: 'Gate 2 opens', news: 'Opens.', lasting: { name: 'Plain', state: 'ongoing' } }, { name: 'The guard is mourned', when: { after: 'Gate 2 opens', days: 2 }, news: 'Mourned.' }]);
    assert.ok(cards(ctx).every(card => /^✓ Ready/.test(card)), JSON.stringify(cards(ctx)));
    click(ctx, 'Add 3 as drafts');
    click(ctx, 'Keep all 3 drafts');
    const mourned = ctx.model.document.content.events.find(event => event.id === 'the-guard-is-mourned');
    assert.equal(mourned.after, 'gate-2-opens-2');
    assert.match(mourned.when, /Plain/);
});

// ------------------------------------------------------------ review 165

test('review 165-1: with a good delay beside a wrong one, the button keeps the good delay, and that is what is saved', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, [{ name: 'Parent', news: 'P', lasting: { name: 'P changed', state: 'ongoing' } }, { name: 'Child', when: { after: 'Parent', days: 2, hours: null }, news: 'C' }]);
    click(ctx, 'Add 2 as drafts');
    ctx.select('events', 'child', 'draft');
    assert.match(banner(ctx), /delay of null hours is not a whole number/);
    assert.ok(!named(ctx, 'Right after is fine'), 'the two days are kept, so right after is not what the button says');
    click(ctx, 'Just the 2 days is fine');
    assert.equal(banner(ctx).includes('null hours'), false);
    click(ctx, 'Keep all 2 drafts');
    const child = ctx.model.document.content.events.find(event => event.id === 'child');
    assert.deepEqual(readCondition(child.when).since, { name: 'P changed', minutes: 2880 });
    // With no good unit, the button says right after and nothing is counted.
    const none = open();
    click(none, '✦ Write with an AI');
    paste(none, [{ name: 'Parent', news: 'P', lasting: { name: 'P changed', state: 'ongoing' } }, { name: 'Child', when: { after: 'Parent', days: null }, news: 'C' }]);
    click(none, 'Add 2 as drafts');
    none.select('events', 'child', 'draft');
    click(none, 'Right after is fine');
    click(none, 'Keep all 2 drafts');
    assert.doesNotMatch(none.model.document.content.events.find(event => event.id === 'child').when, /chronicle\.passed/);
});

const crisisWith = factions => [{ name: 'Harbor crisis', news: 'Harbor closes.', lasting: { name: 'Harbor crisis', state: 'ongoing', factions } }];

test('review 165-2: an empty faction is said and not Ready until the writer accepts it; the payload has the two names', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, crisisWith(['Ironbound', '', 'Tidecallers']));
    assert.match(ctx.inspector.querySelector('.tl-ai-draft').textContent, /^⚠ Needs a look/);
    click(ctx, 'Add 1 as a draft');
    assert.match(banner(ctx), /a faction is empty or not text, so it was left out/);
    assert.ok(named(ctx, 'Keep').disabled);
    click(ctx, 'The factions as shown are fine');
    assert.ok(!named(ctx, 'Keep').disabled);
    click(ctx, 'Keep');
    assert.deepEqual(ctx.model.document.content.events.at(-1).then[0].payload.factions, ['Ironbound', 'Tidecallers']);
});

test('review 165-3: four valid factions that are kept can be accepted, and turning the lasting change off ends its notes', () => {
    const ctx = open();
    click(ctx, '✦ Write with an AI');
    paste(ctx, crisisWith(['North', 'South', 'East', 'West', null, 'Harbor']));
    click(ctx, 'Add 1 as a draft');
    assert.doesNotMatch(banner(ctx), /needs cutting down/);
    assert.ok(named(ctx, 'Keep').disabled);
    click(ctx, 'The factions as shown are fine');
    assert.ok(!named(ctx, 'Keep').disabled);
    click(ctx, 'Keep');
    assert.deepEqual(ctx.model.document.content.events.at(-1).then[0].payload.factions, ['North', 'South', 'East', 'West']);
    // The review's second repro: nothing of the list is kept; the writer removes the lasting change; Keep is open.
    const gone = mountWithStorage();
    click(gone.ctx, '✦ Write with an AI');
    paste(gone.ctx, crisisWith([null, null, null, null, null, 'Harbor']));
    click(gone.ctx, 'Add 1 as a draft');
    assert.ok(named(gone.ctx, 'Keep').disabled);
    assert.ok(named(gone.ctx, 'The factions as shown are fine'), 'and it can be set aside');
    tick(gone.ctx, 'Add to Story Director', false);
    assert.ok(!/factions/.test(banner(gone.ctx)), banner(gone.ctx));
    assert.ok(!named(gone.ctx, 'Keep').disabled);
    // Turning it on again starts fresh: the old note does not come back, and the stored draft has none left.
    tick(gone.ctx, 'Add to Story Director', true);
    assert.ok(!/factions/.test(banner(gone.ctx)));
    assert.ok(!named(gone.ctx, 'Keep').disabled);
    assert.equal(JSON.parse(gone.store.get(DRAFT_KEY)).drafts[0].notes.some(item => item.kind === 'lasting' && item.field), false);
});
