// Typed reference index and rename/remove for data modules. Every reference is found by position in the record
// (a path into the pack plus how to rewrite it); nothing is matched or replaced as text. An enum value that happens
// to spell a field name, a template string, or a `$item.` binding the index does not understand is left alone.
import { entries, list, own, isObject, clone, UNSAFE_KEYS, modulesOf, moduleId, packPrefix, walkModuleExpressions, effectLists, getAt, renameKey } from './dm-model.js';

export const TARGET_KINDS = Object.freeze(['dm.module', 'dm.export', 'dm.field', 'dm.key', 'dm.template', 'dm.alias', 'dm.label', 'dm.binding', 'dm.value']);

const SCREEN_QUERY = /^dataModules\.(view|public|offers|replayInputs)$/;

// Finds `{ query: 'dataModules.*', args: { module, ... } }` bindings (and the `$item.` fields of a list over them) in screen JSON.
function scanPresentation(refs, document, root, basePath) {
    const prefix = packPrefix(document);
    const resolve = value => (typeof value !== 'string' ? null : value.startsWith('pack.') ? value : `${prefix}${value}`);
    const declared = (owner, field) => modulesOf(document).some(module => moduleId(document, module) === owner && own(module?.state, field));
    const visit = (node, path, depth, scope) => {
        if (depth > 24 || node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach((child, i) => visit(child, [...path, i], depth + 1, scope)); return; }
        if (typeof node.query === 'string' && SCREEN_QUERY.test(node.query) && isObject(node.args)) {
            const owner = resolve(node.args.module);
            if (owner) {
                refs.push({ targetKind: 'dm.module', targetId: owner, path: [...path, 'args', 'module'], edit: { mode: 'module' }, via: 'presentation' });
                if (typeof node.args.export === 'string') refs.push({ targetKind: 'dm.export', targetId: `${owner}#${node.args.export}`, path: [...path, 'args', 'export'], edit: { mode: 'set' }, via: 'presentation' });
                const parts = typeof node.path === 'string' ? node.path.split('.') : [];
                if (node.query === 'dataModules.view' && parts[0] === 'chat' && declared(owner, parts[1])) refs.push({ targetKind: 'dm.field', targetId: `${owner}#${parts[1]}`, path: [...path, 'path'], edit: { mode: 'segment', index: 1 }, via: 'presentation' });
            }
        }
        let itemOwner = null;
        if (isObject(node.bind) && node.bind.query === 'dataModules.view' && node.bind.path === 'characters' && isObject(node.bind.args)) itemOwner = resolve(node.bind.args.module);
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string') {
                const field = scope && value.startsWith('$item.') ? value.slice(6).split('.')[0] : null;
                if (field && declared(scope, field)) refs.push({ targetKind: 'dm.field', targetId: `${scope}#${field}`, path: [...path, key], edit: { mode: 'item' }, via: 'presentation' });
            } else visit(value, [...path, key], depth + 1, key === 'item' && itemOwner ? itemOwner : scope);
        }
    };
    visit(root, basePath, 0, null);
}

