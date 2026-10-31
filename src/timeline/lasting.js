// A lasting change: the pack event step that puts a world event into Story Director's chronicle (pure).
//
// The step is `{ command: 'chronicle.lasting', payload }`, and Story Director refuses a payload outside these limits,
// so the pack checker flags one here first (SPEC_TIMELINE section 1). A pack with such a step needs Story Director's
// world-event support, which it names under `requires.capabilities`: Story Block then keeps the pack off, and says
// why, where that support is missing.

export const LASTING_COMMAND = 'chronicle.lasting';
export const LASTING_CAPABILITY = 'chronicle-lasting';
export const LASTING_STATES = Object.freeze(['looming', 'ongoing', 'resolved']);
export const LASTING_LIMITS = Object.freeze({ name: 80, summary: 240, place: 80, factions: 4, faction: 80 });
const LASTING_FIELDS = Object.freeze(['name', 'state', 'summary', 'place', 'factions', 'keep']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Story Director trims a text before it counts it, and refuses a name with nothing left once its invisible and
// markdown marks, apostrophes and spaces are gone.
const long = (value, max) => typeof value !== 'string' || [...value.trim()].length > max;
const blank = text => !text.replace(/\p{Cf}+/gu, '').replace(/\*\*|__|[*`]/g, '').replace(/['’‘`]/g, '').trim();

/** The problems of a payload, each `{ field, message }`; none when Story Director accepts it. */
export function checkLasting(payload) {
    if (!isRecord(payload)) return [{ field: '', message: 'The lasting change needs a payload: { "name": …, "state": … }.' }];
    const problems = [];
    const say = (field, message) => problems.push({ field, message });
    for (const key of Object.keys(payload)) if (!LASTING_FIELDS.includes(key)) say(/^[\w-]+$/.test(key) ? key : '', `“${key}” is not part of a lasting change (it has ${LASTING_FIELDS.join(', ')}).`);
    if (long(payload.name, LASTING_LIMITS.name) || blank(payload.name)) say('name', `name must be 1 to ${LASTING_LIMITS.name} characters.`);
    if (!LASTING_STATES.includes(payload.state)) say('state', 'state must be looming, ongoing or resolved.');
    if (payload.summary !== undefined && long(payload.summary, LASTING_LIMITS.summary)) say('summary', `summary must be text of at most ${LASTING_LIMITS.summary} characters.`);
    if (payload.place !== undefined && long(payload.place, LASTING_LIMITS.place)) say('place', `place must be text of at most ${LASTING_LIMITS.place} characters.`);
    if (payload.factions !== undefined) {
        if (!Array.isArray(payload.factions) || payload.factions.length > LASTING_LIMITS.factions) say('factions', `factions must be a list of at most ${LASTING_LIMITS.factions} names.`);
        else if (payload.factions.some(name => long(name, LASTING_LIMITS.faction))) say('factions', `each faction name must be text of at most ${LASTING_LIMITS.faction} characters.`);
        else if (payload.factions.some(blank)) say('factions', 'a faction needs a name.');
    }
    if (payload.keep !== undefined && typeof payload.keep !== 'boolean') say('keep', 'keep must be true or false.');
    return problems;
}

/** The index in `then` of an event's lasting change, or -1. */
export function lastingIndex(record) {
    return Array.isArray(record?.then) ? record.then.findIndex(step => isRecord(step) && step.command === LASTING_COMMAND) : -1;
}

/** The payload of an event's lasting change, or null. */
export function readLasting(record) {
    const at = lastingIndex(record);
    return at < 0 ? null : isRecord(record.then[at].payload) ? record.then[at].payload : {};
}

/** The record with its lasting change set to `payload` (null removes it); its other steps stay as they were. */
export function withLasting(record, payload) {
    const then = Array.isArray(record.then) ? [...record.then] : [];
    const at = lastingIndex(record);
    const next = { ...record };
    if (payload === null) { if (at >= 0) then.splice(at, 1); }
    else if (at >= 0) then[at] = { ...then[at], payload };
    else then.push({ command: LASTING_COMMAND, payload });
    if (then.length) next.then = then; else delete next.then;
    return next;
}

/** The names of the world events the pack's events add to the chronicle (every lasting change, in order). */
export function lastingNames(document) {
    const events = document?.content?.events;
    if (!Array.isArray(events)) return [];
    return events.flatMap(event => (Array.isArray(event?.then) ? event.then : []))
        .filter(step => isRecord(step) && step.command === LASTING_COMMAND && isRecord(step.payload) && typeof step.payload.name === 'string')
        .map(step => step.payload.name);
}

/** Whether any event of the pack has a lasting change. */
export function usesLasting(document) {
    const events = document?.content?.events;
    return Array.isArray(events) && events.some(event => lastingIndex(event) >= 0);
}

/**
 * The pack with `requires.capabilities` saying what its events need: `chronicle-lasting` is listed while an event has a
 * lasting change and dropped when none does. The pack itself when that already holds, so nothing else is touched.
 */
export function withLastingCapability(document) {
    const requires = document?.requires;
    if (!isRecord(requires) || (requires.capabilities !== undefined && !Array.isArray(requires.capabilities))) return document;
    const listed = requires.capabilities ?? [];
    const needed = usesLasting(document);
    if (listed.includes(LASTING_CAPABILITY) === needed) return document;
    const capabilities = needed ? [...listed, LASTING_CAPABILITY] : listed.filter(name => name !== LASTING_CAPABILITY);
    const next = { ...requires };
    if (capabilities.length) next.capabilities = capabilities; else delete next.capabilities;
    return { ...document, requires: next };
}

/** What the pack checker adds to Story Block's answer: one problem for each field of a lasting change that Story Director would refuse. */
export function lastingProblems(document) {
    const events = document?.content?.events;
    const out = [];
    if (!Array.isArray(events)) return out;
    events.forEach((event, index) => {
        if (!isRecord(event) || !Array.isArray(event.then)) return;
        event.then.forEach((step, at) => {
            if (!isRecord(step) || step.command !== LASTING_COMMAND) return;
            for (const { field, message } of checkLasting(isRecord(step.payload) ? step.payload : {})) {
                out.push({ code: 'bad-value', path: `content.events.${index}.then.${at}.payload${field ? `.${field}` : ''}`, message: `Event "${event.id ?? index + 1}": ${message}` });
            }
        });
    });
    return out;
}
