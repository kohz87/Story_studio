// The Cast secrets: one card per secret, when it opens, and the player-facing preview.

import { el, button, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { CAST_LIMITS, metersOf, meterLabel } from '../../cast/data.js';
import { isRecord, line, group, hint, problemNote, edit, put, wrap, numberInput } from './form.js';
import { showPlayerPreview } from './preview.js';

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
    showPlayerPreview(doc, model, person, preview);
    set.append(preview);
    return set;
}

export { secretFields };