function scanModule(refs, document, module, index) {
    const id = moduleId(document, module);
    const base = ['content', 'dataModules', index];
    const push = (targetKind, targetId, path, edit, role = 'ref') => refs.push({ targetKind, targetId, path, edit, role, via: 'module' });
    if (typeof module?.slug === 'string') push('dm.module', id, [...base, 'slug'], { mode: 'set' }, 'definition');

    for (const [name, schema] of entries(module?.state)) {
        push('dm.field', `${id}#${name}`, [...base, 'state', name], { mode: 'key' }, 'definition');
        if (schema?.type === 'map') list(schema.keys).forEach((key, i) => push('dm.key', `${id}#${name}.${key}`, [...base, 'state', name, 'keys', i], { mode: 'set' }, 'definition'));
    }
    list(module?.migrations).forEach((migration, i) => {
        for (const name of Object.keys(isObject(migration?.add) ? migration.add : {})) push('dm.field', `${id}#${name}`, [...base, 'migrations', i, 'add', name], { mode: 'key' });
    });
    for (const [name] of entries(module?.exports)) push('dm.export', `${id}#${name}`, [...base, 'exports', name], { mode: 'key' }, 'definition');
    for (const [name, spec] of entries(module?.exports)) list(spec?.fields).forEach((field, i) => { if (typeof field === 'string') push('dm.field', `${id}#${field}`, [...base, 'exports', name, 'fields', i], { mode: 'set' }); });
    for (const [alias, spec] of entries(module?.imports)) {
        push('dm.alias', `${id}#${alias}`, [...base, 'imports', alias], { mode: 'key' }, 'definition');
        if (spec?.query === 'dataModules.public' && isObject(spec.args) && typeof spec.args.module === 'string') {
            const owner = spec.args.module.startsWith('pack.') ? spec.args.module : `${packPrefix(document)}${spec.args.module}`;
            push('dm.module', owner, [...base, 'imports', alias, 'args', 'module'], { mode: 'module' });
            if (typeof spec.args.export === 'string') push('dm.export', `${owner}#${spec.args.export}`, [...base, 'imports', alias, 'args', 'export'], { mode: 'set' });
        }
    }
    list(module?.timers).forEach((timer, i) => { if (typeof timer?.clock === 'string') push('dm.alias', `${id}#${timer.clock}`, [...base, 'timers', i, 'clock'], { mode: 'set' }); });
    for (const [kindName, kind] of entries(module?.kinds)) {
        for (const label of Object.keys(isObject(kind?.labels) ? kind.labels : {})) push('dm.label', `${id}#${kindName}.${label}`, [...base, 'kinds', kindName, 'labels', label], { mode: 'key' }, 'definition');
        list(kind?.oncePerReply).forEach((label, i) => { if (typeof label === 'string') push('dm.label', `${id}#${kindName}.${label}`, [...base, 'kinds', kindName, 'oncePerReply', i], { mode: 'set' }); });
    }
    for (const [name, template] of entries(module?.rewards)) {
        push('dm.template', `${id}#${name}`, [...base, 'rewards', name], { mode: 'key' }, 'definition');
        for (const binding of Object.keys(isObject(template?.bindings) ? template.bindings : {})) push('dm.binding', `${id}#${name}.${binding}`, [...base, 'rewards', name, 'bindings', binding], { mode: 'key' }, 'definition');
        for (const value of Object.keys(isObject(template?.values) ? template.values : {})) push('dm.value', `${id}#${name}.${value}`, [...base, 'rewards', name, 'values', value], { mode: 'key' }, 'definition');
        // A range table names the enum binding that selects its branch.
        for (const [value, range] of entries(template?.values)) if (typeof range?.binding === 'string') push('dm.binding', `${id}#${name}.${range.binding}`, [...base, 'rewards', name, 'values', value, 'binding'], { mode: 'set' });
    }
    // Effects that name a template, and the bind keys that answer its bindings.
    for (const group of effectLists(module)) {
        group.effects.forEach((effect, i) => {
            if (!isObject(effect)) return;
            const at = [...base, ...group.path, i];
            if (typeof effect.template === 'string' && ['reward', 'offer'].includes(effect.op)) {
                push('dm.template', `${id}#${effect.template}`, [...at, 'template'], { mode: 'set' });
                for (const binding of Object.keys(isObject(effect.bind) ? effect.bind : {})) push('dm.binding', `${id}#${effect.template}.${binding}`, [...at, 'bind', binding], { mode: 'key' });
            }
            const [first, second] = list(effect.path);
            if (typeof first === 'string' && ['set', 'add', 'clamp'].includes(effect.op)) {
                push('dm.field', `${id}#${first}`, [...at, 'path', 0], { mode: 'set' });
                if (typeof second === 'string') push('dm.key', `${id}#${first}.${second}`, [...at, 'path', 1], { mode: 'set' });
            }
        });
    }
    // Expressions: the owning kind or template scopes labels, bindings and reward values.
    walkModuleExpressions(module, (expr, path, context) => {
        const at = [...base, ...path];
        const name = expr[0];
        if (name === 'get') {
            const [first, second] = list(expr[1]);
            if (typeof first === 'string') push('dm.field', `${id}#${first}`, [...at, 1, 0], { mode: 'set' });
            if (typeof first === 'string' && typeof second === 'string') push('dm.key', `${id}#${first}.${second}`, [...at, 1, 1], { mode: 'set' });
        } else if (name === 'arg' && typeof expr[1] === 'string' && context.where === 'kind') push('dm.label', `${id}#${context.owner}.${expr[1]}`, [...at, 1], { mode: 'set' });
        else if (name === 'bind' && typeof expr[1] === 'string' && context.where === 'template') push('dm.binding', `${id}#${context.owner}.${expr[1]}`, [...at, 1], { mode: 'set' });
        else if (name === 'reward' && typeof expr[1] === 'string' && context.where === 'template') push('dm.value', `${id}#${context.owner}.${expr[1]}`, [...at, 1], { mode: 'set' });
        else if (name === 'input' && typeof expr[1] === 'string') push('dm.alias', `${id}#${expr[1]}`, [...at, 1], { mode: 'set' });
    });
    scanPresentation(refs, document, module?.screens, [...base, 'screens']);
    scanPresentation(refs, document, module?.layouts, [...base, 'layouts']);
}

