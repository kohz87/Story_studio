// The imports section: each import alias with its adapter, mode and projection, or the module and export it reads from this pack.
import { el, button, selectControl, textControl, checkControl, nameControl, card, row, note, heading, safeLabel } from '../ui.js';
import { IMPORT_MODES, IMPORT_ADAPTERS } from '../../../data-modules/hints.js';
import { adapterOf, newImport, makeTarget, uniqueName } from '../../../data-modules/forms.js';
import { entries, list, own, isObject, modulesOf } from '../../../data-modules/dm-model.js';
import { keysOf, obj, budget } from './shared.js';

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
