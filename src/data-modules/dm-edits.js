// Edits to `content.dataModules` as pure, undoable pack edits. Each returns { ok, model, undo } or
// { ok: false, model, errors } like the other editors, so applyEdit() and History handle them unchanged.
// Story Block's checker (through sb-adapter) gives the verdict; Studio adds only the v1.1 refusal and key safety.
import { openPack } from '../model.js';
import { validatePack, status, isWaitingError } from './sb-adapter.js';
import { isObject, clone, modulesOf, moduleId, v11Findings } from './dm-model.js';
import { renameTarget, removeTarget, inboundReferences } from './refs.js';

export const CAPABILITY = 'data-modules-v1';

const refuse = (model, errors) => ({ ok: false, model, errors });
const edit = (model, code, message, path = '') => refuse(model, [{ code, path, message }]);

function withCapability(requires) {
    const base = isObject(requires) ? requires : {};
    const current = Array.isArray(base.capabilities) ? base.capabilities : [];
    return current.includes(CAPABILITY) ? base : { ...base, capabilities: [...current, CAPABILITY] };
}

const sameError = (a, b) => a.code === b.code && a.path === b.path;

/**
 * Replaces the data module list (and, for renames that reach them, the pack's screens/layouts) in one edit.
 * Story Block's checker decides. While the vendored copy cannot check data modules the result is a safe invalid
 * draft carrying the checker's own refusal, never a claimed pass; unrelated new problems still refuse.
 */
export function replaceModules(model, modules, { extra = {}, addCapability = true } = {}) {
    if (!model?.document || !Array.isArray(modules)) return edit(model, 'bad-edit', 'Open a pack before editing data modules.');
    if (modules.some(module => !isObject(module))) return edit(model, 'bad-edit', 'Each data module must be a JSON object.');
    // Story Block's checker refuses v1.1 features itself (DM_SCHEMA, "needs data-modules v1.1"), so its verdict stands.
    // Only a copy that cannot check data modules at all gets Studio's own fixed refusal, so nothing slips through unflagged.
    const v11 = !status().checker ? modules.flatMap(module => v11Findings(module)) : [];
    if (v11.length) return refuse(model, v11.map(({ code, path, message }) => ({ code, path, message })));
    const content = { ...(isObject(model.document.content) ? model.document.content : {}) };
    if (modules.length) content.dataModules = clone(modules);
    else delete content.dataModules;
    const candidate = { ...model.document, ...extra, content };
    if (modules.length && addCapability) candidate.requires = withCapability(model.document.requires);
    const checked = validatePack(candidate);
    const waiting = !status().checker;
    if (!checked.ok) {
        const errors = checked.errors ?? [];
        const fresh = errors.filter(error => !(waiting && isWaitingError(error)) && !(model.validation?.errors ?? []).some(old => sameError(old, error)));
        if (!waiting || fresh.length) return refuse(model, errors);
    }
    const next = openPack(candidate);
    if (!next.document) return edit(model, 'bad-edit', 'Could not read the edited pack.');
    return { ok: true, model: next, undo: () => model, waiting: waiting && modules.length > 0 };
}

/** What Story Block says about a candidate list without committing it: { ok, errors, waiting }. */
export function checkModules(model, modules, { addCapability = true } = {}) {
    if (!model?.document) return { ok: false, errors: [], waiting: false };
    const content = { ...(isObject(model.document.content) ? model.document.content : {}) };
    if (modules.length) content.dataModules = modules;
    else delete content.dataModules;
    const candidate = { ...model.document, content };
    if (modules.length && addCapability) candidate.requires = withCapability(model.document.requires);
    const waiting = !status().checker;
    let checked;
    try { checked = validatePack(candidate); } catch { checked = { ok: false, errors: [{ code: 'NOT_PLAIN', path: '', message: 'Cannot read pack data' }] }; }
    const errors = (checked.errors ?? []).filter(error => !(waiting && isWaitingError(error)));
    return { ok: checked.ok === true, errors, waiting, v11: waiting ? modules.flatMap(module => v11Findings(module)) : [] };
}

export function setModule(model, index, record) {
    const modules = [...modulesOf(model?.document)];
    if (!Number.isInteger(index) || index < 0 || index > modules.length) return edit(model, 'bad-edit', 'Choose a data module.');
    modules[index] = record;
    return replaceModules(model, modules);
}

export function deleteModule(model, index) {
    const modules = [...modulesOf(model?.document)];
    if (!Number.isInteger(index) || index < 0 || index >= modules.length) return edit(model, 'bad-edit', 'Choose a data module.');
    const id = moduleId(model.document, modules[index]);
    const self = ['content', 'dataModules', index];
    const outside = inboundReferences(model.document, { targetKind: 'dm.module', targetId: id })
        .filter(ref => !self.every((part, i) => ref.path[i] === part));
    if (outside.length) {
        return { ...edit(model, 'has-references', `${id} is still referenced ${outside.length} time${outside.length === 1 ? '' : 's'} by other modules or screens; change those first.`, outside[0].path.join('.')), references: outside };
    }
    modules.splice(index, 1);
    return replaceModules(model, modules);
}

/** Typed rename/remove of module, export, template, field, key, alias, label, binding or value (see refs.js). */
export function renameDataModuleTarget(model, target, newName) {
    if (!model?.document) return edit(model, 'bad-edit', 'Open a pack before editing data modules.');
    const result = renameTarget(model.document, target, newName);
    if (!result.ok) return refuse(model, result.errors);
    return replaceModules(model, result.modules, { extra: result.extra });
}

export function removeDataModuleTarget(model, target) {
    if (!model?.document) return edit(model, 'bad-edit', 'Open a pack before editing data modules.');
    const result = removeTarget(model.document, target);
    if (!result.ok) return { ...refuse(model, result.errors), references: result.references };
    return replaceModules(model, result.modules, { extra: result.extra });
}

/** Attaches (copies) or moves a pack screen/layout into a module's presentation. */
export function attachPresentation(model, index, field, id, { move = false } = {}) {
    if (!['screens', 'layouts'].includes(field)) return edit(model, 'bad-edit', 'Choose screens or layouts.');
    const modules = clone(modulesOf(model?.document));
    const module = modules[index];
    const source = Array.isArray(model?.document?.[field]) ? model.document[field] : [];
    const record = source.find(item => item?.id === id);
    if (!isObject(module) || !record) return edit(model, 'bad-edit', 'Choose a module and one of this pack’s screens or layouts.');
    const current = Array.isArray(module[field]) ? module[field] : [];
    if (current.some(item => item?.id === id)) return edit(model, 'duplicate', `This module already has a ${field === 'screens' ? 'screen' : 'layout'} "${id}".`);
    module[field] = [...current, clone(record)];
    const extra = move ? { [field]: source.filter(item => item !== record) } : {};
    return replaceModules(model, modules, { extra });
}