/** Typed references in `content.dataModules` and in the pack's screens/layouts, in traversal order. */
export function indexDataModuleReferences(document) {
    if (!isObject(document)) return [];
    const refs = [];
    modulesOf(document).forEach((module, index) => { if (isObject(module)) scanModule(refs, document, module, index); });
    scanPresentation(refs, document, document.screens, ['screens']);
    scanPresentation(refs, document, document.layouts, ['layouts']);
    return refs.map(ref => ({ kind: 'dataModules', id: ownerOf(document, ref.path), ...ref }));
}

function ownerOf(document, path) {
    if (path[0] === 'content' && path[1] === 'dataModules') return moduleId(document, modulesOf(document)[path[2]]);
    return `${packPrefix(document)}${path[0]}`;
}

/** Inbound references to a target: everything except the target's own definition sites. */
export function inboundReferences(document, target, index = indexDataModuleReferences(document)) {
    return index.filter(ref => ref.targetKind === target.targetKind && ref.targetId === target.targetId && ref.role !== 'definition');
}

/** The records an author can pick for rename/remove, with their definition path. */
export function targets(document) {
    const refs = indexDataModuleReferences(document);
    const seen = new Set();
    const out = [];
    for (const ref of refs) {
        if (ref.role !== 'definition') continue;
        const key = `${ref.targetKind}\u0000${ref.targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ targetKind: ref.targetKind, targetId: ref.targetId, path: ref.path, count: inboundReferences(document, ref, refs).length });
    }
    return out;
}

const bad = (message, path = '') => ({ ok: false, errors: [{ code: 'bad-edit', path, message }] });

function nameOf(targetKind, targetId) {
    if (targetKind === 'dm.module') return targetId.split('/').at(-1);
    const tail = targetId.slice(targetId.indexOf('#') + 1);
    return ['dm.label', 'dm.binding', 'dm.value', 'dm.key'].includes(targetKind) ? tail.slice(tail.indexOf('.') + 1) : tail;
}

function rewrite(root, ref, oldName, newName) {
    const { path, edit } = ref;
    if (edit.mode === 'key') {
        const parent = getAt(root, path.slice(0, -1));
        if (!isObject(parent)) return false;
        const grand = getAt(root, path.slice(0, -2));
        const key = path.at(-2);
        if (!own(parent, oldName) || !grand) return false;
        grand[key] = renameKey(parent, oldName, newName);
        return true;
    }
    const parent = getAt(root, path.slice(0, -1));
    const last = path.at(-1);
    if (parent === undefined || parent === null) return false;
    const current = parent[last];
    if (typeof current !== 'string') return false;
    if (edit.mode === 'set') { parent[last] = newName; return true; }
    if (edit.mode === 'module') { parent[last] = current.startsWith('pack.') ? `${current.slice(0, current.lastIndexOf('/') + 1)}${newName}` : newName; return true; }
    if (edit.mode === 'segment') { const parts = current.split('.'); parts[edit.index] = newName; parent[last] = parts.join('.'); return true; }
    if (edit.mode === 'item') { const parts = current.slice(6).split('.'); parts[0] = newName; parent[last] = `$item.${parts.join('.')}`; return true; }
    return false;
}

function working(document) {
    const plain = {
        content: { dataModules: clone(modulesOf(document)) },
        screens: clone(document.screens),
        layouts: clone(document.layouts),
    };
    return plain;
}

function finish(document, plain) {
    return { ok: true, modules: plain.content.dataModules, extra: { ...(own(document, 'screens') ? { screens: plain.screens } : {}), ...(own(document, 'layouts') ? { layouts: plain.layouts } : {}) } };
}

/**
 * Renames a typed target and every reference to it. Returns { ok, modules, extra, changed } for replaceModules,
 * or { ok: false, errors } when the name is unusable or already taken. Names are not text-matched anywhere.
 */
export function renameTarget(document, target, newName) {
    const refs = indexDataModuleReferences(document);
    const sites = refs.filter(ref => ref.targetKind === target.targetKind && ref.targetId === target.targetId);
    if (!sites.some(ref => ref.role === 'definition')) return bad(`No ${target.targetKind} ${target.targetId} to rename.`);
    if (typeof newName !== 'string' || !newName.trim() || newName !== newName.trim()) return bad('Enter a name without leading or trailing spaces.');
    if (UNSAFE_KEYS.has(newName)) return bad('That name is not allowed.');
    const oldName = nameOf(target.targetKind, target.targetId);
    if (oldName === newName) return bad('The new name is the same as the old one.');
    // A rename must not land on a name already used by a sibling definition.
    const sibling = `${target.targetId.slice(0, target.targetId.length - oldName.length)}${newName}`;
    if (refs.some(ref => ref.role === 'definition' && ref.targetKind === target.targetKind && ref.targetId === sibling)) return bad(`"${newName}" is already used here.`);
    const plain = working(document);
    const changed = [];
    // Values first, then keys, so no recorded path moves before it is used.
    const ordered = [...sites.filter(ref => ref.edit.mode !== 'key'), ...sites.filter(ref => ref.edit.mode === 'key')];
    for (const ref of ordered) if (rewrite(plain, ref, oldName, newName)) changed.push(ref.path);
    return { ...finish(document, plain), changed, references: sites.filter(ref => ref.role !== 'definition').length };
}

/** Removes a typed target's definition, refusing while anything still references it. */
export function removeTarget(document, target) {
    const refs = indexDataModuleReferences(document);
    const definitions = refs.filter(ref => ref.targetKind === target.targetKind && ref.targetId === target.targetId && ref.role === 'definition');
    if (!definitions.length) return bad(`No ${target.targetKind} ${target.targetId} to remove.`);
    const inbound = inboundReferences(document, target, refs);
    if (inbound.length) return { ok: false, errors: [{ code: 'has-references', path: inbound[0].path.join('.'), message: `${target.targetId} is still referenced ${inbound.length} time${inbound.length === 1 ? '' : 's'}; change those first.` }], references: inbound };
    const plain = working(document);
    for (const ref of definitions) {
        const parent = getAt(plain, ref.path.slice(0, -1));
        const last = ref.path.at(-1);
        if (Array.isArray(parent)) parent.splice(last, 1);
        else if (isObject(parent)) delete parent[last];
    }
    return finish(document, plain);
}
