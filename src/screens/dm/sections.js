// The Data modules form sections. Each takes the section context S:
//   { doc, studio, draft, document, packId, touch(), redraw(), refuse(errors), rename(target, name), remove(target) }
// and draws into `host`. They edit the draft record in place; nothing reaches the pack until Apply.
import { el, button, selectControl, textControl, intControl, checkControl, nameControl, card, row, note, heading, move, safeLabel } from './ui.js';
import { drawExpression } from './expression.js';
import { drawEffects } from './effects.js';
import { schemaControls } from './schema.js';
import { SCOPES, FIELD_TYPES, LINE_OPS, PICKS, IMPORT_MODES, IMPORT_ADAPTERS, MOUNTS, V11_MESSAGE } from '../../data-modules/hints.js';
import { isRangeTable, newRangeTable, defaultSchema, newKind, newLabel, newRule, newTemplate, newTimer, newMigration, newImport, adapterOf, makeTarget, uniqueName } from '../../data-modules/forms.js';
import { entries, list, own, isObject, clone, modulesOf, moduleId, shortRef, renameKey } from '../../data-modules/dm-model.js';
import { limits, status, checkMigration } from '../../data-modules/sb-adapter.js';
import { parseJsonInput } from '../../forms.js';

const keysOf = value => Object.keys(isObject(value) ? value : {});
const obj = (draft, key) => { if (!isObject(draft[key])) draft[key] = {}; return draft[key]; };
const arr = (draft, key) => { if (!Array.isArray(draft[key])) draft[key] = []; return draft[key]; };

function budget(S, label, count, key) {
    const max = limits().values[key];
    return note(S.doc, `${count} ${label}${typeof max === 'number' ? ` · Story Block limit ${max}` : ''}`);
}

function expressionContext(S, where, owner) { return { module: S.draft, where, owner }; }

function condition(S, host, holder, key, where, owner) {
    const { doc } = S;
    const present = own(holder, key);
    checkControl(doc, host, `Has a condition (${key})`, present, on => {
        if (on) holder[key] = true;
        else delete holder[key];
        S.redraw();
    });
    if (present) {
        const box = el(doc, 'div', '', { class: 'effect-slot' });
        host.append(box);
        drawExpression(doc, box, holder[key], 'bool', next => { holder[key] = next; S.touch(); }, expressionContext(S, where, owner));
    }
}

export function identity(S, host) {
    const { doc, draft } = S;
    textControl(doc, host, 'Slug', draft.slug, v => { draft.slug = v; S.touch(); }, { id: 'dm-slug' });
    textControl(doc, host, 'Name', draft.name, v => { draft.name = v; S.touch(); }, { id: 'dm-name' });
    intControl(doc, host, 'Language version (schema)', draft.schema, v => { draft.schema = v; S.touch(); });
    intControl(doc, host, 'State version', draft.stateVersion, v => { draft.stateVersion = v; S.touch(); });
    selectControl(doc, host, 'Scope', [...SCOPES], draft.scope, v => { draft.scope = v; S.redraw(); }, { id: 'dm-scope' });
    host.append(note(doc, draft.scope === 'character'
        ? 'One instance per attached Story Director character. Lines name the character with who.'
        : 'One instance for the whole chat. A line may not name who.'));
    const id = moduleId(S.document, draft);
    host.append(el(doc, 'p', `Module ID: ${id}`, { id: 'dm-module-id' }), el(doc, 'p', `Narrator reference: ${shortRef({ ...S.document, content: { ...S.document.content, dataModules: S.others.concat([draft]) } }, draft)}`, { id: 'dm-short-ref' }));
    host.append(note(doc, 'Changing the slug here does not update other modules or screens. Use References, Rename module, to rewrite every reference.'));
}

