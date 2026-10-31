// Drafts: events written with an AI that are not part of the pack yet (pure).
//
// A draft is `{ record, notes, seen }`: the event as the form writes it, what could not be written (`notes`, in words, true
// while the event's date, delay and places are still as they were read: `seen`), and nothing else. Drafts ride along with
// a snapshot of the open pack (model.js `draftsOf`), so they are saved with the project, come back with undo and redo, and
// stay out of its document: the pack checker, Problems and the exported file never see them until one is kept.
//
// The event form edits a draft through `combinedModel`, the pack with its drafts after its own events, so a draft can
// follow another draft and uses the same code as any event; `splitCombined` takes the drafts back out of the result.
import { EVENT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { openPack, draftsOf, withDrafts } from '../model.js';
import { add, setRecords } from '../edits.js';
import { records, identity, localId } from '../records.js';
import { packCalendar, dateText, timeText } from './calendar.js';
import { readEvent, humanName, settleGuards, gapOf, gapText } from './event.js';
import { LASTING_STATES, checkLasting, readLasting } from './lasting.js';

export const NEWS_PLACEHOLDER = '[WHAT THE AI IS TOLD]';
export const MAX_DRAFTS = 60;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** What of an event the notes of a draft are about: its when, after and where, as the form reads them. */
export function draftSignature(record) {
    const info = readEvent(record);
    return JSON.stringify([info.mode, info.from, info.until, info.gap, info.after, info.hand, info.where.map(place => `${place.kind}:${place.name}`)]);
}

/** A draft of `record`; `notes` are what could not be written into it. */
export function makeDraft(record, notes = []) {
    return { record, notes: [...notes], seen: draftSignature(record) };
}

const activeNotes = draft => (draft.notes.length && draftSignature(draft.record) === draft.seen ? draft.notes : []);

/** The drafts of a saved project, checked: a list of `{ record, notes, seen }`; anything else is left out. */
export function sanitizeDrafts(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value.slice(0, MAX_DRAFTS)) {
        if (!isRecord(item) || !isRecord(item.record) || typeof item.record.id !== 'string' || !item.record.id) continue;
        const notes = Array.isArray(item.notes) ? item.notes.filter(note => typeof note === 'string').slice(0, 10) : [];
        out.push({ record: item.record, notes, seen: typeof item.seen === 'string' ? item.seen : draftSignature(item.record) });
    }
    return out;
}

// ---------------------------------------------------------------- the pack with its drafts

const combined = new WeakMap();

/** The pack with its drafts as events after its own: what the event form edits when it edits a draft. The pack itself without drafts. */
export function combinedModel(model, drafts = draftsOf(model)) {
    if (!drafts.length || !model?.document) return model;
    const cached = combined.get(drafts);
    if (cached?.model === model) return cached.value;
    const document = model.document;
    const content = { ...isRecord(document.content) ? document.content : {}, events: [...records(model, 'events'), ...drafts.map(draft => draft.record)] };
    const value = openPack({ ...document, content });
    combined.set(drafts, { model, value });
    return value;
}

/**
 * The drafts after an edit made on the combined pack (`next`, the result's model): its events after the pack's own. Null
 * when they are not the drafts there were (an edit cannot add or remove one).
 */
export function splitCombined(model, drafts, next) {
    const events = next?.document?.content?.events;
    const count = records(model, 'events').length;
    if (!Array.isArray(events) || events.length !== count + drafts.length) return null;
    return drafts.map((draft, at) => ({ ...draft, record: events[count + at] }));
}

// ---------------------------------------------------------------- what is wrong with a draft

const pathEvent = path => {
    const found = /^content\.events(?:\[(\d+)\]|\.(\d+)(?=\.|$)|\.([^.[\]]+))/.exec(path ?? '');
    return found ? (found[3] ?? Number(found[1] ?? found[2])) : null;
};

function findEvent(model, drafts, id) {
    const pack = records(model, 'events').find(record => isRecord(record) && identity(record, 'events') === id);
    if (pack) return { record: pack, draft: false };
    const draft = drafts.find(item => identity(item.record, 'events') === id);
    return draft ? { record: draft.record, draft: true } : null;
}

/**
 * Why a draft cannot be kept yet, in plain words: what was read badly from the answer and has not been changed since, then
 * what is wrong with it now (no news, a name taken, a date before the story, a place or region the pack lacks, an earlier
 * event that is missing, a lasting change Story Director would refuse, anything the pack checker says). None when it is ready.
 */
