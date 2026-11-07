// The ordered lists of the module: rules (run in order after a line's effects) and timers (add to fields once per period of story time).
import { el, button, card, heading, intControl, move, note, row, safeLabel, selectControl, textControl } from '../ui.js';
import { drawExpression } from '../expression.js';
import { drawEffects } from '../effects.js';
import { newRule, newTimer } from '../../../data-modules/forms.js';
import { isObject } from '../../../data-modules/dm-model.js';
import { keysOf, arr, budget, expressionContext } from './shared.js';

export function rules(S, host) {
    const { doc, draft } = S;
    const all = arr(draft, 'rules');
    host.append(note(doc, 'Rules run once, in this order, after a line’s effects. A false rule is skipped; rules never trigger other rules.'), budget(S, 'rules', all.length, 'rules'));
    all.forEach((rule, index) => {
        const box = card(doc);
        box.setAttribute('data-rule', String(rule?.id ?? index));
        if (!isObject(rule)) { box.append(note(doc, 'This rule is not an object. Remove it, or fix it in the record JSON.', 'warning')); host.append(box); return; }
        box.append(heading(doc, `${index + 1}. ${safeLabel(rule.id ?? 'rule')}`));
        textControl(doc, box, `Rule id (${index + 1})`, rule.id, v => { rule.id = v; S.touch(); });
        box.append(heading(doc, 'When', 'h4'));
        const holder = el(doc, 'div', '', { class: 'effect-slot' });
        box.append(holder);
        drawExpression(doc, holder, rule.when, 'bool', next => { rule.when = next; S.touch(); }, expressionContext(S, 'rule', rule.id));
        box.append(heading(doc, 'Then', 'h4'));
        drawEffects(doc, box, arr(rule, 'then'), { ...S, where: 'rule', owner: rule.id, label: `rule ${rule.id ?? index + 1}`, expr: expressionContext(S, 'rule', rule.id) });
        box.append(row(doc, button(doc, 'Up', () => { if (move(all, index, index - 1)) S.redraw(); }, { 'aria-label': `Move rule ${index + 1} up` }),
            button(doc, 'Down', () => { if (move(all, index, index + 1)) S.redraw(); }, { 'aria-label': `Move rule ${index + 1} down` }),
            button(doc, 'Remove rule', () => { all.splice(index, 1); S.redraw(); }, { 'aria-label': `Remove rule ${index + 1}` })));
        host.append(box);
    });
    host.append(button(doc, 'Add rule', () => { all.push(newRule(draft)); S.redraw(); }));
}

export function timers(S, host) {
    const { doc, draft } = S;
    const all = arr(draft, 'timers');
    host.append(note(doc, 'A timer adds to fields once per whole period of story time on an imported clock. Effects are additive only.'), budget(S, 'timers', all.length, 'timers'));
    all.forEach((timer, index) => {
        const box = card(doc);
        box.setAttribute('data-timer', String(timer?.id ?? index));
        if (!isObject(timer)) { box.append(note(doc, 'This timer is not an object. Remove it, or fix it in the record JSON.', 'warning')); host.append(box); return; }
        box.append(heading(doc, `${index + 1}. ${safeLabel(timer.id ?? 'timer')}`));
        textControl(doc, box, `Timer id (${index + 1})`, timer.id, v => { timer.id = v; S.touch(); });
        selectControl(doc, box, `Clock for timer ${index + 1}`, keysOf(draft.imports), typeof timer.clock === 'string' ? timer.clock : '', v => { timer.clock = v; S.touch(); }, { blank: 'choose an import' });
        if (!keysOf(draft.imports).length) box.append(note(doc, 'Add a Story Director minutes import first.', 'warning'));
        intControl(doc, box, `Every (minutes) for timer ${index + 1}`, timer.every, v => { timer.every = v; S.touch(); });
        box.append(heading(doc, 'Each period', 'h4'));
        drawEffects(doc, box, arr(timer, 'effects'), { ...S, where: 'timer', owner: timer.id, label: `timer ${timer.id ?? index + 1}`, expr: expressionContext(S, 'timer', timer.id) });
        box.append(row(doc, button(doc, 'Up', () => { if (move(all, index, index - 1)) S.redraw(); }, { 'aria-label': `Move timer ${index + 1} up` }),
            button(doc, 'Down', () => { if (move(all, index, index + 1)) S.redraw(); }, { 'aria-label': `Move timer ${index + 1} down` }),
            button(doc, 'Remove timer', () => { all.splice(index, 1); S.redraw(); }, { 'aria-label': `Remove timer ${index + 1}` })));
        host.append(box);
    });
    host.append(button(doc, 'Add timer', () => { all.push(newTimer(draft)); S.redraw(); }));
}
