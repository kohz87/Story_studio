// The kinds section: each kind of line the narrator can write, with its labels, its condition and its effects.
import { el, button, selectControl, textControl, checkControl, nameControl, card, row, note, heading } from '../ui.js';
import { schemaControls } from '../schema.js';
import { drawEffects } from '../effects.js';
import { LINE_OPS, V11_MESSAGE } from '../../../data-modules/hints.js';
import { makeTarget, newKind, newLabel, uniqueName } from '../../../data-modules/forms.js';
import { entries, list, own, isObject, renameKey } from '../../../data-modules/dm-model.js';
import { keysOf, obj, arr, budget, expressionContext, condition } from './shared.js';

function labelControls(S, host, kindName, kind) {
    const { doc, draft } = S;
    const labels = obj(kind, 'labels');
    host.append(heading(doc, 'Line labels', 'h4'));
    for (const [name, schema] of entries(labels)) {
        const box = card(doc);
        box.setAttribute('data-label', name);
        nameControl(doc, box, `Label name (${kindName}.${name})`, name, next => S.rename(makeTarget(S.packId, draft, 'dm.label', kindName, name), next));
        schemaControls(doc, box, schema, S, { labelMode: true });
        box.append(button(doc, 'Remove label', () => S.remove(makeTarget(S.packId, draft, 'dm.label', kindName, name)), { 'aria-label': `Remove label ${name} from ${kindName}` }));
        host.append(box);
    }
    const adder = row(doc);
    const name = el(doc, 'input', '', { 'aria-label': `New label name for ${kindName}`, placeholder: 'label' });
    adder.append(name, button(doc, 'Add label', () => {
        const key = name.value.trim() || uniqueName(Object.keys(labels), 'label');
        if (own(labels, key)) { S.refuse([{ code: 'duplicate', path: `kinds.${kindName}.labels.${key}`, message: `Label "${key}" already exists.` }]); return; }
        labels[key] = newLabel('int');
        S.redraw();
    }, { 'aria-label': `Add label to ${kindName}` }));
    host.append(adder);
    const enums = entries(labels).filter(([, schema]) => schema?.type === 'enum').map(([key]) => key);
    if (enums.length) {
        host.append(heading(doc, 'Once per reply, for each', 'h4'));
        const chosen = list(kind.oncePerReply);
        for (const key of enums) {
            checkControl(doc, host, `${kindName}: once per reply for each ${key}`, chosen.includes(key), on => {
                kind.oncePerReply = enums.filter(item => (item === key ? on : list(kind.oncePerReply).includes(item)));
                S.touch();
            });
        }
        host.append(note(doc, 'With none chosen, a kind applies once per subject per reply.'));
    }
}

export function kinds(S, host) {
    const { doc, draft } = S;
    const map = obj(draft, 'kinds');
    host.append(note(doc, 'Each kind is one line the narrator can write. Lines use the shared change-line grammar; checks are not in v1.'), budget(S, 'kinds', keysOf(map).length, 'kinds'));
    for (const [name, kind] of entries(map)) {
        const box = card(doc);
        box.setAttribute('data-kind', name);
        box.append(heading(doc, name));
        if (!isObject(kind)) { box.append(note(doc, 'This kind is not an object. Fix it in the record JSON.', 'warning')); host.append(box); continue; }
        nameControl(doc, box, `Kind name (${name})`, name, next => {
            if (!next.trim() || own(map, next)) { S.refuse([{ code: 'duplicate', path: `kinds.${next}`, message: `Kind "${next}" cannot be used.` }]); S.redraw(); return; }
            if (['__proto__', 'constructor', 'prototype'].includes(next)) { S.refuse([{ code: 'bad-edit', path: 'kinds', message: 'That name is not allowed.' }]); S.redraw(); return; }
            draft.kinds = renameKey(map, name, next);
            S.redraw();
        });
        selectControl(doc, box, `Line operator for ${name}`, [...LINE_OPS], kind.op, v => { kind.op = v; S.touch(); });
        checkControl(doc, box, `${name} may be used from a screen (ui)`, kind.ui === true, on => { if (on) kind.ui = true; else delete kind.ui; S.touch(); });
        if (own(kind, 'check')) {
            box.append(note(doc, `check: ${V11_MESSAGE}`, 'warning'), button(doc, 'Remove check', () => { delete kind.check; S.redraw(); }, { 'aria-label': `Remove check from ${name}` }));
        }
        labelControls(S, box, name, kind);
        box.append(heading(doc, 'Applies only when', 'h4'));
        condition(S, box, kind, 'when', 'kind', name);
        if (own(kind, 'when')) {
            textControl(doc, box, `Refusal text for ${name}`, kind.refusal, v => { if (v === '') delete kind.refusal; else kind.refusal = v; S.touch(); }, { placeholder: 'shown when the condition is false' });
        }
        box.append(heading(doc, 'Effects', 'h4'));
        drawEffects(doc, box, arr(kind, 'effects'), { ...S, where: 'kind', owner: name, label: `kind ${name}`, expr: expressionContext(S, 'kind', name) });
        box.append(button(doc, 'Remove kind', () => { delete map[name]; S.redraw(); }, { 'aria-label': `Remove kind ${name}` }));
        host.append(box);
    }
    const adder = row(doc);
    const name = el(doc, 'input', '', { 'aria-label': 'New kind name', placeholder: 'kind' });
    adder.append(name, button(doc, 'Add kind', () => {
        const key = name.value.trim() || uniqueName(Object.keys(map), 'kind');
        if (own(map, key)) { S.refuse([{ code: 'duplicate', path: `kinds.${key}`, message: `Kind "${key}" already exists.` }]); return; }
        if (['__proto__', 'constructor', 'prototype'].includes(key)) { S.refuse([{ code: 'bad-edit', path: 'kinds', message: 'That name is not allowed.' }]); return; }
        map[key] = newKind();
        S.redraw();
    }));
    host.append(adder);
}
