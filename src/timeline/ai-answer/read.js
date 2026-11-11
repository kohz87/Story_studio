// Reading an answer into draft events: each entry's ID and name, its "after" and delay, its date and places, and the drafts
// that come of them with their notes.
import { slugify } from '../../../vendor/story-block/src/v2/packs/validate.js';
import { EVENT_LIMITS } from '../../../vendor/story-block/src/v2/packs/limits.js';
import { identity } from '../../identity.js';
import { records, localId } from '../../records.js';
import { DAY, packCalendar } from '../calendar.js';
import { writeCondition } from '../condition.js';
import { settleGuards, humanName } from '../event.js';
import { LASTING_COMMAND, readLasting } from '../lasting.js';
import { NEWS_PLACEHOLDER, makeDraft } from '../drafts.js';
import { draftsOf } from '../../model.js';
import { findEvents } from './json.js';
import { readMoment } from './dates.js';
import { placeFinder, readWhere } from './where.js';
import { readLastingPayload } from './lasting-payload.js';
import { isRecord, text, fold, nameKey, quoted, size, clip, describe, wholeNumber, NAME_READ } from './values.js';

export const MAX_EVENTS = 30;
const ID_LIMIT = 64;
const DATE_READ = 200;

// ---------------------------------------------------------------- the answer


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
        // A lasting name Story Block cannot parse (a line break, say) cannot carry a delay: nothing is kept then, so no note promises one.
        const writable = entry.parent && mode !== 'date' && entry.parent.chronicle
            && writeCondition({ ...spec, where: [], since: { name: entry.parent.chronicle, minutes: 1 } }).ok;
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
            else if (kept && item !== kept) note(entry, 'delay', `Only one delay can be written, so the delay of ${describe(given)} ${unit} was left out beside the ${keptText}: choose one in the form.`, settle);
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