export function fields(S, host) {
    const { doc, draft } = S;
    const state = obj(draft, 'state');
    host.append(budget(S, 'fields', keysOf(state).length, 'fields'));
    for (const [name, schema] of entries(state)) {
        const box = card(doc);
        box.setAttribute('data-field', name);
        box.append(heading(doc, name));
        nameControl(doc, box, `Field name (${name})`, name, next => S.rename(makeTarget(S.packId, draft, 'dm.field', name), next));
        schemaControls(doc, box, schema, S);
        box.append(button(doc, 'Remove field', () => S.remove(makeTarget(S.packId, draft, 'dm.field', name)), { 'aria-label': `Remove field ${name}` }));
        host.append(box);
    }
    const adder = row(doc);
    const type = selectControl(doc, adder, 'New field type', [...FIELD_TYPES], 'int', () => {});
    const name = el(doc, 'input', '', { 'aria-label': 'New field name', placeholder: 'field name' });
    adder.append(name, button(doc, 'Add field', () => {
        const key = name.value.trim() || uniqueName(Object.keys(state), 'field');
        if (own(state, key)) { S.refuse([{ code: 'duplicate', path: `state.${key}`, message: `Field "${key}" already exists.` }]); return; }
        if (['__proto__', 'constructor', 'prototype'].includes(key)) { S.refuse([{ code: 'bad-edit', path: 'state', message: 'That name is not allowed.' }]); return; }
        state[key] = defaultSchema(type.value);
        S.redraw();
    }));
    host.append(adder);
}

function importControls(S, box, alias, spec) {
    const { doc, draft, document } = S;
    const adapter = adapterOf(spec);
    selectControl(doc, box, `Adapter for ${alias}`, IMPORT_ADAPTERS.map(item => [item.id, item.label]), adapter?.id ?? '', next => {
        draft.imports[alias] = newImport(next, draft, document);
        S.redraw();
    }, { blank: adapter ? undefined : 'unpublished query' });
    if (!adapter) box.append(note(doc, `Query "${safeLabel(spec?.query)}" is not a published adapter. Story Block refuses it; choose an adapter above.`, 'warning'));
    selectControl(doc, box, `Mode for ${alias}`, [...IMPORT_MODES], spec?.mode, v => { spec.mode = v; S.touch(); });
    if (adapter && adapter.id !== 'data-module') {
        const choices = adapter.choices;
        const chosen = list(spec.projection);
        for (const choice of choices) {
            checkControl(doc, box, `${alias} projects ${choice}`, chosen.includes(choice), on => {
                spec.projection = choices.filter(item => (item === choice ? on : chosen.includes(item)));
                S.touch();
            });
        }
        const caps = list(document.requires?.capabilities);
        if (adapter.capability && !caps.includes(adapter.capability)) box.append(note(doc, `This import needs the ${adapter.capability} capability in the pack's requires.`, 'warning'));
    } else if (adapter) {
        if (!isObject(spec.args)) spec.args = { module: '', export: '' };
        const others = modulesOf(document).filter(other => other && other.slug !== draft.slug);
        const idOf = other => `pack.${S.packId}/${other.slug}`;
        selectControl(doc, box, `Module imported by ${alias}`, others.map(other => [idOf(other), idOf(other)]), spec.args.module, v => {
            const picked = others.find(other => idOf(other) === v);
            spec.args.module = v;
            spec.args.export = keysOf(picked?.exports)[0] ?? '';
            if (picked?.scope === 'character') spec.args.who ??= 'ca_actor'; else delete spec.args.who;
            spec.projection = [];
            S.redraw();
        }, { blank: 'choose a module in this pack' });
        const source = others.find(other => idOf(other) === spec.args.module);
        selectControl(doc, box, `Export imported by ${alias}`, keysOf(source?.exports), spec.args.export, v => { spec.args.export = v; spec.projection = list(source?.exports?.[v]?.fields); S.redraw(); }, { blank: 'choose an export' });
        const available = list(source?.exports?.[spec.args.export]?.fields).map(String);
        for (const choice of available) {
            checkControl(doc, box, `${alias} projects ${choice}`, list(spec.projection).includes(choice), on => {
                spec.projection = available.filter(item => (item === choice ? on : list(spec.projection).includes(item)));
                S.touch();
            });
        }
        if (source?.scope === 'character' || own(spec.args, 'who')) textControl(doc, box, `Character ID for ${alias} (ca_\u2026)`, spec.args.who, v => { if (v === '') delete spec.args.who; else spec.args.who = v; S.touch(); });
        textControl(doc, box, `Module ID outside this pack (${alias})`, spec.args.module, v => { spec.args.module = v; S.touch(); });
    }
}

