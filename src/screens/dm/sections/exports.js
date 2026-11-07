// The exports section: the fields each export shares with other data modules, through its named public view.
import { el, button, checkControl, nameControl, card, row, note, heading } from '../ui.js';
import { makeTarget, uniqueName } from '../../../data-modules/forms.js';
import { entries, list, own, isObject } from '../../../data-modules/dm-model.js';
import { keysOf, obj } from './shared.js';

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
