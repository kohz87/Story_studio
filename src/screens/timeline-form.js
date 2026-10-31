import { applyEdit } from '../apply-edit.js';
import { el, button, field } from '../dom.js';
import { setSchemaField, setRecords, renameId } from '../edits.js';
import { schemaForKind, validateField } from '../form-schema.js';
import { records, identity } from '../records.js';
import { EVENT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { DAY, PARTS, packCalendar, dateText, partName } from '../timeline/calendar.js';
import { writeCondition, readCondition } from '../timeline/condition.js';
import { LASTING_STATES, LASTING_LIMITS, checkLasting, readLasting, withLasting } from '../timeline/lasting.js';
import { readEvent, humanName, idFromName, gapOf, describeWhen } from '../timeline/event.js';

const STATE_LABELS = { looming: 'Looming', ongoing: 'Ongoing', resolved: 'Resolved' };
const UNITS = { days: DAY, hours: 60 };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** What the Timeline keeps between renders: the view, half-typed dates, and the folds the author opened. */
export function timelineState(ctx) {
    ctx.filters ??= {};
    return ctx.filters.timeline ??= { view: 'timeline', drafts: {}, rows: {}, open: {} };
}

const small = (doc, text, attrs = {}) => el(doc, 'p', text, { class: 'tl-small', ...attrs });
function fieldset(doc, legend, ...children) {
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset' });
    set.append(el(doc, 'legend', legend), ...children);
    return set;
}
function pick(doc, label, choices, current, onPick) {
    const group = el(doc, 'div', '', { class: 'tl-pick', role: 'group', 'aria-label': label });
    for (const [value, text, disabled] of choices) {
        const choice = button(doc, text, () => onPick(value), { 'aria-pressed': String(value === current) });
        if (disabled) choice.disabled = true;
        group.append(choice);
    }
    return group;
}
function select(doc, options, current, attrs = {}) {
    const control = el(doc, 'select', '', attrs);
    for (const [value, text] of options) {
        const option = el(doc, 'option', text, { value });
        option.selected = String(value) === String(current);
        control.append(option);
    }
    return control;
}
function inline(doc, ...children) {
    const row = el(doc, 'div', '', { class: 'tl-inline' });
    row.append(...children);
    return row;
}
function checkbox(doc, text, checked, onChange) {
    const box = el(doc, 'input', '', { type: 'checkbox' });
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    const label = el(doc, 'label', '', { class: 'tl-inline tl-check' });
    label.append(box, ` ${text}`);
    return label;
}

/** Saves a whole event record in one step (one undo). A refusal rebuilds the form from the pack and says why. */
function save(ctx, idx, next) {
    const checked = validateField(schemaForKind('events'), next);
    if (!checked.ok) return applyEdit(ctx, { ok: false, model: ctx.model, errors: [{ code: checked.code, message: checked.message }] });
    return applyEdit(ctx, setSchemaField(ctx.model, ['content', 'events', idx], next));
}
const refuse = (ctx, message) => applyEdit(ctx, { ok: false, model: ctx.model, errors: [{ code: 'bad-value', message }] });

// A moment as the date row shows it: day, month (index), year, part of the day and the exact time.
function momentState(calendar, abs, role) {
    if (abs === null) return { day: '', month: '', year: '', part: role === 'from' ? 'dawn' : '', time: '' };
    // An end that falls at midnight is the whole day before it.
    const wholeDay = role === 'until' && abs > 0 && abs % DAY === 0;
    const date = calendar.fromAbs(wholeDay ? abs - 1 : abs);
    const named = partName(date.minutes);
    const part = wholeDay ? '' : named && (role === 'from' || named !== 'midnight') ? named : 'exact';
    const time = `${String(Math.floor(date.minutes / 60)).padStart(2, '0')}:${String(date.minutes % 60).padStart(2, '0')}`;
    return { day: String(date.day), month: String(date.month), year: String(date.year), part, time: part === 'exact' ? time : '' };
}

/** A date row: day, month, year and time of day. It saves once it is a whole date, and (when optional) clears when it is emptied. */
function dateRow(ctx, ui, { key, role, abs, label, optional = false, onCommit }) {
    const { doc } = ctx;
    const calendar = packCalendar(ctx.model.document);
    const state = ui.rows[key] ?? momentState(calendar, abs, role);
    const controls = {
        day: el(doc, 'input', '', { placeholder: 'Day', inputmode: 'numeric', 'aria-label': `${label} day` }),
        month: select(doc, [['', 'Month…'], ...calendar.months.map((month, index) => [String(index), month.name])], state.month, { 'aria-label': `${label} month` }),
        year: el(doc, 'input', '', { placeholder: calendar.era || 'Year', inputmode: 'numeric', 'aria-label': `${label} year` }),
        part: select(doc, [...role === 'until' ? [['', 'Time…']] : [], ['dawn', 'dawn'], ['noon', 'noon'], ['dusk', 'dusk'], ...role === 'from' ? [['midnight', 'midnight']] : [], ['exact', 'exact time…']], state.part, { 'aria-label': `${label} time of day` }),
        time: el(doc, 'input', '', { type: 'time', 'aria-label': `${label} exact time` }),
    };
    controls.day.value = state.day;
    controls.year.value = state.year;
    controls.time.value = state.time;
    const row = el(doc, 'div', '', { class: 'tl-date-row' });
    row.append(controls.day, controls.month, controls.year, controls.part);
    const hint = small(doc, '', { role: 'status' });
    const sync = () => { controls.time.hidden = controls.part.value !== 'exact'; };
    const commit = () => {
        const text = { day: controls.day.value.trim(), month: controls.month.value, year: controls.year.value.trim(), part: controls.part.value, time: controls.time.value };
        ui.rows[key] = text;
        sync();
        if (!text.day && text.month === '' && !text.year) {
            if (!optional) { hint.textContent = 'Fill in the day, month and year.'; return; }
            delete ui.rows[key];
            hint.textContent = '';
            if (abs !== null) onCommit(null);
            return;
        }
        if (!/^\d+$/.test(text.day) || text.month === '' || !/^\d+$/.test(text.year)) { hint.textContent = 'Fill in the day, month and year.'; return; }
        const year = Number(text.year), month = Number(text.month);
        const base = calendar.toAbs({ year, month, day: Number(text.day) });
        if (base === null) { hint.textContent = `${calendar.months[month].name} has ${calendar.daysIn(year, month)} days in ${year}: choose a day from 1 to ${calendar.daysIn(year, month)}.`; return; }
        let minutes;
        if (text.part === 'exact') {
            const clock = /^(\d\d):(\d\d)$/.exec(text.time);
            if (!clock) { hint.textContent = 'Choose the exact time.'; return; }
            minutes = Number(clock[1]) * 60 + Number(clock[2]);
        } else minutes = text.part === '' ? DAY : PARTS[text.part];
        delete ui.rows[key];
        hint.textContent = '';
        if (base + minutes !== abs) onCommit(base + minutes);
    };
    for (const control of Object.values(controls)) control.addEventListener('change', commit);
    sync();
    const block = el(doc, 'div', '', { class: 'tl-date-block' });
    block.append(row, controls.time, hint);
    return block;
}

export function renderEventInspector(ctx, container, { record, idx, problems = [] }) {
    const { doc } = ctx;
    const ui = timelineState(ctx);
    const calendar = packCalendar(ctx.model.document);
    const events = records(ctx.model, 'events').filter(isRecord);
    const info = readEvent(record);
    const id = info.id;
    const parent = info.after ? events.find(event => identity(event, 'events') === info.after) ?? null : null;
    const parentInfo = parent ? readEvent(parent) : null;
    const parentChronicle = parent ? readLasting(parent)?.name ?? null : null;
    const draft = ui.drafts[id] ??= {};
    if (draft.mode === info.mode) delete draft.mode;
    const mode = info.hand ? info.mode : draft.mode ?? info.mode;

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(el(doc, 'h2', info.name || id), el(doc, 'span', 'Event', { class: 'chip' }));
    container.append(titleRow);
    if (problems.length) container.append(el(doc, 'div', problems.map(problem => problem.message).join('\n'), { role: 'status', class: 'warning' }));
    const form = el(doc, 'div', '', { class: 'inspector-form-body' });
    container.append(form);

    // ------------------------------------------------------------ name
    const nameInput = el(doc, 'input', '', { 'aria-label': 'Event name' });
    nameInput.value = info.name;
    nameInput.addEventListener('change', () => {
        const next = idFromName(nameInput.value);
        if (!next) return refuse(ctx, 'Give the event a name.');
        if (next === id) { nameInput.value = info.name; return true; }
        return applyEdit(ctx, renameId(ctx.model, 'events', id, next), { id: next });
    });
    const saved = small(doc, 'Saved as ');
    saved.append(el(doc, 'code', id), '.');
    form.append(fieldset(doc, 'Name', (() => { const row = el(doc, 'div', '', { class: 'fieldset-row' }); row.append(field(doc, 'Event name', nameInput)); return row; })(), saved));

    // ------------------------------------------------------------ when
    // The form's picture of the condition: what changes it is written back as one new `when` (and `after`).
    const gapMinutes = Number.isSafeInteger(info.gap) ? info.gap : 0;
    const apply = (patch, note = '') => {
        const spec = { mode, from: info.from, until: info.until, gap: gapMinutes, after: info.after, where: info.where, ...patch };
        const earlier = spec.after ? events.find(event => identity(event, 'events') === spec.after) : null;
        const chronicle = earlier ? readLasting(earlier)?.name : null;
        const since = spec.mode === 'after' && spec.gap > 0 && chronicle ? { name: chronicle, minutes: spec.gap } : null;
        const written = writeCondition({ from: spec.mode === 'date' ? spec.from : null, until: spec.mode === 'any' ? null : spec.until, since, where: spec.where });
        if (!written.ok) return refuse(ctx, written.reason);
        const next = { ...record, when: written.when };
        if (spec.mode === 'after' || (spec.mode === 'date' && spec.after)) next.after = spec.after; else delete next.after;
        if (spec.mode === 'after' && spec.gap > 0 && !since) note = `“${humanName(spec.after)}” has no lasting change, so the delay was cleared.`;
        if (save(ctx, idx, next) && note) ctx.notify(note);
        return true;
    };
    const handNote = () => {
        const group = el(doc, 'div', '', { class: 'stack' });
        group.append(small(doc, 'Written by hand: edit it under Advanced.'), button(doc, 'Use the form instead', () => {
            const next = { ...record, when: 'true' };
            delete next.after;
            save(ctx, idx, next);
        }));
        return group;
    };
    const firstOther = () => events.find(event => {
        const other = identity(event, 'events');
        return other !== id && event.once !== false && !followsBack(events, other, id);
    });
    const whenSet = fieldset(doc, 'When it happens');
    if (info.hand) whenSet.append(handNote());
    else {
        whenSet.append(pick(doc, 'When', [['date', 'On a date'], ['after', 'After another event', !firstOther() && mode !== 'after'], ['any', 'Any time']], mode, value => {
            if (value === mode) return;
            if (value === 'date') {
                const start = calendar.start === null ? null : calendar.start - calendar.start % DAY;
                if (start === null) { draft.mode = 'date'; ctx.render(); } else apply({ mode: 'date', from: start, after: null, gap: 0 });
            } else if (value === 'after') apply({ mode: 'after', from: null, after: identity(firstOther(), 'events'), gap: 0 });
            else apply({ mode: 'any', from: null, until: null, after: null, gap: 0 });
        }));
        if (mode === 'date') {
            whenSet.append(small(doc, 'From'), dateRow(ctx, ui, { key: `${id}:from`, role: 'from', abs: info.from, label: 'From', onCommit: abs => apply({ from: abs }) }));
            whenSet.append(small(doc, 'Until (optional: leave empty and it waits until it can happen)'), dateRow(ctx, ui, { key: `${id}:until`, role: 'until', abs: info.until, label: 'Until', optional: true, onCommit: abs => apply({ until: abs }) }));
            if (parent) whenSet.append(small(doc, `It also waits for “${parentInfo.name}” to have happened.`));
            if (info.from !== null && calendar.start !== null) {
                const days = Math.floor((info.from - calendar.start) / DAY);
                whenSet.append(small(doc, `The story starts ${dateText(calendar, calendar.start)}: this is ${days >= 0 ? `${days} days in` : `${-days} days before it starts`}.`));
            }
        } else if (mode === 'after') {
            const choices = events.filter(event => {
                const other = identity(event, 'events');
                return other === info.after || (other !== id && event.once !== false && !followsBack(events, other, id));
            }).map(event => [identity(event, 'events'), humanName(identity(event, 'events'))]);
            const earlier = select(doc, [...info.after ? [] : [['', 'Choose an event…']], ...choices], info.after ?? '', { 'aria-label': 'After' });
            earlier.addEventListener('change', () => earlier.value ? apply({ after: earlier.value, gap: gapMinutes }) : null);
            const row = el(doc, 'div', '', { class: 'fieldset-row' });
            row.append(field(doc, 'After', earlier));
            whenSet.append(row);
            const spec = gapOf(gapMinutes);
            const months = calendar.monthDays * DAY;
            const unit = draft.unit === 'months' && gapMinutes % months === 0 ? 'months' : spec?.unit ?? 'days';
            const count = el(doc, 'input', '', { type: 'number', min: '1', step: '1', 'aria-label': 'Delay' });
            count.value = gapMinutes ? String(unit === 'months' ? gapMinutes / months : spec?.n ?? '') : '';
            const units = select(doc, [['days', 'days'], ['hours', 'hours'], ['months', 'months']], unit, { 'aria-label': 'Delay unit' });
            const writeGap = () => {
                const n = count.value.trim() === '' ? 0 : Number(count.value);
                if (!Number.isSafeInteger(n) || n < 0) return refuse(ctx, 'The delay is a whole number.');
                draft.unit = units.value;
                return apply({ gap: n * (UNITS[units.value] ?? months) });
            };
            count.addEventListener('change', writeGap);
            units.addEventListener('change', writeGap);
            const needs = !parentChronicle;
            if (needs) { count.disabled = true; units.disabled = true; }
            whenSet.append(inline(doc, 'at least', count, units, 'later'));
            whenSet.append(small(doc, needs && parent
                ? `Give “${parentInfo.name}” a Lasting change first: the days count from when it enters the chronicle.`
                : 'Counts from when the earlier event entered the chronicle, so that event needs a Lasting change (Story Director).'));
            if (info.sinceName !== null && parentChronicle !== info.sinceName) whenSet.append(el(doc, 'p', `This waits for a world event called “${info.sinceName}”, which “${parentInfo?.name ?? humanName(info.after)}” does not add now, so it never happens until that is fixed.`, { class: 'warning' }));
            whenSet.append(small(doc, 'No later than (optional)'), dateRow(ctx, ui, { key: `${id}:until`, role: 'until', abs: info.until, label: 'No later than', optional: true, onCommit: abs => apply({ until: abs }) }));
        } else whenSet.append(small(doc, 'It can happen on any reply, wherever the party is, unless you choose places below.'));
    }
    form.append(whenSet);

    // ------------------------------------------------------------ where
    const whereSet = fieldset(doc, 'Where');
    if (info.hand) whereSet.append(small(doc, 'Written by hand: edit it under Advanced.'));
    else {
        const only = info.where.length > 0 || draft.whereOnly === true;
        whereSet.append(pick(doc, 'Where', [['anywhere', 'Anywhere'], ['only', 'Only in…']], only ? 'only' : 'anywhere', value => {
            if (value === 'anywhere') { delete draft.whereOnly; if (info.where.length) apply({ where: [] }); else ctx.render(); } else { draft.whereOnly = true; ctx.render(); }
        }));
        if (only) {
            const chips = el(doc, 'div', '', { class: 'tl-chips' });
            info.where.forEach((place, index) => chips.append(button(doc, `${place.name} ✕`, () => apply({ where: info.where.filter((_, at) => at !== index) }), { class: 'chip', 'aria-label': `Remove ${place.name}` })));
            whereSet.append(chips);
            whereSet.append(placePicker(ctx, info.where, where => apply({ where })));
            whereSet.append(small(doc, mode === 'date' ? 'For news that spreads, add a second event “after this one”, some days later, in other regions.' : 'Elsewhere it waits, and happens the first time the party arrives in one of these.'));
        }
    }
    form.append(whereSet);

    // ------------------------------------------------------------ news
    const cue = el(doc, 'textarea', '', { rows: '5', maxlength: String(EVENT_LIMITS.cue), 'aria-label': 'News the AI is told' });
    cue.value = record.cue ?? '';
    const count = el(doc, 'div', `${[...cue.value].length} / ${EVENT_LIMITS.cue}`, { class: 'tl-count' });
    cue.addEventListener('input', () => { count.textContent = `${[...cue.value].length} / ${EVENT_LIMITS.cue}`; });
    cue.addEventListener('change', () => save(ctx, idx, { ...record, cue: cue.value }));
    const cueRow = el(doc, 'div', '', { class: 'fieldset-row' });
    cueRow.append(field(doc, 'Told once, on the reply after it happens', cue));
    form.append(fieldset(doc, 'News the AI is told', cueRow, count, checkbox(doc, 'Happens once', info.once, checked => {
        const next = { ...record };
        if (checked) { if (Object.hasOwn(next, 'once')) next.once = true; } else next.once = false;
        save(ctx, idx, next);
    })));

    // ------------------------------------------------------------ lasting change
    form.append(lastingSet(ctx, ui, { record, idx, info, events }));

    // ------------------------------------------------------------ the sentence
    const preview = el(doc, 'p', '', { class: 'tl-preview' });
    form.append(preview);
    preview.append(el(doc, 'b', 'When this fires:'), ` ${describeWhen(mode === info.mode ? info : { ...info, mode }, calendar, parentInfo)}`);

    // ------------------------------------------------------------ advanced
    const details = el(doc, 'details', '', { class: 'tl-advanced' });
    details.open = ui.open[id] === true;
    details.addEventListener('toggle', () => { ui.open[id] = details.open; });
    details.append(el(doc, 'summary', 'Advanced: the condition Studio writes', { class: 'tl-small' }));
    const raw = (label, control) => { const row = el(doc, 'div', '', { class: 'fieldset-row' }); row.append(field(doc, label, control)); return row; };
    const when = el(doc, 'textarea', '', { class: 'mono', rows: '4', 'aria-label': 'when' });
    when.value = record.when ?? '';
    when.addEventListener('change', () => save(ctx, idx, { ...record, when: when.value }));
    const after = el(doc, 'input', '', { class: 'mono', 'aria-label': 'after' });
    after.value = info.after ?? '';
    after.addEventListener('change', () => {
        const next = { ...record };
        if (after.value.trim()) next.after = after.value.trim(); else delete next.after;
        save(ctx, idx, next);
    });
    const then = el(doc, 'textarea', '', { class: 'mono', rows: '4', 'aria-label': 'then' });
    then.value = Array.isArray(record.then) ? JSON.stringify(record.then, null, 2) : '';
    then.addEventListener('change', () => {
        const next = { ...record };
        if (!then.value.trim()) delete next.then;
        else {
            let parsed;
            try { parsed = JSON.parse(then.value); } catch (err) { return refuse(ctx, `then is not valid JSON: ${err.message}`); }
            next.then = parsed;
        }
        return save(ctx, idx, next);
    });
    details.append(raw('when (the condition)', when), raw('after (the event it follows, by ID)', after), raw('then (steps it runs: the lasting change is one)', then));
    if (info.sinceName !== null && !info.hand) details.append(small(doc, `The ${gapText(info.gap)} count from when “${info.sinceName}” went into Story Director's chronicle (its Lasting change). ${info.gap} is that many story minutes.`));
    form.append(details);
}

function gapText(minutes) {
    const spec = gapOf(minutes);
    return spec ? `${spec.n} ${spec.unit}` : `${minutes} minutes`;
}

// Whether following the event `from` back, event by event, reaches `target`: it must not be offered as the one to follow.
function followsBack(events, from, target) {
    const seen = new Set();
    for (let next = events.find(event => identity(event, 'events') === from); next && !seen.has(identity(next, 'events')); next = events.find(event => identity(event, 'events') === next.after)) {
        if (identity(next, 'events') === target) return true;
        seen.add(identity(next, 'events'));
    }
    return false;
}

/** The search box under the place chips: the pack's places and regions that match, as buttons. */
function placePicker(ctx, chosen, onAdd) {
    const { doc } = ctx;
    const places = records(ctx.model, 'places').filter(isRecord);
    const names = [...new Set(places.map(place => place.name).filter(name => typeof name === 'string' && name))];
    const regions = [...new Set(places.map(place => place.region).filter(name => typeof name === 'string' && name))];
    const input = el(doc, 'input', '', { placeholder: `Search ${names.length} places and ${regions.length} regions`, 'aria-label': 'Add a region or place', autocomplete: 'off' });
    const results = el(doc, 'div', '', { class: 'tl-results', role: 'group', 'aria-label': 'Matching places and regions' });
    const matches = () => {
        const needle = input.value.trim().toLowerCase();
        if (!needle) return [];
        const taken = new Set(chosen.map(place => `${place.kind}:${place.name}`));
        return [...regions.map(name => ({ kind: 'region', name })), ...names.map(name => ({ kind: 'place', name }))]
            .filter(item => !taken.has(`${item.kind}:${item.name}`) && item.name.toLowerCase().includes(needle)).slice(0, 8);
    };
    const refresh = () => {
        results.replaceChildren(...matches().map(item => button(doc, `${item.name} · ${item.kind}`, () => onAdd([...chosen, item]), { class: 'tl-result' })));
    };
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault?.();
        const first = matches()[0];
        if (first) onAdd([...chosen, first]);
    });
    const row = el(doc, 'div', '', { class: 'fieldset-row' });
    row.append(field(doc, 'Add a region or place', input), results);
    return row;
}

