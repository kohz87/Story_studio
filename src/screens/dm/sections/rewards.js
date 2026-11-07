// The rewards section: reward templates, each with its bindings (the narrator picks), its values (the code picks) and its condition.
import { el, button, selectControl, intControl, nameControl, card, row, note, heading } from '../ui.js';
import { schemaControls } from '../schema.js';
import { drawEffects } from '../effects.js';
import { PICKS } from '../../../data-modules/hints.js';
import { isRangeTable, newRangeTable, makeTarget, uniqueName, newTemplate } from '../../../data-modules/forms.js';
import { entries, own, isObject } from '../../../data-modules/dm-model.js';
import { keysOf, obj, arr, budget, expressionContext, condition } from './shared.js';

function rewardParts(S, box, name, template) {
    const { doc, draft } = S;
    box.append(heading(doc, 'Bindings (the narrator picks)', 'h4'));
    const bindings = obj(template, 'bindings');
    for (const [binding, schema] of entries(bindings)) {
        const part = card(doc);
        nameControl(doc, part, `Binding name (${name}.${binding})`, binding, next => S.rename(makeTarget(S.packId, draft, 'dm.binding', name, binding), next));
        schemaControls(doc, part, schema, S, { labelMode: true });
        part.append(button(doc, 'Remove binding', () => S.remove(makeTarget(S.packId, draft, 'dm.binding', name, binding)), { 'aria-label': `Remove binding ${binding} from ${name}` }));
        box.append(part);
    }
    const addBinding = row(doc);
    const bindingName = el(doc, 'input', '', { 'aria-label': `New binding name for ${name}`, placeholder: 'binding' });
    addBinding.append(bindingName, button(doc, 'Add binding', () => {
        const key = bindingName.value.trim() || uniqueName(Object.keys(bindings), 'binding');
        if (own(bindings, key)) { S.refuse([{ code: 'duplicate', path: `rewards.${name}.bindings.${key}`, message: `Binding "${key}" already exists.` }]); return; }
        bindings[key] = { type: 'enum', values: ['one', 'two'] };
        S.redraw();
    }, { 'aria-label': `Add binding to ${name}` }));
    box.append(addBinding, heading(doc, 'Values (the code picks)', 'h4'));
    const values = obj(template, 'values');
    for (const [value, range] of entries(values)) {
        const part = card(doc);
        part.setAttribute('data-value', value);
        nameControl(doc, part, `Value name (${name}.${value})`, value, next => S.rename(makeTarget(S.packId, draft, 'dm.value', name, value), next));
        const enums = entries(bindings).filter(([, schema]) => schema?.type === 'enum').map(([key]) => key);
        if (isRangeTable(range)) {
            selectControl(doc, part, `${name}.${value} mode`, [['fixed', 'one fixed range'], ['table', 'a range per binding value']], 'table', next => {
                if (next === 'fixed') { values[value] = { min: 1, max: 5, pick: 'midpoint' }; S.redraw(); }
            });
            selectControl(doc, part, `${name}.${value} binding`, enums, typeof range.binding === 'string' ? range.binding : '', next => {
                values[value] = newRangeTable(next, bindings[next], range.table);
                S.redraw();
            }, { blank: 'choose an enum binding' });
            for (const [key, branch] of entries(range.table)) {
                if (!isObject(branch)) { part.append(note(doc, `Branch "${key}" is not an object. Fix it in the record JSON.`, 'warning')); continue; }
                intControl(doc, part, `${name}.${value} ${key} minimum`, branch.min, v => { branch.min = v; S.touch(); });
                intControl(doc, part, `${name}.${value} ${key} maximum`, branch.max, v => { branch.max = v; S.touch(); });
                selectControl(doc, part, `${name}.${value} ${key} picker`, [...PICKS], branch.pick, v => { branch.pick = v; S.touch(); });
            }
            part.append(button(doc, 'Cover every binding value', () => { values[value] = newRangeTable(range.binding, bindings[range.binding], range.table); S.redraw(); }, { 'aria-label': `Cover every value of ${range.binding} in ${name}.${value}` }));
        } else if (isObject(range)) {
            if (enums.length) selectControl(doc, part, `${name}.${value} mode`, [['fixed', 'one fixed range'], ['table', 'a range per binding value']], 'fixed', next => {
                if (next === 'table') { values[value] = newRangeTable(enums[0], bindings[enums[0]]); S.redraw(); }
            });
            intControl(doc, part, `${name}.${value} minimum`, range.min, v => { range.min = v; S.touch(); });
            intControl(doc, part, `${name}.${value} maximum`, range.max, v => { range.max = v; S.touch(); });
            selectControl(doc, part, `${name}.${value} picker`, [...PICKS], range.pick, v => { range.pick = v; S.touch(); });
        } else part.append(note(doc, 'This value is not an object. Fix it in the record JSON.', 'warning'));
        part.append(button(doc, 'Remove value', () => S.remove(makeTarget(S.packId, draft, 'dm.value', name, value)), { 'aria-label': `Remove value ${value} from ${name}` }));
        box.append(part);
    }
    const addValue = row(doc);
    const valueName = el(doc, 'input', '', { 'aria-label': `New value name for ${name}`, placeholder: 'value' });
    addValue.append(valueName, button(doc, 'Add value', () => {
        const key = valueName.value.trim() || uniqueName(Object.keys(values), 'value');
        if (own(values, key)) { S.refuse([{ code: 'duplicate', path: `rewards.${name}.values.${key}`, message: `Value "${key}" already exists.` }]); return; }
        values[key] = { min: 1, max: 5, pick: 'midpoint' };
        S.redraw();
    }, { 'aria-label': `Add value to ${name}` }));
    box.append(addValue, heading(doc, 'Offered only when', 'h4'));
    condition(S, box, template, 'when', 'template', name);
    box.append(heading(doc, 'Effects', 'h4'));
    drawEffects(doc, box, arr(template, 'effects'), { ...S, where: 'template', owner: name, label: `template ${name}`, expr: expressionContext(S, 'template', name) });
}

export function rewards(S, host) {
    const { doc, draft } = S;
    const map = obj(draft, 'rewards');
    host.append(note(doc, 'The narrator picks a template and its bindings; the code picks the numbers from the declared range.'), budget(S, 'reward templates', keysOf(map).length, 'templates'));
    for (const [name, template] of entries(map)) {
        const box = card(doc);
        box.setAttribute('data-template', name);
        box.append(heading(doc, name));
        if (!isObject(template)) { box.append(note(doc, 'This template is not an object. Fix it in the record JSON.', 'warning')); host.append(box); continue; }
        nameControl(doc, box, `Template name (${name})`, name, next => S.rename(makeTarget(S.packId, draft, 'dm.template', name), next));
        rewardParts(S, box, name, template);
        box.append(button(doc, 'Remove template', () => S.remove(makeTarget(S.packId, draft, 'dm.template', name)), { 'aria-label': `Remove template ${name}` }));
        host.append(box);
    }
    const adder = row(doc);
    const name = el(doc, 'input', '', { 'aria-label': 'New template name', placeholder: 'template' });
    adder.append(name, button(doc, 'Add template', () => {
        const key = name.value.trim() || uniqueName(Object.keys(map), 'template');
        if (own(map, key)) { S.refuse([{ code: 'duplicate', path: `rewards.${key}`, message: `Template "${key}" already exists.` }]); return; }
        if (['__proto__', 'constructor', 'prototype'].includes(key)) { S.refuse([{ code: 'bad-edit', path: 'rewards', message: 'That name is not allowed.' }]); return; }
        map[key] = newTemplate();
        S.redraw();
    }));
    host.append(adder);
}