export function imports(S, host) {
    const { doc, draft } = S;
    const map = obj(draft, 'imports');
    host.append(note(doc, 'Only published adapters can be imported: Story Director minutes, Story Director actors, or another data module’s export.'), budget(S, 'imports', keysOf(map).length, 'imports'));
    for (const [alias, spec] of entries(map)) {
        const box = card(doc);
        box.setAttribute('data-import', alias);
        box.append(heading(doc, alias));
        nameControl(doc, box, `Import alias (${alias})`, alias, next => S.rename(makeTarget(S.packId, draft, 'dm.alias', alias), next));
        if (!isObject(spec)) box.append(note(doc, 'This import is not an object. Fix it in the record JSON.', 'warning'));
        else importControls(S, box, alias, spec);
        box.append(button(doc, 'Remove import', () => S.remove(makeTarget(S.packId, draft, 'dm.alias', alias)), { 'aria-label': `Remove import ${alias}` }));
        host.append(box);
    }
    const adder = row(doc);
    const kind = selectControl(doc, adder, 'New import adapter', IMPORT_ADAPTERS.map(item => [item.id, item.label]), IMPORT_ADAPTERS[0].id, () => {});
    const name = el(doc, 'input', '', { 'aria-label': 'New import alias', placeholder: 'alias' });
    adder.append(name, button(doc, 'Add import', () => {
        const key = name.value.trim() || uniqueName(keysOf(map), 'import');
        if (own(map, key)) { S.refuse([{ code: 'duplicate', path: `imports.${key}`, message: `Import "${key}" already exists.` }]); return; }
        map[key] = newImport(kind.value, draft, S.document);
        S.redraw();
    }));
    host.append(adder);
}

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

export function rules(S, host) {
    const { doc, draft } = S;
    const all = arr(draft, 'rules');
    host.append(note(doc, 'Rules run once, in this order, after a line’s effects. A false rule is skipped; rules never trigger other rules.'), budget(S, 'rules', all.length, 'rules'));
    all.forEach((rule, index) => {
        const box = card(doc);
        box.setAttribute('data-rule', String(rule?.id ?? index));
        if (!isObject(rule)) { box.append(note(doc, 'This rule is not an object. Remove it, or fix it in the record JSON.', 'warning')); host.append(box); return; }
        box.append(heading(doc, `${index + 1}. ${safeLabel(rule.id ?? 'rule')}`));
        textControl(doc, box, `Rule id (${index + 1})`, rule.id, v => { rule.id = v; S.touch(); });
        box.append(heading(doc, 'When', 'h4'));
        const holder = el(doc, 'div', '', { class: 'effect-slot' });
        box.append(holder);
        drawExpression(doc, holder, rule.when, 'bool', next => { rule.when = next; S.touch(); }, expressionContext(S, 'rule', rule.id));
        box.append(heading(doc, 'Then', 'h4'));
        drawEffects(doc, box, arr(rule, 'then'), { ...S, where: 'rule', owner: rule.id, label: `rule ${rule.id ?? index + 1}`, expr: expressionContext(S, 'rule', rule.id) });
        box.append(row(doc, button(doc, 'Up', () => { if (move(all, index, index - 1)) S.redraw(); }, { 'aria-label': `Move rule ${index + 1} up` }),
            button(doc, 'Down', () => { if (move(all, index, index + 1)) S.redraw(); }, { 'aria-label': `Move rule ${index + 1} down` }),
            button(doc, 'Remove rule', () => { all.splice(index, 1); S.redraw(); }, { 'aria-label': `Remove rule ${index + 1}` })));
        host.append(box);
    });
    host.append(button(doc, 'Add rule', () => { all.push(newRule(draft)); S.redraw(); }));
}

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

