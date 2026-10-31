import { applyEdit } from '../apply-edit.js';
import { el, button } from '../dom.js';
import { records, identity, localId } from '../records.js';
import { add } from '../edits.js';
import { renderRecords, getRecordProblems, openRecordRemoveDialog } from './records.js';
import { renderEventInspector, timelineState } from './timeline-form.js';
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
    const hooks = { title: 'Timeline', toolbar: () => viewSwitch(ctx, ui), addLabel: '+ Add event', add: () => addEvent(ctx), inspect };
    // The List, and the plain add form (kept for anything that selects a new event by the generic route).
    if (ui.view === 'list' || ctx.selection.id === '__new__') { renderRecords(ctx, hooks); return; }
    const events = records(model, 'events');
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    const count = events.filter(isRecord).length;
    header.append(el(doc, 'h1', 'Timeline'), el(doc, 'div', `${count} ${count === 1 ? 'event' : 'events'} · hidden from players`, { class: 'records-subtitle' }),
        viewSwitch(ctx, ui), button(doc, '+ Add event', () => addEvent(ctx)));
    const note = el(doc, 'p', '', { class: 'records-note' });
    const words = el(doc, 'span');
    note.append(words);
    words.append(el(doc, 'b', 'Players never see these.'), ' The AI is told an event only when it happens. Players can only find them by opening the pack file, or in Settings → Diagnostics → Events, which warns that it spoils the story.');
    screen.append(header, note);
    const list = el(doc, 'div', '', { class: 'records-list tl-list' });
    const calendar = packCalendar(model.document);
    const { groups } = timelineRows(events, calendar);
    const waiting = missingWorldEvents(model.document);
    if (!groups.length) list.append(el(doc, 'p', 'No events yet. An event is news the AI is told once, when its date and place come.', { class: 'muted' }));
    for (const group of groups) {
        list.append(el(doc, 'h2', group.title, { class: 'tl-year' }));
        for (const row of group.rows) {
            const id = localId(model, row.info.id);
            const card = button(doc, '', () => ctx.select('events', id), { class: `record-card tl-row${row.depth ? ' tl-chain' : ''}`, 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
            if (row.depth) card.setAttribute('style', `margin-left:${28 * row.depth}px;width:calc(100% - ${28 * row.depth}px)`);
            const problems = getRecordProblems(model, 'events', row.record, row.idx);
            if (problems.length) card.setAttribute('data-has-problem', 'true');
            const date = el(doc, 'span', '', { class: 'tl-date' });
            date.append(el(doc, 'b', row.date.main));
            if (row.date.sub) date.append(row.date.sub);
            const body = el(doc, 'span');
            const title = el(doc, 'span', '', { class: 'record-card-header' });
            title.append(el(doc, 'span', row.info.name, { class: 'record-card-name' }));
            if (problems.length) title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' }));
            else if (waiting.has(row.idx)) title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Waits for a world event nothing adds', title: `Waits for ${waiting.get(row.idx).map(name => `“${name}”`).join(', ')}, which no event in this pack adds.` }));
            const chips = el(doc, 'span', '', { class: 'tl-chips' });
            for (const chip of row.chips) chips.append(el(doc, 'span', chip.text, { class: 'chip' }));
            body.append(title, chips);
            card.append(date, body);
            list.append(card);
        }
    }
    screen.append(list);
    ctx.main.append(screen);
    const inspector = ctx.inspector || screen;
    const selected = events.map((record, idx) => ({ record, idx })).find(({ record }) => isRecord(record) && localId(model, identity(record, 'events')) === ctx.selection.id);
    if (!selected) { inspector.append(el(doc, 'p', 'Select an event from the timeline to inspect and edit.', { class: 'muted' })); return; }
    inspect(ctx, inspector, { ...selected, id: ctx.selection.id, problems: getRecordProblems(model, 'events', selected.record, selected.idx) });
}
