import { DRAWINGS } from './assets/drawings.js';

export function el(doc, tag, text = '', attrs = {}) {
    const node = doc.createElement(tag);
    if (text !== '') node.textContent = String(text);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
}
export function button(doc, text, action, attrs = {}) {
    const node = el(doc, 'button', text, { type: 'button', ...attrs });
    node.addEventListener('click', action);
    return node;
}
export function field(doc, title, control) {
    const label = el(doc, 'label', title, { class: 'field' });
    label.append(control);
    return label;
}
export function icon(doc, name) {
    function draw([tag, attrs, children]) {
        const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        for (const child of children) node.append(draw(child));
        return node;
    }
    const node = draw(DRAWINGS[name] || DRAWINGS['kind-more']);
    node.setAttribute('class', 'icon');
    node.setAttribute('focusable', 'false');
    return node;
}
