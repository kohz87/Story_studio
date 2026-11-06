// The Cast part: the people a pack writes by hand (content.cast), the list and one form per person.
//
// A person is a prepared dossier: who they are, a portrait, where their story starts, what draws them to the party, their
// relationship at the start, whether they may die before they are met, and up to eight secrets. Story Director keeps them off-screen
// until the party meets them; NPC State Delta makes the dossier from this entry at the first meeting. Every limit and message is
// Story Block's (vendor/.../packs/cast.js); the form only shows them where the writer is typing.

import { applyEdit } from '../apply-edit.js';
import { el, button, safeLabel } from '../dom.js';
import { records } from '../records.js';
import { add, setSchemaField as setField, renameId } from '../edits.js';
import { portraitsOf, withPortraits } from '../model.js';
import { openRecordRemoveDialog } from './records.js';
import { oneLine } from '../../vendor/story-block/src/text.js';
import { slugify } from '../../vendor/story-block/src/v2/packs/validate.js';
import { browserIo, fitPortrait, kb, pictureUrl, portraitFileName, sniffImage } from '../cast/portrait.js';
import {
    CAST_BEHAVIOUR_LEVELS, CAST_BEHAVIOUR_LEVERS, CAST_LIMITS, METER_LIMITS, PORTRAIT_LIMITS, PLACEHOLDER_ID, cardTags, idForName, meterLabel, metersOf, newPerson, pictureOf, placeNames,
    playerView, portraitNames, presetChoices, problemsAt, problemsExactly, problemsOfPerson,
} from '../cast/data.js';
import { SKILL_LIMITS, SKILL_RANKS, SKILL_SLOTS, SKILL_STATS, SKILL_USES, newSkill, rankLabel, skillView, statLabel, usesLabel } from '../cast/skills.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const PLACE_HINT = 'Where and when they can be found. A first meeting happens here.';

/** What the Cast keeps between renders: the note under a portrait that was just shrunk, and a picture being shrunk. */
export function castState(ctx) {
    ctx.filters ??= {};
    return ctx.filters.cast ??= { shrunk: new Map(), busy: false };
}

// --- edits -----------------------------------------------------------------------------------------------------------

/** Changes the person at `index` in one step (one undo): `change(copy)` edits a copy of the entry. */
function edit(ctx, index, change, extra) {
    const next = clone(records(ctx.model, 'cast')[index]);
    change(next);
    const result = setField(ctx.model, ['content', 'cast', index], next);
    const preview = ctx.inspector?.querySelector('[data-cf=preview]');
    const saved = applyEdit(ctx, extra && result.ok ? extra(result) : result);
    // A change can defer the form redraw until focus has moved; keep the non-interactive preview current meanwhile.
    if (saved && preview && preview === ctx.inspector.querySelector('[data-cf=preview]')) {
        showPlayerPreview(ctx.doc, ctx.model, records(ctx.model, 'cast')[index], preview);
    }
    return saved;
}

/** Sets or removes (undefined, '') a value at `keys` in a copy of the entry. */
function put(record, keys, value) {
    let node = record;
    for (const key of keys.slice(0, -1)) {
        if (!isRecord(node[key])) node[key] = {};
        node = node[key];
    }
    const last = keys.at(-1);
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete node[last];
    else node[last] = value;
    if (keys.length > 1 && !Object.keys(record[keys[0]] ?? {}).length) delete record[keys[0]];
}

const line = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// --- small pieces ----------------------------------------------------------------------------------------------------

let sequence = 0;
const hintId = () => `cast-hint-${++sequence}`;

/** The problems Story Block reports under `path`, as a message under the control. */
function problemNote(doc, model, path, exact = false) {
    const messages = (exact ? problemsExactly : problemsAt)(model, path);
    if (!messages.length) return null;
    return el(doc, 'p', messages.join('\n'), { class: 'cf-error', role: 'status' });
}

function group(doc, title, ...children) {
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset cf' });
    set.append(el(doc, 'legend', title), ...children);
    return set;
}
const hint = (doc, text, attrs = {}) => el(doc, 'p', text, { class: 'cf-hint', ...attrs });

/** A labelled control with an optional hint, a Story Block problem and a character count under it. */
function wrap(ctx, label, control, { path, note, max, wide = false } = {}) {
    const { doc } = ctx;
    const box = el(doc, 'div', '', { class: `cf-field${wide ? ' wide' : ''}` });
    const labelNode = el(doc, 'label', label, { class: 'field' });
    labelNode.append(control);
    box.append(labelNode);
    if (max) {
        const count = el(doc, 'span', '', { class: 'tl-count' });
        const show = () => { const n = [...control.value].length; count.textContent = `${n} / ${max}`; count.classList.toggle('cf-over', n > max); };
        control.addEventListener('input', show);
        show();
        box.append(count);
    }
    if (note) {
        const id = hintId();
        const text = hint(doc, note, { id });
        control.setAttribute('aria-describedby', id);
        box.append(text);
    }
    const problem = path ? problemNote(doc, ctx.model, path) : null;
    if (problem) { box.append(problem); control.setAttribute('aria-invalid', 'true'); }
    return box;
}

/** A text input or textarea for one value of the entry; the change is saved as one undo step. */
function text(ctx, index, person, keys, label, { area = false, max, note, wide = false, transform, after } = {}) {
    const { doc } = ctx;
    const read = entry => keys.reduce((node, key) => (isRecord(node) ? node[key] : undefined), entry);
    const current = read(person);
    const path = ['content', 'cast', index, ...keys];
    const control = el(doc, area ? 'textarea' : 'input', '', { 'data-path': JSON.stringify(path) });
    control.value = Array.isArray(current) ? current.join(', ') : safeLabel(current ?? '');
    control.addEventListener('change', () => {
        const value = transform ? transform(control.value) : line(control.value);
        const saved = read(records(ctx.model, 'cast')[index]);
        const same = JSON.stringify(value ?? '') === JSON.stringify(saved ?? '');
        if (same) { control.value = Array.isArray(saved) ? saved.join(', ') : safeLabel(saved ?? ''); return; }
        if (after && after(value, index) === true) return;
        if (!edit(ctx, index, record => put(record, keys, value))) control.value = safeLabel(saved ?? '');
    });
    return wrap(ctx, label, control, { path, note, max, wide });
}

// --- the form --------------------------------------------------------------------------------------------------------

