// The Names screen: the pack's content.names, a "Never use" list and one card per culture, with the culture editor in the inspector.
//
// A culture is { regions, given }: its regions are case-insensitive substrings of a place's region text, and its given names are
// the first names the narrator may pick there. The shape and limits are Story Block's names rules (the checker is vendored; the
// suggested limits are kept here as the form's own, so the Problems drawer carries the checker's word). Suggestions shown here are a
// preview with a fixed pick, not what the game will choose; the game picks at random among the same names.

import { applyEdit } from '../apply-edit.js';
import { el, button } from '../dom.js';
import { records } from '../records.js';
import { setSchemaField as setField } from '../edits.js';
import { isRecord } from './cast/pieces.js';
import { NAMES_LIMITS as SB_NAMES, SLUG } from '../../vendor/story-block/src/v2/packs/limits.js';

// Story Block's limits (the checker's), under the names this screen uses.
export const NAMES_LIMITS = Object.freeze({ cultures: SB_NAMES.cultures, regions: SB_NAMES.regions, regionChars: SB_NAMES.region, given: SB_NAMES.given, givenChars: SB_NAMES.name, banned: SB_NAMES.banned, bannedChars: SB_NAMES.bannedName });
export const BANNED_CARD = '__banned';
const RESERVED = 'banned';
// The checker keeps one of two names that differ only in case, so a typed list is cut the same way.
const fresh = (typed, have) => {
    const seen = new Set(have.map(lower));
    return typed.split(',').map(item => item.trim()).filter(item => item && !seen.has(lower(item)) && seen.add(lower(item)));
};
const clone = value => JSON.parse(JSON.stringify(value));
const codePoints = text => [...text].length;
const lower = text => String(text ?? '').toLowerCase();

/** The names object as the pack holds it (a copy); an absent or malformed value reads as empty. */
export function namesOf(model) {
    const value = model?.document?.content?.names;
    return isRecord(value) ? clone(value) : {};
}
/** The culture ids in key order: every key but `banned` whose value is an object. */
export function cultureIds(names) {
    return Object.keys(names).filter(key => key !== RESERVED && isRecord(names[key]));
}
/** A culture id is Story Block's slug (lower-case letters and digits, single hyphens between them, up to 64) and not the reserved word. */
export function cultureIdProblem(id, names = {}, current = null) {
    if (typeof id !== 'string' || !id) return 'Give the culture an id';
    if (id === RESERVED) return '“banned” is reserved for the never-use list';
    if (id === 'names') return '“names” is reserved';
    if (!SLUG.test(id)) return 'Use lower-case letters and digits with single hyphens between them (up to 64)';
    if (id !== current && Object.hasOwn(names, id)) return `A culture named “${id}” already exists`;
    return '';
}
/** How many of the pack's places a culture's regions reach: a region is a case-insensitive substring of the place's region text. */
export function placeMatches(model, regions) {
    const wanted = (regions || []).map(lower).filter(Boolean);
    if (!wanted.length) return 0;
    return records(model, 'places').filter(place => {
        const text = lower(place?.region);
        return text && wanted.some(region => text.includes(region));
    }).length;
}
/** The cast's names as the narrator would see them: each full name and every word of it ("Sir Lothar" gives sir and lothar, so a title never hides the given name), case-insensitive. */
export function castNameSet(model) {
    const set = new Set();
    for (const person of records(model, 'cast').filter(isRecord)) {
        const name = String(person.name ?? '').trim();
        if (!name) continue;
        set.add(lower(name));
        for (const word of name.split(/\s+/)) set.add(lower(word));
    }
    return set;
}
/** The given names that are already cast names (still allowed, but never suggested). */
export function castNameOverlap(model, given) {
    const cast = castNameSet(model);
    return (given || []).filter(name => cast.has(lower(name)));
}
/** A never-use entry matches a given name when the two are the same text, ignoring case and spaces at the ends (the preview's rule; the game also reads titles and multi-word names, which this preview does not). */
export function isBanned(banned, name) {
    const target = lower(String(name ?? '').trim());
    return (banned || []).some(entry => {
        const word = lower(String(entry).trim());
        return word !== '' && word === target;
    });
}
/** A stable string hash (FNV-1a) so the preview pick does not change between renders. */
function hash(text) {
    let h = 0x811c9dc5;
    for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
    return h;
}
/**
 * The preview: three given names for a place, chosen by a fixed rule. Banned names and cast names are left out, duplicates
 * are dropped, and the start moves with the place's text so different places show different names.
 */
