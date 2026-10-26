import { el, button, field, safeLabel } from '../dom.js';
import { parseJsonInput } from '../forms.js';
import { applyEdit } from '../apply-edit.js';
import { validatePack } from '../../vendor/story-block/src/v2/packs/validate.js';
import { createPreview } from '../preview.js';
import { SCREEN_FIELDS, MOUNTS, NODE_TYPES, standardWidgets, QUERIES, SAMPLE, replacePresentation, checkDefaults, elementSnippet, widgetSnippet } from '../screen-authoring.js';

const copy = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issues = result => result.ok ? 'Accepted by Story Block.' : result.errors.map(e => `${e.code} · ${e.path}: ${e.message}`).join('\n');

function control(doc, parent, title, value, change, { json = false, multiline = false, id } = {}) {
    const input = el(doc, multiline || json ? 'textarea' : 'input', '', { ...(id ? { id } : {}), 'aria-label': title });
    input.value = json ? JSON.stringify(value, null, 2) ?? '' : safeLabel(value ?? '');
    if (multiline || json) input.setAttribute('rows', multiline ? '7' : '3');
    const error = el(doc, 'span', '', { class: 'warning', role: 'status' });
    input.addEventListener('input', () => {
        if (!json) { change(input.value); return; }
        const parsed = parseJsonInput(input.value);
        error.textContent = parsed.ok ? '' : `JSON refused: ${parsed.error}`;
        input.setAttribute('data-json-invalid', parsed.ok ? 'false' : 'true');
        if (parsed.ok) change(parsed.value);
    });
    parent.append(field(doc, title, input), error);
    return input;
}
function select(doc, parent, title, values, value, change) {
    const input = el(doc, 'select', '', { 'aria-label': title });
    for (const [key, text] of values) input.append(el(doc, 'option', text, { value: key }));
    input.value = value;
    input.addEventListener('change', () => change(input.value));
    parent.append(field(doc, title, input));
    return input;
}

export function renderSettingsDefaults(ctx) {
    const { doc, main } = ctx;
    main.append(el(doc, 'h1', 'Settings defaults'), el(doc, 'p',
        'This Story Block version accepts no per-module settings defaults in a pack. Reader settings are not pack fields. No defaults will be added to your export.'),
    el(doc, 'p', 'Pack-supported economy, currency, calendar, weather, start state, terms, ranks and rules remain available in Pack settings.', { class: 'muted' }),
    button(doc, 'Open pack settings', () => ctx.select('settings')));
    const table = el(doc, 'table', '', { 'aria-label': 'Pack-settable module settings' });
    const head = el(doc, 'tr');
    for (const text of ['Module', 'Pack-settable fields', 'Type', 'Range', 'Story Block default']) head.append(el(doc, 'th', text));
    table.append(head);
    for (const name of ['Story Block', 'RPG Battle', 'Story Director', 'NPC State Delta']) {
        const row = el(doc, 'tr');
        for (const text of [name, 'None', '—', '—', 'Not exposed to packs']) row.append(el(doc, 'td', text));
        table.append(row);
    }
    main.append(table, el(doc, 'h2', 'Check a defaults request'), el(doc, 'p', 'This checks a proposed settings field against the pack importer without changing the pack. Refused fields stay refused.'));
    const status = el(doc, 'pre', '', { id: 'defaults-result', role: 'status' });
    const requested = { settings: { 'rpg-battle': {} } };
    status.textContent = issues(checkDefaults(ctx.model, requested));
    control(doc, main, 'Requested defaults JSON', requested, value => {
        status.textContent = object(value) ? issues(checkDefaults(ctx.model, value)) : 'Refused: enter an object of proposed pack fields.';
    }, { json: true, id: 'defaults-request' });
    main.append(status);
}