function whoFields(ctx, index, person) {
    const { doc } = ctx;
    const names = text(ctx, index, person, ['name'], 'Name', {
        max: CAST_LIMITS.name,
        // A new person's key follows the name until the writer has named them; after that it is theirs to keep.
        after: (value, at) => {
            const current = records(ctx.model, 'cast')[at];
            const id = idForName(ctx.model, value, current.id);
            if (!PLACEHOLDER_ID.test(current.id) || !id) return false;
            const moved = renameId(ctx.model, 'cast', current.id, id);
            if (!moved.ok) return false;
            const named = setField(moved.model, ['content', 'cast', at, 'name'], value);
            if (!named.ok) return false;
            applyEdit(ctx, named, { id });
            return true;
        },
    });
    const aliases = text(ctx, index, person, ['aliases'], 'Also called', {
        note: 'Comma between names.', transform: value => { const list = value.split(',').map(line).filter(Boolean); return list.length ? list : undefined; },
    });
    const body = [
        names, aliases,
        text(ctx, index, person, ['about'], 'In one line', { max: CAST_LIMITS.about, wide: true }),
        text(ctx, index, person, ['look'], 'Look', { area: true, max: CAST_LIMITS.look, wide: true,
            note: 'Build, face, hair, eyes, marks: what stays the same whatever they wear. NPC State Delta shows it as their physical appearance.' }),
        text(ctx, index, person, ['wears'], 'Usually wears', { area: true, max: CAST_LIMITS.wears, wide: true,
            note: 'Clothes, armour and gear they usually have on. NPC State Delta shows it as their current appearance until the story changes it.' }),
        text(ctx, index, person, ['voice'], 'Voice', { max: CAST_LIMITS.voice, wide: true }),
        text(ctx, index, person, ['history'], 'Background', { area: true, max: CAST_LIMITS.history, wide: true }),
    ];
    const key = el(doc, 'input', '', { value: person.id, 'data-path': JSON.stringify(['content', 'cast', index, 'id']) });
    key.addEventListener('change', () => {
        const next = key.value.trim();
        const id = records(ctx.model, 'cast')[index].id;
        const result = renameId(ctx.model, 'cast', id, next);
        if (result.ok) applyEdit(ctx, result, { id: next });
        else { ctx.notify(`${result.errors?.[0]?.code ?? 'bad-id'}: ${result.errors?.[0]?.message ?? 'Use a lowercase key with hyphens.'}`); key.value = id; }
    });
    const grid = el(doc, 'div', '', { class: 'cf-grid' });
    grid.append(...body, wrap(ctx, 'Key', key, { note: 'What the story files them under. Change it only before anyone plays this pack.', wide: true }));
    const note = hint(doc, `Hidden from players until they meet ${safeLabel(person.name || 'them')}; then NPC State Delta makes the dossier from this, at once.`);
    return group(doc, 'Who they are', grid, note);
}

// --- how they behave ---------------------------------------------------------------------------------------------------

const LEVER_HINT = `How they generally respond or decide. Levers: ${CAST_BEHAVIOUR_LEVERS.join(', ')}. Level: low, medium or high.`;

/** One stored line "Lever: level - effect" as three parts; a part that is not one of the known words is left empty so the row still shows. */
function leverParts(value) {
    const match = /^([^:]*?)\s*:\s*([^\s-]+)\s*[-\u2013\u2014]\s*(.*)$/u.exec(line(value));
    if (!match) return { lever: '', level: '', effect: line(value) };
    const lever = CAST_BEHAVIOUR_LEVERS.find(word => word.toLowerCase() === match[1].trim().toLowerCase()) ?? '';
    const level = CAST_BEHAVIOUR_LEVELS.find(word => word === match[2].toLowerCase()) ?? '';
    return { lever, level, effect: match[3].trim() };
}
const leverLine = ({ lever, level, effect }) => `${lever}: ${level} - ${effect}`;

function behaviourBox(ctx, index, person) {
    const { doc } = ctx;
    const stored = Array.isArray(person.behaviour) ? person.behaviour.map(entry => String(entry ?? '')) : [];
    const rows = stored.map(leverParts);
    const base = ['content', 'cast', index, 'behaviour'];
    const current = () => {
        const value = records(ctx.model, 'cast')[index]?.behaviour;
        return Array.isArray(value) ? value.map(entry => String(entry ?? '')) : [];
    };
    const write = list => edit(ctx, index, record => put(record, ['behaviour'], list));
    const box = el(doc, 'div', '', { class: 'cf-field wide cf-levers', 'data-cf': 'behaviour' });
    box.append(el(doc, 'span', 'Behaviour', { class: 'cf-label' }));
    const list = el(doc, 'div', '', { class: 'cf-list-rows' });
    rows.forEach((row, at) => {
        const n = at + 1;
        const lever = el(doc, 'select', '', { 'aria-label': `Lever ${n}`, 'data-path': JSON.stringify([...base, at]) });
        if (!row.lever) lever.append(el(doc, 'option', 'Lever…', { value: '' }));
        for (const word of CAST_BEHAVIOUR_LEVERS) {
            const option = el(doc, 'option', word, { value: word });
            if (rows.some((other, k) => k !== at && other.lever === word)) option.disabled = true;
            lever.append(option);
        }
        lever.value = row.lever;
        const level = el(doc, 'select', '', { 'aria-label': `Level ${n}` });
        if (!row.level) level.append(el(doc, 'option', 'Level…', { value: '' }));
        for (const word of CAST_BEHAVIOUR_LEVELS) level.append(el(doc, 'option', word, { value: word }));
        level.value = row.level;
        const effect = el(doc, 'input', '', { 'aria-label': `Effect ${n}` });
        effect.value = safeLabel(row.effect);
        const save = () => {
            const entries = current();
            const next = { lever: lever.value, level: level.value, effect: line(effect.value) };
            if (leverLine(next) === entries[at] || leverLine(next) === leverLine(leverParts(entries[at]))) return;
            write(entries.map((entry, k) => (k === at ? leverLine(next) : entry)));
        };
        for (const control of [lever, level, effect]) control.addEventListener('change', save);
        const remove = button(doc, '✕', () => write(current().filter((_, k) => k !== at)), { class: 'cf-x', 'aria-label': `Remove lever ${n}` });
        const item = el(doc, 'div', '', { class: 'cf-lever' });
        item.append(lever, level, effect, remove);
        list.append(item);
    });
    box.append(list);
    const addLever = button(doc, '+ Add a lever', () => {
        const entries = current();
        const free = CAST_BEHAVIOUR_LEVERS.find(word => !entries.some(entry => leverParts(entry).lever === word)) ?? CAST_BEHAVIOUR_LEVERS[0];
        write([...entries, leverLine({ lever: free, level: 'medium', effect: '' })]);
    }, { class: 'cf-add' });
    addLever.disabled = stored.length >= CAST_LIMITS.behaviour;
    box.append(addLever);
    box.append(hint(doc, LEVER_HINT));
    const problem = problemNote(doc, ctx.model, base);
    if (problem) box.append(problem);
    return box;
}