export function pickSuggestions(model, culture, placeText, count = 3) {
    const banned = namesOf(model).banned || [];
    const cast = castNameSet(model);
    const seen = new Set();
    const pool = (culture?.given || []).filter(name => {
        const key = lower(name);
        if (typeof name !== 'string' || !name.trim() || seen.has(key) || cast.has(key) || isBanned(banned, name)) return false;
        seen.add(key);
        return true;
    });
    if (pool.length <= count) return pool;
    const start = hash(placeText) % pool.length;
    return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
}
/** A culture id as a title: `highmark` reads "Highmark", `river-folk` reads "River folk". */
export function prettyId(id) {
    const text = String(id ?? '').replace(/-+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}
/** The names of the places a culture's regions reach (the first `limit`), for the "Matches" line. */
export function matchedPlaceNames(model, regions, limit = 3) {
    const wanted = (regions || []).map(lower).filter(Boolean);
    return records(model, 'places').filter(place => wanted.some(region => lower(place?.region).includes(region))).map(place => String(place.name ?? '')).filter(Boolean).slice(0, limit);
}
/** The preview picker's options: one per place name, the value being the place's region text; a name listed twice is shown once. */
export function placeOptions(model) {
    const seen = new Set();
    const out = [];
    for (const place of records(model, 'places')) {
        if (typeof place?.region !== 'string' || !place.region.trim()) continue;
        const label = String(place.name ?? '').trim() || place.region;
        if (seen.has(lower(label))) continue;
        seen.add(lower(label));
        out.push({ label, value: place.region });
    }
    return out;
}
/** The checker's messages for one culture (or the never-use list), for the editor to show. */
function namesProblems(model, id) {
    const prefix = `content.names.${id}`;
    return (model?.validation?.errors ?? []).filter(err => {
        const path = String(err.path ?? '').replace(/\[(\d+)\]/g, '.$1');
        return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
    }).map(err => err.message).filter(Boolean);
}

/** The first culture in key order whose region matches the place text (the same rule the game uses). */
export function cultureForPlace(names, placeText) {
    const text = lower(placeText);
    return cultureIds(names).find(id => (names[id].regions || []).some(region => region && text.includes(lower(region)))) ?? null;
}

function writeNames(ctx, next, selection) {
    return applyEdit(ctx, setField(ctx.model, ['content', 'names'], next), selection);
}
/** Replaces a culture under `oldId` with `id` (the key keeps its place in the order) and `value`. */
function rebuild(names, oldId, id, value) {
    const out = {};
    for (const key of Object.keys(names)) {
        if (key === oldId) out[id] = value;
        else out[key] = names[key];
    }
    if (!Object.hasOwn(out, id)) out[id] = value;
    return out;
}
function chip(doc, text, remove, { used = false, label } = {}) {
    const node = el(doc, 'span', '', { class: used ? 'chip used' : 'chip' });
    node.append(el(doc, 'span', text));
    if (remove) node.append(button(doc, '✕', remove, { class: 'x', 'aria-label': label ?? `Remove ${text}` }));
    return node;
}
function addRow(ctx, placeholder, label, onAdd) {
    const row = el(ctx.doc, 'div', '', { class: 'names-add-row' });
    const input = el(ctx.doc, 'input', '', { placeholder, 'aria-label': label, type: 'text' });
    const submit = () => { const value = input.value; input.value = ''; onAdd(value); };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    row.append(input, button(ctx.doc, 'Add', submit));
    return row;
}

/** The "Never use" editor: the banned list as chips, one add box. */
function bannedEditor(ctx, names) {
    const { doc } = ctx;
    const banned = Array.isArray(names.banned) ? names.banned : [];
    const box = el(doc, 'div', '', { class: 'names-editor cf-form' });
    const problems = namesProblems(ctx.model, 'banned');
    box.append(el(doc, 'h2', 'Never use'), el(doc, 'p', 'These names are never chosen for a new person, in any culture. Story Block also merges the names other packs list.', { class: 'muted' }));
    if (problems.length) box.append(el(doc, 'div', problems.join('\n'), { role: 'status', class: 'warning' }));
    const row = el(doc, 'div', '', { class: 'names-chips' });
    banned.forEach((entry, i) => row.append(chip(doc, entry, () => {
        const next = namesOf(ctx.model);
        next.banned = banned.filter((_, j) => j !== i);
        if (!next.banned.length) delete next.banned;
        writeNames(ctx, next);
    })));
    box.append(row);
    box.append(el(doc, 'span', `${banned.length} / ${NAMES_LIMITS.banned}`, { class: 'tl-count' }));
    box.append(addRow(ctx, 'Add names, separated by commas', 'Names never to use', value => {
        const add = fresh(value, banned);
        if (!add.length) return;
        const longest = add.find(name => codePoints(name) > NAMES_LIMITS.bannedChars);
        if (longest) { ctx.notify(`“${longest}” is longer than ${NAMES_LIMITS.bannedChars} characters`); return; }
        if (banned.length + add.length > NAMES_LIMITS.banned) { ctx.notify(`At most ${NAMES_LIMITS.banned} names in the never-use list`); return; }
        const next = namesOf(ctx.model);
        next.banned = [...banned, ...add];
        writeNames(ctx, next);
    }));
    return box;
}

/** The culture editor: id, regions (with the place count), given names, the cast-name warning and a three-name preview. */
function cultureEditor(ctx, id, names) {
    const { doc, model } = ctx;
    const culture = names[id];
    const regions = Array.isArray(culture.regions) ? culture.regions : [];
    const given = Array.isArray(culture.given) ? culture.given : [];
    const box = el(doc, 'div', '', { class: 'names-editor cf-form' });
    const title = el(doc, 'div', '', { class: 'names-title' });
    title.append(el(doc, 'h2', prettyId(id)), button(doc, 'Delete', () => {
        const next = namesOf(model);
        delete next[id];
        writeNames(ctx, next, { kind: 'names', id: null });
    }, { class: 'danger' }));
    box.append(title);
    const problems = namesProblems(model, id);
    if (problems.length) box.append(el(doc, 'div', problems.join('\n'), { role: 'status', class: 'warning' }));
    // Id: changing it keeps the culture's place in the order.
    const idInput = el(doc, 'input', '', { value: id, 'aria-label': 'Culture id', type: 'text' });
    idInput.addEventListener('change', () => {
        const next = idInput.value.trim();
        const problem = cultureIdProblem(next, names, id);
        if (problem) { ctx.notify(problem); idInput.value = id; return; }
        if (next === id) return;
        writeNames(ctx, rebuild(names, id, next, culture), { kind: 'names', id: next });
    });
    box.append(el(doc, 'label', 'Id', { class: 'field' }), idInput);
    // Regions.
    box.append(el(doc, 'span', 'Regions', { class: 'lbl' }));
    const regionRow = el(doc, 'div', '', { class: 'names-chips' });
    regions.forEach((region, i) => regionRow.append(chip(doc, region, () => {
        if (regions.length < 2) { ctx.notify('A culture needs at least one region.'); return; }
        const value = { ...culture, regions: regions.filter((_, j) => j !== i) };
        writeNames(ctx, rebuild(names, id, id, value));
    })));
    box.append(regionRow);
    box.append(addRow(ctx, 'Add a region, e.g. River Confederacy', 'Add region', value => {
        const region = value.trim();
        if (!region) return;
        if (codePoints(region) > NAMES_LIMITS.regionChars) { ctx.notify(`A region is at most ${NAMES_LIMITS.regionChars} characters`); return; }
        if (regions.some(r => lower(r) === lower(region))) return;
        if (regions.length >= NAMES_LIMITS.regions) { ctx.notify(`At most ${NAMES_LIMITS.regions} regions per culture`); return; }
        writeNames(ctx, rebuild(names, id, id, { ...culture, regions: [...regions, region] }));
    }));
    const matched = placeMatches(model, regions);
    const first = matchedPlaceNames(model, regions);
    box.append(el(doc, 'span', `Matches ${matched} places${first.length ? `: ${first.join(', ')}${matched > first.length ? '…' : ''}` : ''}`, { class: 'muted' }));
    // Given names.
    box.append(el(doc, 'span', `Given names · ${given.length} / ${NAMES_LIMITS.given}`, { class: 'lbl' }));
    const overlap = new Set(castNameOverlap(model, given));
    const givenRow = el(doc, 'div', '', { class: 'names-chips' });
    given.forEach((name, i) => givenRow.append(chip(doc, name, () => {
        if (given.length < 2) { ctx.notify('A culture needs at least one given name.'); return; }
        writeNames(ctx, rebuild(names, id, id, { ...culture, given: given.filter((_, j) => j !== i) }));
    }, { used: overlap.has(name) })));
    box.append(givenRow);
    box.append(addRow(ctx, 'Add names, separated by commas', 'Add given names', value => {
        const added = fresh(value, given);
        if (!added.length) return;
        const long = added.find(name => codePoints(name) > NAMES_LIMITS.givenChars);
        if (long) { ctx.notify(`“${long}” is longer than ${NAMES_LIMITS.givenChars} characters`); return; }
        if (given.length + added.length > NAMES_LIMITS.given) { ctx.notify(`At most ${NAMES_LIMITS.given} given names per culture`); return; }
        writeNames(ctx, rebuild(names, id, id, { ...culture, given: [...given, ...added] }));
    }));
    if (overlap.size) box.append(el(doc, 'div', `${[...overlap].join(', ')} ${overlap.size === 1 ? 'is a' : 'are'} cast name${overlap.size === 1 ? '' : 's'}: never suggested.`, { role: 'status', class: 'warning' }));
    box.append(preview(ctx, id, names));
    return box;
}

/** A preview for a chosen place: labelled as a preview, with the fixed pick. */
function preview(ctx, id, names) {
    const { doc, model } = ctx;
    const box = el(doc, 'div', '', { class: 'names-preview' });
    box.append(el(doc, 'span', 'Preview', { class: 'lbl' }));
    const places = placeOptions(model);
    if (!places.length) { box.append(el(doc, 'p', 'No places with a region yet: add one to preview names for it.', { class: 'muted' })); return box; }
    const select = el(doc, 'select', '', { 'aria-label': 'Place for the preview' });
    for (const place of places) select.append(el(doc, 'option', place.label, { value: place.value }));
    const out = el(doc, 'p', '', { class: 'names-preview-out', 'aria-live': 'polite' });
    const show = () => {
        const placeText = select.value;
        const culture = cultureForPlace(names, placeText);
        if (culture !== id) {
            out.textContent = culture ? `${placeText} is in “${culture}”, so this culture is not used there.` : `No culture matches ${placeText}.`;
            return;
        }
        const picks = pickSuggestions(model, names[id], placeText);
        out.textContent = picks.length ? `Suggestions in ${placeText}: ${picks.join(' · ')}` : 'No given names to suggest yet.';
    };
    select.addEventListener('change', show);
    show();
    box.append(select, out);
    return box;
}

/** The Names screen: the never-use card and a card per culture in the list, the selected editor in the inspector. */
export function renderNames(ctx) {
    const { doc, model } = ctx;
    const names = namesOf(model);
    const ids = cultureIds(names);
    const screen = el(doc, 'div', '', { class: 'records-screen names-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    header.append(el(doc, 'h1', 'Names'), el(doc, 'div', `${ids.length} ${ids.length === 1 ? 'culture' : 'cultures'} · first names the narrator picks for new people`, { class: 'records-subtitle' }),
        button(doc, '+ Culture', () => addCulture(ctx, names, ids)));
    screen.append(header);
    const list = el(doc, 'div', '', { class: 'records-list' });
    const banned = Array.isArray(names.banned) ? names.banned : [];
    const bannedCard = button(doc, '', () => ctx.select('names', BANNED_CARD), { class: 'record-card names-card', 'aria-pressed': String(ctx.selection.id === BANNED_CARD), 'data-id': BANNED_CARD });
    bannedCard.append(el(doc, 'span', 'Never use', { class: 'record-card-name' }), el(doc, 'span', banned.length ? `${banned.slice(0, 3).join(', ')}${banned.length > 3 ? ` +${banned.length - 3}` : ''}` : 'Nothing yet', { class: 'record-card-meta' }));
    list.append(bannedCard);
    for (const id of ids) {
        const culture = names[id];
        const card = button(doc, '', () => ctx.select('names', id), { class: 'record-card names-card', 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
        const given = Array.isArray(culture.given) ? culture.given : [];
        const regions = Array.isArray(culture.regions) ? culture.regions : [];
        const head = el(doc, 'span', '', { class: 'record-card-header' });
        head.append(el(doc, 'span', prettyId(id), { class: 'record-card-name' }), el(doc, 'span', `${given.length} names`, { class: 'record-card-meta' }));
        card.append(head, el(doc, 'span', regions.join(', ') || 'no regions', { class: 'record-card-meta' }), el(doc, 'span', `${given.slice(0, 5).join(', ')}${given.length > 5 ? '…' : ''}`, { class: 'names-sample' }));
        list.append(card);
    }
    if (!ids.length) list.append(el(doc, 'p', 'No cultures yet. A culture is a set of first names for one region.', { class: 'muted' }));
    screen.append(list);
    ctx.main.append(screen);
    const inspector = ctx.inspector || screen;
    const back = button(doc, '‹ Back to the list', () => ctx.select('names', null), { class: 'back-to-list' });
    if (ctx.selection.id === BANNED_CARD) { inspector.append(back, bannedEditor(ctx, names)); return; }
    if (ctx.selection.id && ids.includes(ctx.selection.id)) { inspector.append(back, cultureEditor(ctx, ctx.selection.id, names)); return; }
    inspector.append(el(doc, 'p', 'Select a culture or “Never use” to edit it.', { class: 'muted' }));
}

function addCulture(ctx, names, ids) {
    if (ids.length >= NAMES_LIMITS.cultures) { ctx.notify(`At most ${NAMES_LIMITS.cultures} cultures`); return; }
    let n = ids.length + 1;
    let id = `culture-${n}`;
    while (Object.hasOwn(names, id)) id = `culture-${++n}`;
    writeNames(ctx, { ...names, [id]: { regions: ['New region'], given: ['Name'] } }, { kind: 'names', id });
}