function nodePaths(root, path = [], out = []) {
    if (!object(root) || out.length >= 600 || path.length > 48) return out;
    out.push([path, root]);
    if (Array.isArray(root.children)) root.children.forEach((node, i) => nodePaths(node, [...path, 'children', i], out));
    if (root.item) nodePaths(root.item, [...path, 'item'], out);
    if (Array.isArray(root.pages)) root.pages.forEach((page, i) => nodePaths(page?.node, [...path, 'pages', i, 'node'], out));
    return out;
}
function defaultNode(type) {
    if (type === 'grid') return { type, cols: 2, children: [] };
    if (type === 'list') return { type, bind: { query: 'inventory.items' }, item: { type: 'text', value: '$item.name' } };
    if (type === 'tabs') return { type, pages: [{ title: 'Page', node: { type: 'text', value: 'Page' } }] };
    if (type === 'when') return { type, cond: 'true', children: [] };
    if (type === 'button') return { type, label: 'Action', command: 'party.create' };
    if (['box', 'row', 'col'].includes(type)) return { type, children: [] };
    if (Object.hasOwn(standardWidgets, type)) return { type, props: {} };
    return { type, ...(type === 'text' ? { value: 'Text' } : {}) };
}

// The node form follows the renderer's field catalogue, but its diagnostics never gate pack acceptance.
function layoutForm(doc, parent, getLayout, putLayout, state) {
    const section = el(doc, 'details', '', { class: 'card' });
    section.open = true;
    section.append(el(doc, 'summary', 'Layout node builder'));
    const body = el(doc, 'div', '', { class: 'stack' });
    section.append(body); parent.append(section);
    const draw = () => {
        body.replaceChildren();
        const layout = getLayout();
        if (!object(layout) || !object(layout.root)) {
            body.append(button(doc, 'Create layout root', () => { putLayout({ ...(object(layout) ? layout : {}), root: defaultNode('box') }); draw(); }));
            return;
        }
        const paths = nodePaths(layout.root);
        const selected = paths.find(([path]) => JSON.stringify(path) === state.node) ?? paths[0];
        const [path, node] = selected;
        let rawNode = null;
        const update = (value, redraw = false) => {
            const next = copy(getLayout());
            if (!path.length) next.root = value;
            else {
                let target = next.root;
                for (const key of path.slice(0, -1)) target = target[key];
                target[path.at(-1)] = value;
            }
            putLayout(next);
            if (rawNode && rawNode.getAttribute('data-json-invalid') !== 'true') rawNode.value = JSON.stringify(value, null, 2);
            if (redraw) draw();
        };
        select(doc, body, 'Selected layout node', paths.map(([p, n]) => [JSON.stringify(p), `root${p.map(k => typeof k === 'number' ? `[${k}]` : `.${k}`).join('')} · ${safeLabel(n.type)}`]), JSON.stringify(path), value => { state.node = value; draw(); });
        const types = [...Object.keys(NODE_TYPES), ...Object.keys(standardWidgets)];
        if (!types.includes(node.type)) types.push(safeLabel(node.type));
        select(doc, body, 'Node type', types.map(key => [key, key]), node.type, type => update(defaultNode(type), true));
        const spec = NODE_TYPES[node.type];
        const fields = { ...(spec?.fields ?? { props: 'payload' }), bind: 'payload' };
        for (const [key, kind] of Object.entries(fields)) {
            if (['children', 'node', 'pages'].includes(kind)) continue;
            const isJson = ['payload', 'cols', 'limit'].includes(kind) || object(node[key]) || Array.isArray(node[key]);
            control(doc, body, `Node ${key}${isJson ? ' JSON' : ''}`, node[key], value => { node[key] = value; update(node); }, { json: isJson });
            if (Object.hasOwn(node, key)) body.append(button(doc, `Omit node ${key}`, () => { delete node[key]; update(node, true); }));
        }
        if (spec?.fields.children) body.append(button(doc, 'Add child node', () => { node.children = [...(Array.isArray(node.children) ? node.children : []), defaultNode('text')]; update(node, true); }));
        if (node.type === 'tabs') body.append(button(doc, 'Add layout page', () => { node.pages = [...(node.pages ?? []), { title: 'Page', node: defaultNode('text') }]; update(node, true); }));
        rawNode = control(doc, body, 'Selected node JSON', node, () => {}, { json: true });
        body.append(button(doc, 'Use node JSON', () => {
            const parsed = parseJsonInput(rawNode.value);
            if (parsed.ok) update(parsed.value, true);
        }));
    };
    draw();
    return draw;
}

