// The cast, read from a pack (pure): what the list, the form, the player-view preview and the check say. Every limit comes from
// Story Block's own limits (vendor/.../packs/limits.js) and every problem from its checker; nothing is judged here twice.

import { CAST_BUILT_IN_METERS, CAST_LIMITS, METER_LIMITS, PORTRAIT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { slugify } from '../../vendor/story-block/src/v2/packs/validate.js';
import { foldKey } from '../../vendor/story-block/src/text.js';
import { crc32 } from '../../vendor/story-block/src/v2/packs/zip.js';
import { records } from '../records.js';
import { portraitsOf } from '../model.js';
import { kb } from './portrait.js';

export { CAST_LIMITS, METER_LIMITS, PORTRAIT_LIMITS };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const castOf = model => records(model, 'cast').filter(isRecord);

const titleCase = id => String(id).replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase());

// NPC State Delta's own meter presets, besides its four meters (npc-meters-presets.js): a pack may name one in `meters.preset`.
const BUILT_IN = Object.freeze({
    companion: { title: 'Companion', ids: ['loyalty'] },
    rival: { title: 'Rival', ids: ['respect', 'rivalry'] },
    mentor: { title: 'Mentor', ids: ['approval'] },
});
// Delta's own four come first; the rest of Story Block's list are the meters its built-in presets add (a rule may name any of them).
export const DEFAULT_METERS = Object.freeze(CAST_BUILT_IN_METERS.slice(0, 4).map(id => ({ id, name: titleCase(id) })));

/** The meter presets a person can use: the pack's own (`content.meterPresets`), then NPC State Delta's built-in ones. `[{ id, title, meters: [{ id, name }], own }]`. */
export function presetChoices(model) {
    const own = records(model, 'meterPresets').filter(isRecord).filter(p => typeof p.id === 'string').map(p => ({
        id: p.id, title: typeof p.title === 'string' && p.title ? p.title : p.id, own: true,
        meters: (Array.isArray(p.meters) ? p.meters : []).filter(m => isRecord(m) && typeof m.id === 'string').map(m => ({ id: m.id, name: typeof m.name === 'string' && m.name ? m.name : titleCase(m.id) })),
    }));
    const builtIn = Object.entries(BUILT_IN).filter(([id]) => !own.some(p => p.id === id)).map(([id, p]) => ({ id, title: p.title, own: false, meters: p.ids.map(m => ({ id: m, name: titleCase(m) })) }));
    return [...own, ...builtIn];
}

/**
 * The meters a person has: NPC State Delta's four, the chosen preset's, and any other id the entry already uses (so nothing it holds is hidden).
 * `all` adds every meter Story Block's checker accepts in a rule without a preset (the choices for a stage or a secret).
 */
export function metersOf(model, person, all = false) {
    const out = DEFAULT_METERS.map(meter => ({ ...meter }));
    const add = (id, name) => { if (typeof id === 'string' && id && !out.some(meter => meter.id === id)) out.push({ id, name: name ?? titleCase(id) }); };
    if (all) for (const id of CAST_BUILT_IN_METERS) add(id);
    const preset = presetChoices(model).find(choice => choice.id === person.meters?.preset);
    for (const meter of preset?.meters ?? []) add(meter.id, meter.name);
    for (const key of Object.keys(isRecord(person.meters) ? person.meters : {})) if (key !== 'preset') add(key);
    for (const stage of Array.isArray(person.stages) ? person.stages : []) for (const need of Array.isArray(stage?.needs) ? stage.needs : []) add(need?.meter);
    for (const secret of Array.isArray(person.secrets) ? person.secrets : []) add(secret?.meter);
    return out;
}

/** The name a meter goes by for this person ("Trust"), or its id written out. */
export const meterLabel = (model, person, id) => metersOf(model, person, true).find(meter => meter.id === id)?.name ?? titleCase(id);

