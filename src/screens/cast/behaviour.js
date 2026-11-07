// How a Cast person behaves: personality, levers, mannerisms and how they treat the player.

import { el, button, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { CAST_BEHAVIOUR_LEVELS, CAST_BEHAVIOUR_LEVERS, CAST_LIMITS } from '../../cast/data.js';
import { edit, put, line, group, hint, problemNote, text } from './form.js';

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


export { behaviourFields };
