// Pure helpers for the expression editor: operator catalogue by slot, defaults, and light type hints for choosing
// controls. A hint never rejects an expression; the checker's verdict (through sb-adapter) is the only authority.
import { OPERATORS } from './hints.js';
import { isObject, isExpression, own, list, entries } from './dm-model.js';

export const OPERATOR_GROUPS = Object.freeze(['Read', 'Compare', 'Logic', 'Integer']);

/** Operator names offered for a slot, grouped. `context` limits the readers that make sense where the slot lives. */
export function operatorsFor(slotType, context = {}) {
    const allowed = name => {
        const spec = OPERATORS[name];
        if (spec.v11) return false;
        if (name === 'arg') return context.where === 'kind';
        if (name === 'bind' || name === 'reward') return context.where === 'template';
        if (name === 'timer') return context.where === 'timer';
        if (name === 'input') return Object.keys(context.module?.imports ?? {}).length > 0;
        if (slotType === 'bool') return spec.result === 'bool' || name === 'get' || name === 'arg' || name === 'bind' || name === 'input';
        if (slotType === 'int' || slotType === 'positiveInt') return spec.result === 'int' || name === 'get' || name === 'input';
        return true;
    };
    return Object.keys(OPERATORS).filter(allowed);
}

/** The field a path names, or null. A map's value schema applies once a key segment is present. */
export function fieldSchema(module, path) {
    const [name, key] = list(path);
    if (typeof name !== 'string' || !own(module?.state, name)) return null;
    const schema = module.state[name];
    return schema?.type === 'map' && key !== undefined ? schema.values ?? null : schema;
}

/** { type: 'int'|'bool'|'text'|'enum', values? } for a schema. */
export function typeOfSchema(schema) {
    if (!isObject(schema) || typeof schema.type !== 'string') return null;
    return schema.type === 'enum' ? { type: 'enum', values: list(schema.values) } : { type: schema.type };
}

export function typeOfExpression(expression, context = {}) {
    if (typeof expression === 'number') return { type: 'int' };
    if (typeof expression === 'boolean') return { type: 'bool' };
    if (typeof expression === 'string') return { type: 'text' };
    if (!isExpression(expression)) return null;
    const [name, a, b] = expression;
    if (name === 'get') return typeOfSchema(fieldSchema(context.module, a));
    if (name === 'arg') return typeOfSchema(context.module?.kinds?.[context.owner]?.labels?.[a]);
    if (name === 'bind') return typeOfSchema(context.module?.rewards?.[context.owner]?.bindings?.[a]);
    if (!own(OPERATORS, name)) return null;
    void b;
    const result = OPERATORS[name].result;
    return result === 'any' ? null : { type: result };
}

/** A starting expression for a slot, using the first declared field where one fits. */
export function defaultExpression(slotType, module) {
    if (slotType === 'bool') return true;
    if (slotType === 'positiveInt') return 1;
    if (slotType === 'int') {
        const field = entries(module?.state).find(([, schema]) => schema?.type === 'int');
        return field ? ['get', [field[0]]] : 0;
    }
    return 0;
}

export function slotTypes(name) { return own(OPERATORS, name) ? OPERATORS[name].slots : []; }

const NAME_SLOTS = new Set(['path', 'label', 'binding', 'alias', 'field', 'value', 'name', 'periods']);

/** Switches an expression's operator, keeping arguments that still fit and filling any new slots. */
export function changeOperator(expression, name, module) {
    if (!own(OPERATORS, name)) return expression;
    const oldName = isExpression(expression) ? expression[0] : null;
    const oldSlots = oldName !== null && own(OPERATORS, oldName) ? OPERATORS[oldName].slots : [];
    // A literal being wrapped becomes the first argument.
    const old = oldName !== null ? expression.slice(1) : expression === undefined ? [] : [expression];
    const was = oldName !== null ? oldSlots : ['int'];
    return [name, ...OPERATORS[name].slots.map((slot, i) => {
        if (slot === 'periods') return 'periods';
        if (slot === 'path') return was[i] === 'path' && Array.isArray(old[i]) ? old[i] : [entries(module?.state)[0]?.[0] ?? ''];
        if (NAME_SLOTS.has(slot)) return was[i] === slot && typeof old[i] === 'string' ? old[i] : '';
        return i < old.length && was[i] !== undefined && !NAME_SLOTS.has(was[i]) ? old[i] : defaultExpression(slot, module);
    })];
}

/** Counts nodes and depth of an expression, for the budget hint beside an expression editor. */
export function measure(expression, depth = 1) {
    if (!isExpression(expression)) return { nodes: 1, depth };
    let nodes = 1;
    let deepest = depth;
    const children = expression[0] === 'get' ? list(expression[1]) : expression.slice(1);
    for (const child of children) {
        if (isExpression(child)) {
            const inner = measure(child, depth + 1);
            nodes += inner.nodes;
            deepest = Math.max(deepest, inner.depth);
        } else nodes += 1;
    }
    return { nodes, depth: deepest };
}
