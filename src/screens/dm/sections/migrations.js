// The migrations section: additive migrations between state versions, and the check of a draft against an earlier published pack.
import { el, button, selectControl, textControl, intControl, card, note, heading, safeLabel } from '../ui.js';
import { schemaControls } from '../schema.js';
import { FIELD_TYPES } from '../../../data-modules/hints.js';
import { defaultSchema, newMigration } from '../../../data-modules/forms.js';
import { entries, own, clone, isObject } from '../../../data-modules/dm-model.js';
import { checkMigration } from '../../../data-modules/sb-adapter.js';
import { parseJsonInput } from '../../../forms.js';
import { obj, arr } from './shared.js';

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
