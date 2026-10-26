// Small control builders for the Data modules forms. Author text only ever reaches the page as an element's
// textContent, a form value or an attribute value; nothing here builds markup from strings.
import { el, button, field, safeLabel } from '../../dom.js';

export { el, button, field, safeLabel };

export const card = (doc, ...children) => { const node = el(doc, 'div', '', { class: 'card stack' }); node.append(...children); return node; };
export const row = (doc, ...children) => { const node = el(doc, 'div', '', { class: 'row' }); node.append(...children); return node; };
export const heading = (doc, text, level = 'h3') => el(doc, level, text);
export const note = (doc, text, cls = 'muted') => el(doc, 'p', text, { class: cls });

const INTEGER = /^-?\d+$/;

/** Reads an integer control: a whole number stays a number; anything else stays text so the checker can say why. */
export function readInt(raw) {
    const text = String(raw).trim();
    return INTEGER.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : text;
}

function labelled(doc, parent, title, control, inline) {
    const wrapper = field(doc, title, control);
    if (inline) wrapper.classList?.add?.('inline');
    parent.append(wrapper);
    return control;
}

export function textControl(doc, parent, title, value, change, { id, multiline = false, placeholder, rows } = {}) {
    const input = el(doc, multiline ? 'textarea' : 'input', '', { 'aria-label': title, ...(id ? { id } : {}), ...(placeholder ? { placeholder } : {}) });
    if (multiline) input.setAttribute('rows', String(rows ?? 3));
    input.value = typeof value === 'string' ? value : value === undefined ? '' : safeLabel(value);
    input.addEventListener('input', () => change(input.value));
    return labelled(doc, parent, title, input);
}

/** Integer control. With `optional`, an empty box omits the key (change receives undefined). */
export function intControl(doc, parent, title, value, change, { optional = false, id } = {}) {
    const input = el(doc, 'input', '', { 'aria-label': title, inputmode: 'numeric', ...(id ? { id } : {}) });
    input.value = value === undefined ? '' : safeLabel(value);
    input.addEventListener('input', () => change(optional && input.value.trim() === '' ? undefined : readInt(input.value)));
    return labelled(doc, parent, title, input);
}

export function selectControl(doc, parent, title, options, value, change, { id, blank } = {}) {
    const input = el(doc, 'select', '', { 'aria-label': title, ...(id ? { id } : {}) });
    const pairs = options.map(option => (Array.isArray(option) ? option : [option, option]));
    if (blank !== undefined) input.append(el(doc, 'option', blank, { value: '' }));
    for (const [key, text] of pairs) input.append(el(doc, 'option', text, { value: key }));
    // A value the list does not offer stays selectable and visibly marked, so a bad draft is never rewritten silently.
    if (value !== undefined && value !== '' && !pairs.some(([key]) => key === value)) input.append(el(doc, 'option', `${safeLabel(value)} (not offered)`, { value: safeLabel(value) }));
    input.value = value === undefined ? (blank !== undefined ? '' : pairs[0]?.[0] ?? '') : safeLabel(value);
    input.addEventListener('change', () => change(input.value));
    return labelled(doc, parent, title, input);
}

export function checkControl(doc, parent, title, checked, change) {
    const input = el(doc, 'input', '', { type: 'checkbox', 'aria-label': title });
    input.checked = checked === true;
    input.addEventListener('change', () => change(input.checked));
    return labelled(doc, parent, title, input);
}

/** A list of short strings edited one per line (enum values, map keys, projections). */
export function linesControl(doc, parent, title, values, change, { id, commit } = {}) {
    const input = el(doc, 'textarea', '', { 'aria-label': title, rows: '3', ...(id ? { id } : {}) });
    input.value = Array.isArray(values) ? values.map(safeLabel).join('\n') : '';
    input.addEventListener('input', () => change(input.value.split('\n').map(line => line.trim()).filter(Boolean)));
    // `commit` runs once the box loses focus, for controls (an enum's default) that depend on the list.
    if (commit) input.addEventListener('change', commit);
    return labelled(doc, parent, title, input);
}

/** Moves item `from` to `to` in place. */
export function move(array, from, to) {
    if (to < 0 || to >= array.length) return false;
    array.splice(to, 0, array.splice(from, 1)[0]);
    return true;
}

/** A name box that commits on change (blur or Enter), so a rename runs once, not per keystroke. */
export function nameControl(doc, parent, title, value, commit) {
    const input = el(doc, 'input', '', { 'aria-label': title });
    input.value = safeLabel(value ?? '');
    input.addEventListener('change', () => commit(input.value));
    return labelled(doc, parent, title, input);
}
