// What Problems says about the Timeline beyond the pack checker's errors (pure): notes that never stop an export.
import { chronicleNames } from './condition.js';
import { LASTING_CAPABILITY, lastingNames, usesLasting } from './lasting.js';

// A name as Story Director finds a world event by it: invisible marks and apostrophes dropped, spaces folded, lowercase.
const keyOf = text => String(text ?? '').replace(/\p{Cf}+/gu, '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The events (by position in the pack) whose condition waits for a world event that no event of the pack adds: `Map` of position to names. */
export function missingWorldEvents(document) {
    const events = document?.content?.events;
    const missing = new Map();
    if (!Array.isArray(events)) return missing;
    const written = new Set(lastingNames(document).map(keyOf));
    events.forEach((event, index) => {
        const names = chronicleNames(event?.when).filter(name => !written.has(keyOf(name)));
        if (names.length) missing.set(index, [...new Set(names)]);
    });
    return missing;
}

/** What the pack's events need and what may never happen: `{ kind: 'info' | 'warning', path, message }` each; `path` is empty for the whole pack. */
export function timelineNotes(document) {
    const notes = [];
    if (usesLasting(document)) {
        const listed = Array.isArray(document?.requires?.capabilities) && document.requires.capabilities.includes(LASTING_CAPABILITY);
        notes.push(listed
            ? { kind: 'info', path: '', message: `Events with a Lasting change need Story Director with world-event support. The pack lists “${LASTING_CAPABILITY}” under requires, so without it the pack will not turn on and Story Block says why.` }
            : { kind: 'warning', path: 'requires.capabilities', message: `Events with a Lasting change need Story Director with world-event support, but the pack does not list “${LASTING_CAPABILITY}” under requires. Change any event and Studio adds it.` });
    }
    const events = document?.content?.events ?? [];
    for (const [index, names] of missingWorldEvents(document)) {
        const id = events[index]?.id ?? index + 1;
        notes.push({ kind: 'warning', path: `content.events.${index}.when`, message: `Event "${id}" waits for ${names.map(name => `“${name}”`).join(', ')}, which no event in this pack adds. It never happens unless the story adds that world event itself.` });
    }
    return notes;
}