export function timers(S, host) {
    const { doc, draft } = S;
    const all = arr(draft, 'timers');
    host.append(note(doc, 'A timer adds to fields once per whole period of story time on an imported clock. Effects are additive only.'), budget(S, 'timers', all.length, 'timers'));
    all.forEach((timer, index) => {
        const box = card(doc);
        box.setAttribute('data-timer', String(timer?.id ?? index));
        if (!isObject(timer)) { box.append(note(doc, 'This timer is not an object. Remove it, or fix it in the record JSON.', 'warning')); host.append(box); return; }
        box.append(heading(doc, `${index + 1}. ${safeLabel(timer.id ?? 'timer')}`));
        textControl(doc, box, `Timer id (${index + 1})`, timer.id, v => { timer.id = v; S.touch(); });
        selectControl(doc, box, `Clock for timer ${index + 1}`, keysOf(draft.imports), typeof timer.clock === 'string' ? timer.clock : '', v => { timer.clock = v; S.touch(); }, { blank: 'choose an import' });
        if (!keysOf(draft.imports).length) box.append(note(doc, 'Add a Story Director minutes import first.', 'warning'));
        intControl(doc, box, `Every (minutes) for timer ${index + 1}`, timer.every, v => { timer.every = v; S.touch(); });
        box.append(heading(doc, 'Each period', 'h4'));
        drawEffects(doc, box, arr(timer, 'effects'), { ...S, where: 'timer', owner: timer.id, label: `timer ${timer.id ?? index + 1}`, expr: expressionContext(S, 'timer', timer.id) });
        box.append(row(doc, button(doc, 'Up', () => { if (move(all, index, index - 1)) S.redraw(); }, { 'aria-label': `Move timer ${index + 1} up` }),
            button(doc, 'Down', () => { if (move(all, index, index + 1)) S.redraw(); }, { 'aria-label': `Move timer ${index + 1} down` }),
            button(doc, 'Remove timer', () => { all.splice(index, 1); S.redraw(); }, { 'aria-label': `Remove timer ${index + 1}` })));
        host.append(box);
    });
    host.append(button(doc, 'Add timer', () => { all.push(newTimer(draft)); S.redraw(); }));
}

export function exportsSection(S, host) {
    const { doc, draft } = S;
    const map = obj(draft, 'exports');
    host.append(note(doc, 'Exports are the only fields other data modules can read, through a named public view.'));
    const fieldNames = keysOf(draft.state);
    for (const [name, spec] of entries(map)) {
        const box = card(doc);
        box.setAttribute('data-export', name);
        box.append(heading(doc, name));
        nameControl(doc, box, `Export name (${name})`, name, next => S.rename(makeTarget(S.packId, draft, 'dm.export', name), next));
        if (!isObject(spec)) { box.append(note(doc, 'This export is not an object. Fix it in the record JSON.', 'warning')); host.append(box); continue; }
        for (const field of fieldNames) {
            checkControl(doc, box, `${name} exports ${field}`, list(spec.fields).includes(field), on => {
                spec.fields = fieldNames.filter(item => (item === field ? on : list(spec.fields).includes(item)));
                S.touch();
            });
        }
        const stale = list(spec.fields).filter(field => !fieldNames.includes(field));
        if (stale.length) box.append(note(doc, `Not a declared field: ${stale.join(', ')}`, 'warning'));
        box.append(button(doc, 'Remove export', () => S.remove(makeTarget(S.packId, draft, 'dm.export', name)), { 'aria-label': `Remove export ${name}` }));
        host.append(box);
    }
    const adder = row(doc);
    const name = el(doc, 'input', '', { 'aria-label': 'New export name', placeholder: 'export' });
    adder.append(name, button(doc, 'Add export', () => {
        const key = name.value.trim() || uniqueName(Object.keys(map), 'export');
        if (own(map, key)) { S.refuse([{ code: 'duplicate', path: `exports.${key}`, message: `Export "${key}" already exists.` }]); return; }
        map[key] = { fields: [] };
        S.redraw();
    }));
    host.append(adder);
}

