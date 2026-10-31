import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack, draftsOf } from '../src/model.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';
import { buildPrompt, wordCount } from '../src/timeline/ai-prompt.js';

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