export function draftProblems(model, drafts, index) {
    const draft = drafts[index];
    const record = draft.record;
    const out = [...activeNotes(draft)];
    const info = readEvent(record);
    const calendar = packCalendar(model.document);
    const cue = typeof record.cue === 'string' ? record.cue.trim() : '';
    if (!cue || cue === NEWS_PLACEHOLDER) out.push('There is no news yet: write what the AI is told in the form.');
    else if (cue.length > EVENT_LIMITS.cue) out.push(`The news is ${cue.length} characters and an event allows ${EVENT_LIMITS.cue}: shorten it in the form.`);
    if (records(model, 'events').some(event => isRecord(event) && localId(model, identity(event, 'events')) === localId(model, info.id))) {
        out.push(`The pack already has an event with the ID “${info.id}”: rename this one in the form.`);
    }
    if (!info.hand) {
        if (info.from !== null && calendar.start !== null && info.from < calendar.start) out.push(`It is set before the story starts (${dateText(calendar, calendar.start)}): choose a later date in the form.`);
        if (info.from !== null && info.until !== null && info.until <= info.from) out.push('Its end is not after its start: choose a later “until” in the form.');
        const places = records(model, 'places').filter(isRecord);
        const names = new Set(places.map(place => place.name));
        const regions = new Set(places.map(place => place.region));
        for (const place of info.where) {
            if (!(place.kind === 'region' ? regions : names).has(place.name)) out.push(`“${place.name}” is not a ${place.kind} in this pack: pick one in the form.`);
        }
    }
    const parent = info.after ? findEvent(model, drafts, info.after) : null;
    if (info.after && !parent) out.push(`It comes after “${humanName(info.after)}”, which is not an event of the pack: choose the earlier event in the form.`);
    else if (parent && parent.record.once === false) out.push(`“${humanName(info.after)}” happens again and again, so nothing can come after it.`);
    if (!info.hand && info.sinceName !== null && parent && readLasting(parent.record)?.name !== info.sinceName) {
        out.push(`The delay counts from a lasting change called “${info.sinceName}”, which “${humanName(info.after)}” does not add: fix it in the form.`);
    }
    const lasting = readLasting(record);
    if (lasting) for (const problem of checkLasting(lasting)) out.push(`Lasting change: ${problem.message}`);
    if (!out.length) {
        const checked = combinedModel(model, drafts);
        const at = records(model, 'events').length + index;
        for (const error of checked?.validation?.errors ?? []) {
            const where = pathEvent(error.path);
            if (where === at || where === info.id) out.push(error.message);
        }
    }
    return out;
}

/** The draft an event comes after, when that is still a draft: it has to be kept first. `{ id, name }` or null. */
export function waitingFor(model, drafts, index) {
    const after = readEvent(drafts[index].record).after;
    if (!after) return null;
    if (records(model, 'events').some(event => isRecord(event) && identity(event, 'events') === after)) return null;
    return drafts.some(draft => identity(draft.record, 'events') === after) ? { id: after, name: humanName(after) } : null;
}

/** What a draft says of itself, for a list: `{ when, where, lasting }` in words. */
export function summarize(model, record) {
    const info = readEvent(record);
    const calendar = packCalendar(model.document);
    let when = 'any time';
    if (info.mode === 'date' && info.from !== null) when = `${dateText(calendar, info.from)} at ${timeText(calendar.fromAbs(info.from).minutes)}`;
    else if (info.mode === 'after') {
        const spec = gapOf(info.gap);
        when = `${spec ? `at least ${gapText(spec)} after` : 'right after'} “${humanName(info.after)}”`;
    }
    if (info.until !== null && info.mode !== 'any') when += `, until ${dateText(calendar, info.until > 0 ? info.until - 1 : info.until)}`;
    const names = info.where.map(place => place.name);
    const lasting = info.lasting;
    const kind = lasting && LASTING_STATES.includes(lasting.state) ? `${lasting.state}${lasting.keep === true ? ', keep in mind' : ''}` : '';
    return {
        when,
        where: names.length ? names.join(', ') : 'anywhere',
        lasting: lasting ? `lasting change: ${lasting.name ?? humanName(info.id)}${kind ? ` (${kind})` : ''}` : '',
    };
}

// ---------------------------------------------------------------- changing the drafts

