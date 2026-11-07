// Helpers the data-module form sections share: list and object access on the draft, the budget note, the expression context
// and the condition control that every holder of a `when` uses. Each takes the section context S (see sections.js).
import { el, note, checkControl } from '../ui.js';
import { drawExpression } from '../expression.js';
import { limits } from '../../../data-modules/sb-adapter.js';
import { own, isObject } from '../../../data-modules/dm-model.js';

export const keysOf = value => Object.keys(isObject(value) ? value : {});
export const obj = (draft, key) => { if (!isObject(draft[key])) draft[key] = {}; return draft[key]; };
export const arr = (draft, key) => { if (!Array.isArray(draft[key])) draft[key] = []; return draft[key]; };

export function budget(S, label, count, key) {
    const max = limits().values[key];
    return note(S.doc, `${count} ${label}${typeof max === 'number' ? ` · Story Block limit ${max}` : ''}`);
}

export function expressionContext(S, where, owner) { return { module: S.draft, where, owner }; }

export function condition(S, host, holder, key, where, owner) {
    const { doc } = S;
    const present = own(holder, key);
    checkControl(doc, host, `Has a condition (${key})`, present, on => {
        if (on) holder[key] = true;
        else delete holder[key];
        S.redraw();
    });
    if (present) {
        const box = el(doc, 'div', '', { class: 'effect-slot' });
        host.append(box);
        drawExpression(doc, box, holder[key], 'bool', next => { holder[key] = next; S.touch(); }, expressionContext(S, where, owner));
    }
}
