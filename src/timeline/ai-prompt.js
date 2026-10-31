// The prompt a writer pastes into an AI chat to have timeline events written (pure).
//
// Studio never talks to an AI: it only builds this text from the open pack (the calendar, the regions and places, the
// names in the lorebook, the events already there), the writer's idea and the answer format `ai-answer.js` reads back. The
// same pack and idea always give the same text. Its size is bounded: the place list, the one part that can be long, is
// cut to fit, and the result says so.
import { EVENT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { worldInfo } from '../lorebook.js';
import { identity } from '../identity.js';
import { packCalendar, dateText, clockText, DAY } from './calendar.js';
import { readEvent, humanName } from './event.js';
import { LASTING_LIMITS } from './lasting.js';

export const IDEA_LIMIT = 2000;
/** The size a prompt is held to: the place list, the one long part, takes what room the rest leaves and is cut to fit. */
export const PROMPT_LIMIT = 24000;
const LISTED = { regions: 80, names: 100, events: 40 };
const NAME_LIMIT = 80;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oneLine = (value, max = NAME_LIMIT) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return [...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text;
};
const unique = list => [...new Set(list.filter(Boolean))];
const order = (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0);
const wordsOf = text => (text.trim() ? text.trim().split(/\s+/).length : 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a pack gives the prompt: `{ regions, places, names, events }` (names of each; `events` as `{ name, text }`). */
export function packFacts(document) {
    const calendar = packCalendar(document);
    const places = Array.isArray(document?.content?.places) ? document.content.places.filter(isRecord) : [];
    const regions = unique(places.map(place => oneLine(place.region)));
    const placeNames = unique(places.map(place => oneLine(place.name))).sort(order);
    let book = { entries: {} };
    try { book = worldInfo(document); } catch { /* A damaged collection gives no names. */ }
    const names = unique(Object.values(book.entries)
        .filter(entry => entry.extensions?.story_studio?.kind !== 'places')
        .flatMap(entry => entry.key.map(key => oneLine(key))));
    const list = Array.isArray(document?.content?.events) ? document.content.events.filter(isRecord) : [];
    const byId = new Map(list.map(record => [identity(record, 'events'), record]));
    const events = list.filter(record => identity(record, 'events')).map(record => ({ name: oneLine(humanName(identity(record, 'events'))), text: eventText(calendar, record, byId) }));
    return { calendar, regions, places: placeNames, names, events };
}

// "Bluewatch guild board (Goldwane 12, CY 611; Bluewatch Village)": the date or what it follows, then the places.
function eventText(calendar, record, byId) {
    const info = readEvent(record);
    const when = [];
    if (info.mode === 'date' && info.from !== null) {
        when.push(dateText(calendar, info.from));
        const end = info.until === null ? null : dateText(calendar, info.until > 0 && info.until % DAY === 0 ? info.until - 1 : info.until);
        if (end !== null && end !== when[0]) when.push(`until ${end}`);
    } else if (info.mode === 'after') {
        const parent = byId.get(info.after);
        when.push(`after ${oneLine(parent ? humanName(identity(parent, 'events')) : humanName(info.after))}`);
    } else when.push('any time');
    const names = info.where.map(place => oneLine(place.name));
    const where = names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '') : '';
    const lasting = info.lasting ? `lasting change: ${oneLine(info.lasting.name)}` : '';
    return [when.join(', '), where, lasting].filter(Boolean).join('; ');
}

const hhmm = minutes => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

function calendarLine(calendar) {
    if (!calendar.hasCalendar) return 'CALENDAR: the Gregorian calendar (January to December, with leap years). The pack gives the story no calendar of its own.';
    const lengths = new Set(calendar.months.map(month => month.days));
    const names = calendar.months.map(month => oneLine(month.name));
    const shape = lengths.size === 1
        ? `${calendar.months.length} months of ${calendar.months[0].days} days: ${names.join(', ')}`
        : `${calendar.months.length} months: ${calendar.months.map((month, at) => `${names[at]} (${month.days} days)`).join(', ')}`;
    const era = calendar.era ? `Years are ${oneLine(calendar.era, 12)}.` : 'Years are plain numbers.';
    let start = 'The pack does not say when the story starts.';
    if (calendar.start !== null) {
        const date = calendar.fromAbs(calendar.start);
        start = `The story starts ${dateText(calendar, calendar.start)}, ${hhmm(date.minutes)}.`;
    }
    return `CALENDAR: ${shape}. ${era} ${start} Times of day: dawn, noon, dusk, midnight, or an exact time like 18:30.`;
}

// A date the answer format uses, as an example, written in this pack's own months and era.
function sampleDate(calendar) {
    const month = calendar.months[Math.min(calendar.months.length - 1, Math.floor(calendar.months.length * 0.9))];
    const year = calendar.start !== null ? calendar.fromAbs(calendar.start).year + 1 : 1;
    return `${month.name} 4, ${calendar.era ? `${calendar.era} ` : ''}${year}, dawn`;
}

/**
 * The prompt for the pack `document`: `{ text, words, characters, counts, cut }`. `idea` is the writer's own words (at most
 * IDEA_LIMIT characters); `include` says which parts of the pack go in (`calendar`, `places` for the regions and places,
 * `names`, `events`; all on when left out). `counts` is what the pack has of each, and `cut` is `{ shown, total }` when the
 * place list had to be shortened, else null.
 */
export function buildPrompt(document, { idea = '', include = {} } = {}) {
    const use = { calendar: true, places: true, names: true, events: true, ...include };
    const facts = packFacts(document);
    const { calendar } = facts;
    const name = oneLine(document?.name || document?.id || 'this pack', 120);
    const lines = [`You are helping a writer plan hidden world events for the Story Suite pack "${name}". Players never see these events; when one happens, the story's narrator is told its news once.`, ''];
    if (use.calendar) lines.push(calendarLine(calendar));
    if (use.places) {
        if (facts.regions.length) lines.push(`REGIONS (${facts.regions.length}): ${facts.regions.slice(0, LISTED.regions).join(', ')}${facts.regions.length > LISTED.regions ? ', …' : ''}`);
        if (facts.places.length) lines.push(`PLACES (${facts.places.length}): listed at the end.`);
    }
    if (use.names && facts.names.length) lines.push(`FACTIONS AND NAMES: ${facts.names.slice(0, LISTED.names).join(', ')}${facts.names.length > LISTED.names ? ', …' : ''}`);
    if (use.events) {
        const shown = facts.events.slice(0, LISTED.events).map(event => `${event.name}${event.text ? ` (${event.text})` : ''}`);
        lines.push(`EVENTS ALREADY IN THE PACK (${facts.events.length}): ${shown.length ? shown.join(' · ') : 'none'}${facts.events.length > LISTED.events ? ` · and ${facts.events.length - LISTED.events} more` : ''}`);
    }
    const format = [
        'ANSWER with a JSON list only, one object per event:',
        '{ "name": "...",',
        `  "when": { "on": "${sampleDate(calendar)}" } | { "after": "<event name>", "days": 14 } | "any time",`,
        '  "until": "<date>"?,  "where": "anywhere" | ["<region or place from the lists>", ...],',
        `  "news": "<what the narrator is told, up to ${EVENT_LIMITS.cue} characters, in the world's voice>",`,
        '  "once": true,',
        '  "lasting": { "name": "...", "state": "looming|ongoing|resolved", "place": "...", "factions": ["..."], "summary": "...", "keep": false }? }',
        '',
        'RULES:',
        `- ${use.calendar ? 'Use only the month names above' : 'Use the pack\'s own month names'}${use.places ? ', and only the regions and places listed' : ''}. Write every date as in the example.`,
        `- ${calendar.start !== null ? 'Dates are on or after the story start. ' : ''}Instead of "days" an "after" delay may be given in "hours" or "months".`,
        '- An "after" event must name an event in the pack or in your list, and that earlier event needs a "lasting" (a change that stays in the world): the delay counts from when it happens.',
        `- A "lasting" has a name of at most ${LASTING_LIMITS.name} characters, a summary of at most ${LASTING_LIMITS.summary}, and at most ${LASTING_LIMITS.factions} factions. Set "keep" to true for at most two changes the narrator should keep in mind on every reply.`,
        '- Keep each news short and concrete, written as what the narrator is told, never as a plot summary.',
        '- Never explain outside the JSON.',
    ];
    lines.push('', ...format, '', "THE WRITER'S IDEA:");
    const given = [...String(idea ?? '').trim()].slice(0, IDEA_LIMIT).join('');
    lines.push(given || '(The writer has not written an idea yet.)');
    const counts = { regions: facts.regions.length, places: facts.places.length, names: facts.names.length, events: facts.events.length };
    let cut = null;
    let text = lines.join('\n');
    if (use.places && facts.places.length) {
        // The list takes what room is left; a long one drops its sub-places ("Auvoth / Sealcrown") before it stops short.
        const room = PROMPT_LIMIT - text.length - 'PLACES: '.length - 2;
        const fits = list => list.join(', ').length <= room;
        let shown = facts.places;
        if (!fits(shown)) shown = shown.filter(place => !place.includes(' / '));
        if (!fits(shown)) {
            const kept = [];
            let size = 0;
            for (const place of shown) {
                size += place.length + (kept.length ? 2 : 0);
                if (size > room - 3) break;
                kept.push(place);
            }
            shown = kept;
        }
        if (shown.length < facts.places.length) cut = { shown: shown.length, total: facts.places.length };
        text += `\n\nPLACES: ${shown.join(', ')}${cut ? ', …' : ''}`;
    }
    return { text, words: wordsOf(text), characters: text.length, counts, cut };
}

/** "2,140 words". */
export function wordCount(n) {
    return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${n === 1 ? 'word' : 'words'}`;
}

/** The sentence under the prompt that says its place list was cut, or ''. */
export function cutNote(cut) {
    return cut ? `The place list is cut to ${cut.shown} of ${plural(cut.total, 'place')} to keep the prompt short (sub-places go first). The AI may name a place that is not listed; Studio checks every name it reads.` : '';
}
