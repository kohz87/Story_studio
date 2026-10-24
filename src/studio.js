import { openPack } from './model.js';
import { setField } from './edits.js';
import { createHistory } from './history.js';
import { el, button, field, icon } from './dom.js';
import { KINDS, LABELS, records } from './records.js';
import { renderScreen } from './screens/index.js';

export function mountStudio(root) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    let history = createHistory(null);
    let destroyed = false;
    const selection = { kind: 'classes', id: null, form: null };
    const media = win.matchMedia?.('(prefers-color-scheme: light)');
    let themeChoice;
    try { themeChoice = win.localStorage.getItem('story-studio-theme'); } catch { /* Storage is optional. */ }
    const setTheme = () => {
        const theme = themeChoice === 'dark' || themeChoice === 'light' ? themeChoice : media?.matches ? 'light' : 'dark';
        doc.documentElement.dataset.theme = theme;
        themeButton.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
        themeButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    };
    const app = el(doc, 'div', '', { class: 'studio' });
    const header = el(doc, 'header', '', { class: 'topbar' });
    const brand = el(doc, 'strong', 'Story Studio', { class: 'brand' });
    brand.prepend(icon(doc, 'logo-mark'));
    const name = el(doc, 'input', '', { id: 'pack-name', placeholder: '[YOUR PACK NAME]' });
    name.addEventListener('change', () => ctx.apply(setField(ctx.model, ['name'], name.value)));
    const fingerprint = el(doc, 'span', 'rules v2 · —', { class: 'fingerprint muted' });
    const undo = button(doc, '', () => { history.undo(); ctx.changed(); }, { 'aria-label': 'Undo' });
    undo.append(icon(doc, 'undo'));
    const redo = button(doc, '', () => { history.redo(); ctx.changed(); }, { 'aria-label': 'Redo' });
    redo.append(icon(doc, 'redo'));
    const file = el(doc, 'input', '', { type: 'file', accept: '.json,application/json', id: 'pack-file', hidden: '' });
    const open = button(doc, 'Open pack…', () => file.click());
    const problems = button(doc, 'Problems (0)', () => ctx.showProblems());
    const check = button(doc, 'Check / export', () => ctx.select('check'));
    const exportButton = button(doc, 'Export', () => ctx.select('check'), { class: 'primary' });
    const themeButton = button(doc, '', () => {
        themeChoice = doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { win.localStorage.setItem('story-studio-theme', themeChoice); } catch { /* Storage is optional. */ }
        setTheme();
    });
    header.append(brand, field(doc, 'Pack', name), fingerprint, undo, redo, open, problems, exportButton, themeButton, file);
    const workspace = el(doc, 'div', '', { class: 'workspace' });
    const rail = el(doc, 'nav', '', { 'aria-label': 'Pack parts', class: 'rail' });
    const main = el(doc, 'main', '', { id: 'main', tabindex: '-1' });
    const inspector = el(doc, 'aside', '', { class: 'inspector', 'aria-label': 'Inspector' });
    const inspectorClose = button(doc, 'Close inspector', () => { app.classList.remove('inspector-open'); main.focus(); }, { class: 'inspector-close' });
    const inspectorBody = el(doc, 'div', '', { class: 'inspector-body' });
    inspector.append(inspectorClose, inspectorBody);
    const notice = el(doc, 'div', '', { role: 'status', 'aria-live': 'polite', class: 'notice' });
    const overlays = el(doc, 'div', '', { class: 'overlays' });
    workspace.append(rail, main, inspector);
    app.append(header, workspace, notice, overlays);
    root.replaceChildren(app);
    const ctx = {
        doc, win, root, app, main, inspector: inspectorBody, overlays, selection, file,
        get model() { return history.current; },
        get history() { return history; },
        apply(result) {
            if (!history.commit(result)) {
                ctx.notify((result?.errors || [{ code: 'refused-edit', message: 'Edit refused' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
                return false;
            }
            ctx.changed();
            return true;
        },
        changed() { ctx.render(); },
        notify(message) { notice.textContent = message; },
        select(kind, id = null, form = null) {
            selection.kind = kind; selection.id = id; selection.form = form;
            ctx.render();
            if (id !== null) app.classList.add('inspector-open');
        },
        showProblems() { ctx.select('check'); },
        loadText(text) {
            if (destroyed) return null;
            const model = openPack(text);
            history = createHistory(model);
            selection.id = null; selection.form = null;
            ctx.render();
            return model;
        },
        render() {
            if (destroyed) return;
            const model = ctx.model;
            name.value = model?.document?.name ?? '';
            name.disabled = !model?.document;
            fingerprint.textContent = `rules v2 · ${model?.rulesHash?.slice(0, 8) ?? '—'}`;
            fingerprint.title = model?.rulesHash ?? '';
            undo.disabled = !history.canUndo; redo.disabled = !history.canRedo;
            problems.textContent = `Problems (${model?.validation?.errors?.length ?? 0})`;
            exportButton.disabled = !model?.validation?.ok;
            exportButton.title = exportButton.disabled ? 'Fix the problems first' : 'Check and export pack';
            rail.replaceChildren();
            for (const kind of KINDS.slice(0, 8)) {
                const nav = button(doc, '', () => ctx.select(kind), { 'aria-current': selection.kind === kind ? 'page' : 'false' });
                const asset = kind === 'creatures' ? 'kind-foes' : `kind-${kind}`;
                nav.append(icon(doc, asset), el(doc, 'span', LABELS[kind]), el(doc, 'small', records(model, kind).length));
                rail.append(nav);
            }
            const more = el(doc, 'details');
            more.open = KINDS.slice(8).includes(selection.kind);
            more.append(el(doc, 'summary', 'More kinds'));
            for (const kind of KINDS.slice(8)) more.append(button(doc, `${LABELS[kind]} (${records(model, kind).length})`, () => ctx.select(kind)));
            rail.append(more, check);
            main.replaceChildren(); inspectorBody.replaceChildren();
            inspector.hidden = !model?.document || selection.kind === 'check';
            renderScreen(ctx);
        },
        destroy() { destroyed = true; media?.removeEventListener?.('change', setTheme); root.replaceChildren(); },
    };
    media?.addEventListener?.('change', setTheme);
    setTheme(); ctx.render();
    return ctx;
}
if (typeof document !== 'undefined') {
    const root = document.getElementById('studio');
    if (root) mountStudio(root);
}
