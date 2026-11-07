// Where a Cast person starts and how the story reaches them: place, routine, goal, draws, meters, stages and death.

import { oneLine } from '../../../vendor/story-block/src/text.js';
import { slugify } from '../../../vendor/story-block/src/v2/packs/validate.js';
import { el, button, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { CAST_LIMITS, METER_LIMITS, placeNames, metersOf, presetChoices } from '../../cast/data.js';
import { isRecord, line, group, hint, problemNote, edit, put, wrap, text, numberInput } from './form.js';

const PLACE_HINT = 'Where and when they can be found. A first meeting happens here.';

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
    // Enter and the field losing focus both mean "take this"; `taking` stops a redraw's blur from taking it twice.
    let taking = false;
    const take = () => {
        const phrase = line(input.value);
        if (!phrase || taking) return;
        taking = true;
        if (edit(ctx, index, record => put(record, ['drawnTo'], [...current(), phrase]))) input.value = '';
        taking = false;
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

export { startFields, drawnFields, relationFields, dieFields };
