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
    CAST_LIMITS, METER_LIMITS, PORTRAIT_LIMITS, PLACEHOLDER_ID, cardTags, idForName, meterLabel, metersOf, newPerson, pictureOf, placeNames,
    playerView, portraitNames, presetChoices, problemsAt, problemsExactly, problemsOfPerson,
} from '../cast/data.js';

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
    return applyEdit(ctx, extra && result.ok ? extra(result) : result);
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
    const current = keys.reduce((node, key) => (isRecord(node) ? node[key] : undefined), person);
    const path = ['content', 'cast', index, ...keys];
    const control = el(doc, area ? 'textarea' : 'input', '', { 'data-path': JSON.stringify(path) });
    control.value = Array.isArray(current) ? current.join(', ') : safeLabel(current ?? '');
    control.addEventListener('change', () => {
        const value = transform ? transform(control.value) : line(control.value);
        const same = JSON.stringify(value ?? '') === JSON.stringify(current ?? '');
        if (same) { control.value = Array.isArray(current) ? current.join(', ') : safeLabel(current ?? ''); return; }
        if (after && after(value, index) === true) return;
        if (!edit(ctx, index, record => put(record, keys, value))) control.value = safeLabel(current ?? '');
    });
    return wrap(ctx, label, control, { path, note, max, wide });
}

// --- the form --------------------------------------------------------------------------------------------------------

function whoFields(ctx, index, person) {
    const { doc, model } = ctx;
    const names = text(ctx, index, person, ['name'], 'Name', {
        max: CAST_LIMITS.name,
        // A new person's key follows the name until the writer has named them; after that it is theirs to keep.
        after: (value, at) => {
            const id = idForName(model, value, person.id);
            if (!PLACEHOLDER_ID.test(person.id) || !id) return false;
            const moved = renameId(model, 'cast', person.id, id);
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
        text(ctx, index, person, ['look'], 'Look', { area: true, max: CAST_LIMITS.look, wide: true }),
        text(ctx, index, person, ['voice'], 'Voice', { max: CAST_LIMITS.voice, wide: true }),
        text(ctx, index, person, ['personality'], 'Personality', { area: true, max: CAST_LIMITS.personality, wide: true }),
        text(ctx, index, person, ['history'], 'Background', { area: true, max: CAST_LIMITS.history, wide: true }),
    ];
    const key = el(doc, 'input', '', { value: person.id, 'data-path': JSON.stringify(['content', 'cast', index, 'id']) });
    key.addEventListener('change', () => {
        const next = key.value.trim();
        const result = renameId(ctx.model, 'cast', person.id, next);
        if (result.ok) applyEdit(ctx, result, { id: next });
        else { ctx.notify(`${result.errors?.[0]?.code ?? 'bad-id'}: ${result.errors?.[0]?.message ?? 'Use a lowercase key with hyphens.'}`); key.value = person.id; }
    });
    const grid = el(doc, 'div', '', { class: 'cf-grid' });
    grid.append(...body, wrap(ctx, 'Key', key, { note: 'What the story files them under. Change it only before anyone plays this pack.', wide: true }));
    const note = hint(doc, `Hidden from players until they meet ${safeLabel(person.name || 'them')}; then NPC State Delta makes the dossier from this, at once.`);
    return group(doc, 'Who they are', grid, note);
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
        if (file) await choosePortrait(ctx, person.id, file);
    });
    const choose = button(doc, picture || named ? 'Replace image…' : 'Choose image…', () => chooser.click());
    const remove = button(doc, 'Remove', () => removePortrait(ctx, person.id), { class: 'danger' });
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
    const row = el(doc, 'div', '', { class: 'cf-row' });
    list.forEach((phrase, at) => {
        const chip = el(doc, 'span', '', { class: 'cf-chip' });
        chip.append(safeLabel(phrase), button(doc, '✕', () => edit(ctx, index, record => put(record, ['drawnTo'], list.filter((_, n) => n !== at))), { 'aria-label': `Remove ${safeLabel(phrase)}` }));
        row.append(chip);
    });
    const input = el(doc, 'input', '', { placeholder: 'Add…', 'aria-label': 'Add something they are drawn to', 'data-path': JSON.stringify(['content', 'cast', index, 'drawnTo']) });
    input.disabled = list.length >= CAST_LIMITS.drawnTo;
    // Enter and the field losing focus (the form is rebuilt under it) both mean "take this"; once is enough.
    let taken = false;
    const take = () => {
        const phrase = line(input.value);
        if (!phrase || taken) return;
        taken = true;
        edit(ctx, index, record => put(record, ['drawnTo'], [...list, phrase]));
    };
    input.addEventListener('change', take);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); take(); } });
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
        whoFields(ctx, idx, record), portraitFields(ctx, idx, record), startFields(ctx, idx, record), drawnFields(ctx, idx, record),
        relationFields(ctx, idx, record), dieFields(ctx, idx, record), secretFields(ctx, idx, record),
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
