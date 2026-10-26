// The expression editor: one structured picker per operator with fixed arity and typed slots, so an author never
// types an expression as text. Whatever the record holds is shown as is (an unknown operator, a wrong-arity array
// or a value that is no expression appears with a note); nothing is silently fixed or dropped.
import { el, selectControl, textControl, intControl, note } from './ui.js';
import { OPERATORS, V11_MESSAGE } from '../../data-modules/hints.js';
import { isExpression, own, list, isObject } from '../../data-modules/dm-model.js';
import { OPERATOR_GROUPS, operatorsFor, changeOperator, defaultExpression, typeOfExpression, measure } from '../../data-modules/expr.js';

const LITERAL = '';
const literalKind = value => (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? 'text' : 'other');

/**
 * Draws an editable expression into `host`. `slot` is the slot type (int, bool, any, positiveInt); `change(next)`
 * receives the whole replacement. `context` is { module, where, owner, expect? } so label, binding, value and alias
 * pickers list the names the record really declares.
 */
export function drawExpression(doc, host, initial, slot, change, context, depth = 1) {
    const box = el(doc, 'div', '', { class: 'expr', 'data-expr-depth': String(depth) });
    host.append(box);
    let value = initial;
    const commit = next => { value = next; change(next); };
    const render = () => { box.replaceChildren(); fill(doc, box, value, slot, commit, context, depth, render); };
    render();
    return box;
}

function operatorSelect(doc, box, value, slot, context, replace) {
    const current = isExpression(value) ? value[0] : LITERAL;
    const select = el(doc, 'select', '', { 'aria-label': 'Operator' });
    select.append(el(doc, 'option', slot === 'bool' ? 'true/false' : 'literal', { value: LITERAL }));
    const offered = new Set(operatorsFor(slot, context));
    for (const group of OPERATOR_GROUPS) {
        const names = Object.keys(OPERATORS).filter(name => OPERATORS[name].group === group && !OPERATORS[name].v11 && (offered.has(name) || name === current));
        if (!names.length) continue;
        const optgroup = el(doc, 'optgroup', '', { label: group });
        for (const name of names) optgroup.append(el(doc, 'option', name, { value: name }));
        select.append(optgroup);
    }
    const refused = el(doc, 'optgroup', '', { label: 'Not in v1' });
    for (const name of Object.keys(OPERATORS).filter(key => OPERATORS[key].v11)) {
        const option = el(doc, 'option', `${name} (${V11_MESSAGE})`, { value: name });
        if (name !== current) option.setAttribute('disabled', '');
        refused.append(option);
    }
    select.append(refused);
    if (current !== LITERAL && !own(OPERATORS, current)) select.append(el(doc, 'option', `${current} (unknown)`, { value: current }));
    select.value = current;
    select.addEventListener('change', () => {
        const next = select.value;
        replace(next === LITERAL ? (slot === 'bool' ? true : defaultExpression(slot, context.module)) : changeOperator(value, next, context.module));
    });
    box.append(select);
}

function fill(doc, box, value, slot, commit, context, depth, render) {
    const replace = next => { commit(next); render(); };
    operatorSelect(doc, box, value, slot, context, replace);
    if (!isExpression(value)) { literalEditor(doc, box, value, slot, commit, context, replace); return; }
    const name = value[0];
    const spec = own(OPERATORS, name) ? OPERATORS[name] : null;
    if (!spec) { box.append(note(doc, `Unknown operator "${name}". Choose another operator, or fix it in the record JSON.`, 'warning')); return; }
    if (spec.v11) { box.append(note(doc, `${name}: ${V11_MESSAGE}`, 'warning')); return; }
    if (value.length - 1 !== spec.slots.length) {
        box.append(note(doc, `${name} takes ${spec.slots.length} argument${spec.slots.length === 1 ? '' : 's'}; this has ${value.length - 1}. Choose the operator again to reset its arguments.`, 'warning'));
    }
    const slots = el(doc, 'div', '', { class: 'expr-slots' });
    box.append(slots);
    spec.slots.forEach((type, index) => {
        const holder = el(doc, 'div', '', { class: 'expr-slot', 'data-slot': type });
        slots.append(holder);
        holder.append(el(doc, 'span', slotLabel(name, index, type), { class: 'muted expr-slot-label' }));
        const set = next => { value[index + 1] = next; commit(value); };
        const expect = ['eq', 'ne'].includes(name) ? typeOfExpression(value[index === 0 ? 2 : 1], context) : null;
        namedSlot(doc, holder, type, value[index + 1], set, { ...context, expect }, value, depth, render);
    });
    if (depth === 1 && value.length > 1) {
        const size = measure(value);
        box.append(el(doc, 'small', `${size.nodes} nodes · depth ${size.depth}`, { class: 'muted' }));
    }
}

