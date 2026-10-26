// Effect list editor: each effect is `op` plus exactly the fields its operation names. Operations a context does not
// allow, and the v1.1 grants, are shown but refused with the fixed v1.1 message rather than hidden.
import { el, button, selectControl, textControl, card, row, note, move } from './ui.js';
import { drawExpression } from './expression.js';
import { EFFECTS, BOUNDS, V11_MESSAGE } from '../../data-modules/hints.js';
import { effectOps, newEffect, syncBindings } from '../../data-modules/forms.js';
import { isObject, list, own, entries } from '../../data-modules/dm-model.js';
import { fieldSchema, typeOfSchema } from '../../data-modules/expr.js';

/** A field path control that offers the declared fields, and a key for maps. */
function pathControl(doc, host, effect, ctx) {
    const draft = ctx.draft;
    const names = Object.keys(isObject(draft.state) ? draft.state : {});
    const [first, second] = list(effect.path);
    const wrap = el(doc, 'div', '', { class: 'expr-path' });
    host.append(wrap);
    selectControl(doc, wrap, 'Field', names, typeof first === 'string' ? first : '', next => {
        const schema = isObject(draft.state?.[next]) ? draft.state[next] : null;
        effect.path = schema?.type === 'map' ? [next, list(schema.keys)[0] ?? ''] : [next];
        ctx.redraw();
    }, { blank: 'choose' });
    const schema = typeof first === 'string' && own(draft.state, first) && isObject(draft.state[first]) ? draft.state[first] : null;
    if (schema?.type === 'map') {
        const keys = list(schema.keys).map(String);
        const exprKey = Array.isArray(second);
        selectControl(doc, wrap, 'Key from', [['key', 'a declared key'], ['expr', 'a line label or binding']], exprKey ? 'expr' : 'key', next => {
            effect.path = [first, next === 'expr' ? [ctx.where === 'template' ? 'bind' : 'arg', ''] : keys[0] ?? ''];
            ctx.redraw();
        });
        if (exprKey) drawExpression(doc, wrap, second, 'any', next => { effect.path = [first, next]; ctx.touch(); }, ctx.expr, 3);
        else selectControl(doc, wrap, 'Key', keys, typeof second === 'string' ? second : '', next => { effect.path = [first, next]; ctx.touch(); }, { blank: 'choose' });
    } else if (list(effect.path).length > 1) wrap.append(note(doc, `Extra path segment kept: ${JSON.stringify(effect.path.slice(1))}`, 'warning'));
    if (typeof first === 'string' && first !== '' && !names.includes(first)) wrap.append(note(doc, `"${first}" is not a declared field.`, 'warning'));
}

function expression(doc, host, title, effect, key, slot, ctx) {
    const holder = el(doc, 'div', '', { class: 'effect-slot' });
    holder.append(el(doc, 'span', title, { class: 'muted' }));
    host.append(holder);
    drawExpression(doc, holder, effect[key], slot, next => { effect[key] = next; ctx.touch(); }, ctx.expr, 2);
}

function effectFields(doc, body, effect, ctx) {
    const draft = ctx.draft;
    const op = effect.op;
    if (['set', 'add', 'clamp'].includes(op)) pathControl(doc, body, effect, ctx);
    if (op === 'set') {
        const expect = typeOfSchema(fieldSchema(draft, effect.path));
        const holder = el(doc, 'div', '', { class: 'effect-slot' });
        holder.append(el(doc, 'span', 'to', { class: 'muted' }));
        body.append(holder);
        drawExpression(doc, holder, effect.value, 'any', next => { effect.value = next; ctx.touch(); }, { ...ctx.expr, expect }, 2);
    }
    if (op === 'add') {
        expression(doc, body, 'amount', effect, 'value', 'int', ctx);
        selectControl(doc, body, 'Bounds', [...BOUNDS], effect.bounds, next => { effect.bounds = next; ctx.touch(); }, { blank: 'reject (default)' });
    }
    if (op === 'clamp') {
        expression(doc, body, 'lowest', effect, 'min', 'int', ctx);
        expression(doc, body, 'highest', effect, 'max', 'int', ctx);
    }
    if (op === 'reward' || op === 'offer') {
        selectControl(doc, body, 'Template', Object.keys(isObject(draft.rewards) ? draft.rewards : {}), typeof effect.template === 'string' ? effect.template : '', next => {
            effect.template = next;
            effect.bind = {};
            syncBindings(effect, draft);
            ctx.redraw();
        }, { blank: 'choose' });
        if (op === 'offer') textControl(doc, body, 'Offer key', effect.key, next => { effect.key = next; ctx.touch(); });
        if (!isObject(effect.bind)) effect.bind = {};
        const declared = isObject(draft.rewards?.[effect.template]?.bindings) ? draft.rewards[effect.template].bindings : {};
        for (const name of Object.keys(declared)) {
            const holder = el(doc, 'div', '', { class: 'effect-slot' });
            holder.append(el(doc, 'span', `binding ${name} is`, { class: 'muted' }));
            body.append(holder);
            drawExpression(doc, holder, effect.bind[name] ?? '', 'any', next => { effect.bind[name] = next; ctx.touch(); }, { ...ctx.expr, expect: typeOfSchema(declared[name]) }, 2);
        }
        for (const [name] of entries(effect.bind)) if (!own(declared, name)) body.append(note(doc, `Binding "${name}" is not declared by the template.`, 'warning'));
    }
    if (op === 'award') textControl(doc, body, 'Offer key to award', effect.offer, next => { effect.offer = next; ctx.touch(); });
}

