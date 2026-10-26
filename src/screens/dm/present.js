// Module presentation: the screens and layouts a definition carries, mounted only with its pin. Existing Part 4
// screens/layouts attach as copies; the preview reuses Part 4's isolated, script-disabled renderer.
import { el, button, selectControl, card, row, note, heading, safeLabel } from './ui.js';
import { createPreview } from '../../preview.js';
import { starterScreen, sampleView, uniqueName } from '../../data-modules/forms.js';
import { moduleId, clone, list, isObject } from '../../data-modules/dm-model.js';

export function presentationSection(S, host) {
    const { doc, draft } = S;
    const select = S.state.presentation ??= { field: 'screens', index: 0 };
    const lists = { screens: Array.isArray(draft.screens) ? draft.screens : [], layouts: Array.isArray(draft.layouts) ? draft.layouts : [] };
    host.append(note(doc, 'Screens and layouts here mount only for chats that enable this module. Build one in the Screen builder and attach a copy, add a generated starter, or edit the record JSON.'));
    for (const field of ['screens', 'layouts']) {
        host.append(heading(doc, field === 'screens' ? 'Module screens' : 'Module layouts', 'h3'));
        if (!lists[field].length) host.append(note(doc, `No ${field} attached.`));
        lists[field].forEach((record, index) => {
            const item = row(doc);
            item.append(button(doc, `${index + 1}. ${safeLabel(record?.title ?? record?.id ?? 'Layout object')}`, () => { select.field = field; select.index = index; S.redraw(); },
                { 'aria-pressed': String(select.field === field && select.index === index) }),
            button(doc, 'Remove', () => { draft[field].splice(index, 1); select.index = 0; S.redraw(); }, { 'aria-label': `Remove ${field === 'screens' ? 'screen' : 'layout'} ${safeLabel(record?.id ?? index + 1)} from this module` }));
            host.append(item);
        });
    }
    const pack = S.document;
    const attach = card(doc, heading(doc, 'Attach from this pack', 'h3'));
    for (const field of ['screens', 'layouts']) {
        const source = list(pack[field]).filter(record => isObject(record) && typeof record.id === 'string');
        if (!source.length) continue;
        const choice = selectControl(doc, attach, `Pack ${field === 'screens' ? 'screen' : 'layout'} to attach`, source.map(record => record.id), source[0].id, () => {});
        attach.append(button(doc, `Attach ${field === 'screens' ? 'screen' : 'layout'} copy`, () => {
            const record = source.find(candidate => candidate.id === choice.value);
            const current = Array.isArray(draft[field]) ? draft[field] : (draft[field] = []);
            if (current.some(existing => existing?.id === record.id)) { S.refuse([{ code: 'duplicate', path: field, message: `This module already has "${record.id}".` }]); return; }
            current.push(clone(record));
            S.redraw();
        }));
    }
    attach.append(button(doc, 'Add generated starter screen', () => {
        const screens = Array.isArray(draft.screens) ? draft.screens : (draft.screens = []);
        const starter = starterScreen(draft, moduleId(pack, draft));
        starter.id = uniqueName(screens.map(screen => screen?.id), starter.id);
        screens.push(starter);
        select.field = 'screens';
        select.index = screens.length - 1;
        S.redraw();
    }));
    host.append(attach);

    const record = lists[select.field][select.index];
    if (!isObject(record)) return;
    const frame = el(doc, 'iframe', '', { title: 'Module screen preview', sandbox: 'allow-same-origin', class: 'screen-preview' });
    const warnings = el(doc, 'pre', '', { id: 'dm-preview-warnings', role: 'status' });
    host.append(heading(doc, 'Preview', 'h3'), note(doc, 'Sample data from the module’s defaults. Commands are inactive.'), frame, warnings);
    const renderer = createPreview(frame, messages => { warnings.textContent = messages.join('\n'); });
    S.state.cleanup = () => renderer.destroy();
    const screen = select.field === 'screens' ? record : { id: record.id, mounts: ['tab'], layout: record };
    renderer.update(screen, { state: { v: 2, meta: {}, domains: {} }, draft: {}, settings: {}, ops: [], queries: { 'dataModules.view': sampleView(draft) } });
}