function slotLabel(name, index, type) {
    if (['and', 'or'].includes(name)) return index === 0 ? 'left' : 'right';
    if (name === 'floorDiv') return index === 0 ? 'number' : 'divide by (positive whole number)';
    if (name === 'clamp') return ['number', 'lowest', 'highest'][index];
    if (['lt', 'le', 'gt', 'ge', 'eq', 'ne', 'add', 'sub', 'mul', 'min', 'max'].includes(name)) return index === 0 ? 'a' : 'b';
    return { path: 'field path', label: 'line label', binding: 'binding', alias: 'import', field: 'imported field', value: 'reward value', periods: '', bool: 'condition', int: 'number' }[type] ?? type;
}

const keysOf = value => Object.keys(isObject(value) ? value : {});

function namedSlot(doc, holder, type, current, set, context, parent, depth, render) {
    const module = context.module;
    const text = typeof current === 'string' ? current : '';
    if (type === 'path') { pathEditor(doc, holder, Array.isArray(current) ? current : [], set, context, render); return; }
    if (type === 'periods') { holder.append(el(doc, 'code', 'periods')); return; }
    if (type === 'label') { selectControl(doc, holder, 'Line label', keysOf(module?.kinds?.[context.owner]?.labels), text, set, { blank: 'choose' }); return; }
    if (type === 'binding') { selectControl(doc, holder, 'Reward binding', keysOf(module?.rewards?.[context.owner]?.bindings), text, set, { blank: 'choose' }); return; }
    if (type === 'value') { selectControl(doc, holder, 'Reward value', keysOf(module?.rewards?.[context.owner]?.values), text, set, { blank: 'choose' }); return; }
    if (type === 'alias') { selectControl(doc, holder, 'Import alias', keysOf(module?.imports), text, next => { set(next); render(); }, { blank: 'choose' }); return; }
    if (type === 'field') {
        const projection = list(module?.imports?.[parent[1]]?.projection).map(String);
        if (projection.length) selectControl(doc, holder, 'Imported field', projection, text, set, { blank: 'choose' });
        else textControl(doc, holder, 'Imported field', current, set);
        return;
    }
    if (type === 'name') { holder.append(note(doc, V11_MESSAGE, 'warning')); return; }
    drawExpression(doc, holder, current, type, set, context, depth + 1);
}

function literalEditor(doc, box, value, slot, change, context, replace) {
    const kind = literalKind(value);
    if (kind === 'other') {
        box.append(note(doc, `This value is not a number, text or true/false (${JSON.stringify(value) ?? 'missing'}). Choose an operator, or fix it in the record JSON.`, 'warning'));
        return;
    }
    const expect = context.expect;
    if (slot === 'bool' || (slot === 'any' && (expect?.type === 'bool' || kind === 'bool'))) {
        selectControl(doc, box, 'Literal', ['true', 'false'], String(value === true), next => change(next === 'true'));
        if (kind !== 'bool') box.append(note(doc, 'A condition needs true or false.', 'warning'));
        return;
    }
    if (slot === 'any' && expect?.type === 'enum') { selectControl(doc, box, 'Literal', expect.values.map(String), value, change); return; }
    if (slot === 'int' || slot === 'positiveInt' || kind === 'number' || (slot === 'any' && expect?.type === 'int')) { intControl(doc, box, 'Literal', value, change); return; }
    selectControl(doc, box, 'Literal type', [['number', 'number'], ['text', 'text'], ['bool', 'true/false']], kind, next => replace(next === 'number' ? 0 : next === 'bool' ? true : ''));
    textControl(doc, box, 'Literal', value, change);
}

// A field path: a declared field, then (for a map) a declared key or an expression over a line label or binding.
function pathEditor(doc, host, path, set, context, render) {
    const module = context.module;
    const wrap = el(doc, 'div', '', { class: 'expr-path' });
    host.append(wrap);
    const [first, second] = path;
    const names = keysOf(module?.state);
    selectControl(doc, wrap, 'Field', names, typeof first === 'string' ? first : '', next => {
        const schema = isObject(module?.state?.[next]) ? module.state[next] : null;
        set(schema?.type === 'map' ? [next, list(schema.keys)[0] ?? ''] : [next]);
        render();
    }, { blank: 'choose' });
    const schema = typeof first === 'string' && own(module?.state, first) && isObject(module.state[first]) ? module.state[first] : null;
    if (schema?.type === 'map') {
        const keys = list(schema.keys).map(String);
        selectControl(doc, wrap, 'Key from', [['key', 'a declared key'], ['expr', 'a line label or binding']], isExpression(second) ? 'expr' : 'key', next => {
            set([first, next === 'expr' ? [context.where === 'template' ? 'bind' : 'arg', ''] : keys[0] ?? '']);
            render();
        });
        if (isExpression(second)) drawExpression(doc, wrap, second, 'any', next => set([first, next]), context, 3);
        else selectControl(doc, wrap, 'Key', keys, typeof second === 'string' ? second : '', next => set([first, next]), { blank: 'choose' });
    } else if (path.length > 1) wrap.append(note(doc, `Extra path segment kept: ${JSON.stringify(path.slice(1))}`, 'warning'));
    if (typeof first === 'string' && first !== '' && !names.includes(first)) wrap.append(note(doc, `"${first}" is not a declared field.`, 'warning'));
}
