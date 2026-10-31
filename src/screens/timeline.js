import { applyEdit } from '../apply-edit.js';
import { el, button } from '../dom.js';
import { records, identity, localId } from '../records.js';
import { add } from '../edits.js';
import { renderRecords, getRecordProblems, openRecordRemoveDialog } from './records.js';
import { renderEventInspector, timelineState } from './timeline-form.js';
import { renderAiPanel, openAiPanel, aiShown, aiState, draftBanner, findDraft } from './timeline-ai.js';
import { draftsOf } from '../model.js';
import { combinedModel, draftProblems, editDrafts } from '../timeline/drafts.js';
import { packCalendar } from '../timeline/calendar.js';
import { timelineRows } from '../timeline/event.js';
import { missingWorldEvents } from '../timeline/notes.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// A new event starts with a placeholder for its news (the pack needs some) and no condition: it can happen on any reply.
function addEvent(ctx) {
    const taken = new Set(records(ctx.model, 'events').map(event => localId(ctx.model, identity(event, 'events'))));
    let id = 'new-event';
    for (let n = 2; taken.has(id); n++) id = `new-event-${n}`;
    const result = add(ctx.model, 'events', { id, when: 'true', cue: '[WHAT THE AI IS TOLD]' });
    if (applyEdit(ctx, result, { id })) ctx.select('events', id);
}

function inspect(ctx, inspector, selected) {
    renderEventInspector(ctx, inspector, selected);
    const removeButton = button(ctx.doc, 'Remove…', () => openRecordRemoveDialog(ctx, 'events', selected.record, removeButton), { class: 'danger' });
    inspector.append(removeButton);
}

// What the form of a draft sees and does: the pack with its drafts as events after its own, and an edit comes back as a
// change to the drafts (one undo step); the pack's own events are never touched until a draft is kept.
function draftContext(host) {
    timelineState(host);
    const child = Object.create(host);
    Object.defineProperty(child, 'model', { get: () => combinedModel(host.model) });
    // The form reaches this through the shared refusal helper (applyEdit), which restores its controls when it answers false.
    child.apply = result => {
        const change = editDrafts(host.model, result);
        return change === null ? true : host.apply(change);
    };
    return child;
}

function inspectDraft(ctx, inspector, { index, count }) {
    const draft = draftsOf(ctx.model)[index];
    renderEventInspector(draftContext(ctx), inspector, { record: draft.record, idx: count + index, banner: draftBanner(ctx, index) });
}

function viewSwitch(ctx, ui) {
    const { doc } = ctx;
    const group = el(doc, 'span', '', { class: 'tl-seg', role: 'group', 'aria-label': 'View' });
    for (const [view, label] of [['timeline', 'Timeline'], ['list', 'List']]) {
        group.append(button(doc, label, () => { ui.view = view; ctx.render(); }, { 'aria-pressed': String(ui.view === view) }));
    }
    return group;
}

