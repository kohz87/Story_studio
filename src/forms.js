import { applyEdit } from './apply-edit.js';
import { safeLabel, el, button, field } from './dom.js';
import { setSchemaField as setField, renameId } from './edits.js';
import { records, identity, localId } from './records.js';
import { referenceTarget, resolveSchema, validateField, validateChange } from './form-schema.js';
import { validateRulesPack, RULES_V2_LIMITS, RULES_V2_PROGRESSION } from '../vendor/story-block/src/v2/packs/rules-v2.js';

export function parseNumberInput(raw) {
    if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Number(raw))) return { ok: false, error: 'Enter a finite number' };
    return { ok: true, value: Number(raw) };
}
export function parseIntegerInput(raw) {
    const result = parseNumberInput(raw);
    if (!result.ok || !/^-?\d+$/.test(raw.trim()) || !Number.isSafeInteger(result.value)) return { ok: false, error: 'Enter a whole number' };
    return result;
}
export function parseJsonInput(raw) {
    try {
        if (new TextEncoder().encode(raw).length > RULES_V2_LIMITS.packBytes) throw new Error('JSON exceeds the pack size limit');
        return { ok: true, value: JSON.parse(raw) };
    } catch (err) { return { ok: false, error: err.message }; }
}
export function createDefault(input, options = {}) {
    const schema = resolveSchema(input) || {};
    const { model, kind, path = [], used = [], partial = false } = options;
    const identities = model && ['id', 'slug'].includes(path.at(-1)) ? records(model, kind).map(record => localId(model, identity(record))) : [];
    const accepts = value => value !== undefined && validateField(schema, value).ok
        && !identities.includes(value) && !used.some(entry => JSON.stringify(entry) === JSON.stringify(value));
    if (schema.default !== undefined && accepts(schema.default)) return JSON.parse(JSON.stringify(schema.default));
    const target = referenceTarget(kind, path);
    if (schema.oneOf) {
        for (const part of schema.oneOf) {
            const value = createDefault(part, options);
            if (accepts(value)) return value;
        }
        return partial ? createDefault(schema.oneOf.find(part => part.type !== 'null'), { ...options, partial: true }) : undefined;
    }
    if (schema.type === 'null') return accepts(null) ? null : undefined;
    if (target && model && schema.type !== 'array' && schema.type !== 'object') {
        const entries = target === 'forms' ? formOptions(model) : records(model, target).map(identity);
        return entries.map(id => referenceId(model, schema, id)).find(accepts);
    }
    const candidates = [];
    if (schema.default !== undefined) candidates.push(schema.default);
    if (schema.const !== undefined) candidates.push(schema.const);
    if (schema.enum) candidates.push(...schema.enum);
    if (schema.type === 'array') {
        const value = [];
        for (let i = 0; i < (schema.minItems ?? 0); i++) {
            value.push(createDefault(schema.items, { ...options, path: [...path, i], used: schema.uniqueItems ? value : [] }));
        }
        if (partial || accepts(value)) return value;
    } else if (schema.type === 'object') {
        const value = Object.fromEntries((schema.required || []).map(key => [key, createDefault(schema.properties?.[key], { ...options, path: [...path, key], used: [] })]));
        if (kind === 'branches' && model && schema.properties?.fromForm && schema.properties?.choice) {
            const advanced = records(model, 'classes').filter(record => record?.tier === Math.max(...RULES_V2_PROGRESSION.tiers))
                .flatMap(record => Array.isArray(record.skills) ? record.skills.map(id => localId(model, id)) : []);
            const taken = new Set(records(model, 'branches').map(record => localId(model, identity(record))));
            const owner = id => advanced.filter(skill => id === `${skill}-base` || id.startsWith(`${skill}-base-`)).sort((a, b) => b.length - a.length)[0];
            const parent = formOptions(model).find(id => {
                const skill = owner(id);
                return skill && id.slice(`${skill}-base`.length).split('-').filter(Boolean).length < RULES_V2_PROGRESSION.pathwaySteps
                    && RULES_V2_PROGRESSION.writtenChoices.some(choice => !taken.has(`${id}-${choice}`));
            });
            if (parent) {
                value.skill = owner(parent);
                value.fromForm = parent;
                value.choice = RULES_V2_PROGRESSION.writtenChoices.find(choice => !taken.has(`${parent}-${choice}`));
                value.step = parent === `${value.skill}-base` ? 1 : 2;
                value.slug = `${parent}-${value.choice}`;
            } else if (!partial) return undefined;
        }
        if (partial || accepts(value)) return value;
    } else if (schema.type === 'boolean') candidates.push(false, true);
    else if (schema.type === 'number' || schema.type === 'integer') {
        const step = schema.multipleOf ?? 1;
        const lower = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + step : Math.min(0, schema.maximum ?? (schema.exclusiveMaximum !== undefined ? schema.exclusiveMaximum - step : 0)));
        const start = Math.ceil(lower / step) * step;
        for (let i = 0; i <= used.length + 1; i++) candidates.push(start + i * step);
    } else {
        if (['id', 'slug'].includes(path.at(-1))) candidates.push('new-record');
        candidates.push('', '[YOUR VALUE]', 'new-record', 'pack.pack/new-record', 'pl_00000001', 'STR', 'x'.repeat(schema.minLength ?? 0));
        for (let i = 1; i <= used.length + identities.length + 1; i++) candidates.push(`new-record-${i}`, `pack.pack/new-record-${i}`);
    }
    const value = candidates.find(accepts);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function display(value) { return safeLabel(value ?? ''); }