function manneristBox(ctx, index, person) {
    const { doc } = ctx;
    const stored = Array.isArray(person.mannerisms) ? person.mannerisms.map(entry => String(entry ?? '')) : [];
    const base = ['content', 'cast', index, 'mannerisms'];
    const current = () => {
        const value = records(ctx.model, 'cast')[index]?.mannerisms;
        return Array.isArray(value) ? value.map(entry => String(entry ?? '')) : [];
    };
    const write = list => edit(ctx, index, record => put(record, ['mannerisms'], list));
    const box = el(doc, 'div', '', { class: 'cf-field wide', 'data-cf': 'mannerisms' });
    box.append(el(doc, 'span', 'Mannerisms', { class: 'cf-label' }));
    const list = el(doc, 'div', '', { class: 'cf-list-rows' });
    stored.forEach((habit, at) => {
        const input = el(doc, 'input', '', { 'aria-label': `Mannerism ${at + 1}`, 'data-path': JSON.stringify([...base, at]) });
        input.value = safeLabel(habit);
        input.addEventListener('change', () => {
            const entries = current();
            const value = line(input.value);
            if (value === entries[at]) { input.value = safeLabel(entries[at]); return; }
            write(entries.map((entry, k) => (k === at ? value : entry)));
        });
        const remove = button(doc, '✕', () => write(current().filter((_, k) => k !== at)), { class: 'cf-x', 'aria-label': `Remove mannerism ${at + 1}` });
        const item = el(doc, 'div', '', { class: 'cf-item' });
        item.append(input, remove);
        list.append(item);
    });
    box.append(list);
    const addHabit = button(doc, '+ Add a mannerism', () => write([...current(), '']), { class: 'cf-add' });
    addHabit.disabled = stored.length >= CAST_LIMITS.mannerisms;
    box.append(addHabit, hint(doc, 'Small recurring habits you would notice in a scene.'));
    const problem = problemNote(doc, ctx.model, base);
    if (problem) box.append(problem);
    return box;
}

function behaviourFields(ctx, index, person) {
    const { doc } = ctx;
    const grid = el(doc, 'div', '', { class: 'cf-grid' });
    grid.append(
        text(ctx, index, person, ['personality'], 'Personality', { area: true, max: CAST_LIMITS.personality, wide: true, note: 'Who they are inside, in a few words.' }),
        behaviourBox(ctx, index, person),
        manneristBox(ctx, index, person),
        text(ctx, index, person, ['withYou'], 'With you', { area: true, max: CAST_LIMITS.withYou, wide: true,
            note: "How they treat the player character. Becomes the dossier's relationship summary at the first meeting; the story keeps it up to date after that." }),
    );
    const set = group(doc, 'How they behave', grid);
    set.setAttribute('data-cf', 'behave');
    return set;
}

function portraitFields(ctx, index, person) {
    const { doc, model } = ctx;
    const ui = castState(ctx);
    const picture = pictureOf(model, person);
    const named = typeof person.portrait === 'string' ? person.portrait : '';
    const face = el(doc, 'div', '', { class: 'cf-face' });
    if (picture) face.append(el(doc, 'img', '', { src: pictureUrl(picture), alt: `${safeLabel(person.name)}'s portrait` }));
    else face.append(el(doc, 'span', safeLabel(person.name || '?').trim().slice(0, 1).toUpperCase() || '?', { class: 'cf-face-empty', 'aria-hidden': 'true' }));

    const chooser = el(doc, 'input', '', { type: 'file', accept: 'image/webp,image/png,image/jpeg', hidden: '', 'aria-label': 'Portrait image', 'data-cast-portrait': 'true' });
    chooser.addEventListener('change', async () => {
        const file = chooser.files?.[0];
        chooser.value = '';
        if (file) await choosePortrait(ctx, records(ctx.model, 'cast')[index]?.id, file);
    });
    const choose = button(doc, picture || named ? 'Replace image…' : 'Choose image…', () => chooser.click());
    const remove = button(doc, 'Remove', () => removePortrait(ctx, records(ctx.model, 'cast')[index]?.id), { class: 'danger' });
    remove.disabled = !named;
    const row = el(doc, 'div', '', { class: 'cf-row' });
    row.append(choose, remove, chooser);

    const facts = el(doc, 'p', '', { class: 'cf-hint', 'data-portrait-facts': 'true' });
    if (picture) {
        facts.append(`${named} · ${picture.width} × ${picture.height} · `, el(doc, 'b', `${kb(picture.bytes.length)} KB`, { class: 'cf-ok' }));
        const shrunk = ui.shrunk.get(named);
        if (shrunk?.picture === picture) facts.append(` (${shrunk.text})`);
        facts.append('. ');
    } else if (named) {
        facts.append(el(doc, 'span', `${named} is named, but no picture is held for it: choose the image again, or open the pack as a .zip.`, { class: 'cf-warn' }), ' ');
    }
    facts.append(`Pictures are made smaller automatically to fit ${kb(PORTRAIT_LIMITS.bytes)} KB; JPEG, PNG or WebP.`);
    const where = hint(doc, `Exported beside the pack in portraits/; shown on their dossier from the first meeting.${ui.busy === person.id ? ' Making it smaller…' : ''}`);
    const side = el(doc, 'div', '', { class: 'cf-stack' });
    side.append(row, facts, where);
    const problem = problemNote(doc, model, ['content', 'cast', index, 'portrait']);
    if (problem) side.append(problem);
    const layout = el(doc, 'div', '', { class: 'cf-portrait' });
    layout.append(face, side);
    const set = group(doc, 'Portrait', layout);
    set.setAttribute('data-cf', 'portrait');
    return set;
}