const ok = (model, next) => ({ ok: true, model: next, undo: () => model });
const refuse = (model, message) => ({ ok: false, model, errors: [{ code: 'draft', path: '', message }] });
const sameError = (a, b) => a.code === b.code && a.path === b.path && a.message === b.message;

/** The drafts `items` added to the project: one edit. */
export function addDrafts(model, items) {
    const drafts = draftsOf(model);
    if (drafts.length + items.length > MAX_DRAFTS) return refuse(model, `A project holds at most ${MAX_DRAFTS} drafts: keep or discard some first.`);
    return ok(model, withDrafts(model, [...drafts, ...items]));
}

/** The drafts after an edit the form made on the combined pack: one edit, or the pack's own refusal; null when nothing changed. */
export function editDrafts(model, result) {
    const drafts = draftsOf(model);
    if (!result.ok) return result;
    const next = splitCombined(model, drafts, result.model);
    if (!next) return refuse(model, 'A draft could not be changed that way.');
    if (JSON.stringify(next) === JSON.stringify(drafts)) return null;
    return ok(model, withDrafts(model, next));
}

/** The draft with this ID thrown away: one edit. */
export function discardDraft(model, id) {
    const drafts = draftsOf(model);
    const at = drafts.findIndex(draft => identity(draft.record, 'events') === id);
    if (at < 0) return refuse(model, 'That draft is already gone.');
    return ok(model, withDrafts(model, drafts.filter((_, index) => index !== at)));
}

// The pack with `record` added as an event, its guards settled, or why not. The pack checker has the last word.
function keepOne(model, record) {
    const events = records(model, 'events');
    const list = [...events, record];
    const at = list.length - 1;
    const settled = settleGuards(list, at, record);
    let result = add(model, 'events', settled[at]);
    if (result.ok && settled.some((event, index) => index < at && event !== list[index])) result = setRecords(result.model, 'events', settled);
    if (!result.ok) return { ok: false, message: result.errors?.[0]?.message ?? 'The pack would not take it.' };
    const before = model.validation?.errors ?? [];
    const fresh = (result.model.validation?.errors ?? []).filter(error => !before.some(old => sameError(old, error)));
    if (fresh.length) return { ok: false, message: fresh[0].message };
    return { ok: true, model: result.model };
}

/** The draft with this ID kept: it joins the pack's events (and the guard of the event it follows is settled): one edit. */
export function keepDraft(model, id) {
    const drafts = draftsOf(model);
    const at = drafts.findIndex(draft => identity(draft.record, 'events') === id);
    if (at < 0) return refuse(model, 'That draft is already gone.');
    const problems = draftProblems(model, drafts, at);
    if (problems.length) return refuse(model, problems[0]);
    const waiting = waitingFor(model, drafts, at);
    if (waiting) return refuse(model, `Keep “${waiting.name}” first: this event comes after it.`);
    const kept = keepOne(model, drafts[at].record);
    if (!kept.ok) return refuse(model, kept.message);
    return ok(model, withDrafts(kept.model, drafts.filter((_, index) => index !== at)));
}

/** Every draft that can be kept, parents first, in one edit: `{ result, kept, left }`; `result` is null when none can. */
export function keepAll(model) {
    let current = model;
    let remaining = [...draftsOf(model)];
    let kept = 0;
    for (let progress = true; progress && remaining.length;) {
        progress = false;
        for (let at = 0; at < remaining.length; at++) {
            if (draftProblems(current, remaining, at).length || waitingFor(current, remaining, at)) continue;
            const done = keepOne(current, remaining[at].record);
            if (!done.ok) continue;
            current = done.model;
            remaining = remaining.filter((_, index) => index !== at);
            kept++;
            progress = true;
            at--;
        }
    }
    return { result: kept ? ok(model, withDrafts(current, remaining)) : null, kept, left: remaining.length };
}

/** How many of the drafts could be kept right now: nothing to fix, and the earlier event is in the pack or is one of these. */
export function keepableCount(model) {
    const drafts = draftsOf(model);
    const ready = new Map();
    const can = at => {
        const id = identity(drafts[at].record, 'events');
        if (ready.has(id)) return ready.get(id);
        ready.set(id, false);
        let result = draftProblems(model, drafts, at).length === 0;
        const waiting = result ? waitingFor(model, drafts, at) : null;
        if (waiting) result = can(drafts.findIndex(draft => identity(draft.record, 'events') === waiting.id));
        ready.set(id, result);
        return result;
    };
    return drafts.reduce((sum, _, at) => sum + (can(at) ? 1 : 0), 0);
}