function matches(schema, value) {
    if (schema.oneOf) return schema.oneOf.some(s => matches(s, value));
    if (schema.const !== undefined) return Object.is(schema.const, value);
    if (schema.enum) return schema.enum.some(v => Object.is(v, value));
    if (schema.type === 'null') return value === null;
    if (schema.type === 'array') return Array.isArray(value);
    if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(schema.properties || {}).every(([k, s]) => s.const === undefined || Object.is(value[k], s.const));
    if (schema.type === 'integer') return Number.isInteger(value);
    return typeof value === schema.type;
}
function accept(ctx, schema, value) {
    const result = validateField(schema, value);
    if (!result.ok) ctx.notify(`${result.code}: ${result.message}`);
    return result.ok;
}
function mutate(ctx, path, value, options) {
    const checked = options.pending ? validateField(options.schema, value)
        : validateChange(options.rootSchema, options.rootValue, path.slice(options.rootPath.length), value);
    if (!checked.ok) { ctx.notify(`${checked.code}: ${checked.message}`); return false; }
    if (options.isNew) { options.onChange(value, path); return true; }
    if (['id', 'slug'].includes(path.at(-1)) && path.length > options.rootPath.length + 1) {
        const index = path.findIndex((part, i) => i >= options.rootPath.length && typeof part === 'number');
        if (index >= 0) {
            const listPath = path.slice(0, index);
            let current = ctx.model.document;
            for (const part of listPath) current = current?.[part];
            if (Array.isArray(current)) {
                const list = JSON.parse(JSON.stringify(current));
                let parent = list;
                for (const part of path.slice(index, -1)) parent = parent[part];
                parent[path.at(-1)] = value;
                return applyEdit(ctx, setField(ctx.model, listPath, list));
            }
        }
    }
    return applyEdit(ctx, setField(ctx.model, path, value, options));
}
function pathAttrs(path, options) { return { [options.isNew ? 'data-draft-path' : 'data-path']: JSON.stringify(path) }; }
function titleFor(path) { return typeof path.at(-1) === 'number' ? `Item ${path.at(-1) + 1}` : String(path.at(-1) || 'Record'); }

function withDefault(ctx, container, schema, path, options, commit, used = []) {
    const settings = { model: ctx.model, kind: options.kind, path, used };
    const value = createDefault(schema, settings);
    if (value !== undefined) return commit(value);
    const dialog = el(ctx.doc, 'dialog', '', { class: 'default-picker', 'aria-label': 'Choose required values' });
    const body = el(ctx.doc, 'div');
    const actions = el(ctx.doc, 'div', '', { class: 'row' });
    let draft = createDefault(schema, { ...settings, partial: true });
    const render = () => {
        body.replaceChildren();
        renderForm(ctx, body, schema, draft, path, {
            kind: options.kind, isNew: true, pending: true,
            onChange(next, changedPath) {
                const relative = changedPath.slice(path.length);
                if (!relative.length) draft = next;
                else {
                    const copy = JSON.parse(JSON.stringify(draft));
                    let parent = copy;
                    for (const key of relative.slice(0, -1)) parent = parent[key];
                    parent[relative.at(-1)] = next;
                    draft = copy;
                }
                render();
            },
        });
    };
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('close', () => dialog.remove());
    actions.append(button(ctx.doc, 'Cancel', close), button(ctx.doc, 'Add', () => {
        if (accept(ctx, schema, draft) && commit(draft)) close();
    }, { class: 'primary' }));
    dialog.append(el(ctx.doc, 'p', 'Choose the required values before adding.'), body, actions);
    (ctx.overlays || container).append(dialog);
    render(); dialog.showModal();
    return false;
}

