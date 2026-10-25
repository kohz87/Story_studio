import { safeLabel, el, button, field } from './dom.js';
import { setField, renameId } from './edits.js';
import { records, identity, localId } from './records.js';
import { referenceTarget, resolveSchema } from './form-schema.js';
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
export function createDefault(input) {
    const schema = resolveSchema(input) || {};
    if (schema.default !== undefined) return JSON.parse(JSON.stringify(schema.default));
    if (schema.const !== undefined) return schema.const;
    if (schema.enum) return schema.enum[0];
    if (schema.oneOf) return createDefault(schema.oneOf.find(s => s.type !== 'null') || { type: 'null' });
    if (schema.type === 'null') return null;
    if (schema.type === 'array') return [];
    if (schema.type === 'object') return Object.fromEntries((schema.required || []).filter(k => schema.properties?.[k]).map(k => [k, createDefault(schema.properties[k])]));
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
    return '';
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
function mutate(ctx, path, value, options) {
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
                return ctx.apply(setField(ctx.model, listPath, list));
            }
        }
    }
    return ctx.apply(setField(ctx.model, path, value));
}
function pathAttrs(path, options) { return { [options.isNew ? 'data-draft-path' : 'data-path']: JSON.stringify(path) }; }
function titleFor(path) { return typeof path.at(-1) === 'number' ? `Item ${path.at(-1) + 1}` : String(path.at(-1) || 'Record'); }

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
    const options = { ...passed, rootPath: passed.rootPath || path };
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
            const next = createDefault(variant);
            if (next && typeof next === 'object' && value && typeof value === 'object') {
                for (const [key, child] of Object.entries(variant.properties || {})) {
                    if (child.const === undefined && Object.hasOwn(value, key) && matches(child, value[key])) next[key] = value[key];
                }
            }
            commit(next);
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
            const current = el(doc, 'option', `${display(value)} (invalid)`, { value: '__current__' });
            current.selected = true; select.append(current);
        }
        select.addEventListener('change', () => { if (select.value !== '__current__') commit(schema.enum.find(v => String(v) === select.value)); });
        return;
    }
    if (schema.type === 'object' || schema.type === 'array') {
        const correct = schema.type === 'array' ? Array.isArray(value) : value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!correct) {
            if (value !== undefined) renderJson(ctx, container, value, path, options, `${title} current value`);
            container.append(button(doc, `Initialize ${title}`, () => commit(createDefault(schema)), attrs)); return;
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
            group.append(button(doc, '+ Add item', () => commit([...value, createDefault(schema.items)]), { class: 'array-add-btn', 'aria-label': `Add ${title} item` }));
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
                if (present) delete next[key]; else next[key] = createDefault(childSchema);
                commit(next);
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
            const result = renameId(ctx.model, options.kind, identity(options.record), next);
            if (result.ok) { ctx.selection.id = localId(result.model, next); ctx.apply(result); }
            else { ctx.apply(result); control.value = display(value); }
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
let referenceSequence = 0;
function renderReference(ctx, container, target, schema, value, path, options, title) {
    const doc = ctx.doc;
    const current = display(value);
    const entries = target === 'forms' ? formOptions(ctx.model).map(id => ({ slug: id })) : records(ctx.model, target);
    const choices = entries.filter(r => typeof identity(r) === 'string').map(r => ({ id: localId(ctx.model, identity(r)), name: typeof r.name === 'string' ? r.name : identity(r) }));
    const external = ['places', 'npcs', 'threads'].includes(target);
    const control = el(doc, external ? 'input' : 'select', '', pathAttrs(path, options));
    const list = external ? el(doc, 'datalist', '', { id: `reference-${++referenceSequence}` }) : control;
    if (external) control.setAttribute('list', list.id);
    else { const empty = el(doc, 'option', '(none / clear)', { value: '' }); empty.selected = !current; list.append(empty); }
    for (const choice of choices) {
        const option = el(doc, 'option', `${safeLabel(choice.name)} (${safeLabel(choice.id)})`, { value: choice.id });
        option.selected = choice.id === current; list.append(option);
    }
    if (current && !choices.some(c => c.id === current)) {
        const option = el(doc, 'option', `${current} (current)`, { value: current }); option.selected = true; list.append(option);
    }
    if (external) control.value = current;
    control.addEventListener('change', () => {
        const next = control.value || (schema.oneOf?.some(s => s.type === 'null') ? null : '');
        if (!mutate(ctx, path, next, options)) control.value = current;
    });
    container.append(field(doc, title, control));
    if (external) container.append(list);
}
