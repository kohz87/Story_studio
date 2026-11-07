// The lasting change an event carries in an answer: each field read as far as it can be, with a note for each field cut or left out.
import { LASTING_LIMITS } from '../lasting.js';
import { clip, size, describe, bounded } from './values.js';

// The payload for the lasting change `raw` asks for, and `cuts`: what was changed on the way, one `{ field, text, ack? }` for each
// field of the lasting change (a field with several texts cut says so once). A text is cut one character past its limit, so one that
// is too long still shows as too long (the check of a lasting change refuses it) and the draft stays small; a text at its limit, or
// one past it that was not cut, is kept whole. An optional field that is there but cannot be read (null, or the wrong kind) is left
// out of the payload and said, so the form can repair the fields one at a time; `name` and `state`, which a lasting change needs,
// are kept as they came for the check to refuse. Only a field that is left out is left at its default.
export function readLastingPayload(raw, fallbackName) {
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
