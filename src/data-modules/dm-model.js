// Pure helpers over `content.dataModules` records. Records are plain JSON; every traversal tolerates any shape,
// because a draft can hold anything the author typed (Story Block's checker, not this file, says what is valid).
import { OPERATORS, EFFECTS, V11_MESSAGE } from './hints.js';

export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
export const own = (object, key) => isObject(object) && Object.hasOwn(object, key);
export const entries = value => (isObject(value) ? Object.entries(value) : []);
export const list = value => (Array.isArray(value) ? value : []);

export function modulesOf(document) {
    const value = document?.content?.dataModules;
    return Array.isArray(value) ? value : [];
}

export function packPrefix(document) {
    return `pack.${typeof document?.id === 'string' ? document.id : 'pack'}/`;
}

export function moduleId(document, module) {
    return `${packPrefix(document)}${typeof module?.slug === 'string' ? module.slug : ''}`;
}

/** The short slug form is used only when the slug is unique among this pack's definitions (decision 6). */
export function shortRef(document, module) {
    const slug = module?.slug;
    if (typeof slug !== 'string' || !slug) return moduleId(document, module);
    const same = modulesOf(document).filter(other => other?.slug === slug).length;
    return same <= 1 ? slug : moduleId(document, module);
}

// An expression is an array whose first item is the operator name. A path or a list of fields never starts that way
// where an expression is expected, so position decides: callers ask for expression slots explicitly.
export const isExpression = value => Array.isArray(value) && typeof value[0] === 'string';

/** Calls visit(expression, path) for the expression and every nested expression, including path-segment expressions. */
export function walkExpression(expression, path, visit) {
    if (!isExpression(expression)) return;
    visit(expression, path);
    const [name, ...args] = expression;
    if (name === 'get') {
        list(args[0]).forEach((segment, index) => walkExpression(segment, [...path, 1, index], visit));
        return;
    }
    const spec = own(OPERATORS, name) ? OPERATORS[name] : null;
    args.forEach((arg, index) => {
        const slot = spec?.slots[index];
        if (slot === undefined || ['int', 'bool', 'any', 'positiveInt'].includes(slot)) walkExpression(arg, [...path, index + 1], visit);
    });
}

/** Every effect list in the record with where it sits (kind, rule, template or timer). */
export function effectLists(module) {
    const out = [];
    for (const [name, kind] of entries(module?.kinds)) if (Array.isArray(kind?.effects)) out.push({ path: ['kinds', name, 'effects'], effects: kind.effects, where: 'kind', owner: name });
    list(module?.rules).forEach((rule, index) => { if (Array.isArray(rule?.then)) out.push({ path: ['rules', index, 'then'], effects: rule.then, where: 'rule', owner: rule?.id ?? index }); });
    for (const [name, template] of entries(module?.rewards)) if (Array.isArray(template?.effects)) out.push({ path: ['rewards', name, 'effects'], effects: template.effects, where: 'template', owner: name });
    list(module?.timers).forEach((timer, index) => { if (Array.isArray(timer?.effects)) out.push({ path: ['timers', index, 'effects'], effects: timer.effects, where: 'timer', owner: timer?.id ?? index }); });
    return out;
}

/** Every condition (`when`) slot: { path, value, where, owner }. */
export function conditionSlots(module) {
    const out = [];
    for (const [name, kind] of entries(module?.kinds)) if (own(kind, 'when')) out.push({ path: ['kinds', name, 'when'], value: kind.when, where: 'kind', owner: name });
    list(module?.rules).forEach((rule, index) => { if (own(rule, 'when')) out.push({ path: ['rules', index, 'when'], value: rule.when, where: 'rule', owner: rule?.id ?? index }); });
    for (const [name, template] of entries(module?.rewards)) if (own(template, 'when')) out.push({ path: ['rewards', name, 'when'], value: template.when, where: 'template', owner: name });
    return out;
}

