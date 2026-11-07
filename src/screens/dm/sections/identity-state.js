// The module's identity (slug, name, scope, IDs) and its state fields, each field with its own schema controls.
import { el, button, selectControl, textControl, intControl, nameControl, card, row, note, heading } from '../ui.js';
import { schemaControls } from '../schema.js';
import { SCOPES, FIELD_TYPES } from '../../../data-modules/hints.js';
import { makeTarget, uniqueName, defaultSchema } from '../../../data-modules/forms.js';
import { entries, own, moduleId, shortRef } from '../../../data-modules/dm-model.js';
import { keysOf, obj, budget } from './shared.js';

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