/** Takes a picked image: makes it fit, then saves the picture and the name in one undo step. */
async function choosePortrait(ctx, id, file) {
    const ui = castState(ctx);
    if (ui.busy) return;
    ui.busy = id;
    ctx.render();
    let fit;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const io = browserIo(ctx.win, bytes);
        try { fit = await fitPortrait(bytes, io); } finally { io.close(); }
        fit.original = sniffImage(bytes);
    } catch (error) {
        ui.busy = false;
        ctx.notify(`portrait: ${safeLabel(error?.message || 'That picture could not be used.')}`);
        ctx.render();
        return;
    }
    ui.busy = false;
    const index = records(ctx.model, 'cast').findIndex(person => isRecord(person) && person.id === id);
    if (index < 0) { ctx.render(); return; }
    const person = records(ctx.model, 'cast')[index];
    const table = new Map(portraitsOf(ctx.model));
    const others = portraitNames(records(ctx.model, 'cast').filter(other => other !== person));
    const reuse = typeof person.portrait === 'string' && person.portrait.toLowerCase().endsWith(fit.type === 'jpg' ? '.jpg' : `.${fit.type}`) && !others.includes(person.portrait);
    const name = reuse ? person.portrait : portraitFileName(person.id, fit.type, new Set([...table.keys(), ...others]));
    if (!others.includes(name) && new Set([...others, name]).size > PORTRAIT_LIMITS.perPack) {
        ctx.notify(`portrait: A pack may name at most ${PORTRAIT_LIMITS.perPack} different portrait files.`);
        ctx.render();
        return;
    }
    const picture = Object.freeze({ bytes: fit.bytes, type: fit.type, width: fit.width, height: fit.height });
    if (typeof person.portrait === 'string' && person.portrait !== name && !others.includes(person.portrait)) table.delete(person.portrait);
    table.set(name, picture);
    const label = fit.changed ? `made smaller from ${fit.from >= 1024 * 1024 ? `${(fit.from / 1024 / 1024).toFixed(1)} MB` : `${kb(fit.from)} KB`} ${String(fit.original ?? 'picture').toUpperCase()}` : 'kept as it was';
    ui.shrunk.set(name, { picture, text: label });
    edit(ctx, index, record => { record.portrait = name; }, result => ({ ...result, model: withPortraits(result.model, table) }));
}

function removePortrait(ctx, id) {
    const index = records(ctx.model, 'cast').findIndex(person => isRecord(person) && person.id === id);
    if (index < 0) return;
    const person = records(ctx.model, 'cast')[index];
    if (typeof person.portrait !== 'string') return;
    const table = new Map(portraitsOf(ctx.model));
    if (!portraitNames(records(ctx.model, 'cast').filter(other => other !== person)).includes(person.portrait)) table.delete(person.portrait);
    edit(ctx, index, record => { delete record.portrait; }, result => ({ ...result, model: withPortraits(result.model, table) }));
}

function startFields(ctx, index, person) {
    const { doc, model } = ctx;
    const places = placeNames(model);
    const path = ['content', 'cast', index, 'start', 'place'];
    let place;
    if (places.length) {
        place = el(doc, 'select', '', { 'data-path': JSON.stringify(path) });
        const current = safeLabel(person.start?.place ?? '');
        const options = places.includes(current) || !current ? places : [current, ...places];
        if (!current) place.append(el(doc, 'option', '(choose a place)', { value: '' }));
        for (const name of options) {
            const option = el(doc, 'option', places.includes(name) ? name : `${name} (not a place of this pack)`, { value: name });
            option.selected = name === current;
            place.append(option);
        }
        place.addEventListener('change', () => { if (place.value) edit(ctx, index, record => put(record, ['start', 'place'], place.value)); });
    } else {
        place = el(doc, 'input', '', { 'data-path': JSON.stringify(path), value: safeLabel(person.start?.place ?? '') });
        place.addEventListener('change', () => edit(ctx, index, record => put(record, ['start', 'place'], line(place.value))));
    }
    const grid = el(doc, 'div', '', { class: 'cf-grid' });
    grid.append(
        wrap(ctx, 'Place', place, { path, note: places.length ? `From this pack’s places (${places.length}).` : 'This pack has no places yet; write the name of one.' }),
        text(ctx, index, person, ['start', 'routine'], 'Routine', { max: CAST_LIMITS.routine, note: PLACE_HINT }),
        text(ctx, index, person, ['start', 'goal'], 'Their goal', { max: CAST_LIMITS.goal, wide: true }),
    );
    return group(doc, 'Where their story starts', grid);
}

function drawnFields(ctx, index, person) {
    const { doc } = ctx;
    const list = Array.isArray(person.drawnTo) ? person.drawnTo : [];
    const current = () => {
        const value = records(ctx.model, 'cast')[index]?.drawnTo;
        return Array.isArray(value) ? value : [];
    };
    const row = el(doc, 'div', '', { class: 'cf-row' });
    list.forEach((phrase, at) => {
        const chip = el(doc, 'span', '', { class: 'cf-chip' });
        chip.append(safeLabel(phrase), button(doc, '✕', () => edit(ctx, index, record => put(record, ['drawnTo'], current().filter((_, n) => n !== at))), { 'aria-label': `Remove ${safeLabel(phrase)}` }));
        row.append(chip);
    });
    const input = el(doc, 'input', '', { placeholder: 'Add…', 'aria-label': 'Add something they are drawn to', 'data-path': JSON.stringify(['content', 'cast', index, 'drawnTo']) });
    input.disabled = list.length >= CAST_LIMITS.drawnTo;
    // Enter and the field losing focus both mean "take this".
    let taken = false;
    const take = () => {
        const phrase = line(input.value);
        if (!phrase || taken) return;
        taken = true;
        if (edit(ctx, index, record => put(record, ['drawnTo'], [...current(), phrase]))) input.value = '';
        taken = false;
    };
    input.addEventListener('change', take);
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault?.();
        if (doc.defaultView?.Event) input.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
        else take();
    });
    row.append(input);
    const set = group(doc, 'Drawn to ', row,
        hint(doc, `When the story touches one of these, they come looking for the party. Up to ${CAST_LIMITS.drawnTo}, each up to ${CAST_LIMITS.phrase} characters.`));
    set.querySelector('legend').append(el(doc, 'small', '(optional)', { class: 'muted' }));
    set.setAttribute('data-cf', 'drawn');
    const problem = problemNote(doc, ctx.model, ['content', 'cast', index, 'drawnTo']);
    if (problem) set.append(problem);
    return set;
}

function numberInput(doc, value, attrs = {}) {
    const input = el(doc, 'input', '', { type: 'number', step: '1', min: METER_LIMITS.min, max: METER_LIMITS.max, ...attrs });
    input.value = value === undefined ? '' : String(value);
    return input;
}

