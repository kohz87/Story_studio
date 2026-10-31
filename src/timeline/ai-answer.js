// Reading an AI's answer into draft events (pure).
//
// Tolerant of what a chat adds around the answer (a code fence, a sentence before or after, one event instead of a list,
// months, regions and places in any case) and strict about everything it writes: each event becomes the same spec the event
// form uses and is written with `writeCondition`, so a draft is what the form would have written. What cannot be written
// (a date that cannot be read, an earlier event that is not there, a delay with nothing to count from) is left out of the
// event and said in words in the draft's notes; what is only wrong once written (a place the pack lacks, a date before the
// story, news too long, a lasting change outside Story Director's limits) is found by `draftProblems`, as it is for any draft.
import { slugify } from '../../vendor/story-block/src/v2/packs/validate.js';
import { identity } from '../identity.js';
import { records, localId } from '../records.js';
import { DAY, PARTS, packCalendar } from './calendar.js';
import { writeCondition } from './condition.js';
import { settleGuards, humanName } from './event.js';
import { LASTING_COMMAND, LASTING_LIMITS, readLasting } from './lasting.js';
import { NEWS_PLACEHOLDER, makeDraft } from './drafts.js';
import { draftsOf } from '../model.js';

export const MAX_EVENTS = 30;
const ID_LIMIT = 64;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');
const fold = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoted = value => `“${value}”`;

// ---------------------------------------------------------------- finding the JSON

// The end of the JSON value that starts at `start` (a bracket), or -1: brackets counted outside strings.
function endOf(source, start) {
    let depth = 0, inString = false;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (inString) { if (char === '\\') i++; else if (char === '"') inString = false; }
        else if (char === '"') inString = true;
        else if (char === '[' || char === '{') depth++;
        else if (char === ']' || char === '}') { if (--depth === 0) return i; }
    }
    return -1;
}

const attempt = source => {
    try { return { value: JSON.parse(source) }; } catch (error) { return { failure: error instanceof Error ? error.message : 'not JSON' }; }
};

// The events in a parsed value: a list, `{ events: [...] }`, or a single event; null when it is none of them.
function eventsIn(value) {
    if (Array.isArray(value)) return value;
    if (!isRecord(value)) return null;
    if (Array.isArray(value.events)) return value.events;
    return 'name' in value || 'when' in value || 'news' in value ? [value] : null;
}