/** An ID for a new person that no one in the pack has. */
export function freshId(model, base = 'new-person') {
    const taken = new Set(castOf(model).map(person => person.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
}
export const PLACEHOLDER_ID = /^new-person(?:-\d+)?$/;
/** The ID a name would give, or '' when that is taken or empty. */
export function idForName(model, name, own) {
    const slug = slugify(name);
    if (!slug || castOf(model).some(person => person.id === slug && person.id !== own)) return '';
    return slug;
}

/** A new person with the required parts as placeholders to write over, starting at the pack's first place when it has one. */
export function newPerson(model) {
    const place = records(model, 'places').find(p => isRecord(p) && typeof p.name === 'string' && p.name)?.name ?? '[PLACE]';
    return { id: freshId(model), name: 'New person', about: '[ONE LINE ABOUT THEM]', look: '[WHAT THEY LOOK LIKE]', start: { place, goal: '[WHAT THEY WANT]' } };
}

export const placeNames = model => records(model, 'places').filter(isRecord).map(place => place.name).filter(name => typeof name === 'string' && name);
/** True when the text names a place of the pack (by name, alias or slug, ignoring case). */
export function knownPlace(model, text) {
    const key = foldKey(text);
    return records(model, 'places').filter(isRecord).some(place => [place.name, place.slug, ...(Array.isArray(place.aliases) ? place.aliases : [])].some(value => typeof value === 'string' && foldKey(value) === key));
}

/** True when the meter rule is already met by the person's starting value (what Delta opens at once). */
export function opensAtStart(person, secret) {
    if (typeof secret?.meter !== 'string' || !Number.isInteger(secret.at)) return false;
    const given = person.meters?.[secret.meter];
    const start = Number.isInteger(given) ? given : 0;
    return secret.at >= 0 ? start >= secret.at : start <= secret.at;
}

/** The rule of a secret as words: "Opens at Trust 60" or "Opens with the story". */
export function ruleText(model, person, secret) {
    if (typeof secret?.meter === 'string') return `Opens at ${meterLabel(model, person, secret.meter)} ${secret.at}`;
    return 'Opens with the story';
}

/** What the player sees of the secrets after meeting the person: opened ones in full, hidden ones as a bar and the rule (never the event's words). */
export function playerView(model, person) {
    return (Array.isArray(person.secrets) ? person.secrets : []).filter(isRecord).map(secret => (opensAtStart(person, secret)
        ? { open: true, title: secret.title, rule: `Opened · ${meterLabel(model, person, secret.meter)} ${secret.at}`, text: secret.text }
        : { open: false, rule: ruleText(model, person, secret) }));
}

/** The picture held for a person's `portrait` name, or undefined. */
export const pictureOf = (model, person) => (typeof person?.portrait === 'string' ? portraitsOf(model).get(person.portrait) : undefined);

/** The portrait file names some people name, in order, each once. */
export function portraitNames(people) {
    const names = [];
    for (const person of people) if (isRecord(person) && typeof person.portrait === 'string' && !names.includes(person.portrait)) names.push(person.portrait);
    return names;
}
/** The portrait file names the cast names, in cast order, each once. */
export const namedPortraits = model => portraitNames(castOf(model));

/** The files a zip of this pack holds beside pack.json: the pictures the cast names that are held, and the names that have none. */
export function zipPortraits(model) {
    const held = portraitsOf(model);
    const kept = [], missing = [];
    for (const name of namedPortraits(model)) (held.has(name) ? kept : missing).push(name);
    return { files: kept.map(name => ({ name, picture: held.get(name) })), missing, unused: [...held.keys()].filter(name => !kept.includes(name)) };
}

/** What the list card says: [{ text }] chips for secrets, drawn to and portrait size. */
export function cardTags(model, person) {
    const tags = [];
    const secrets = Array.isArray(person.secrets) ? person.secrets.length : 0;
    if (secrets) tags.push(`${secrets} ${secrets === 1 ? 'secret' : 'secrets'}`);
    const drawn = Array.isArray(person.drawnTo) ? person.drawnTo.length : 0;
    if (drawn) tags.push(`drawn to ${drawn}`);
    const picture = pictureOf(model, person);
    if (picture) tags.push(`portrait ${kb(picture.bytes.length)} KB`);
    else if (typeof person.portrait === 'string') tags.push('portrait missing');
    return tags;
}

const dotted = path => String(path ?? '').replace(/\[(\d+)\]/g, '.$1');
/** Story Block's problems under a path (an array of keys), as plain messages. */
export function problemsAt(model, path) {
    const prefix = path.join('.');
    return (model?.validation?.errors ?? []).filter(error => {
        const at = dotted(error.path);
        return at === prefix || at.startsWith(`${prefix}.`);
    }).map(error => error.message).filter(Boolean);
}
/** Story Block's problems about exactly this path (not the paths under it). */
export function problemsExactly(model, path) {
    const at = path.join('.');
    return (model?.validation?.errors ?? []).filter(error => dotted(error.path) === at).map(error => error.message).filter(Boolean);
}
/** The same for the whole person at `index`, every field. */
export const problemsOfPerson = (model, index) => problemsAt(model, ['content', 'cast', index]);

/**
 * The cast lines of the check: `[{ level: 'ok' | 'warn' | 'bad', text }]`. Problems are Story Block's own and are counted from the
 * pack's validation; the warnings are what the checker cannot know (a place nobody can find, a picture that is not held, a thin entry).
 */
export function castCheck(model) {
    const people = castOf(model);
    if (!people.length) return [];
    const lines = [];
    const bad = (model?.validation?.errors ?? []).filter(error => dotted(error.path).startsWith('content.cast'));
    lines.push(bad.length
        ? { level: 'bad', text: `Cast: ${bad.length} ${bad.length === 1 ? 'problem' : 'problems'} in ${people.length} ${people.length === 1 ? 'person' : 'people'} (see Problems).` }
        : { level: 'ok', text: `Cast: ${people.length} ${people.length === 1 ? 'person' : 'people'}, all fields within limits.` });
    const { files, missing, unused } = zipPortraits(model);
    const named = namedPortraits(model);
    if (named.length || files.length) {
        const total = files.reduce((sum, file) => sum + file.picture.bytes.length, 0);
        const big = files.filter(file => file.picture.bytes.length > PORTRAIT_LIMITS.bytes);
        if (named.length > PORTRAIT_LIMITS.perPack) lines.push({ level: 'bad', text: `Portraits: ${named.length} files named; a pack may name at most ${PORTRAIT_LIMITS.perPack}.` });
        else if (big.length) lines.push({ level: 'bad', text: `Portraits: ${big.map(file => file.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over ${kb(PORTRAIT_LIMITS.bytes)} KB.` });
        else if (files.length) lines.push({ level: 'ok', text: `Portraits: ${files.length} ${files.length === 1 ? 'file' : 'files'}, ${kb(total)} KB together (each under ${kb(PORTRAIT_LIMITS.bytes)} KB).` });
        for (const name of missing) {
            const who = people.find(person => person.portrait === name);
            lines.push({ level: 'warn', text: `${who?.name ?? name} names the portrait ${name}, but no picture is held for it: choose the image again, or open the pack as a .zip. The .zip leaves it out.` });
        }
    }
    if (unused.length) lines.push({ level: 'warn', text: `${unused.length === 1 ? 'A picture is' : `${unused.length} pictures are`} held that no one names (${unused.join(', ')}); the .zip leaves ${unused.length === 1 ? 'it' : 'them'} out.` });
    const places = records(model, 'places').length;
    const lost = people.filter(person => typeof person.start?.place === 'string' && person.start.place && places && !knownPlace(model, person.start.place));
    lines.push(!places ? { level: 'warn', text: 'This pack has no places, so no starting place can be checked.' }
        : lost.length ? { level: 'warn', text: `${lost.map(person => `${person.name} starts at "${person.start.place}"`).join('; ')}: not ${lost.length === 1 ? 'a place' : 'places'} of this pack.` }
            : { level: 'ok', text: 'Starting places exist in this pack.' });
    const secrets = people.reduce((sum, person) => sum + (Array.isArray(person.secrets) ? person.secrets.length : 0), 0);
    if (secrets) lines.push({ level: 'ok', text: `Secrets: ${secrets}, each opens at a meter or on a story event.` });
    for (const person of people) if (!person.voice) lines.push({ level: 'warn', text: `${person.name} has no voice written — the narrator will invent one at the first meeting.` });
    return lines;
}

/** Counts shown with the zip: a name and size for each file in the order the zip holds them. */
export function zipListing(model, packBytes, stem) {
    const { files } = zipPortraits(model);
    return { name: `${stem}.zip`, rows: [['pack.json', packBytes], ...files.map(file => [`portraits/${file.name}`, file.picture.bytes.length])] };
}

const prints = new WeakMap();
/** A short text that differs whenever the held pictures do (names, sizes and checksums): what "changed since the last export" compares. */
export function portraitSignature(model) {
    const rows = [];
    for (const [name, picture] of portraitsOf(model)) {
        if (!prints.has(picture)) prints.set(picture, `${picture.bytes.length}:${crc32(picture.bytes)}`);
        rows.push(`${name}:${prints.get(picture)}`);
    }
    return rows.sort().join('|');
}