function stageFields(ctx, index, person) {
    const { doc, model } = ctx;
    const meters = metersOf(model, person, true);
    const stages = Array.isArray(person.stages) ? person.stages : [];
    const box = el(doc, 'div', '', { class: 'cf-stack' });
    const save = (at, change) => edit(ctx, index, record => { change(record.stages[at], record); });
    stages.forEach((stage, at) => {
        if (!isRecord(stage)) return;
        const card = el(doc, 'div', '', { class: 'cf-secret', 'data-stage': String(at) });
        const head = el(doc, 'div', '', { class: 'cf-secret-head' });
        head.append(el(doc, 'b', `Stage ${at + 1}`), button(doc, 'Remove', () => edit(ctx, index, record => put(record, ['stages'], record.stages.filter((_, n) => n !== at))), { class: 'danger', 'aria-label': `Remove stage ${at + 1}` }));
        card.append(head);
        const name = el(doc, 'input', '', { 'data-path': JSON.stringify(['content', 'cast', index, 'stages', at, 'name']), value: safeLabel(stage.name ?? '') });
        name.addEventListener('change', () => save(at, (target, record) => {
            target.name = line(name.value);
            const slug = slugify(target.name);
            if (/^stage(?:-\d+)?$/.test(target.id) && slug && !record.stages.some(other => other.id === slug)) target.id = slug;
        }));
        card.append(wrap(ctx, 'Name', name, { path: ['content', 'cast', index, 'stages', at, 'name'] }));
        const needs = Array.isArray(stage.needs) ? stage.needs : [];
        needs.forEach((need, k) => {
            const row = el(doc, 'div', '', { class: 'cf-row' });
            const meter = el(doc, 'select', '', { 'aria-label': `Stage ${at + 1} meter ${k + 1}`, 'data-path': JSON.stringify(['content', 'cast', index, 'stages', at, 'needs', k, 'meter']) });
            const ids = meters.some(m => m.id === need?.meter) ? meters : [...meters, { id: safeLabel(need?.meter), name: safeLabel(need?.meter) }];
            for (const m of ids) { const option = el(doc, 'option', m.name, { value: m.id }); option.selected = m.id === need?.meter; meter.append(option); }
            meter.addEventListener('change', () => save(at, target => { target.needs[k].meter = meter.value; }));
            const level = numberInput(doc, need?.at, { 'aria-label': `Stage ${at + 1} value ${k + 1}`, 'data-path': JSON.stringify(['content', 'cast', index, 'stages', at, 'needs', k, 'at']) });
            level.addEventListener('change', () => {
                const value = Number(level.value);
                if (level.value.trim() === '' || !Number.isInteger(value)) { ctx.notify('bad-value: Enter a whole number'); level.value = safeLabel(need?.at ?? ''); return; }
                save(at, target => { target.needs[k].at = value; });
            });
            const drop = button(doc, '✕', () => save(at, target => { target.needs.splice(k, 1); }), { 'aria-label': `Remove stage ${at + 1} rule ${k + 1}` });
            drop.disabled = needs.length <= 1;
            row.append(el(doc, 'span', k === 0 ? 'Reached when' : 'and'), meter, el(doc, 'span', 'is at'), level, drop);
            card.append(row);
        });
        const more = button(doc, '+ Add rule', () => save(at, target => { target.needs.push({ meter: meters[0].id, at: 20 }); }));
        more.disabled = needs.length >= METER_LIMITS.needs;
        const milestone = el(doc, 'input', '', { 'data-path': JSON.stringify(['content', 'cast', index, 'stages', at, 'milestone']), value: safeLabel(stage.milestone ?? '') });
        milestone.addEventListener('change', () => save(at, target => put(target, ['milestone'], line(milestone.value))));
        card.append(more, wrap(ctx, 'What marks it (optional)', milestone, { max: METER_LIMITS.milestone, path: ['content', 'cast', index, 'stages', at, 'milestone'] }));
        const problem = problemNote(doc, model, ['content', 'cast', index, 'stages', at], true);
        if (problem) card.append(problem);
        box.append(card);
    });
    const addStage = button(doc, '+ Add stage', () => edit(ctx, index, record => {
        const taken = new Set((record.stages ?? []).map(stage => stage?.id));
        let id = 'stage';
        for (let n = 2; taken.has(id); n++) id = `stage-${n}`;
        record.stages = [...(record.stages ?? []), { id, name: 'New stage', needs: [{ meter: meters[0].id, at: 20 }] }];
    }));
    addStage.disabled = stages.length >= METER_LIMITS.stages;
    box.append(addStage);
    return box;
}

function parseFields(value) {
    const out = {};
    for (const row of value.split('\n')) {
        const trimmed = row.trim();
        if (!trimmed) continue;
        const at = trimmed.indexOf(':');
        if (at < 1) return { error: `Write each field as “Name: value” on its own line (this line has no colon: “${trimmed.slice(0, 40)}”).` };
        out[oneLine(trimmed.slice(0, at))] = oneLine(trimmed.slice(at + 1));
    }
    return { value: out };
}

