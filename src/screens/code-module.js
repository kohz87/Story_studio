// The Code module section (docs/PART5B_SPEC.md §7): a form for a starter SillyTavern module, the files Studio writes from
// it, and Download zip. It works with or without a pack open, and never reads or changes the pack, the history, the saved
// draft or the dirty state. Author text reaches the page only as a form value or as textContent.

import { el, button, field, icon, safeLabel } from '../dom.js';
import { applyEdit } from '../apply-edit.js';
import { downloadFile } from '../export.js';
import { EXAMPLE_INPUTS, INPUT_KEYS, LABELS } from '../code-module/inputs.js';
import { generateScaffold, scaffoldZip } from '../code-module/generate.js';
import { readInt } from './dm/ui.js';

const INTRO = 'Start a SillyTavern extension that is a real Story Suite module: Studio writes its files, a copy of Story Block\'s testkit and tests that pass. Download the zip, then git init, install it and grow it. Your work stays on this device.';
const CONTROL_IDS = {
    moduleId: 'cm-module-id', name: 'cm-name', description: 'cm-description', author: 'cm-author', capability: 'cm-capability',
    domain: 'cm-domain', field: 'cm-field', label: 'cm-label', min: 'cm-min', max: 'cm-max', initial: 'cm-initial', step: 'cm-step',
    kind: 'cm-kind', kindLabel: 'cm-kind-label', command: 'cm-command', action: 'cm-action', query: 'cm-query', screen: 'cm-screen',
};

function cancelPending(ctx, state) {
    if (state.pending !== null) ctx.win?.clearTimeout?.(state.pending);
    state.pending = null;
}