/** Asks Story Block whether this draft is an additive migration of an earlier published pack (nothing is stored). */
function migrationCheck(S) {
    const { doc, draft } = S;
    const box = card(doc, heading(doc, 'Check against an earlier version', 'h4'),
        note(doc, 'Paste the pack JSON you published before. Story Block compares the module in it with this draft and says whether the change is an additive migration; anything else needs a new timeline.'));
    const earlier = textControl(doc, box, 'Earlier pack JSON', '', () => {}, { multiline: true, rows: 4, id: 'dm-migration-earlier' });
    const result = el(doc, 'div', '', { id: 'dm-migration-result', role: 'status', 'aria-live': 'polite' });
    box.append(button(doc, 'Check migration', () => {
        result.replaceChildren();
        const parsed = parseJsonInput(earlier.value);
        if (!parsed.ok || !isObject(parsed.value)) { result.append(note(doc, `JSON refused: ${parsed.ok ? 'a pack is a JSON object' : parsed.error}`, 'warning')); return; }
        const verdict = checkMigration(parsed.value, S.candidateDocument(), draft.slug);
        if (verdict.waiting) result.append(note(doc, `${verdict.message}.`, 'warning'));
        else if (verdict.ok) result.append(note(doc, `Compatible: an additive migration${Object.keys(verdict.add ?? {}).length ? ` adding ${Object.keys(verdict.add).join(', ')}` : ''}.`, 'muted'));
        else for (const error of verdict.errors.slice(0, 20)) result.append(el(doc, 'p', `${safeLabel(error.code)} \u00b7 ${safeLabel(error.path)}: ${safeLabel(error.message)}`, { class: 'warning' }));
    }), result);
    return box;
}

export function migrations(S, host) {
    const { doc, draft } = S;
    const all = arr(draft, 'migrations');
    host.append(note(doc, 'v1 migrations are additive only: new fields with defaults between adjacent state versions (at most four steps). Anything else needs a new timeline.'));
    const helper = card(doc, heading(doc, 'Add a field with a migration', 'h4'));
    const name = el(doc, 'input', '', { 'aria-label': 'Migration field name', placeholder: 'new field' });
    const type = selectControl(doc, helper, 'Migration field type', [...FIELD_TYPES], 'int', () => {});
    helper.append(name, button(doc, 'Add field and migration', () => {
        const key = name.value.trim();
        const state = obj(draft, 'state');
        if (!key || own(state, key)) { S.refuse([{ code: 'duplicate', path: `state.${key}`, message: key ? `Field "${key}" already exists.` : 'Name the new field.' }]); return; }
        if (['__proto__', 'constructor', 'prototype'].includes(key)) { S.refuse([{ code: 'bad-edit', path: 'state', message: 'That name is not allowed.' }]); return; }
        const step = newMigration(draft);
        const schema = defaultSchema(type.value);
        state[key] = clone(schema);
        step.add = { [key]: schema };
        all.push(step);
        draft.stateVersion = step.to;
        S.redraw();
    }));
    host.append(helper);
    host.append(migrationCheck(S));
    all.forEach((step, index) => {
        const box = card(doc);
        box.setAttribute('data-migration', String(index));
        if (!isObject(step)) { box.append(note(doc, 'This migration is not an object. Remove it, or fix it in the record JSON.', 'warning')); host.append(box); return; }
        box.append(heading(doc, `Version ${safeLabel(step.from)} to ${safeLabel(step.to)}`));
        intControl(doc, box, `Migration ${index + 1} from`, step.from, v => { step.from = v; S.touch(); });
        intControl(doc, box, `Migration ${index + 1} to`, step.to, v => { step.to = v; S.touch(); });
        for (const [field, schema] of entries(step.add)) {
            const part = card(doc, heading(doc, `adds ${field}`, 'h4'));
            schemaControls(doc, part, schema, S);
            part.append(button(doc, 'Remove added field', () => { delete step.add[field]; S.redraw(); }, { 'aria-label': `Remove ${field} from migration ${index + 1}` }));
            box.append(part);
        }
        box.append(button(doc, 'Remove migration', () => { all.splice(index, 1); S.redraw(); }, { 'aria-label': `Remove migration ${index + 1}` }));
        host.append(box);
    });
}

export { MOUNTS, status };