function relationFields(ctx, index, person) {
    const { doc, model } = ctx;
    const presets = presetChoices(model);
    const current = typeof person.meters?.preset === 'string' ? person.meters.preset : '';
    const preset = el(doc, 'select', '', { 'data-path': JSON.stringify(['content', 'cast', index, 'meters', 'preset']) });
    const option = (value, label) => { const node = el(doc, 'option', label, { value }); node.selected = value === current; preset.append(node); };
    option('', `Default (${['Trust', 'Affection', 'Desire', 'Tension'].join(', ')})`);
    for (const choice of presets) option(choice.id, `${choice.title} (${choice.meters.map(meter => meter.name).join(', ') || choice.id})${choice.own ? '' : ' · built in'}`);
    if (current && !presets.some(choice => choice.id === current)) option(current, `${current} (not found)`);
    preset.addEventListener('change', () => edit(ctx, index, record => put(record, ['meters', 'preset'], preset.value)));
    const grid = el(doc, 'div', '', { class: 'cf-grid' });
    grid.append(wrap(ctx, 'Meters', preset, { path: ['content', 'cast', index, 'meters', 'preset'] }));
    for (const meter of metersOf(model, person)) {
        const path = ['content', 'cast', index, 'meters', meter.id];
        const input = numberInput(doc, person.meters?.[meter.id], { 'data-path': JSON.stringify(path), placeholder: 'default' });
        input.addEventListener('change', () => {
            const raw = input.value.trim();
            const value = Number(raw);
            if (raw !== '' && !Number.isInteger(value)) { ctx.notify('bad-value: Enter a whole number'); input.value = safeLabel(person.meters?.[meter.id] ?? ''); return; }
            edit(ctx, index, record => put(record, ['meters', meter.id], raw === '' ? undefined : value));
        });
        grid.append(wrap(ctx, meter.name, input, { path }));
    }
    const fieldsPath = ['content', 'cast', index, 'fields'];
    const fields = el(doc, 'textarea', '', { 'data-path': JSON.stringify(fieldsPath) });
    fields.value = Object.entries(isRecord(person.fields) ? person.fields : {}).map(([key, value]) => `${key}: ${value}`).join('\n');
    fields.addEventListener('change', () => {
        const parsed = parseFields(fields.value);
        if (parsed.error) { ctx.notify(`bad-value: ${parsed.error}`); return; }
        edit(ctx, index, record => put(record, ['fields'], Object.keys(parsed.value).length ? parsed.value : undefined));
    });
    const stagesBox = stageFields(ctx, index, person);
    const wide = el(doc, 'div', '', { class: 'cf-field wide' });
    wide.append(el(doc, 'span', 'Stages', { class: 'cf-label' }), stagesBox, hint(doc, `Up to ${METER_LIMITS.stages}. A stage is reached when every one of its rules holds.`));
    grid.append(wide, wrap(ctx, 'Fields', fields, { path: fieldsPath, wide: true, note: `Your own dossier fields, one per line as “Name: value” (up to ${CAST_LIMITS.fields}) — held while they are away.` }));
    return group(doc, 'Relationship at the start', grid);
}

function dieFields(ctx, index, person) {
    const { doc } = ctx;
    const box = el(doc, 'input', '', { type: 'checkbox', 'data-path': JSON.stringify(['content', 'cast', index, 'canDieUnmet']) });
    box.checked = person.canDieUnmet === true;
    box.addEventListener('change', () => { if (!edit(ctx, index, record => put(record, ['canDieUnmet'], box.checked ? true : undefined))) box.checked = person.canDieUnmet === true; });
    const label = el(doc, 'label', '', { class: 'tl-inline tl-check' });
    label.append(box, ` ${safeLabel(person.name || 'They')} may die off-screen before the party meets them`);
    return group(doc, 'Before they are met', label, hint(doc, 'Off by default, for every player’s setting. Hurt, losing things or moving are always possible.'));
}

function skillCard(ctx, index, skills, at) {
    const { doc, model } = ctx;
    const view = skillView(skills[at]);
    const base = ['content', 'cast', index, 'skills', at];
    // Every change writes the whole row (defaults filled in), so what is saved is what the row shows.
    const save = change => edit(ctx, index, record => {
        const next = { ...record.skills[at], ...skillView(record.skills[at]) };
        change(next);
        record.skills[at] = next;
    });
    const card = el(doc, 'div', '', { class: 'cf-secret', 'data-skill': String(at) });
    const head = el(doc, 'div', '', { class: 'cf-secret-head' });
    const tools = el(doc, 'span', '', { class: 'cf-row' });
    const swap = to => edit(ctx, index, record => { [record.skills[to], record.skills[at]] = [record.skills[at], record.skills[to]]; });
    const up = button(doc, '↑', () => swap(at - 1), { 'aria-label': `Move skill ${at + 1} up` });
    const down = button(doc, '↓', () => swap(at + 1), { 'aria-label': `Move skill ${at + 1} down` });
    up.disabled = at === 0;
    down.disabled = at === skills.length - 1;
    tools.append(up, down, button(doc, 'Remove', () => edit(ctx, index, record => put(record, ['skills'], record.skills.filter((_, n) => n !== at))), { class: 'danger', 'aria-label': `Remove skill ${at + 1}` }));
    head.append(el(doc, 'b', `Skill ${at + 1}`), tools);
    card.append(head);
    const field = (key, label, aria, max) => {
        const control = el(doc, 'input', '', { 'aria-label': `Skill ${at + 1} ${aria}`, 'data-path': JSON.stringify([...base, key]) });
        control.value = safeLabel(view[key]);
        control.addEventListener('change', () => {
            const current = skillView(records(ctx.model, 'cast')[index]?.skills?.[at])[key];
            if (line(control.value) === line(current)) { control.value = safeLabel(current); return; }
            save(target => { target[key] = line(control.value); });
        });
        return wrap(ctx, label, control, { path: [...base, key], max });
    };
    card.append(field('name', 'Name', 'name', SKILL_LIMITS.name), field('about', 'What it does (one line)', 'what it does', SKILL_LIMITS.about));
    const choose = (key, label, values, show) => {
        const control = el(doc, 'select', '', { 'aria-label': `Skill ${at + 1} ${key}`, 'data-path': JSON.stringify([...base, key]) });
        const current = view[key];
        // A value the checker would refuse stays visible, so nothing is hidden from the writer.
        for (const value of values.includes(current) ? values : [current, ...values]) {
            const option = el(doc, 'option', values.includes(value) ? show(value) : `${safeLabel(value) || '(none)'} (not allowed)`, { value });
            option.selected = value === current;
            control.append(option);
        }
        control.addEventListener('change', () => save(target => { target[key] = control.value; }));
        const box = el(doc, 'label', label, { class: 'field' });
        box.append(control);
        return box;
    };
    const row = el(doc, 'div', '', { class: 'cf-row' });
    const uses = el(doc, 'div', 'Uses', { class: 'field', role: 'group', 'aria-label': `Skill ${at + 1} uses` });
    const mode = el(doc, 'span', '', { class: 'cf-seg' });
    for (const value of SKILL_USES) mode.append(button(doc, usesLabel(value), () => { if (view.uses !== value) save(target => { target.uses = value; }); }, { 'aria-pressed': String(view.uses === value) }));
    uses.append(mode);
    row.append(choose('stat', 'Stat', SKILL_STATS, statLabel), choose('rank', 'Rank', SKILL_RANKS, rankLabel), uses);
    card.append(row);
    for (const key of ['stat', 'uses', 'rank']) {
        const problem = problemNote(doc, model, [...base, key]);
        if (problem) card.append(problem);
    }
    // What is wrong with the row as a whole (not an object, a key the checker does not know).
    const whole = problemNote(doc, model, base, true);
    if (whole) card.append(whole);
    const unknown = (model?.validation?.errors ?? []).filter(error => error.code === 'UNKNOWN_FIELD' && String(error.path).startsWith(`content.cast[${index}].skills[${at}].`)).map(error => error.message);
    if (unknown.length) card.append(el(doc, 'p', unknown.join('\n'), { class: 'cf-error', role: 'status' }));
    return card;
}