export function renderCodeModule(ctx) {
    const doc = ctx.doc;
    const state = (ctx.codeModule ??= { draft: { ...EXAMPLE_INPUTS }, selected: null, pending: null });
    cancelPending(ctx, state);
    const inputs = {};
    const prefixes = [];

    // Changes update the draft and schedule one refresh, 120 ms later (the Data modules pattern); the form is not rebuilt.
    const schedule = () => {
        const set = ctx.win?.setTimeout;
        if (typeof set !== 'function') { refresh(); return; }
        cancelPending(ctx, state);
        state.pending = set.call(ctx.win, refresh, 120);
    };
    const remember = (key, control, label) => { inputs[key] = { control, label, error: null }; return label; };

    function textBox(key, title, { multiline = false, placeholder } = {}) {
        const extra = {};
        if (placeholder) extra.placeholder = placeholder;
        if (multiline) extra.rows = '2';
        const control = el(doc, multiline ? 'textarea' : 'input', '', { 'aria-label': title, id: CONTROL_IDS[key], ...extra });
        control.value = safeLabel(state.draft[key] ?? '');
        control.addEventListener('input', () => { state.draft[key] = control.value; schedule(); });
        return remember(key, control, field(doc, title, control));
    }

    function numberBox(key, title) {
        const control = el(doc, 'input', '', { 'aria-label': title, id: CONTROL_IDS[key], inputmode: 'numeric' });
        control.value = safeLabel(state.draft[key] ?? '');
        control.addEventListener('input', () => { state.draft[key] = readInt(control.value); schedule(); });
        return remember(key, control, field(doc, title, control));
    }

    function prefixedBox(key, title) {
        const prefix = el(doc, 'span', '', { class: 'mono', 'aria-hidden': 'true' });
        prefixes.push(prefix);
        const control = el(doc, 'input', '', { 'aria-label': title, id: CONTROL_IDS[key] });
        control.value = safeLabel(state.draft[key] ?? '');
        control.addEventListener('input', () => { state.draft[key] = control.value; schedule(); });
        const wrap = el(doc, 'span', '', { class: 'cm-prefixed' });
        wrap.append(prefix, control);
        return remember(key, control, field(doc, title, wrap));
    }

    const fieldset = (title, ...children) => {
        const set = el(doc, 'fieldset');
        set.append(el(doc, 'legend', title), ...children);
        return set;
    };

    const linePreview = el(doc, 'pre', '', { class: 'mono', id: 'cm-line-example' });
    const screenBox = el(doc, 'input', '', { type: 'checkbox', 'aria-label': LABELS.screen, id: CONTROL_IDS.screen });
    screenBox.checked = state.draft.screen === true;
    screenBox.addEventListener('change', () => { state.draft.screen = screenBox.checked; schedule(); });
    const screenLabel = field(doc, LABELS.screen, screenBox);
    screenLabel.classList.add('cm-check');
    remember('screen', screenBox, screenLabel);

    const form = el(doc, 'section', '', { class: 'stack', 'aria-label': 'Module form' });
    const numbers = el(doc, 'div', '', { class: 'cm-numbers' });
    numbers.append(numberBox('min', LABELS.min), numberBox('max', LABELS.max), numberBox('initial', LABELS.initial), numberBox('step', LABELS.step));
    form.append(
        fieldset('Module',
            textBox('moduleId', LABELS.moduleId, { placeholder: undefined }),
            textBox('name', LABELS.name),
            textBox('description', LABELS.description, { multiline: true }),
            textBox('author', LABELS.author, { placeholder: 'optional' }),
            textBox('capability', LABELS.capability, { placeholder: 'optional' })),
        fieldset('State',
            textBox('domain', LABELS.domain),
            textBox('field', LABELS.field),
            textBox('label', LABELS.label),
            numbers),
        fieldset('Narrator line',
            textBox('kind', LABELS.kind),
            textBox('kindLabel', LABELS.kindLabel),
            el(doc, 'p', 'The narrator writes, and code decides the number:', { class: 'muted' }),
            linePreview),
        fieldset('Command and query',
            prefixedBox('command', LABELS.command),
            textBox('action', LABELS.action),
            prefixedBox('query', LABELS.query)),
        fieldset('Screen', screenLabel),
    );

    const validation = el(doc, 'pre', '', { id: 'cm-validation', role: 'status' });
    const download = el(doc, 'button', '', { type: 'button', class: 'primary', id: 'cm-download' });
    download.append(icon(doc, 'export-file'), el(doc, 'span', 'Download zip'));
    const reset = button(doc, 'Reset to example', () => {
        cancelPending(ctx, state);
        state.draft = { ...EXAMPLE_INPUTS };
        state.selected = null;
        ctx.render();
    }, { id: 'cm-reset' });
    const actions = el(doc, 'div', '', { class: 'row' });
    actions.append(download, reset);
    const body = el(doc, 'div', '', { class: 'cm-body' });
    const files = el(doc, 'section', '', { class: 'stack', 'aria-label': 'Files' });
    files.append(el(doc, 'h2', 'Files'), validation, actions, body);

    // Refresh: validation, per-field errors, the example line, the `<domain>.` prefixes and the file list or the viewer.
    // It never rebuilds a control, so focus and caret stay where they are.
    function refresh() {
        state.pending = null;
        const result = generateScaffold(state.draft);
        const errors = result.ok ? [] : result.errors;
        validation.setAttribute('data-ok', result.ok ? 'true' : 'false');
        validation.textContent = result.ok
            ? `Ready: ${result.files.length} files written by Studio, ${result.copied.count} copied from Story Block ${result.copied.stamp.version} (commit ${result.copied.stamp.commit.slice(0, 7)}).`
            : [`Not ready (${errors.length} problem${errors.length === 1 ? '' : 's'}):`, ...errors.map(error => `- ${error.message}`)].join('\n');
        for (const key of INPUT_KEYS) {
            const entry = inputs[key];
            if (!entry) continue;
            const problem = errors.find(error => error.field === key);
            if (problem) {
                if (!entry.error) {
                    entry.error = el(doc, 'small', '', { class: 'cm-error', id: `${entry.control.id}-error` });
                    entry.label.append(entry.error);
                }
                entry.error.textContent = problem.message;
                entry.control.setAttribute('aria-invalid', 'true');
                entry.control.setAttribute('aria-describedby', entry.error.id);
            } else {
                entry.error?.remove();
                entry.error = null;
                entry.control.removeAttribute('aria-invalid');
                entry.control.removeAttribute('aria-describedby');
            }
        }
        for (const prefix of prefixes) prefix.textContent = `${safeLabel(state.draft.domain)}.`;
        linePreview.textContent = `~ ${safeLabel(state.draft.kind)} Someone — what happened | ${safeLabel(state.draft.kindLabel)}: +${safeLabel(state.draft.step)}`;
        body.replaceChildren();
        if (!result.ok) {
            body.append(el(doc, 'p', 'Fix the marked fields to see the files.', { class: 'muted', id: 'cm-files-empty' }));
            return;
        }
        const paths = result.files.map(file => file.path);
        if (!paths.includes(state.selected)) {
            const part = `src/parts/${state.draft.domain}.js`;
            state.selected = paths.includes(part) ? part : paths[0];
        }
        const list = el(doc, 'ul', '', { class: 'cm-files', 'aria-label': 'Files in the zip' });
        for (const path of paths) {
            const item = el(doc, 'li');
            item.append(button(doc, path, () => { state.selected = path; refresh(); }, { 'aria-pressed': path === state.selected ? 'true' : 'false' }));
            list.append(item);
        }
        const { count, stamp } = result.copied;
        list.append(el(doc, 'li', `tests/vendor/LICENSE-story-block and tests/vendor/story-block/: ${count} files copied from Story Block ${stamp.version} (commit ${stamp.commit.slice(0, 7)}). Not shown.`, { class: 'cm-copied' }));
        const chosen = result.files.find(file => file.path === state.selected);
        const name = el(doc, 'h3', state.selected, { class: 'mono', id: 'cm-file-name' });
        const viewer = el(doc, 'pre', '', { id: 'cm-file', tabindex: '0', 'aria-labelledby': 'cm-file-name' });
        viewer.textContent = chosen.text;
        body.append(list, name, viewer);
    }

    // Download runs the same generation as the list. A refused draft is shown through applyEdit (the notice bar and a
    // re-render from the kept draft); a valid one is downloaded and never touches the pack or its history.
    download.addEventListener('click', () => {
        cancelPending(ctx, state);
        refresh();
        const result = scaffoldZip(state.draft);
        if (!result.ok) {
            applyEdit(ctx, { ok: false, errors: result.errors.map(({ code, message }) => ({ code, message })) });
            return;
        }
        downloadFile(ctx, result.bytes, result.filename, 'application/zip');
    });

    ctx.main.append(el(doc, 'h1', 'Code module'), el(doc, 'p', INTRO, { class: 'muted' }));
    const workspace = el(doc, 'div', '', { class: 'presentation-workspace code-module-workspace' });
    workspace.append(form, files);
    ctx.main.append(workspace);
    refresh();
}