/**
 * Draws the editable effect list. `ctx` is { draft, where, owner, touch, redraw, expr } where expr is the expression
 * context ({ module, where, owner }).
 */
export function drawEffects(doc, host, effects, ctx) {
    const wrap = el(doc, 'div', '', { class: 'stack effects', 'aria-label': 'Effects' });
    host.append(wrap);
    const allowed = effectOps(ctx.where);
    effects.forEach((effect, index) => {
        const box = card(doc);
        wrap.append(box);
        if (!isObject(effect)) {
            box.append(note(doc, `Effect ${index + 1} is not an object. Remove it, or fix it in the record JSON.`, 'warning'), button(doc, `Remove effect ${index + 1}`, () => { effects.splice(index, 1); ctx.redraw(); }));
            return;
        }
        const spec = own(EFFECTS, effect.op) ? EFFECTS[effect.op] : null;
        const header = row(doc);
        box.append(header);
        const options = [...new Set([...allowed, ...(typeof effect.op === 'string' ? [effect.op] : [])])];
        selectControl(doc, header, `Effect ${index + 1} operation`, options.map(op => [op, own(EFFECTS, op) && EFFECTS[op].v11 ? `${op} (${V11_MESSAGE})` : !allowed.includes(op) ? `${op} (not allowed here)` : op]), effect.op, next => {
            const fresh = newEffect(next, ctx.draft);
            for (const key of Object.keys(effect)) delete effect[key];
            Object.assign(effect, fresh);
            ctx.redraw();
        });
        header.append(button(doc, 'Up', () => { if (move(effects, index, index - 1)) ctx.redraw(); }, { 'aria-label': `Move effect ${index + 1} up` }),
            button(doc, 'Down', () => { if (move(effects, index, index + 1)) ctx.redraw(); }, { 'aria-label': `Move effect ${index + 1} down` }),
            button(doc, 'Remove', () => { effects.splice(index, 1); ctx.redraw(); }, { 'aria-label': `Remove effect ${index + 1}` }));
        if (spec?.v11) { box.append(note(doc, `${effect.op}: ${V11_MESSAGE}`, 'warning')); return; }
        if (!spec) { box.append(note(doc, `Unknown operation "${effect.op}". Choose a listed operation, or fix it in the record JSON.`, 'warning')); return; }
        if (!allowed.includes(effect.op)) box.append(note(doc, `${effect.op} is not allowed in ${ctx.where === 'timer' ? 'a timer (additive changes only)' : `a ${ctx.where}`}.`, 'warning'));
        effectFields(doc, box, effect, ctx);
        const extras = Object.keys(effect).filter(key => key !== 'op' && !spec.fields.includes(key) && !spec.optional.includes(key));
        if (extras.length) box.append(note(doc, `Other fields kept: ${extras.join(', ')}`, 'warning'));
    });
    const adder = row(doc);
    const choice = selectControl(doc, adder, `New effect operation for ${ctx.label ?? 'list'}`, allowed, allowed[0], () => {});
    wrap.append(adder);
    adder.append(button(doc, 'Add effect', () => { effects.push(newEffect(choice.value, ctx.draft)); ctx.redraw(); }, { 'aria-label': `Add effect to ${ctx.label ?? 'list'}` }));
    if (effects.length >= 16) wrap.append(note(doc, `${effects.length} effects; Story Block limits a list (proposed 16).`, 'muted'));
}
