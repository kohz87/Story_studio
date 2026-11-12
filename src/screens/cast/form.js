// Shared Cast edit and control helpers: one-undo edits, nested value writes and labelled fields.
//
// The field groups import these; castState remains the screen state the portrait fields keep.

import { applyEdit } from '../../apply-edit.js';
import { el, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { setSchemaField as setField } from '../../edits.js';
import { METER_LIMITS } from '../../cast/data.js';
import { isRecord, line, hint, hintId, problemNote } from './pieces.js';
import { showPlayerPreview } from './preview.js';

const clone = value => JSON.parse(JSON.stringify(value));
/** What the Cast keeps between renders: the note under a portrait that was just shrunk, and a picture being shrunk. */
export function castState(ctx) {
    ctx.filters ??= {};
    return ctx.filters.cast ??= { shrunk: new Map(), busy: false };
}
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
function text(ctx, index, person, keys, label, { area = false, max, note, wide = false, transform, after, suggest } = {}) {
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
    const box = wrap(ctx, label, control, { path, note, max, wide });
    // Suggestions (not limits): a datalist the writer may follow or ignore.
    if (suggest?.length) {
        const options = el(doc, 'datalist', '', { id: `cf-suggest-${path.join('-')}` });
        for (const word of suggest) options.append(el(doc, 'option', '', { value: word }));
        control.setAttribute('list', options.id);
        box.append(options);
    }
    return box;
}
function numberInput(doc, value, attrs = {}) {
    const input = el(doc, 'input', '', { type: 'number', step: '1', min: METER_LIMITS.min, max: METER_LIMITS.max, ...attrs });
    input.value = value === undefined ? '' : String(value);
    return input;
}

export { isRecord, line, group, hint, problemNote } from './pieces.js';
export { edit, put, wrap, text, numberInput };