export function formOptions(model) {
    const checked = validateRulesPack(model.document);
    if (checked.ok) return Object.keys(checked.resolved.forms).map(id => localId(model, id));
    const ids = [];
    for (const skill of records(model, 'skills')) {
        if (typeof skill?.slug !== 'string') continue;
        const slug = localId(model, skill.slug);
        const base = `${slug}-base`;
        ids.push(base);
        const owner = records(model, 'classes').find(c => Array.isArray(c?.skills) && c.skills.some(s => localId(model, s) === slug));
        if (owner?.tier !== Math.max(...RULES_V2_PROGRESSION.tiers)) continue;
        let parents = [base];
        for (let step = 0; step < RULES_V2_PROGRESSION.pathwaySteps; step++) {
            parents = parents.flatMap(parent => [...RULES_V2_PROGRESSION.writtenChoices, RULES_V2_PROGRESSION.generatedChoice].map(choice => `${parent}-${choice}`));
            ids.push(...parents);
        }
    }
    return ids;
}

export function renderForm(ctx, container, input, value, path, passed = {}) {
    const schema = resolveSchema(input) || {};
    const options = { ...passed, rootPath: passed.rootPath || path, rootSchema: passed.rootSchema || schema, rootValue: passed.rootPath ? passed.rootValue : value, schema };
    const doc = ctx.doc;
    const title = options.label || titleFor(path);
    const attrs = pathAttrs(path, options);
    const append = control => { container.append(field(doc, title, control)); return control; };
    const commit = next => mutate(ctx, path, next, options);
    const leaf = schema.type !== 'array' && schema.type !== 'object' && !Array.isArray(value) && !(value && typeof value === 'object');
    const idField = path.length === options.rootPath.length + 1 && ['slug', 'id', 'def'].includes(path.at(-1));
    if (schema.const !== undefined || (idField && path.at(-1) === 'def' && options.kind === 'itemRules' && !options.isNew)) {
        const control = append(el(doc, 'input', '', { ...attrs, readonly: '', value: display(value) }));
        control.readOnly = true;
        if (schema.const === undefined) container.append(el(doc, 'p', 'Rename the item to change this reference.', { class: 'muted' }));
        if (schema.const !== undefined && !Object.is(value, schema.const)) container.append(button(doc, `Reset ${title}`, () => commit(schema.const)));
        return;
    }
    const target = leaf ? referenceTarget(options.kind, path, options.record) : null;
    if (target) { renderReference(ctx, container, target, schema, value, path, options, title); return; }
    if (schema.oneOf) {
        const group = el(doc, 'fieldset', '', { class: 'form-fieldset union-group', ...attrs });
        group.append(el(doc, 'legend', title));
        const active = schema.oneOf.findIndex(s => matches(s, value));
        const select = el(doc, 'select', '', attrs);
        const placeholder = el(doc, 'option', value === undefined ? '(not set)' : '(invalid current value)', { value: '' });
        placeholder.selected = active < 0; select.append(placeholder);
        schema.oneOf.forEach((s, i) => {
            const discriminator = Object.entries(s.properties || {}).find(([, v]) => v.const !== undefined);
            const caption = s.title || discriminator?.[1].const || (s.type === 'null' ? '(none / null)' : s.type || s.enum?.join(' / ') || `Option ${i + 1}`);
            const option = el(doc, 'option', caption, { value: String(i) });
            option.selected = i === active; select.append(option);
        });
        group.append(field(doc, `${title} variant`, select));
        select.addEventListener('change', () => {
            if (select.value === '') return;
            const variant = schema.oneOf[Number(select.value)];
            const changed = withDefault(ctx, container, variant, path, options, next => {
                if (next && typeof next === 'object' && value && typeof value === 'object') {
                    for (const [key, child] of Object.entries(variant.properties || {})) {
                        if (child.const === undefined && Object.hasOwn(value, key) && validateField(child, value[key]).ok) next[key] = value[key];
                    }
                }
                return commit(next);
            });
            if (!changed) select.value = active < 0 ? '' : String(active);
        });
        if (active >= 0 && schema.oneOf[active].type !== 'null') renderForm(ctx, group, schema.oneOf[active], value, path, { ...options, label: title });
        else if (active < 0 && value !== undefined) renderJson(ctx, group, value, path, options, `${title} current value`);
        container.append(group); return;
    }
    if (schema.enum) {
        const select = append(el(doc, 'select', '', attrs));
        schema.enum.forEach(choice => {
            const option = el(doc, 'option', display(choice), { value: String(choice) });
            option.selected = Object.is(choice, value); select.append(option);
        });
        if (!schema.enum.some(v => Object.is(v, value))) {
            const current = el(doc, 'option', `${display(value)} (invalid)`, { value: '__current__', disabled: '' });
            current.selected = true; select.append(current);
        }
        select.addEventListener('change', () => {
            if (select.value !== '__current__' && !commit(schema.enum.find(v => String(v) === select.value))) select.value = schema.enum.some(v => Object.is(v, value)) ? String(value) : '__current__';
        });
        return;
    }
    if (schema.type === 'object' || schema.type === 'array') {
        const correct = schema.type === 'array' ? Array.isArray(value) : value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!correct) {
            if (value !== undefined) renderJson(ctx, container, value, path, options, `${title} current value`);
            container.append(button(doc, `Initialize ${title}`, () => withDefault(ctx, container, schema, path, options, commit), attrs)); return;
        }
        if (schema.type === 'array') {
            const group = el(doc, 'fieldset', '', { class: 'array-group', ...attrs });
            group.append(el(doc, 'legend', title));
            value.forEach((entry, i) => {
                const row = el(doc, 'div', '', { class: 'array-row' });
                const body = el(doc, 'div', '', { class: 'array-row-control' });
                renderForm(ctx, body, schema.items, entry, [...path, i], { ...options, label: `${title} ${i + 1}` });
                row.append(body, button(doc, 'Remove', () => commit(value.filter((_, index) => index !== i)), { class: 'danger', 'aria-label': `Remove ${title} ${i + 1}` }));
                group.append(row);
            });
            const add = button(doc, '+ Add item', () => withDefault(ctx, container, schema.items, [...path, value.length], options,
                next => commit([...value, next]), schema.uniqueItems ? value : []), { class: 'array-add-btn', 'aria-label': `Add ${title} item` });
            add.disabled = value.length >= (schema.maxItems ?? Infinity);
            group.append(add);
            container.append(group); return;
        }
        if (!schema.properties) { renderJson(ctx, container, value, path, options, title); return; }
        const group = el(doc, 'fieldset', '', { class: 'form-fieldset', ...attrs });
        group.append(el(doc, 'legend', title));
        for (const [key, childSchema] of Object.entries(schema.properties)) {
            const row = el(doc, 'div', '', { class: 'fieldset-row' });
            const present = Object.hasOwn(value, key);
            const required = schema.required?.includes(key);
            if (present || required) renderForm(ctx, row, childSchema, value[key], [...path, key], { ...options, label: key });
            if (!required) row.append(button(doc, present ? 'Clear' : `Enable ${key}`, () => {
                const next = { ...value };
                if (present) { delete next[key]; commit(next); }
                else withDefault(ctx, container, childSchema, [...path, key], options, entry => commit({ ...value, [key]: entry }));
            }, { class: present ? 'clear-btn' : 'enable-btn', 'aria-label': `${present ? 'Clear' : 'Enable'} ${key}` }));
            group.append(row);
        }
        if (Object.keys(value).some(k => !Object.hasOwn(schema.properties, k))) {
            const details = el(doc, 'details', '', { class: 'advanced-json' });
            details.append(el(doc, 'summary', 'Other fields (JSON)'));
            renderJson(ctx, details, value, path, options, `${title} including other fields`); group.append(details);
        }
        container.append(group); return;
    }
    if (schema.type === 'boolean') {
        const control = append(el(doc, 'input', '', { ...attrs, type: 'checkbox' }));
        control.checked = value === true;
        control.addEventListener('change', () => { if (!commit(control.checked)) control.checked = value === true; }); return;
    }
    const numeric = schema.type === 'number' || schema.type === 'integer';
    const multiline = path.at(-1) === 'note' || (schema.maxLength ?? 0) > 160;
    const control = append(el(doc, multiline ? 'textarea' : 'input', '', { ...attrs, ...(numeric ? { type: 'number', step: schema.type === 'integer' ? '1' : 'any' } : {}) }));
    control.value = display(value);
    control.addEventListener('change', () => {
        let next = control.value;
        if (numeric) {
            const result = schema.type === 'integer' ? parseIntegerInput(next) : parseNumberInput(next);
            if (!result.ok) { ctx.notify(`bad-value: ${result.error}`); control.value = display(value); return; }
            next = result.value;
        }
        if (idField && !options.isNew) {
            if (!accept(ctx, schema, next)) { control.value = display(value); return; }
            const result = renameId(ctx.model, options.kind, identity(options.record), next);
            applyEdit(ctx, result, { id: localId(result.model, next) });
        } else if (!commit(next)) control.value = display(value);
    });
}