/** The Events section: the Timeline (events by story year) or today's plain List, and the same form for either. */
export function renderTimeline(ctx) {
    const { doc, model } = ctx;
    const ui = timelineState(ctx);
    // The panel is what the inspector shows while no event is selected; picking an event puts it away (its text stays).
    if (ctx.selection.id !== null) aiState(ctx).open = false;
    const hooks = { title: 'Timeline', toolbar: () => viewSwitch(ctx, ui), addLabel: '+ Add event', add: () => addEvent(ctx), inspect };
    // The List, and the plain add form (kept for anything that selects a new event by the generic route).
    if (ui.view === 'list' || ctx.selection.id === '__new__') { renderRecords(ctx, hooks); return; }
    const events = records(model, 'events');
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    const count = events.filter(isRecord).length;
    const drafts = draftsOf(model);
    const drafted = drafts.length ? ` + ${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'}` : '';
    header.append(el(doc, 'h1', 'Timeline'), el(doc, 'div', `${count} ${count === 1 ? 'event' : 'events'}${drafted} · hidden from players`, { class: 'records-subtitle' }),
        viewSwitch(ctx, ui), button(doc, '✦ Write with an AI', () => openAiPanel(ctx), { 'aria-pressed': String(aiShown(ctx)) }), button(doc, '+ Add event', () => addEvent(ctx)));
    const note = el(doc, 'p', '', { class: 'records-note' });
    const words = el(doc, 'span');
    note.append(words);
    words.append(el(doc, 'b', 'Players never see these.'), ' The AI is told an event only when it happens. Players can only find them by opening the pack file, or in Settings → Diagnostics → Events, which warns that it spoils the story.');
    screen.append(header, note);
    const list = el(doc, 'div', '', { class: 'records-list tl-list' });
    const calendar = packCalendar(model.document);
    // The drafts follow the pack's events in the list the rows are made from, so a draft can sit under the event it follows.
    const { groups } = timelineRows([...events, ...drafts.map(draft => draft.record)], calendar);
    const waiting = missingWorldEvents(model.document);
    if (!groups.length) list.append(el(doc, 'p', 'No events yet. An event is news the AI is told once, when its date and place come.', { class: 'muted' }));
    for (const group of groups) {
        list.append(el(doc, 'h2', group.title, { class: 'tl-year' }));
        for (const row of group.rows) {
            const id = localId(model, row.info.id);
            const isDraft = row.idx >= events.length;
            const card = button(doc, '', () => ctx.select('events', id), { class: `record-card tl-row${row.depth ? ' tl-chain' : ''}${isDraft ? ' tl-draft-row' : ''}`, 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
            if (row.depth) card.setAttribute('style', `margin-left:${28 * row.depth}px;width:calc(100% - ${28 * row.depth}px)`);
            const problems = isDraft ? draftProblems(model, drafts, row.idx - events.length) : getRecordProblems(model, 'events', row.record, row.idx);
            if (isDraft) row.chips.unshift({ text: 'draft', draft: true });
            if (problems.length) card.setAttribute('data-has-problem', 'true');
            const date = el(doc, 'span', '', { class: 'tl-date' });
            date.append(el(doc, 'b', row.date.main));
            if (row.date.sub) date.append(row.date.sub);
            const body = el(doc, 'span');
            const title = el(doc, 'span', '', { class: 'record-card-header' });
            title.append(el(doc, 'span', row.info.name, { class: 'record-card-name' }));
            if (isDraft && problems.length) title.append(el(doc, 'span', '⚠', { class: 'tl-warn', role: 'img', 'aria-label': 'Needs a look', title: problems.join('\n') }));
            else if (problems.length) title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' }));
            else if (!isDraft && waiting.has(row.idx)) title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Waits for a world event nothing adds', title: `Waits for ${waiting.get(row.idx).map(name => `“${name}”`).join(', ')}, which no event in this pack adds.` }));
            const chips = el(doc, 'span', '', { class: 'tl-chips' });
            for (const chip of row.chips) chips.append(el(doc, 'span', chip.text, { class: chip.draft ? 'chip tl-draft' : 'chip' }));
            body.append(title, chips);
            card.append(date, body);
            list.append(card);
        }
    }
    screen.append(list);
    ctx.main.append(screen);
    const inspector = ctx.inspector || screen;
    const selected = events.map((record, idx) => ({ record, idx })).find(({ record }) => isRecord(record) && localId(model, identity(record, 'events')) === ctx.selection.id);
    if (!selected) {
        const draft = findDraft(model, ctx.selection.id);
        if (draft) inspectDraft(ctx, inspector, draft);
        else if (aiShown(ctx)) renderAiPanel(ctx, inspector);
        else inspector.append(el(doc, 'p', 'Select an event from the timeline to inspect and edit.', { class: 'muted' }));
        return;
    }
    inspect(ctx, inspector, { ...selected, id: ctx.selection.id, problems: getRecordProblems(model, 'events', selected.record, selected.idx) });
}