function skillFields(ctx, index, person) {
    const { doc, model } = ctx;
    const given = Array.isArray(person.skills) ? person.skills : [];
    const set = group(doc, `Signature skills · ${given.length} of ${SKILL_SLOTS}`);
    set.setAttribute('data-cf', 'skills');
    set.append(hint(doc, 'Filled into their skill slots when they join; free slots stay for the story.'));
    given.forEach((skill, at) => { if (isRecord(skill)) set.append(skillCard(ctx, index, given, at)); });
    const addSkill = button(doc, '+ Add skill', () => edit(ctx, index, record => { record.skills = [...(record.skills ?? []), newSkill(record.skills)]; }));
    addSkill.disabled = given.length >= SKILL_SLOTS;
    const row = el(doc, 'div', '', { class: 'cf-row' });
    row.append(addSkill, hint(doc, `Up to ${SKILL_SLOTS}; they count while the RPG is on. A name up to ${SKILL_LIMITS.name} characters, what it does up to ${SKILL_LIMITS.about}.`));
    set.append(row);
    // The list as a whole (too many, none, not a list).
    const whole = problemNote(doc, model, ['content', 'cast', index, 'skills'], true);
    if (whole) set.append(whole);
    return set;
}

function secretCard(ctx, index, person, secret, at, total) {
    const { doc, model } = ctx;
    const meters = metersOf(model, person, true);
    const base = ['content', 'cast', index, 'secrets', at];
    const save = change => edit(ctx, index, record => change(record.secrets[at], record));
    const card = el(doc, 'div', '', { class: 'cf-secret', 'data-secret': String(at) });
    const head = el(doc, 'div', '', { class: 'cf-secret-head' });
    const tools = el(doc, 'span', '', { class: 'cf-row' });
    const up = button(doc, '↑', () => edit(ctx, index, record => { [record.secrets[at - 1], record.secrets[at]] = [record.secrets[at], record.secrets[at - 1]]; }), { 'aria-label': `Move secret ${at + 1} up` });
    const down = button(doc, '↓', () => edit(ctx, index, record => { [record.secrets[at + 1], record.secrets[at]] = [record.secrets[at], record.secrets[at + 1]]; }), { 'aria-label': `Move secret ${at + 1} down` });
    up.disabled = at === 0;
    down.disabled = at === total - 1;
    tools.append(up, down, button(doc, 'Remove', () => edit(ctx, index, record => put(record, ['secrets'], record.secrets.filter((_, n) => n !== at))), { class: 'danger', 'aria-label': `Remove secret ${at + 1}` }));
    head.append(el(doc, 'b', `Secret ${at + 1}`), tools);
    card.append(head);
    const field = (keys, label, options) => {
        const control = el(doc, options.area ? 'textarea' : 'input', '', { 'data-path': JSON.stringify([...base, ...keys]) });
        const value = secret[keys[0]];
        control.value = safeLabel(value ?? '');
        control.addEventListener('change', () => save(target => { target[keys[0]] = line(control.value); }));
        return wrap(ctx, label, control, { path: [...base, ...keys], max: options.max });
    };
    card.append(field(['title'], 'Title (shown once it opens)', { max: CAST_LIMITS.secretTitle }), field(['text'], 'The secret', { area: true, max: CAST_LIMITS.secretText }));
    const byMeter = typeof secret.meter === 'string' || secret.at !== undefined;
    const opens = el(doc, 'div', '', { class: 'cf-row' });
    const mode = el(doc, 'span', '', { class: 'cf-seg', role: 'group', 'aria-label': `Secret ${at + 1} opens` });
    mode.append(
        button(doc, 'at a meter', () => { if (!byMeter) save(target => { delete target.when; target.meter = meters[0].id; target.at = 40; }); }, { 'aria-pressed': String(byMeter) }),
        button(doc, 'on a story event', () => { if (byMeter) save(target => { delete target.meter; delete target.at; target.when = target.when || '[STORY EVENT]'; }); }, { 'aria-pressed': String(!byMeter) }),
    );
    opens.append(el(doc, 'span', 'Opens'), mode);
    if (byMeter) {
        const meter = el(doc, 'select', '', { 'aria-label': `Secret ${at + 1} meter`, 'data-path': JSON.stringify([...base, 'meter']) });
        const ids = meters.some(m => m.id === secret.meter) ? meters : [...meters, { id: safeLabel(secret.meter), name: safeLabel(secret.meter) }];
        for (const m of ids) { const option = el(doc, 'option', m.name, { value: m.id }); option.selected = m.id === secret.meter; meter.append(option); }
        meter.addEventListener('change', () => save(target => { target.meter = meter.value; }));
        const level = numberInput(doc, secret.at, { 'aria-label': `Secret ${at + 1} value`, 'data-path': JSON.stringify([...base, 'at']) });
        level.addEventListener('change', () => {
            const value = Number(level.value);
            if (level.value.trim() === '' || !Number.isInteger(value)) { ctx.notify('bad-value: Enter a whole number'); level.value = safeLabel(secret.at ?? ''); return; }
            save(target => { target.at = value; });
        });
        opens.append(meter, level);
        card.append(opens);
        // A secret may open by its meter or by a story event, whichever comes first: the event is an optional second rule.
        const also = el(doc, 'input', '', { 'aria-label': `Secret ${at + 1} also opens on a story event`, 'data-path': JSON.stringify([...base, 'when']), value: safeLabel(secret.when ?? ''), placeholder: 'the party finds the weir ledger' });
        also.addEventListener('change', () => {
            const value = line(also.value);
            save(target => { if (value) target.when = value; else delete target.when; });
        });
        const hintText = `Opens at ${meterLabel(model, person, secret.meter)} ${safeLabel(secret.at ?? '')} or when this happens, whichever comes first.`;
        const extra = wrap(ctx, '…or also on a story event (optional)', also, { path: [...base, 'when'], max: CAST_LIMITS.secretWhen, note: hintText });
        extra.classList.add('cf-also');
        card.append(extra);
    } else {
        const when = el(doc, 'input', '', { 'aria-label': `Secret ${at + 1} story event`, 'data-path': JSON.stringify([...base, 'when']), value: safeLabel(secret.when ?? ''), placeholder: 'the party finds the weir ledger' });
        when.addEventListener('change', () => save(target => { target.when = line(when.value); }));
        opens.append(when);
        card.append(opens);
    }
    for (const key of byMeter ? ['meter', 'at'] : ['meter', 'at', 'when']) {
        const problem = problemNote(doc, model, [...base, key]);
        if (problem) card.append(problem);
    }
    const whole = problemNote(doc, model, base, true);
    if (whole) card.append(whole);
    return card;
}

