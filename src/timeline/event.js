// A pack event as the Timeline shows it (pure): what the form reads from it, how the list groups and labels it, and
// the plain-words sentence of when it fires. Nothing here changes a pack; the condition is read through condition.js.
import { slugify } from '../../vendor/story-block/src/v2/packs/validate.js';
import { identity } from '../identity.js';
import { readCondition, glanceCondition } from './condition.js';
import { readLasting } from './lasting.js';
import { DAY, dayText, dateText, yearText, partName, timeText, clockText } from './calendar.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An event has no name of its own, only its ID: this is the ID in words ("the-seventh-seal-fails": "The seventh seal fails"). */
export function humanName(id) {
    const text = String(id ?? '').replace(/-+/g, ' ').trim();
    return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/** The ID a name is saved as. */
export const idFromName = slugify;

/** "60 days", "1 hour": a delay in minutes as a whole number of days, else of hours; null for any other. */
export function gapOf(minutes) {
    if (!Number.isSafeInteger(minutes) || minutes < 1) return null;
    if (minutes % DAY === 0) return { n: minutes / DAY, unit: 'days' };
    return minutes % 60 === 0 ? { n: minutes / 60, unit: 'hours' } : null;
}
export const gapText = ({ n, unit }) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;

/**
 * What the form and the list know of an event: `mode` ('date', 'after' or 'any'), `from` and `until` (minutes), `gap`
 * (minutes after the earlier event's chronicle entry, 0 for none), `sinceName`, `where` (`{ kind, name }`), `lasting`,
 * `once`, `after` (the earlier event's ID). `hand` is true when the condition is not one Studio wrote: the dates and
 * places are then only what can be seen in it, and the form keeps it exactly as it is.
 */
export function readEvent(record) {
    const id = identity(record, 'events');
    const after = typeof record?.after === 'string' && record.after ? record.after : null;
    const info = { id, name: humanName(id), once: record?.once !== false, after, lasting: readLasting(record), hand: false, mode: 'any', from: null, until: null, gap: 0, sinceName: null, where: [] };
    const read = readCondition(record?.when);
    if (!read) {
        const seen = glanceCondition(record?.when);
        return { ...info, hand: true, mode: after ? 'after' : seen.from !== null ? 'date' : 'any', from: seen.from, until: seen.until, where: seen.where };
    }
    info.from = read.from; info.until = read.until; info.where = read.where;
    if (read.since) { info.gap = read.since.minutes; info.sinceName = read.since.name; }
    info.mode = read.since || (read.from === null && after) ? 'after' : read.from !== null ? 'date' : 'any';
    if ((read.since && (!after || !gapOf(read.since.minutes))) || (info.mode === 'any' && read.until !== null)) info.hand = true;
    return info;
}

// ---------------------------------------------------------------- the list

const LATER = { days: 'day', hours: 'hour' };
function laterText(gap) {
    const spec = gapOf(gap);
    return spec ? `${spec.n} ${spec.n === 1 ? LATER[spec.unit] : spec.unit} later` : 'right after';
}

const suffix = text => text.slice(-2);
/** The time of day in a range: "6:40 – 8:00 pm" (the first part loses its am or pm when it is the same). */
function range(a, b) {
    const first = clockText(a), second = clockText(b);
    return `${suffix(first) === suffix(second) ? first.slice(0, -3) : first} – ${second}`;
}

/** `{ main, sub }` for the date column of a row: "Goldwane 12" over "6:40 – 8:00 pm", "from 6:40 am", "at dawn", "– Deepwinter 30". */
export function dateColumn(calendar, info, year = null) {
    if (info.from === null) return { main: info.gap || info.mode === 'after' ? laterText(info.gap) : 'Any time', sub: info.until === null ? '' : `until ${dayText(calendar, endOf(info.until))}` };
    const start = calendar.fromAbs(info.from);
    const main = `${dayText(calendar, info.from)}${year !== null && start.year !== year ? `, ${yearText(calendar, start.year)}` : ''}`;
    if (info.until === null) return { main, sub: start.minutes === 0 ? '' : partName(start.minutes) ? `at ${partName(start.minutes)}` : `from ${clockText(start.minutes)}` };
    const end = endOf(info.until);
    const stop = calendar.fromAbs(end);
    const dayEnd = info.until % DAY === 0 || stop.minutes === DAY - 1;
    if (stop.year === start.year && stop.month === start.month && stop.day === start.day) {
        if (dayEnd) return { main, sub: start.minutes === 0 ? '' : `from ${clockText(start.minutes)}` };
        return { main, sub: range(start.minutes, stop.minutes) };
    }
    const to = `${dayText(calendar, end)}${stop.year !== start.year ? `, ${yearText(calendar, stop.year)}` : ''}${dayEnd ? '' : `, ${clockText(stop.minutes)}`}`;
    return { main, sub: `${start.minutes === 0 ? '' : `${clockText(start.minutes)} `}– ${to}` };
}
// The last minute an `until` bound still counts (the bound itself is exclusive); a day's end reads as that day.
const endOf = until => (until > 0 && until % DAY === 0 ? until - 1 : until);

/** The chips of a row: its places and regions (three, then "+2 regions"), what it follows, once or every visit. */
export function chipsOf(info, parentName = null) {
    const names = info.where.map(place => place.name);
    const chips = names.slice(0, 3).map(name => ({ text: name }));
    const rest = info.where.slice(3);
    if (rest.length) chips.push({ text: `+${rest.length} ${rest.every(place => place.kind === 'region') ? 'regions' : rest.every(place => place.kind === 'place') ? 'places' : 'more'}` });
    if (info.after) chips.push({ text: `after: ${shorten(parentName ?? humanName(info.after))}` });
    chips.push({ text: info.once ? 'once' : info.where.length ? 'every visit' : 'repeats' });
    return chips;
}
const shorten = text => (text.length > 26 ? `${text.slice(0, 25)}…` : text);

/**
 * The Timeline's rows: events grouped by story year (the year of a dated event, with those that follow it under it),
 * then those with no date. `{ groups: [{ key, title, rows: [{ idx, record, info, depth, date, chips }] }] }`.
 */
export function timelineRows(events, calendar) {
    const rows = events.map((record, idx) => ({ idx, record, info: readEvent(record) })).filter(row => isRecord(row.record) && row.info.id);
    const byId = new Map(rows.map(row => [row.info.id, row]));
    // An event is a root unless the one it follows exists and following on from it never comes back round to it.
    const loops = row => {
        const seen = new Set([row.info.id]);
        for (let next = byId.get(row.info.after); next; next = byId.get(next.info.after)) {
            if (seen.has(next.info.id)) return true;
            seen.add(next.info.id);
        }
        return false;
    };
    const kids = new Map();
    const roots = [];
    for (const row of rows) {
        const parent = row.info.after && row.info.after !== row.info.id ? byId.get(row.info.after) : null;
        if (parent && !loops(row)) kids.set(parent.info.id, [...kids.get(parent.info.id) ?? [], row]);
        else roots.push(row);
    }
    // A row and, beneath it, the events that follow it, nearest first.
    const walk = (row, depth, base, year, into) => {
        const parent = byId.get(row.info.after);
        into.push({ ...row, depth, date: dateColumn(calendar, row.info, depth ? year : null), chips: chipsOf(row.info, depth ? parent?.info.name : null) });
        const start = row.info.from ?? base;
        const key = kid => kid.info.from ?? start + kid.info.gap;
        for (const kid of (kids.get(row.info.id) ?? []).sort((a, b) => key(a) - key(b) || a.idx - b.idx)) walk(kid, Math.min(depth + 1, 3), start, year, into);
    };
    const groups = [];
    for (const row of roots.filter(row => row.info.from !== null).sort((a, b) => a.info.from - b.info.from || a.idx - b.idx)) {
        const year = calendar.fromAbs(row.info.from).year;
        let group = groups.at(-1);
        if (!group || group.year !== year) {
            const started = calendar.start !== null && calendar.fromAbs(calendar.start).year === year ? ` · the story starts ${dayText(calendar, calendar.start)}` : '';
            group = { key: `year-${year}`, year, title: `${yearText(calendar, year)}${started}`, rows: [] };
            groups.push(group);
        }
        walk(row, 0, row.info.from, year, group.rows);
    }
    const loose = roots.filter(row => row.info.from === null);
    if (loose.length) {
        const group = { key: 'any', year: null, title: 'Any date · by place only', rows: [] };
        for (const row of loose) walk(row, 0, 0, null, group.rows);
        groups.push(group);
    }
    return { groups, count: rows.length };
}

// ---------------------------------------------------------------- the sentence

function whenText(calendar, abs, kind) {
    const date = calendar.fromAbs(abs);
    if (kind === 'until' && (abs % DAY === 0 || date.minutes === DAY - 1) && abs > 0) return `the end of ${dateText(calendar, endOf(abs))}`;
    return date.minutes === 0 ? `the start of ${dateText(calendar, abs)}` : `${timeText(date.minutes)} on ${dateText(calendar, abs)}`;
}

function placesText(where) {
    const names = where.map(place => place.name);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? '';
}

/** The green line under the form: when this fires, in plain words. */
export function describeWhen(info, calendar, parent = null) {
    if (info.hand) return 'The condition is written by hand and kept exactly as it is: see it under Advanced.';
    const where = info.where.length ? ` while the party is in ${placesText(info.where)}` : '';
    const parts = [];
    if (info.mode === 'date' && info.from !== null) {
        const date = calendar.fromAbs(info.from);
        parts.push(date.minutes === 0 ? `on the first reply at or after the start of ${dateText(calendar, info.from)}` : `on the first reply at or after ${timeText(date.minutes)}, ${dateText(calendar, info.from)}`);
        if (info.until !== null) parts.push(`until ${whenText(calendar, info.until, 'until')}`);
        if (info.after) parts.splice(1, 0, `once “${parent?.name ?? humanName(info.after)}” has happened`);
        if (where) parts.push(where.trim());
    } else if (info.mode === 'after') {
        const earlier = `“${parent?.name ?? humanName(info.after)}”`;
        const spec = gapOf(info.gap);
        let lead = spec ? `at least ${gapText(spec)} after ${earlier}` : `after ${earlier} has happened`;
        if (spec && parent?.from != null) lead += ` (so from ${dateText(calendar, parent.from)} + ${gapText(spec)})`;
        parts.push(lead);
        if (info.until !== null) parts.push(`and no later than ${whenText(calendar, info.until, 'until')}`);
        parts.push(`on the first reply${where}`);
    } else parts.push(`on the first reply${where}`);
    return `${parts.join(', ')}${info.once ? '' : '; it can fire again on later replies'}.`;
}
