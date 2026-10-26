// Typed field schemas (int, bool, enum, text, map) as bounded controls. `labelMode` hides defaults, since a line
// label has a type and bounds but no default.
import { el, selectControl, intControl, textControl, checkControl, linesControl, card, note } from './ui.js';
import { FIELD_TYPES, SCALAR_TYPES, LABEL_TYPES } from '../../data-modules/hints.js';
import { defaultSchema, setEnumValues, setMapKeys, newLabel } from '../../data-modules/forms.js';
import { isObject, list } from '../../data-modules/dm-model.js';

/** Draws the controls for `schema`. `ctx.touch()` runs after a value change; `ctx.redraw()` after a structural one. */
export function schemaControls(doc, host, schema, ctx, { labelMode = false, scalarOnly = false } = {}) {
    if (!isObject(schema)) { host.append(note(doc, 'This schema is not an object. Fix it in the record JSON.', 'warning')); return; }
    const types = labelMode ? LABEL_TYPES : scalarOnly ? SCALAR_TYPES : FIELD_TYPES;
    selectControl(doc, host, 'Type', [...types], schema.type, next => {
        const fresh = labelMode ? newLabel(next) : defaultSchema(next);
        for (const key of Object.keys(schema)) delete schema[key];
        Object.assign(schema, fresh);
        ctx.redraw();
    });
    switch (schema.type) {
        case 'int':
            intControl(doc, host, 'Minimum', schema.min, v => { schema.min = v; ctx.touch(); });
            intControl(doc, host, 'Maximum', schema.max, v => { schema.max = v; ctx.touch(); });
            if (!labelMode) intControl(doc, host, 'Default', schema.default, v => { schema.default = v; ctx.touch(); });
            break;
        case 'bool':
            if (!labelMode) checkControl(doc, host, 'Default is true', schema.default === true, v => { schema.default = v; ctx.touch(); });
            break;
        case 'enum':
            linesControl(doc, host, 'Values (one per line)', schema.values, values => { setEnumValues(schema, values); ctx.touch(); });
            if (!labelMode) selectControl(doc, host, 'Default', list(schema.values).map(String), typeof schema.default === 'string' ? schema.default : '', v => { schema.default = v; ctx.touch(); }, { blank: 'choose' });
            break;
        case 'text':
            intControl(doc, host, 'Maximum length', schema.max, v => { schema.max = v; ctx.touch(); });
            textControl(doc, host, 'Default', schema.default, v => { schema.default = v; ctx.touch(); });
            break;
        case 'map': {
            linesControl(doc, host, 'Fixed keys (one per line)', schema.keys, keys => { setMapKeys(schema, keys); ctx.touch(); });
            const inner = card(doc);
            inner.append(el(doc, 'strong', 'Value of each key'));
            if (!isObject(schema.values)) schema.values = defaultSchema('int');
            schemaControls(doc, inner, schema.values, ctx, { scalarOnly: true });
            host.append(inner);
            break;
        }
        default:
            host.append(note(doc, `Unknown type "${schema.type}". Choose a type above, or fix it in the record JSON.`, 'warning'));
    }
}