/** Every expression position in the record: calls visit(expression, path, context) for each expression found. */
export function walkModuleExpressions(module, visit) {
    for (const slot of conditionSlots(module)) walkExpression(slot.value, slot.path, (expr, path) => visit(expr, path, slot));
    for (const group of effectLists(module)) {
        group.effects.forEach((effect, index) => {
            if (!isObject(effect)) return;
            const base = [...group.path, index];
            const context = { where: group.where, owner: group.owner, effect };
            for (const key of ['value', 'min', 'max']) if (own(effect, key)) walkExpression(effect[key], [...base, key], (expr, path) => visit(expr, path, context));
            list(effect.path).forEach((segment, i) => walkExpression(segment, [...base, 'path', i], (expr, path) => visit(expr, path, context)));
            for (const [name, value] of entries(effect.bind)) walkExpression(value, [...base, 'bind', name], (expr, path) => visit(expr, path, context));
        });
    }
}

/** Story Block v1.1 features. v1 refuses them with one fixed message, never silently (decision 7). */
export function v11Findings(module) {
    const found = [];
    const note = (path, what) => found.push({ code: 'NEEDS_V1_1', path: ['content', 'dataModules', ...path].join('.'), local: path, message: `${what}: ${V11_MESSAGE}` });
    for (const [name, kind] of entries(module?.kinds)) if (own(kind, 'check')) note(['kinds', name, 'check'], `Kind "${name}" uses a Story Director skill check`);
    for (const group of effectLists(module)) {
        group.effects.forEach((effect, index) => {
            const op = isObject(effect) ? effect.op : undefined;
            if (typeof op === 'string' && own(EFFECTS, op) && EFFECTS[op].v11) note([...group.path, index], `Effect "${op}"`);
        });
    }
    walkModuleExpressions(module, (expr, path) => { if (expr[0] === 'check') note(path, 'Expression "check"'); });
    return found;
}

/** Reads a nested value by a segment path; undefined when absent. */
export function getAt(root, path) {
    let node = root;
    for (const key of path) {
        if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return undefined;
        node = node[key];
    }
    return node;
}

/** Writes a nested value in place, creating plain objects; refuses unsafe keys. Returns the root. */
export function setAt(root, path, value) {
    if (path.some(key => typeof key === 'string' && UNSAFE_KEYS.has(key))) throw new Error('Unsafe key');
    if (path.length === 0) return value;
    let node = root;
    path.slice(0, -1).forEach((key, i) => {
        if (node[key] === null || typeof node[key] !== 'object') node[key] = typeof path[i + 1] === 'number' ? [] : {};
        node = node[key];
    });
    node[path.at(-1)] = value;
    return root;
}

export function deleteAt(root, path) {
    const parent = getAt(root, path.slice(0, -1));
    if (Array.isArray(parent)) parent.splice(path.at(-1), 1);
    else if (isObject(parent)) delete parent[path.at(-1)];
}

/** Renames an object key without changing key order; returns a new object. */
export function renameKey(object, from, to) {
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key === from ? to : key, value]));
}

export function pathText(path) {
    return path.map(part => (typeof part === 'number' ? `[${part}]` : String(part))).join('.').replaceAll('.[', '[');
}

/** A short, escaped-by-textContent rendering of an expression for reading (not for execution). */
export function expressionText(expression) {
    if (!isExpression(expression)) return typeof expression === 'string' ? JSON.stringify(expression) : JSON.stringify(expression) ?? String(expression);
    const [name, ...args] = expression;
    const infix = { eq: '=', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=', and: 'and', or: 'or', add: '+', sub: '-', mul: '*' };
    if (name === 'get') return list(args[0]).map(part => (isExpression(part) ? `{${expressionText(part)}}` : String(part))).join('.');
    if (['arg', 'bind', 'reward'].includes(name)) return `${name === 'reward' ? 'reward' : name === 'arg' ? 'label' : 'binding'} ${args[0]}`;
    if (name === 'input') return `${args[0]}.${args[1]}`;
    if (name === 'timer') return 'timer periods';
    if (name === 'not') return `not (${expressionText(args[0])})`;
    if (Object.hasOwn(infix, name) && args.length === 2) return `(${expressionText(args[0])} ${infix[name]} ${expressionText(args[1])})`;
    return `${name}(${args.map(expressionText).join(', ')})`;
}
