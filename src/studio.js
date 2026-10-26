import { applyEdit } from './apply-edit.js';
import { openPack } from './model.js';
import { setSchemaField as setField } from './edits.js';
import { createHistory } from './history.js';
import { safeLabel, el, button, field, icon } from './dom.js';
import { KINDS, LABELS, records } from './records.js';
import { renderScreen } from './screens/index.js';
import { downloadPack } from './export.js';
import { readDraft, writeDraft, MAX_PACK_BYTES } from './session.js';
import { renderProblemsDrawer } from './screens/problems.js';

export function mountStudio(root) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    let destroyed = false;
    let seq = 0;
    const selection = { kind: 'classes', id: null, form: null };
    let lastBaselineJson = null;

    const restored = readDraft(win);
    let history = createHistory(restored?.model ?? null);
    if (restored?.model?.document) {
        if (restored.dirty) {
            lastBaselineJson = null;
        } else {
            lastBaselineJson = JSON.stringify(restored.model.document);
        }
    }

    const media = win?.matchMedia?.('(prefers-color-scheme: light)');
    let themeChoice;
    try { themeChoice = win?.localStorage?.getItem('story-studio-theme'); } catch { /* Storage is optional. */ }
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
    const name = el(doc, 'input', '', { id: 'pack-name', placeholder: '[YOUR PACK NAME]', 'aria-label': 'Pack name' });
    name.addEventListener('change', () => {
        applyEdit(ctx, setField(ctx.model, ['name'], name.value));
    });
    const fingerprint = el(doc, 'span', 'rules v2 · —', { class: 'fingerprint muted' });
    const undo = button(doc, '', () => {
        history.undo();
        ++seq;
        ctx.changed();
    }, { 'aria-label': 'Undo' });
    undo.append(icon(doc, 'undo'));
    const redo = button(doc, '', () => {
        history.redo();
        ++seq;
        ctx.changed();
    }, { 'aria-label': 'Redo' });
    redo.append(icon(doc, 'redo'));
    const file = el(doc, 'input', '', { type: 'file', accept: '.json,application/json', id: 'pack-file', hidden: '', 'aria-label': 'Open pack file' });
    file.addEventListener('change', () => {
        const f = file.files?.[0];
        file.value = '';
        if (f) ctx.openFile(f);
    });
    const open = button(doc, 'Open pack…', () => file.click());
    const problems = button(doc, 'Problems (0)', () => ctx.showProblems());
    const check = button(doc, 'Check / export', () => ctx.select('check'));
    const exportButton = button(doc, 'Export', () => ctx.select('check'), { class: 'primary' });
    const themeButton = button(doc, '', () => {
        themeChoice = doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { win?.localStorage?.setItem('story-studio-theme', themeChoice); } catch { /* Storage is optional. */ }
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
    const problemsHost = el(doc, 'div', '', { class: 'problems-drawer-host' });
    const overlays = el(doc, 'div', '', { class: 'overlays' });
    workspace.append(rail, main, inspector);
    app.append(header, workspace, notice, problemsHost, overlays);
    root.replaceChildren(app);

    const onBeforeUnload = (e) => {
        if (ctx.dirty) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    };
    const onKeyDown = (e) => {
        if (e.key === 'Escape' && problemsHost.childNodes.length > 0) {
            e.preventDefault?.();
            ctx.closeProblems(true);
        }
    };
    const onDragOver = (e) => {
        e.preventDefault();
    };
    const onDrop = (e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f) ctx.openFile(f);
    };

    win?.addEventListener?.('beforeunload', onBeforeUnload);
    win?.addEventListener?.('keydown', onKeyDown);
    win?.addEventListener?.('dragover', onDragOver);
    win?.addEventListener?.('drop', onDrop);


    const ctx = {
        doc, win, root, app, main, inspector: inspectorBody, overlays, selection, file, authoring: {},
        get model() { return history.current; },
        get history() { return history; },
        get dirty() {
            if (!history.current?.document) return false;
            return lastBaselineJson === null || JSON.stringify(history.current.document) !== lastBaselineJson;
        },
        apply(result) {
            if (destroyed) return false;
            if (!history.commit(result)) {
                ctx.notify((result?.errors || [{ code: 'refused-edit', message: 'Edit refused' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
                return false;
            }
            ++seq;
            notice.textContent = '';
            if (!ctx.changed()) {
                history.undo();
                ctx.render();
                return false;
            }
            return true;
        },
        changed() {
            if (destroyed) return;
            ++seq;
            if (!ctx.render()) return false;
            if (problemsHost.childNodes.length > 0) {
                problemsHost.replaceChildren();
                if (typeof renderProblemsDrawer === 'function') {
                    renderProblemsDrawer(ctx, problemsHost, () => ctx.closeProblems(true));
                }
            }
            if (history.current?.document) writeDraft(win, history.current, ctx.dirty);
            return true;
        },
        notify(message) { notice.textContent = message; },
        select(kind, id = null, form = null) {
            if (destroyed) return;
            selection.kind = kind; selection.id = id; selection.form = form;
            ctx.render();
            if (id !== null) app.classList.add('inspector-open');
        },
        showProblems() {
            if (destroyed) return;
            if (problemsHost.childNodes.length > 0) {
                ctx.closeProblems(true);
            } else {
                problemsHost.replaceChildren();
                if (typeof renderProblemsDrawer === 'function') {
                    renderProblemsDrawer(ctx, problemsHost, () => ctx.closeProblems(true));
                }
                problemsHost.querySelector('button')?.focus();
            }
        },
        closeProblems(restoreFocus = true) {
            problemsHost.replaceChildren();
            if (restoreFocus) problems.focus();
        },
        download(filename) {
            const id = typeof ctx.model?.document?.id === 'string' ? ctx.model.document.id : 'pack';
            return downloadPack(ctx, filename || ctx.filename || `${id}.json`);
        },
        markExported() {
            if (!destroyed && history.current?.validation?.ok) {
                lastBaselineJson = JSON.stringify(history.current.document);
                writeDraft(win, history.current, false);
            }
        },
        loadText(textOrObject) {
            if (destroyed) return null;
            ++seq;
            let model;
            try {
                model = openPack(textOrObject);
            } catch (err) {
                model = {
                    document: null,
                    validation: { ok: false, errors: [{ code: 'bad-schema', message: err?.message || 'Invalid pack' }] },
                };
            }
            if (model?.document) {
                const previous = { history, selection: { ...selection }, baseline: lastBaselineJson, filename: ctx.filename, authoring: ctx.authoring };
                history = createHistory(model);
                ctx.authoring = {};
                selection.kind = 'classes';
                selection.id = null;
                selection.form = null;
                lastBaselineJson = JSON.stringify(model.document);
                ctx.filename = null;
                notice.textContent = '';
                app.classList.remove('inspector-open');
                ctx.closeProblems(false);
                if (!ctx.render()) {
                    history = previous.history;
                    Object.assign(selection, previous.selection);
                    lastBaselineJson = previous.baseline;
                    ctx.filename = previous.filename;
                    ctx.authoring = previous.authoring;
                    ctx.render();
                    return null;
                }
                writeDraft(win, model, false);
                return model;
            }
            const errors = model?.validation?.errors || [{ code: 'no-document', message: 'No valid document' }];
            ctx.notify(errors.map(e => `${e.code}: ${e.message}`).join('\n'));
            if (!history.current) {
                history = createHistory(model);
                ctx.render();
            }
            return model;
        },
        async openFile(f) {
            if (destroyed) return false;
            const token = ++seq;
            if (f && typeof f.size === 'number' && f.size > MAX_PACK_BYTES) {
                ctx.notify('too-large: Pack file exceeds maximum size limit');
                return false;
            }
            let text;
            try {
                text = await f.text();
            } catch (err) {
                if (destroyed || token !== seq) return false;
                ctx.notify(`file-read-error: ${err?.message || 'Failed to read file'}`);
                return false;
            }
            if (destroyed || token !== seq) return false;
            return ctx.loadText(text);
        },
        render() {
            if (destroyed) return false;
            try {
                ctx.renderContent();
                return true;
            } catch (err) {
                ctx.notify(`render-error: ${safeLabel(err?.message || 'Could not render pack')}`);
                return false;
            }
        },
        renderContent() {
            const model = ctx.model;
            const rawName = model?.document?.name;
            name.value = safeLabel(rawName ?? '');
            name.disabled = !model?.document;
            fingerprint.textContent = `rules v2 · ${model?.rulesHash?.slice(0, 8) ?? '—'}`;
            fingerprint.title = model?.rulesHash ?? '';
            undo.disabled = !history.canUndo; redo.disabled = !history.canRedo;
            problems.textContent = `Problems (${model?.validation?.errors?.length ?? 0})`;
            exportButton.disabled = !model?.validation?.ok;
            exportButton.title = exportButton.disabled ? 'Fix the problems first' : 'Export pack';
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
            rail.append(more, button(doc, 'Pack settings', () => ctx.select('settings')));
            for (const [kind, label] of [['defaults', 'Settings defaults'], ['presentation', 'Screen builder'], ['data-modules', 'Data modules'], ['code-module', 'Code module'], ['narrator', 'Narrator card'], ['lorebook', 'Lorebook'], ['lore-import', 'Import lorebook']]) {
                rail.append(button(doc, label, () => ctx.select(kind), { 'aria-current': selection.kind === kind ? 'page' : 'false' }));
            }
            rail.append(check);
            ctx.previewCleanup?.();
            ctx.previewCleanup = null;
            main.replaceChildren(); inspectorBody.replaceChildren();
            inspector.hidden = !model?.document || ['check', 'defaults', 'presentation', 'data-modules', 'code-module', 'narrator', 'lorebook', 'lore-import'].includes(selection.kind);
            renderScreen(ctx);
        },
        destroy() {
            ctx.previewCleanup?.();
            destroyed = true;
            ++seq;
            media?.removeEventListener?.('change', setTheme);
            win?.removeEventListener?.('beforeunload', onBeforeUnload);
            win?.removeEventListener?.('keydown', onKeyDown);
            win?.removeEventListener?.('dragover', onDragOver);
            win?.removeEventListener?.('drop', onDrop);

            root.replaceChildren();
        },
    };

    media?.addEventListener?.('change', setTheme);
    setTheme();
    ctx.render();
    return ctx;
}

if (typeof document !== 'undefined') {
    const root = document.getElementById('studio');
    if (root) mountStudio(root);
}