/** The list of events in an answer's text, `{ list }`, or `{ error }` in words. */
export function findEvents(source) {
    const body = String(source ?? '').replace(/^\uFEFF/, '');
    if (!body.trim()) return { error: 'Paste the AI’s answer first.' };
    const found = [];
    let failure = '';
    const take = (parsed, expected = true) => {
        const list = parsed.value !== undefined && eventsIn(parsed.value);
        if (list) found.push(list); else if (parsed.failure && expected) failure ||= parsed.failure;
    };
    take(attempt(body.trim()), /^[[{]/.test(body.trim()));
    if (!found.length) for (const block of body.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)) take(attempt(block[1].trim()));
    // Around prose: each top-level [ ... ] or { ... } in turn. One that does not read is reported, not looked inside.
    if (!found.length) {
        for (let i = 0, tries = 0; i < body.length && !found.length && tries < 60; i++) {
            if (body[i] !== '[' && body[i] !== '{') continue;
            tries++;
            const end = endOf(body, i);
            if (end < 0) { failure ||= 'it is cut off before its closing bracket'; break; }
            take(attempt(body.slice(i, end + 1)));
            i = end;
        }
    }
    const list = found.find(items => items.some(isRecord)) ?? found[0];
    if (!list) {
        return { error: failure
            ? `I found a list but could not read it (${failure}). Paste the whole answer again, or ask the AI to answer with the JSON list only.`
            : 'I could not find a JSON list of events in that text. Paste the whole answer, from its first [ to its last ].' };
    }
    if (!list.length) return { error: 'The answer holds no events.' };
    return { list };
}

// ---------------------------------------------------------------- dates

const TIME = /\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?(?!\d)/i;

/**
 * A date from the answer's words ("Icewane 4, CY 612, dawn", "4 icewane 612 18:30") as story minutes: `{ abs }`, or
 * `{ message }` in words. `role` 'until' reads a date with no time of day as that whole day (its end).
 */
export function readMoment(source, calendar, role = 'from') {
    let rest = ` ${text(source).replace(/,/g, ' ')} `;
    if (!text(source)) return { message: 'it is empty' };
    rest = rest.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1').replace(/\s(?:at|on)(?=\s)/gi, ' ');
    let minutes = null;
    const clock = TIME.exec(rest);
    if (clock) {
        let hours = Number(clock[1]);
        const suffix = clock[3]?.toLowerCase();
        if (suffix) hours = hours % 12 + (suffix === 'p' ? 12 : 0);
        if (hours > 23 || Number(clock[2]) > 59) return { message: `${quoted(clock[0])} is not a time of day` };
        minutes = hours * 60 + Number(clock[2]);
        rest = rest.replace(clock[0], ' ');
    } else {
        const part = /\b(dawn|noon|dusk|midnight)\b/i.exec(rest);
        if (part) { minutes = PARTS[part[1].toLowerCase()]; rest = rest.replace(part[0], ' '); }
    }
    if (calendar.era) rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(calendar.era)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
    const lower = rest.toLowerCase();
    let month = -1;
    [...calendar.months.keys()].sort((a, b) => calendar.months[b].name.length - calendar.months[a].name.length).some(index => {
        const named = new RegExp(`(?<![\\p{L}\\p{N}])${escape(calendar.months[index].name.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').exec(lower);
        if (!named) return false;
        month = index;
        rest = `${rest.slice(0, named.index)} ${rest.slice(named.index + named[0].length)}`;
        return true;
    });
    const words = rest.replace(/-?\d+/g, ' ').replace(/\s+/g, ' ').trim();
    if (month < 0) {
        return { message: words ? `${quoted(words)} is not a month of this calendar (${calendar.months.map(item => item.name).join(', ')})` : `it names no month (${calendar.months.map(item => item.name).join(', ')})` };
    }
    let numbers = rest.match(/-?\d+/g) ?? [];
    if (numbers.length !== 2) return { message: 'it needs a day and a year, like “Icewane 4, CY 612”' };
    if (numbers[0].length >= 3 && numbers[1].length <= 2) numbers = [numbers[1], numbers[0]];
    const [day, year] = numbers.map(Number);
    if (!Number.isSafeInteger(year) || year < 0) return { message: `${quoted(numbers[1])} is not a year` };
    const length = calendar.daysIn(year, month);
    if (!Number.isInteger(day) || day < 1 || day > length) return { message: `${calendar.months[month].name} has ${length} days in ${year}, so day ${numbers[0]} is not one` };
    const abs = calendar.toAbs({ year, month, day, minutes: minutes ?? (role === 'until' ? DAY : PARTS.dawn) });
    return abs === null ? { message: 'it is outside the calendar' } : { abs };
}

// ---------------------------------------------------------------- places

function placeFinder(model) {
    const places = records(model, 'places').filter(isRecord);
    const byKey = (pick, kind) => {
        const map = new Map();
        for (const place of places) for (const name of pick(place)) if (typeof name === 'string' && name.trim() && !map.has(fold(name))) map.set(fold(name), { kind, name: kind === 'region' ? name : place.name });
        return map;
    };
    const regions = byKey(place => [place.region], 'region');
    const names = byKey(place => [place.name], 'place');
    const aliases = byKey(place => (Array.isArray(place.aliases) ? place.aliases : []), 'place');
    // A name that is both a region and a place is the region. Anything the pack lacks is kept as it was written, as a place.
    return name => regions.get(fold(name)) ?? names.get(fold(name)) ?? aliases.get(fold(name)) ?? { kind: 'place', name };
}

function readWhere(raw, find) {
    const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
    const out = [];
    for (const item of list) {
        const name = text(item);
        if (!name || ['anywhere', 'any', 'everywhere'].includes(fold(name))) continue;
        const place = find(name);
        if (!out.some(other => other.kind === place.kind && other.name === place.name)) out.push(place);
    }
    return out;
}

// ---------------------------------------------------------------- a lasting change

function readLastingPayload(raw, fallbackName) {
    if (!isRecord(raw)) return null;
    const payload = { name: text(raw.name) || fallbackName.slice(0, LASTING_LIMITS.name) };
    payload.state = typeof raw.state === 'string' ? raw.state.trim().toLowerCase() : raw.state;
    if (payload.state === undefined) delete payload.state;
    if (typeof raw.place === 'string' && raw.place.trim()) payload.place = raw.place.trim();
    if (raw.factions !== undefined && raw.factions !== null) {
        const list = typeof raw.factions === 'string' ? [raw.factions] : raw.factions;
        if (!Array.isArray(list)) payload.factions = list;
        else if (list.length) payload.factions = list.map(name => (typeof name === 'string' ? name.trim() : name));
    }
    if (typeof raw.summary === 'string' && raw.summary.trim()) payload.summary = raw.summary.trim();
    if (raw.keep !== undefined && raw.keep !== false) payload.keep = raw.keep;
    return payload;
}

// ---------------------------------------------------------------- the answer

const wholeNumber = value => {
    const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

/**
 * What `source` (the pasted answer) holds, for the pack `model`: `{ ok: true, items, skipped, extra }` with `items` as
 * `{ name, id, draft, info }` (`draft` is a draft for makeDraft's shape, `info` plain notes that do not stop it being kept,
 * like a changed ID), `skipped` as `{ index, reason }` for entries that are no event, and `extra` the number of events left
 * unread past MAX_EVENTS; or `{ ok: false, error }` in words.
 */
export function readAnswer(source, model) {
    const found = findEvents(source);
    if (found.error) return { ok: false, error: found.error };
    const calendar = packCalendar(model.document);
    const find = placeFinder(model);
    const packEvents = records(model, 'events').filter(isRecord);
    const taken = new Set([...packEvents.map(event => localId(model, identity(event, 'events'))), ...draftsOf(model).map(draft => identity(draft.record, 'events'))]);
    const skipped = [];
    const extra = Math.max(0, found.list.length - MAX_EVENTS);

    // 1. Each entry's name and ID, and what it says of itself.
    const entries = [];
    found.list.slice(0, MAX_EVENTS).forEach((raw, index) => {
        if (!isRecord(raw)) return skipped.push({ index, reason: 'It is not an event (an event is an object with a name).' });
        const name = text(raw.name);
        const base = slugify(name);
        if (!name || !base) return skipped.push({ index, name, reason: name ? `The name “${name}” has no letters or digits to make an ID from.` : 'It has no name.' });
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base.slice(0, ID_LIMIT - `-${n}`.length).replace(/-+$/, '')}-${n}`;
        taken.add(id);
        const once = raw.once !== false;
        const lasting = readLastingPayload(raw.lasting, name);
        entries.push({ raw, index, name, base, id, once, lasting, notes: [], info: id === base ? [] : [`There is already an event called “${name}”, so this one is saved as ${id}.`] });
    });

    // 2. The earlier event of each "after": in the pack, or in the answer.
    const byBase = new Map(entries.map(entry => [entry.base, entry]));
    const packParent = name => {
        const slug = slugify(name);
        const record = packEvents.find(event => localId(model, identity(event, 'events')) === slug);
        return record ? { id: localId(model, identity(record, 'events')), once: record.once !== false, chronicle: text(readLasting(record)?.name) || null } : null;
    };
    for (const entry of entries) {
        const when = entry.raw.when;
        const asked = isRecord(when) ? text(when.after) : '';
        if (!asked) continue;
        const pack = packParent(asked);
        const mate = byBase.get(slugify(asked));
        if (pack) entry.parent = pack;
        else if (mate && mate !== entry) entry.parent = { id: mate.id, once: mate.once, chronicle: mate.lasting ? text(mate.lasting.name) || null : null, entry: mate };
        else entry.notes.push(mate === entry ? 'It cannot come after itself: choose the earlier event in the form.' : `It comes after ${quoted(asked)}, which is not an event in the pack or in this answer: choose the earlier event in the form.`);
    }
    // An "after" that leads back to the event itself is no order at all.
    for (const entry of entries) {
        const seen = new Set([entry.id]);
        for (let next = entry.parent?.entry; next; next = next.parent?.entry) {
            if (seen.has(next.id)) { entry.notes.push('It comes after an event that comes after it: choose the earlier event in the form.'); delete entry.parent; break; }
            seen.add(next.id);
        }
    }

    // 3. The event itself, as the form writes it.
    const items = entries.map(entry => {
        const { raw } = entry;
        const when = raw.when;
        const spec = { from: null, until: null, since: null, where: readWhere(raw.where, find) };
        const date = (value, role) => {
            const read = readMoment(value, calendar, role);
            if (read.message) entry.notes.push(`The date ${quoted(text(value))} could not be read: ${read.message}. Choose it in the form.`);
            return read.abs ?? null;
        };
        const on = typeof when === 'string' && !['any time', 'anytime', 'any', 'always'].includes(fold(when)) ? when : isRecord(when) ? when.on : undefined;
        let mode = entry.parent ? 'after' : 'any';
        if (on !== undefined && text(on)) {
            spec.from = date(on, 'from');
            if (spec.from !== null) mode = 'date';
        }
        if (entry.parent && !entry.parent.once) entry.notes.push(`${quoted(humanName(entry.parent.id))} happens again and again, so nothing can come after it: choose another earlier event in the form.`);
        if (mode === 'after') {
            for (const [unit, size] of [['days', DAY], ['hours', 60], ['months', calendar.monthDays * DAY]]) {
                if (!isRecord(when) || when[unit] === undefined) continue;
                const n = wholeNumber(when[unit]);
                if (n === null || !Number.isSafeInteger(n * size)) entry.notes.push(`The delay of ${quoted(text(String(when[unit])))} ${unit} is not a whole number of at least 1: set it in the form.`);
                else if (!entry.parent.chronicle) entry.notes.push(`${quoted(humanName(entry.parent.id))} has no lasting change, and a delay counts from when one happens: give it one in the form, then set the delay.`);
                else spec.since = { name: entry.parent.chronicle, minutes: n * size };
                break;
            }
        }
        if (raw.until !== undefined && text(raw.until)) {
            if (mode === 'any') entry.notes.push('It has an end date but no date or earlier event to start from: choose when it starts in the form.');
            else spec.until = date(raw.until, 'until');
        }
        let written = writeCondition(spec);
        if (!written.ok) {
            entry.notes.push(`${written.reason} The places were left out: choose them in the form.`);
            written = writeCondition({ ...spec, where: [] });
        }
        const record = { id: entry.id };
        if (entry.parent) record.after = entry.parent.id;
        if (!entry.once) record.once = false;
        record.when = written.ok ? written.when : 'true';
        record.cue = text(raw.news ?? raw.cue) || NEWS_PLACEHOLDER;
        if (entry.lasting) record.then = [{ command: LASTING_COMMAND, payload: entry.lasting }];
        return { entry, record };
    });

    // 4. The guard of an event others count days from, as the form settles it among the drafts.
    let list = items.map(item => item.record);
    list.forEach((_, at) => { list = settleGuards(list, at, list[at]); });
    return {
        ok: true,
        items: items.map((item, at) => ({ name: item.entry.name, id: item.entry.id, draft: makeDraft(list[at], item.entry.notes), info: item.entry.info })),
        skipped,
        extra,
    };
}