function lastingSet(ctx, ui, { record, idx, info, events }) {
    const { doc } = ctx;
    const lasting = info.lasting;
    const set = fieldset(doc, 'Lasting change: add to the chronicle');
    set.append(checkbox(doc, 'Add to Story Director\'s chronicle', lasting !== null, checked => {
        save(ctx, idx, withLasting(record, checked ? { name: (info.name || info.id).slice(0, LASTING_LIMITS.name), state: 'ongoing' } : null));
    }));
    if (lasting === null) return set;
    // A change to the payload is checked against the limits Story Director refuses, then saved with the event. The
    // events that count days from this one follow its chronicle name.
    const change = patch => {
        const payload = { ...lasting };
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '' || value === false || (Array.isArray(value) && !value.length)) delete payload[key]; else payload[key] = value;
        }
        const problem = checkLasting(payload)[0];
        if (problem) return refuse(ctx, problem.message);
        const next = withLasting(record, payload);
        const before = typeof lasting.name === 'string' ? lasting.name : null;
        if (before === null || before === payload.name) return save(ctx, idx, next);
        const list = events.map(event => {
            if (event === record) return next;
            const read = event.after === info.id ? readCondition(event.when) : null;
            if (!read?.since || read.since.name !== before) return event;
            const written = writeCondition({ ...read, since: { ...read.since, name: payload.name } });
            return written.ok ? { ...event, when: written.when } : event;
        });
        const all = records(ctx.model, 'events').map(event => (event === record ? next : list[events.indexOf(event)] ?? event));
        return applyEdit(ctx, setRecords(ctx.model, 'events', all));
    };
    const text = (label, key, limit, multiline = false, list = null) => {
        const control = el(doc, multiline ? 'textarea' : 'input', '', { maxlength: String(limit), 'aria-label': label, ...multiline ? { rows: '2' } : {} });
        control.value = typeof lasting[key] === 'string' ? lasting[key] : '';
        if (list) control.setAttribute('list', list.id);
        control.addEventListener('change', () => change({ [key]: control.value.trim() }));
        const row = el(doc, 'div', '', { class: 'fieldset-row' });
        row.append(field(doc, label, control));
        if (list) row.append(list);
        return row;
    };
    set.append(text('World event', 'name', LASTING_LIMITS.name));
    set.append(pick(doc, 'State', LASTING_STATES.map(state => [state, STATE_LABELS[state]]), lasting.state, state => change({ state })));
    const options = el(doc, 'datalist', '', { id: `tl-places-${idx}` });
    for (const name of new Set(records(ctx.model, 'places').filter(isRecord).map(place => place.name))) if (typeof name === 'string') options.append(el(doc, 'option', '', { value: name }));
    set.append(text('Place', 'place', LASTING_LIMITS.place, false, options));
    const factions = Array.isArray(lasting.factions) ? lasting.factions : [];
    const chips = el(doc, 'div', '', { class: 'tl-chips' });
    factions.forEach((name, at) => chips.append(button(doc, `${name} ✕`, () => change({ factions: factions.filter((_, index) => index !== at) }), { class: 'chip', 'aria-label': `Remove ${name}` })));
    if (ui.addingFaction === info.id) {
        const input = el(doc, 'input', '', { maxlength: String(LASTING_LIMITS.faction), placeholder: 'Faction name', 'aria-label': 'New faction' });
        const add = () => { ui.addingFaction = null; if (input.value.trim()) change({ factions: [...factions, input.value.trim()] }); else ctx.render(); };
        input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); add(); } });
        const addButton = button(doc, 'Add', add);
        chips.append(input, addButton);
    } else {
        const more = button(doc, '+ faction', () => { ui.addingFaction = info.id; ctx.render(); }, { class: 'chip' });
        if (factions.length >= LASTING_LIMITS.factions) more.disabled = true;
        chips.append(more);
    }
    set.append(chips);
    set.append(text('Summary', 'summary', LASTING_LIMITS.summary, true));
    set.append(checkbox(doc, 'Keep in mind: mentioned on every reply (up to 2)', lasting.keep === true, checked => change({ keep: checked })));
    set.append(small(doc, 'Players see it in World → News and the Journal once it happens. The story can add detail but can\'t change its state; only another event or the player can. Needs Story Director; without it the news is still told once.'));
    return set;
}
