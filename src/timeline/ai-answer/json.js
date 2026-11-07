// Finds the JSON in a pasted answer: the whole text, a code fence, or each bracketed value around the prose, read in turn.
import { isRecord } from './values.js';

/** The most characters of a pasted answer that are read. */
export const PASTE_LIMIT = 200000;

// The end of the JSON value that starts at `start` (a bracket), or -1: brackets counted outside strings.
export function endOf(source, start) {
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
