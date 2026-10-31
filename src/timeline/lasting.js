// A lasting change: the pack event step that puts a world event into Story Director's chronicle (pure).
//
// The step is `{ command: 'chronicle.lasting', payload }`, and Story Director refuses a payload outside these limits,
// so the pack checker flags one here first (SPEC_TIMELINE section 1).

export const LASTING_COMMAND = 'chronicle.lasting';
export const LASTING_STATES = Object.freeze(['looming', 'ongoing', 'resolved']);
export const LASTING_LIMITS = Object.freeze({ name: 80, summary: 240, place: 80, factions: 4, faction: 80 });

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const long = (value, max) => typeof value !== 'string' || [...value].length > max;

/** The problems of a payload, each `{ field, message }`; none when Story Director accepts it. */
export function checkLasting(payload) {
    if (!isRecord(payload)) return [{ field: '', message: 'The lasting change needs a payload: { "name": …, "state": … }.' }];
    const problems = [];
    const say = (field, message) => problems.push({ field, message });
    if (long(payload.name, LASTING_LIMITS.name) || !payload.name.trim()) say('name', `name must be 1 to ${LASTING_LIMITS.name} characters.`);
    if (!LASTING_STATES.includes(payload.state)) say('state', 'state must be looming, ongoing or resolved.');
    if (payload.summary !== undefined && long(payload.summary, LASTING_LIMITS.summary)) say('summary', `summary must be text of at most ${LASTING_LIMITS.summary} characters.`);
    if (payload.place !== undefined && long(payload.place, LASTING_LIMITS.place)) say('place', `place must be text of at most ${LASTING_LIMITS.place} characters.`);
    if (payload.factions !== undefined) {
        if (!Array.isArray(payload.factions) || payload.factions.length > LASTING_LIMITS.factions) say('factions', `factions must be a list of at most ${LASTING_LIMITS.factions} names.`);
        else if (payload.factions.some(name => long(name, LASTING_LIMITS.faction))) say('factions', `each faction name must be text of at most ${LASTING_LIMITS.faction} characters.`);
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
