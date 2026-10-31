// Reading an AI's answer into draft events (pure).
//
// Tolerant of what a chat adds around the answer (a code fence, a sentence before or after, one event instead of a list,
// months, regions and places in any case) and strict about everything it writes: each event becomes the same spec the event
// form uses and is written with `writeCondition`, so a draft is what the form would have written. What cannot be written
// (a date that cannot be read, an earlier event that is not there, a delay with nothing to count from) is left out of the
// event and said in words in the draft's notes, each tied to the field it is about; what is only wrong once written (a place
// the pack lacks, a date before the story, news too long, a lasting change outside Story Director's limits) is found by
// `draftProblems`, as it is for any draft. A field of the wrong kind is a note too, never a quiet default. Nothing here
// turns an unknown value into text (it could throw), and every size is bounded before it is looked at. Sizes count Unicode
// characters (a dragon is one, though it takes two UTF-16 units), a cut never splits one, and a text that is cut says so.
import { slugify } from '../../vendor/story-block/src/v2/packs/validate.js';
import { identity } from '../identity.js';
import { records, localId } from '../records.js';
import { DAY, PARTS, packCalendar } from './calendar.js';
import { writeCondition } from './condition.js';
import { settleGuards, humanName } from './event.js';
import { LASTING_COMMAND, LASTING_LIMITS, readLasting } from './lasting.js';
import { NEWS_PLACEHOLDER, makeDraft } from './drafts.js';
import { draftsOf } from '../model.js';
import { EVENT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';

export const MAX_EVENTS = 30;
/** The most characters of a pasted answer that are read. */
export const PASTE_LIMIT = 200000;
const ID_LIMIT = 64;
const NAME_READ = 200;
const MAX_WHERE = 30;
const DATE_READ = 200;
const NESTING = 4;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');
const fold = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// The name of an event as the answer used it: case and spacing only (a superscript two is not a two, a hyphen is not a space).
const nameKey = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoted = value => `“${value}”`;
// The length of a text in characters, and the text cut to `max` characters (never in the middle of a character).
const size = value => (value.length <= 1 ? value.length : [...value].length);
const clip = (value, max) => (value.length <= max || size(value) <= max ? value : [...value].slice(0, max).join(''));
// An unknown value in words, without ever turning it into text (an object with a broken toString would throw).
const describe = value => {
    if (typeof value === 'string') return quoted(clip(value.trim(), 40) + (size(value.trim()) > 40 ? '…' : ''));
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return Array.isArray(value) ? 'a list' : isRecord(value) ? 'an object' : value === null ? 'null' : 'nothing';
};
// Whether `value` is no deeper than `depth` levels and holds at most 1000 values: counted without recursion.
function shallow(value, depth) {
    const stack = [[value, 0]];
    for (let seen = 0; stack.length; seen++) {
        const [item, level] = stack.pop();
        if (item === null || typeof item !== 'object') continue;
        if (level >= depth || seen > 1000) return false;
        const children = Array.isArray(item) ? item : Object.values(item);
        if (children.length > 1000) return false;
        for (const child of children) stack.push([child, level + 1]);
    }
    return true;
}
// A value that is kept as it came only when it is small: else null, which every check of a lasting change refuses.
const bounded = value => (shallow(value, NESTING) ? value : null);

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
    return looksLikeEvent(value) ? [value] : null;
}
const looksLikeEvent = value => isRecord(value) && ('name' in value || 'when' in value || 'news' in value || 'cue' in value);
// A list "holds events" when one of its entries looks like one: a citation like [1] in the prose around it does not.
const holdsEvents = list => list.some(looksLikeEvent);

