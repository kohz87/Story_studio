// The Cast signature-skill rows: the fields, ordering and checker notes for one skill at a time.

import { el, button, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { SKILL_LIMITS, SKILL_RANKS, SKILL_SLOTS, SKILL_STATS, SKILL_USES, newSkill, rankLabel, skillView, statLabel, usesLabel } from '../../cast/skills.js';
import { isRecord, line, group, hint, problemNote, edit, put, wrap } from './form.js';

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

export { skillFields };