function showPlayerPreview(doc, model, person, preview) {
    preview.replaceChildren();
    preview.append(el(doc, 'b', `What the player sees after meeting ${safeLabel(person.name || 'them')}`));
    const view = playerView(model, person);
    if (!view.length) preview.append(hint(doc, 'Nothing yet: add a secret.'));
    view.forEach(item => {
        if (item.open) {
            const open = el(doc, 'div', '', { class: 'cf-open' });
            open.append(el(doc, 'b', safeLabel(item.title)), ' ', el(doc, 'span', item.rule, { class: 'cf-tag' }), el(doc, 'p', safeLabel(item.text), { class: 'cf-hint' }));
            preview.append(open);
        } else {
            preview.append(el(doc, 'span', '', { class: 'cf-bar', 'aria-hidden': 'true' }), hint(doc, item.rule));
        }
    });
}

function secretFields(ctx, index, person) {
    const { doc, model } = ctx;
    const secrets = Array.isArray(person.secrets) ? person.secrets.filter(isRecord) : [];
    const meters = metersOf(model, person, true);
    const set = group(doc, `Secrets · ${secrets.length} of ${CAST_LIMITS.secrets}`);
    set.setAttribute('data-cf', 'secrets');
    secrets.forEach((secret, at) => set.append(secretCard(ctx, index, person, secret, at, secrets.length)));
    const addSecret = button(doc, '+ Add secret', () => edit(ctx, index, record => {
        record.secrets = [...(record.secrets ?? []), { title: 'New secret', text: '[WHAT THEY HIDE]', meter: meters[0].id, at: 40 }];
    }));
    addSecret.disabled = secrets.length >= CAST_LIMITS.secrets;
    const row = el(doc, 'div', '', { class: 'cf-row' });
    row.append(addSecret, hint(doc, 'Light to deep. The narrator knows them all from the first meeting and keeps them; the player sees each one when it opens.'));
    set.append(row);
    const preview = el(doc, 'div', '', { class: 'cf-preview', 'data-cf': 'preview' });
    showPlayerPreview(doc, model, person, preview);
    set.append(preview);
    return set;
}

function renderPerson(ctx, inspector, { record, idx }) {
    const { doc, model } = ctx;
    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(el(doc, 'h2', record.name || record.id), el(doc, 'span', 'Cast', { class: 'chip' }));
    inspector.append(titleRow);
    const problems = problemsOfPerson(model, idx);
    if (problems.length) inspector.append(el(doc, 'div', problems.join('\n'), { role: 'status', class: 'warning' }));
    const form = el(doc, 'div', '', { class: 'inspector-form-body cf-form' });
    form.append(
        whoFields(ctx, idx, record), behaviourFields(ctx, idx, record), portraitFields(ctx, idx, record), startFields(ctx, idx, record), drawnFields(ctx, idx, record),
        relationFields(ctx, idx, record), dieFields(ctx, idx, record), skillFields(ctx, idx, record), secretFields(ctx, idx, record),
    );
    inspector.append(form);
    const remove = button(doc, 'Remove…', () => openRecordRemoveDialog(ctx, 'cast', record, remove), { class: 'danger' });
    inspector.append(remove);
}

function addPerson(ctx) {
    const person = newPerson(ctx.model);
    const result = add(ctx.model, 'cast', person);
    if (applyEdit(ctx, result, { id: person.id })) ctx.select('cast', person.id);
}

/** The Cast screen: the list in the middle, the selected person's form in the inspector. */
export function renderCast(ctx) {
    const { doc, model } = ctx;
    const list = records(model, 'cast').map((record, idx) => ({ record, idx })).filter(({ record }) => isRecord(record));
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    header.append(el(doc, 'h1', 'Cast'), el(doc, 'div', `${list.length} ${list.length === 1 ? 'person' : 'people'} · hidden from players until met`, { class: 'records-subtitle' }),
        button(doc, '+ Add person', () => addPerson(ctx)));
    screen.append(header);
    const cards = el(doc, 'div', '', { class: 'records-list' });
    if (!list.length) cards.append(el(doc, 'p', 'No one in the cast yet. A person starts somewhere with a goal and lives off-screen until the party meets them.', { class: 'muted' }));
    for (const { record, idx } of list) {
        const id = typeof record.id === 'string' ? record.id : '';
        const card = button(doc, '', () => ctx.select('cast', id), { class: 'record-card cast-card', 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
        if (!id) card.disabled = true;
        const picture = pictureOf(model, record);
        card.append(picture ? el(doc, 'img', '', { src: pictureUrl(picture), alt: '' }) : el(doc, 'span', safeLabel(record.name || '?').trim().slice(0, 1).toUpperCase() || '?', { class: 'cast-face', 'aria-hidden': 'true' }));
        const body = el(doc, 'span', '', { class: 'cast-body' });
        const title = el(doc, 'span', '', { class: 'record-card-header' });
        title.append(el(doc, 'span', record.name || id || `Person ${idx + 1}`, { class: 'record-card-name' }));
        const problems = problemsOfPerson(model, idx);
        if (problems.length) { title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' })); card.setAttribute('data-has-problem', 'true'); }
        body.append(title);
        const meta = [id, record.about, record.start?.place ? `starts at ${safeLabel(record.start.place)}` : ''].filter(Boolean).map(safeLabel).join(' · ');
        if (meta) body.append(el(doc, 'span', meta, { class: 'record-card-meta' }));
        const tags = cardTags(model, record);
        if (tags.length) {
            const row = el(doc, 'span', '', { class: 'cc-tags' });
            for (const tag of tags) row.append(el(doc, 'span', tag, { class: 'cc-tag' }));
            body.append(row);
        }
        card.append(body);
        cards.append(card);
    }
    screen.append(cards);
    ctx.main.append(screen);
    const inspector = ctx.inspector || screen;
    const selected = list.find(({ record }) => record.id === ctx.selection.id);
    if (!selected) { inspector.append(el(doc, 'p', 'Select a person from the list to read and edit them.', { class: 'muted' })); return; }
    renderPerson(ctx, inspector, selected);
}