export function renderPresentation(ctx) {
    const { doc, main } = ctx;
    const state = ctx.authoring.builder ??= { field: 'screens', index: 0, sample: JSON.stringify(SAMPLE, null, 2), node: '[]' };
    const pack = ctx.model.document;
    const list = Array.isArray(pack[state.field]) ? pack[state.field] : [];
    if (state.base !== ctx.model) { state.base = ctx.model; state.draft = undefined; state.node = '[]'; }
    if (state.draft === undefined && list[state.index] !== undefined) state.draft = copy(list[state.index]);
    main.append(el(doc, 'h1', 'Screen builder'), el(doc, 'p', 'Edit screens and layouts, preview with local sample JSON, then Apply. Pack acceptance uses Story Block’s importer. Preview warnings describe rendering only.', { class: 'muted' }));
    const choices = el(doc, 'div', '', { class: 'row' });
    for (const name of ['screens', 'layouts']) choices.append(button(doc, name === 'screens' ? 'Screens' : 'Layouts', () => { state.field = name; state.index = 0; state.draft = undefined; ctx.render(); }, { 'aria-pressed': state.field === name }));
    choices.append(button(doc, state.field === 'screens' ? 'New screen' : 'New layout', () => {
        state.index = list.length;
        let suffix = 1;
        while (list.some(record => record?.id === `new-${suffix}`)) suffix++;
        state.draft = state.field === 'screens' ? { id: `new-${suffix}`, title: 'New screen', mounts: ['tab'], data: { pc: { query: 'party.pc' } }, template: '<p>{{ q.pc.name }}</p>' }
            : { id: `new-${suffix}`, title: 'New layout', root: defaultNode('box') };
        ctx.render();
    }));
    main.append(choices);
    const entries = el(doc, 'div', '', { class: 'row', 'aria-label': 'Presentation records' });
    list.forEach((record, index) => entries.append(button(doc, `${index + 1}. ${safeLabel(record?.title ?? record?.id ?? 'Layout object')}`, () => { state.index = index; state.draft = undefined; state.node = '[]'; ctx.render(); })));
    main.append(entries);
    if (state.draft === undefined) { main.append(el(doc, 'p', `No ${state.field}. Add one to begin.`)); return; }
    const workspace = el(doc, 'div', '', { class: 'presentation-workspace' });
    const editor = el(doc, 'section', '', { class: 'stack', 'aria-label': 'Presentation form' });
    const preview = el(doc, 'section', '', { class: 'stack', 'aria-label': 'Live preview' });
    workspace.append(editor, preview); main.append(workspace);
    const status = el(doc, 'pre', '', { id: 'presentation-validation', role: 'status' });
    const warnings = el(doc, 'pre', '', { id: 'preview-warnings', role: 'status' });
    const frame = el(doc, 'iframe', '', { title: 'Screen preview', sandbox: 'allow-same-origin', class: 'screen-preview' });
    preview.append(el(doc, 'h2', 'Live preview'), el(doc, 'p', 'Sample data only. External images, links, resource-bearing CSS and game commands are inactive.', { class: 'muted' }), frame, warnings);
    const renderer = createPreview(frame, messages => { warnings.textContent = messages.join('\n'); });
    ctx.previewCleanup = () => renderer.destroy();
    let step = null;
    let sourceSelect = null;
    let redrawLayout = () => {};
    let rawRecord = null;
    const candidates = () => { const rows = [...list]; rows[state.index] = state.draft; return rows; };
    const refresh = () => {
        if (rawRecord && doc.activeElement !== rawRecord && rawRecord.getAttribute('data-json-invalid') !== 'true') rawRecord.value = JSON.stringify(state.draft, null, 2);
        const checked = validatePack({ ...pack, [state.field]: candidates() });
        status.textContent = issues(checked);
        const parsed = parseJsonInput(state.sample);
        if (!parsed.ok || !object(parsed.value)) { renderer.update({}, {}); warnings.textContent = `Sample refused: ${parsed.error ?? 'enter an object'}`; return; }
        // JSON parsing supplies plain values only; binding reads remain own-property-only in the host.
        if (sourceSelect) {
            sourceSelect.replaceChildren(el(doc, 'option', 'Screen', { value: '' }));
            const steps = Array.isArray(state.draft?.steps) ? state.draft.steps : [];
            steps.forEach((row, i) => sourceSelect.append(el(doc, 'option', `Step ${i + 1}: ${safeLabel(row?.title ?? row?.id ?? '')}`, { value: String(i) })));
            if (step !== null && !steps[step]) step = null;
            sourceSelect.value = step === null ? '' : String(step);
        }
        const screen = state.field === 'screens' ? state.draft : { id: state.draft?.id, mounts: ['tab'], layout: state.draft };
        renderer.update(object(screen) ? screen : {}, parsed.value, step);
    };
    const actions = el(doc, 'div', '', { class: 'row' });
    actions.append(button(doc, state.field === 'screens' ? 'Apply screen' : 'Apply layout', () => {
        if (editor.querySelector('[data-json-invalid="true"]')) { ctx.notify('Apply refused: correct the JSON field first.'); return; }
        const result = replacePresentation(ctx.model, state.field, candidates());
        if (!result.ok) { status.textContent = issues(result); ctx.notify(issues(result)); return; }
        applyEdit(ctx, result);
    }, { class: 'primary' }), button(doc, 'Discard draft', () => { state.draft = undefined; state.index = Math.min(state.index, list.length - 1); ctx.render(); }));
    if (state.index < list.length) actions.append(button(doc, 'Delete record', () => {
        applyEdit(ctx, replacePresentation(ctx.model, state.field, list.filter((_, i) => i !== state.index)));
    }));
    editor.append(actions, status);
    if (!object(state.draft)) {
        const repair = control(doc, editor, 'Record JSON', state.draft, () => {}, { json: true });
        editor.append(button(doc, 'Use record JSON', () => {
            const parsed = parseJsonInput(repair.value);
            if (parsed.ok) { state.draft = parsed.value; ctx.render(); }
        }));
        refresh(); return;
    }
    const put = (key, value) => { state.draft[key] = value; refresh(); };
    const fields = state.field === 'screens' ? SCREEN_FIELDS : ['id', 'title', 'icon', 'theme', 'root'];
    const templates = new Map();
    for (const key of fields) {
        const section = el(doc, 'div', '', { class: 'stack' });
        editor.append(section);
        if (key === 'mounts') {
            const mounts = el(doc, 'fieldset', '', { class: 'mount-choices' }); mounts.append(el(doc, 'legend', 'mounts'));
            for (const name of MOUNTS) {
                const input = el(doc, 'input', '', { type: 'checkbox', 'aria-label': `Mount ${name}` });
                input.checked = Array.isArray(state.draft.mounts) && state.draft.mounts.includes(name);
                input.addEventListener('change', () => {
                    const current = Array.isArray(state.draft.mounts) ? state.draft.mounts : [];
                    put('mounts', input.checked ? [...current, name] : current.filter(mount => mount !== name));
                });
                mounts.append(field(doc, name, input));
            }
            section.append(mounts);
        } else {
            const json = ['layout', 'theme', 'data', 'steps', 'root'].includes(key);
            const input = control(doc, section, `${key}${json ? ' JSON' : ''}`, state.draft[key], value => { put(key, value); if (['root', 'layout'].includes(key)) redrawLayout(); }, { json, multiline: ['template', 'css'].includes(key), id: `screen-${key}` });
            templates.set(key, input);
        }
        if (Object.hasOwn(state.draft, key)) section.append(button(doc, `Omit ${key}`, () => { delete state.draft[key]; ctx.render(); }));
    }
    const raw = el(doc, 'details', '', { class: 'card' }); raw.append(el(doc, 'summary', 'Whole record JSON (including unknown fields)'));
    rawRecord = control(doc, raw, 'Record JSON', state.draft, () => {}, { json: true });
    raw.append(button(doc, 'Use record JSON', () => {
        const parsed = parseJsonInput(rawRecord.value);
        if (parsed.ok) { state.draft = parsed.value; ctx.render(); }
    }));
    editor.append(raw);
    const putLayout = value => {
        if (state.field === 'screens') { put('layout', value); templates.get('layout').value = JSON.stringify(value, null, 2); }
        else { state.draft = value; templates.get('root').value = JSON.stringify(value.root, null, 2); refresh(); }
    };
    redrawLayout = layoutForm(doc, editor, () => state.field === 'screens' ? state.draft.layout : state.draft, putLayout, state);
    if (state.field === 'screens') {
        const palette = el(doc, 'details', '', { class: 'card stack' }); palette.open = true; palette.append(el(doc, 'summary', 'Template palette'));
        editor.append(palette);
        const append = snippet => { put('template', `${state.draft.template ?? ''}\n${snippet}`); templates.get('template').value = state.draft.template; };
        let tag = 'p', text = '{{ q.pc.name }}', condition = '', each = '';
        select(doc, palette, 'Element', ['section', 'div', 'p', 'span', 'h2', 'ul', 'li', 'button', 'input'].map(value => [value, value]), tag, value => { tag = value; });
        control(doc, palette, 'Element text / binding', text, value => { text = value; });
        control(doc, palette, 'Condition (data-if)', '', value => { condition = value; });
        control(doc, palette, 'Repeat (data-each)', '', value => { each = value; });
        palette.append(button(doc, 'Insert element', () => append(elementSnippet(tag, text, condition, each))));
        let widget = 'ss.meter', props = { value: '{{ q.pc.hp.cur }}', max: '{{ q.pc.hp.max }}', label: 'HP' };
        const propHelp = el(doc, 'pre', '', { id: 'widget-prop-help' });
        const showProps = () => { propHelp.textContent = JSON.stringify(standardWidgets[widget].props, null, 2); };
        select(doc, palette, 'Widget', Object.keys(standardWidgets).map(name => [name, name]), widget, value => { widget = value; showProps(); });
        const propInput = control(doc, palette, 'Widget props JSON', props, value => { props = value; }, { json: true });
        palette.append(button(doc, 'Insert widget', () => {
            const parsed = parseJsonInput(propInput.value);
            if (!parsed.ok || !object(parsed.value)) { ctx.notify('Widget props refused: enter a JSON object.'); return; }
            append(widgetSnippet(widget, parsed.value));
        }), propHelp); showProps();
        let query = QUERIES[0][0], alias = 'pc';
        select(doc, palette, 'Query', QUERIES.map(([name, module, meaning]) => [name, `${name} · ${module} · ${meaning}`]), query, value => { query = value; });
        control(doc, palette, 'Query alias', alias, value => { alias = value; });
        const args = control(doc, palette, 'Query args JSON', {}, () => {}, { json: true });
        palette.append(button(doc, 'Add query binding', () => {
            const parsed = parseJsonInput(args.value);
            if (!/^[a-zA-Z_$][\w$]*$/.test(alias) || ['__proto__', 'constructor', 'prototype'].includes(alias) || !parsed.ok || !object(parsed.value)) { ctx.notify('Query refused: choose a safe alias and JSON object arguments.'); return; }
            if (Object.hasOwn(state.draft.data ?? {}, alias)) { ctx.notify('Query alias already exists. Choose another alias.'); return; }
            put('data', { ...(state.draft.data ?? {}), [alias]: { query, args: parsed.value } });
            templates.get('data').value = JSON.stringify(state.draft.data, null, 2);
        }));
        const steps = Array.isArray(state.draft.steps) ? state.draft.steps : [];
        sourceSelect = select(doc, preview, 'Preview source', [['', 'Screen'], ...steps.map((row, i) => [String(i), `Step ${i + 1}: ${safeLabel(row?.title ?? row?.id ?? '')}`])], '', value => { step = value === '' ? null : Number(value); refresh(); });
    }
    control(doc, preview, 'Sample data JSON', JSON.parse(state.sample || '{}'), value => { state.sample = JSON.stringify(value); refresh(); }, { json: true, id: 'preview-sample' });
    refresh();
}