function renderJson(ctx, container, value, path, options, title) {
    const control = el(ctx.doc, 'textarea', '', { ...pathAttrs(path, options), class: 'mono json-textarea' });
    control.value = JSON.stringify(value, null, 2) ?? '';
    control.addEventListener('change', () => {
        const result = parseJsonInput(control.value);
        if (!result.ok) { ctx.notify(`bad-value: ${result.error}`); control.value = JSON.stringify(value, null, 2) ?? ''; }
        else if (!mutate(ctx, path, result.value, options)) control.value = JSON.stringify(value, null, 2) ?? '';
    });
    container.append(field(ctx.doc, title, control));
}
export function referenceId(model, input, id) {
    if (typeof id !== 'string') return null;
    const schema = resolveSchema(input) || {};
    const accepts = (s, value) => s.oneOf ? s.oneOf.some(part => accepts(part, value))
        : s.type !== 'null' && (!s.pattern || new RegExp(s.pattern, 'u').test(value))
            && value.length >= (s.minLength ?? 0) && value.length <= (s.maxLength ?? Infinity);
    const local = localId(model, id);
    const qualified = `pack.${safeLabel(model?.document?.id)}/${local}`;
    return [id, local, qualified].find(value => accepts(schema, value)) ?? null;
}

let referenceSequence = 0;
function renderReference(ctx, container, target, schema, value, path, options, title) {
    const doc = ctx.doc;
    const current = display(value);
    const entries = target === 'forms' ? formOptions(ctx.model).map(id => ({ slug: id })) : records(ctx.model, target);
    const choices = entries.filter(r => typeof identity(r) === 'string').map(r => {
        const same = localId(ctx.model, identity(r)) === localId(ctx.model, current);
        const id = referenceId(ctx.model, schema, same ? current : identity(r));
        return { id, name: safeLabel(r.name ?? identity(r)) };
    }).filter(choice => choice.id !== null);
    const external = ['places', 'npcs', 'threads'].includes(target);
    const control = el(doc, external ? 'input' : 'select', '', pathAttrs(path, options));
    const list = external ? el(doc, 'datalist', '', { id: `reference-${++referenceSequence}` }) : control;
    if (external) control.setAttribute('list', list.id);
    else { const empty = el(doc, 'option', '(none / clear)', { value: '' }); empty.selected = !current; list.append(empty); }
    for (const choice of choices) {
        const option = el(doc, 'option', `${choice.name} (${choice.id})`, { value: choice.id });
        option.selected = choice.id === current; list.append(option);
    }
    if (current && !choices.some(c => c.id === current)) {
        const isExternal = external && !current.startsWith(`pack.${safeLabel(ctx.model?.document?.id)}/`)
            && (current.includes('/') || /^[a-z]+_[0-9a-z]{8}$/.test(current));
        const caption = `${current} (${isExternal ? 'external' : 'missing'})`;
        if (external) container.append(el(doc, 'p', caption, { class: 'muted' }));
        else {
            const option = el(doc, 'option', caption, { value: current, disabled: '' });
            option.selected = true; list.append(option);
        }
    }
    if (external) control.value = current;
    control.addEventListener('change', () => {
        const next = control.value ? referenceId(ctx.model, schema, control.value)
            : (schema.oneOf?.some(s => s.type === 'null') ? null : '');
        const known = external || choices.some(choice => choice.id === next) || !control.value;
        if ((next === null && control.value) || !known) {
            ctx.notify('bad-ref: Choose an existing ID or a valid external reference');
            control.value = current;
        } else if (!mutate(ctx, path, next, options)) control.value = current;
    });
    container.append(field(doc, title, control));
    if (external) container.append(list);
}