/** The list of events in an answer's text, `{ list }`, or `{ error }` in words. */
export function findEvents(source) {
    const body = String(source ?? '').replace(/^\uFEFF/, '');
    if (!body.trim()) return { error: 'Paste the AI’s answer first.' };
    if (body.length > PASTE_LIMIT) return { error: `That is ${body.length.toLocaleString('en-US')} characters, and I read at most ${PASTE_LIMIT.toLocaleString('en-US')}. Paste only the JSON list, or ask the AI for fewer events.` };
    const found = [];
    let failure = '';
    const take = (parsed, expected = true) => {
        const list = parsed.value !== undefined && eventsIn(parsed.value);
        if (list) found.push(list); else if (parsed.failure && expected) failure ||= parsed.failure;
    };
    const done = () => found.some(holdsEvents);
    take(attempt(body.trim()), /^[[{]/.test(body.trim()));
    if (!done()) for (const block of body.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)) { take(attempt(block[1].trim())); if (done()) break; }
    // Around prose: each top-level [ ... ] or { ... } in turn, until one holds events. One that does not read is reported,
    // not looked inside; one that holds none (a citation like [1]) is passed over.
    if (!done()) {
        for (let i = 0, tries = 0; i < body.length && !done() && tries < 200; i++) {
            if (body[i] !== '[' && body[i] !== '{') continue;
            tries++;
            const end = endOf(body, i);
            if (end < 0) { failure ||= 'it is cut off before its closing bracket'; break; }
            take(attempt(body.slice(i, end + 1)));
            i = end;
        }
    }
    const list = found.find(holdsEvents) ?? found.find(items => items.some(isRecord)) ?? found[0];
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

// The places an event is limited to: `{ list, note, cut }`; `note` says in words what could not be read, `cut` how many names
// were shortened. The answer's own limit on how many are read, and a Set for the duplicates, keep a hostile list cheap.
function readWhere(raw, find) {
    if (raw === undefined) return { list: [] };
    const asked = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : null;
    if (!asked) return { list: [], note: `“where” should be “anywhere” or a list of region and place names, not ${describe(raw)}: choose the places in the form.` };
    const out = [];
    const seen = new Set();
    let unread = 0, cut = 0;
    for (const item of asked.slice(0, MAX_WHERE)) {
        if (typeof item !== 'string') { unread++; continue; }
        const name = clip(text(item), NAME_READ);
        if (size(item.trim()) > NAME_READ) cut++;
        if (!name || ['anywhere', 'any', 'everywhere'].includes(fold(name))) continue;
        const place = find(name);
        const key = `${place.kind}:${place.name}`;
        if (!seen.has(key)) { seen.add(key); out.push(place); }
    }
    const rest = Math.max(0, asked.length - MAX_WHERE);
    const said = [];
    if (unread) said.push(`${unread === 1 ? 'a place' : `${unread} places`} that ${unread === 1 ? 'is' : 'are'} not a name`);
    if (rest) said.push(`${rest} more than the ${MAX_WHERE} that are read`);
    return { list: out, cut, ...said.length ? { note: `Left out of “where”: ${said.join(' and ')}. Check the places in the form.` } : {} };
}

// ---------------------------------------------------------------- a lasting change

// The payload for the lasting change `raw` asks for, and `cuts`: what was changed on the way, one `{ field, text, ack? }` for each
// field of the lasting change (a field with several texts cut says so once). A text is cut one character past its limit, so one that
// is too long still shows as too long (the check of a lasting change refuses it) and the draft stays small; a text at its limit, or
// one past it that was not cut, is kept whole. An optional field that is there but cannot be read (null, or the wrong kind) is left
// out of the payload and said, so the form can repair the fields one at a time; `name` and `state`, which a lasting change needs,
// are kept as they came for the check to refuse. Only a field that is left out is left at its default.
function readLastingPayload(raw, fallbackName) {
    const limits = LASTING_LIMITS;
    const cuts = [];
    const words = (value, max, field, what) => {
        if (typeof value !== 'string') return bounded(value);
        const trimmed = value.trim(), length = size(trimmed);
        if (length > max + 1) cuts.push({ field, text: `${what} was ${length.toLocaleString('en-US')} characters and a lasting change allows ${max}: it was shortened to ${max + 1}, and still needs cutting down in the form.` });
        return clip(trimmed, max + 1);
    };
    const blank = value => value === undefined || (typeof value === 'string' && !value.trim());
    // An optional text that is there: read when it is text, else left out and said.
    const optional = (field, max, what, ack) => {
        const value = raw[field];
        if (blank(value)) return;
        if (typeof value === 'string') payload[field] = words(value, max, field, what);
        else cuts.push({ field, ack, text: `Lasting change: ${field} must be text, not ${describe(value)}, so it was left out: fill it in the form, or leave it blank.` });
    };
    const payload = { name: blank(raw.name) ? clip(fallbackName, limits.name) : words(raw.name, limits.name, 'name', 'The name') };
    // With no name of its own the lasting change takes the event's, which is cut to fit; that is said too, and the writer may accept it.
    if (blank(raw.name) && size(fallbackName) > limits.name) cuts.push({ field: 'name', ack: 'The cut name is fine', text: `The lasting change has no name of its own, so it takes the event’s, which is ${size(fallbackName)} characters: only the first ${limits.name} were kept.` });
    payload.state = typeof raw.state === 'string' ? clip(raw.state.trim().toLowerCase(), 20) : bounded(raw.state);
    if (payload.state === undefined) delete payload.state;
    optional('place', limits.place, 'The place', 'No place is fine');
    if (!blank(raw.factions)) {
        const list = typeof raw.factions === 'string' ? [raw.factions] : raw.factions;
        if (!Array.isArray(list)) cuts.push({ field: 'factions', ack: 'No factions is fine', text: `Lasting change: factions must be a list of at most ${limits.factions} names, not ${describe(list)}, so it was left out: add the factions in the form, or leave it blank.` });
        else if (list.length) {
            // One note for the whole list, said of the list that is kept: the entries read (one past the limit, so a list that is too
            // long still shows as too long), the ones that are no name (empty or not text) taken out, and the names that were cut.
            // It can always be set aside, to keep the factions as they are shown; the check of a lasting change still has its say.
            const asked = list.slice(0, limits.factions + 1);
            const names = asked.filter(name => typeof name === 'string' && name.trim());
            const unread = asked.length - names.length;
            const tooLong = names.filter(name => size(name.trim()) > limits.faction + 1).length;
            const over = names.length > limits.factions || names.some(name => size(name.trim()) > limits.faction);
            const said = [];
            if (list.length > limits.factions + 1) said.push(`The list has ${list.length} factions and a lasting change allows ${limits.factions}: it was shortened to ${limits.factions + 1}.`);
            if (tooLong) said.push(`${tooLong === 1 ? 'A faction name was' : `${tooLong} faction names were`} longer than ${limits.faction} characters and ${tooLong === 1 ? 'was' : 'were'} shortened to ${limits.faction + 1}.`);
            if (unread) said.push(`Lasting change: ${unread === 1 ? 'a faction is' : `${unread} factions are`} empty or not text, so ${unread === 1 ? 'it was' : 'they were'} left out.`);
            if (names.length) payload.factions = names.map(name => clip(name.trim(), limits.faction + 1));
            if (said.length) cuts.push({ field: 'factions', ack: 'The factions as shown are fine', text: `${said.join(' ')} ${over ? 'The list still needs cutting down in the form.' : 'Check the factions in the form.'}` });
        }
    }
    optional('summary', limits.summary, 'The summary', 'No summary is fine');
    if (raw.keep !== undefined && raw.keep !== false) {
        if (typeof raw.keep === 'boolean') payload.keep = raw.keep;
        else cuts.push({ field: 'keep', ack: 'Not kept in mind is fine', text: `Lasting change: keep must be true or false, not ${describe(raw.keep)}, so it was left out: set it in the form.` });
    }
    return { payload, cuts };
}

// ---------------------------------------------------------------- the answer

const wholeNumber = value => {
    const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

// Notes say what could not be written into a draft, each tied to the field it is about (see drafts.js): `ack` is what the
// writer can press to say the plain reading is what they want (a draft with no end date, or that comes right after).
const ACK = { when: 'Not dated is fine', until: 'No end date is fine', delay: 'Right after is fine', where: 'Anywhere is fine', once: 'Once is fine', news: 'The cut news is fine', lasting: 'No lasting change is fine' };
// `extra` is `{ ack }` to offer another button than the kind's own (or `{ ack: null }` for none), and `{ field }` for a note about one
// field of the lasting change.
const note = (entry, kind, words, extra = {}) => {
    const ack = extra.ack === undefined ? ACK[kind] : extra.ack;
    entry.notes.push({ kind, text: words, ...ack ? { ack } : {}, ...extra.field ? { field: extra.field } : {} });
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
    const taken = new Set([...packEvents.map(event => localId(model, identity(event, 'events'))), ...draftsOf(model).map(draft => localId(model, identity(draft.record, 'events')))]);
    const skipped = [];
    const extra = Math.max(0, found.list.length - MAX_EVENTS);

    // 1. Each entry's name and ID, and what it says of itself.
    const entries = [];
    found.list.slice(0, MAX_EVENTS).forEach((raw, index) => {
        if (!isRecord(raw)) return skipped.push({ index, reason: 'It is not an event (an event is an object with a name).' });
        const name = clip(text(raw.name), NAME_READ);
        const nameCut = size(text(raw.name)) > NAME_READ;
        const base = slugify(name);
        if (!name || !base) return skipped.push({ index, name, reason: name ? `The name “${name}” has no letters or digits to make an ID from.` : 'It has no name.' });
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base.slice(0, ID_LIMIT - `-${n}`.length).replace(/-+$/, '')}-${n}`;
        taken.add(id);
        const entry = { raw, index, name, base, id, once: raw.once !== false, lasting: null, notes: [], info: id === base ? [] : [`There is already an event called “${name}”, so this one is saved as ${id}.`] };
        if (nameCut) entry.info.push(`The name is longer than ${NAME_READ} characters, so only the first ${NAME_READ} were read to make the ID.`);
        if (raw.once !== undefined && typeof raw.once !== 'boolean') {
            entry.once = true;
            note(entry, 'once', `“once” should be true or false, not ${describe(raw.once)}, so it is left at the usual (happens once). Change it in the form if you want it to repeat.`);
        }
        if (raw.lasting !== undefined && raw.lasting !== false) {
            if (isRecord(raw.lasting)) {
                const read = readLastingPayload(raw.lasting, name);
                entry.lasting = read.payload;
                for (const cut of read.cuts) note(entry, 'lasting', cut.text, { ack: cut.ack ?? null, field: cut.field });
            } else note(entry, 'lasting', `“lasting” should be an object like { "name": …, "state": … }, not ${describe(raw.lasting)}: add the lasting change in the form.`);
        }
        entries.push(entry);
    });

    // 2. The earlier event of each "after", by the name the answer used for it, normalised by case and spacing only (never by the ID
    // two names would make: "Dawn-Watch Falls" and "Dawn Watch Falls" are two events). An event of that name in the answer wins
    // (the writer asked for it in this very answer, and its ID only differs because the pack's took the name), then the pack's (the pack
    // has IDs, not names, so its event is the one whose ID the name makes). Two events of the answer whose names are the same are not
    // guessed between, and a name that matches neither is not guessed from the ID it would make: the child is left with a note instead.
    const group = key => {
        const map = new Map();
        for (const entry of entries) map.set(key(entry), [...map.get(key(entry)) ?? [], entry]);
        return map;
    };
    const byName = group(entry => nameKey(entry.name));
    const packParent = name => {
        const slug = slugify(name);
        const record = packEvents.find(event => localId(model, identity(event, 'events')) === slug);
        return record ? { id: localId(model, identity(record, 'events')), once: record.once !== false, chronicle: text(readLasting(record)?.name) || null } : null;
    };
    const ambiguous = (entry, asked, mates) => note(entry, 'after', `${quoted(asked)} could mean any of ${mates.length} events in this answer (${mates.map(mate => mate.id).join(', ')}): choose the earlier event in the form.`);
    const answerParent = mate => ({ id: mate.id, once: mate.once, chronicle: mate.lasting ? (typeof mate.lasting.name === 'string' ? text(mate.lasting.name) : '') || null : null, entry: mate });
    for (const entry of entries) {
        const when = entry.raw.when;
        const given = isRecord(when) ? when.after : undefined;
        if (given === undefined) continue;
        const asked = typeof given === 'string' ? clip(text(given), NAME_READ) : '';
        if (!asked) { note(entry, 'after', typeof given === 'string' ? '“after” is empty: choose the earlier event in the form.' : `“after” should be the name of an event, not ${describe(given)}: choose the earlier event in the form.`); continue; }
        const named = byName.get(nameKey(asked)) ?? [];
        const pack = packParent(asked);
        if (named.length > 1) { ambiguous(entry, asked, named); continue; }
        if (named.length && named[0] !== entry) {
            entry.parent = answerParent(named[0]);
            if (pack) entry.info.push(`There is an event called ${quoted(asked)} in the pack and another in this answer. This one comes after the one in this answer (${named[0].id}), not the pack's (${pack.id}).`);
        } else if (pack) entry.parent = pack;
        else if (named.length) note(entry, 'after', 'It cannot come after itself: choose the earlier event in the form.');
        else note(entry, 'after', `It comes after ${quoted(asked)}, which is not an event in the pack or in this answer: choose the earlier event in the form.`);
    }
    // An "after" that leads back to the event itself is no order at all.
    for (const entry of entries) {
        const seen = new Set([entry.id]);
        for (let next = entry.parent?.entry; next; next = next.parent?.entry) {
            if (seen.has(next.id)) { note(entry, 'after', 'It comes after an event that comes after it: choose the earlier event in the form.'); delete entry.parent; break; }
            seen.add(next.id);
        }
    }

    // 3. The event itself, as the form writes it.
    const items = entries.map(entry => {
        const { raw } = entry;
        const when = raw.when;
        const spec = { from: null, until: null, since: null, where: [] };
        const where = readWhere(raw.where, find);
        spec.where = where.list;
        const date = (value, role, kind) => {
            // A date that long is no date; it is not cut to see what is left, which could be a different one.
            const read = size(text(value)) > DATE_READ ? { message: `it is longer than ${DATE_READ} characters` } : readMoment(value, calendar, role);
            if (read.message) note(entry, kind, `The date ${quoted(clip(text(value), 60))} could not be read: ${read.message}. Choose it in the form.`);
            return read.abs ?? null;
        };
        // What "when" says: nothing, "any time", a date in words, or an object with `on`, `after` and a delay.
        let on;
        if (when !== undefined) {
            if (typeof when === 'string') on = ['any time', 'anytime', 'any', 'always'].includes(fold(clip(when, 40))) ? undefined : when;
            else if (isRecord(when) && (!Object.keys(when).length || ['on', 'after', 'days', 'hours', 'months'].some(key => key in when))) on = when.on;
            else note(entry, 'when', `“when” should be a date, “any time”, or { "on": … } or { "after": …, "days": … }, not ${describe(when)}: choose when it happens in the form.`);
        }
        let mode = entry.parent ? 'after' : 'any';
        if (on !== undefined) {
            if (typeof on !== 'string') note(entry, 'when', `The date should be words like “Icewane 4, CY 612, dawn”, not ${describe(on)}. Choose it in the form.`);
            else {
                spec.from = date(on, 'from', 'when');
                if (spec.from !== null) mode = 'date';
            }
        }
        if (entry.parent && !entry.parent.once) note(entry, 'after', `${quoted(humanName(entry.parent.id))} happens again and again, so nothing can come after it: choose another earlier event in the form.`);
        // The delay: days, hours or months after the earlier event's lasting change. Every unit that is there is read, so a second one
        // that is wrong is not hidden behind the first; only one delay can be written.
        const units = [['days', DAY], ['hours', 60], ['months', calendar.monthDays * DAY]].map(([unit, size]) => ({ unit, size, given: isRecord(when) ? when[unit] : undefined })).filter(item => item.given !== undefined);
        const writable = entry.parent && mode !== 'date' && entry.parent.chronicle;
        const kept = writable ? units.find(item => { const n = wholeNumber(item.given); return n !== null && Number.isSafeInteger(n * item.size); }) : null;
        const keptText = kept ? `${wholeNumber(kept.given)} ${kept.unit}` : null;
        // What a wrong unit's button says follows what is saved: the delay that is kept, or none (right after).
        const settle = keptText ? { ack: `Just the ${keptText} is fine` } : {};
        for (const item of units) {
            const { unit, size, given } = item;
            const n = wholeNumber(given);
            if (!entry.parent) note(entry, 'delay', `It has a delay of ${describe(given)} ${unit} but no earlier event to count from: choose the earlier event in the form, then set the delay.`);
            else if (mode === 'date') note(entry, 'delay', `A date and a delay after another event cannot both be written, so the delay of ${describe(given)} ${unit} was left out: choose one in the form.`);
            else if (n === null || !Number.isSafeInteger(n * size)) note(entry, 'delay', `The delay of ${describe(given)} ${unit} is not a whole number of at least 1: ${keptText ? `it was left out, and the ${keptText} is kept. Set it in the form` : 'set it in the form'}.`, settle);
            else if (!entry.parent.chronicle) note(entry, 'delay', `${quoted(humanName(entry.parent.id))} has no lasting change, and a delay counts from when one happens: give it one in the form, then set the delay.`);
            else if (item !== kept) note(entry, 'delay', `Only one delay can be written, so the delay of ${describe(given)} ${unit} was left out beside the ${keptText}: choose one in the form.`, settle);
            else spec.since = { name: entry.parent.chronicle, minutes: n * size };
        }
        const until = raw.until;
        if (until !== undefined) {
            if (typeof until !== 'string') note(entry, 'until', `The end date should be words like “Icewane 9, CY 612”, not ${describe(until)}. Choose it in the form.`);
            else if (mode === 'any') note(entry, 'until', 'It has an end date but no date or earlier event to start from: choose when it starts in the form.');
            else spec.until = date(until, 'until', 'until');
        }
        if (where.note) note(entry, 'where', where.note);
        if (where.cut) note(entry, 'where', `${where.cut === 1 ? 'A place name was' : `${where.cut} place names were`} longer than ${NAME_READ} characters and ${where.cut === 1 ? 'was' : 'were'} shortened: check the places in the form.`, { ack: null });
        let written = writeCondition(spec);
        if (!written.ok && spec.since) {
            // The delay is what cannot be written when it fails even with no places (a lasting name with a line break, say).
            const bare = writeCondition({ ...spec, where: [] });
            if (!bare.ok) {
                note(entry, 'delay', `${bare.reason} Set the delay in the form.`);
                spec.since = null;
                written = writeCondition(spec);
            }
        }
        if (!written.ok) {
            note(entry, 'where', `${written.reason} The places were left out: choose them in the form.`);
            written = writeCondition({ ...spec, where: [] });
        }
        const record = { id: entry.id };
        if (entry.parent) record.after = entry.parent.id;
        if (!entry.once) record.once = false;
        record.when = written.ok ? written.when : 'true';
        // The news is counted as the pack checker counts it (in UTF-16 units, as Story Block does), so a news that is valid is never cut;
        // a cut never leaves half of a character.
        let cue = typeof (raw.news ?? raw.cue) === 'string' ? text(raw.news ?? raw.cue) : '';
        if (cue.length > EVENT_LIMITS.cue) {
            note(entry, 'news', `The news is ${cue.length.toLocaleString('en-US')} characters and an event allows ${EVENT_LIMITS.cue}: only the first ${EVENT_LIMITS.cue} were kept. Shorten it in the form.`);
            cue = cue.slice(0, EVENT_LIMITS.cue).replace(/[\ud800-\udbff]$/, '').trim();
        }
        record.cue = cue || NEWS_PLACEHOLDER;
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
