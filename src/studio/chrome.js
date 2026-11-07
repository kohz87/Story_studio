// The Studio page shell: header controls, workspace columns, inspector, notices, problems host and overlays, built once per
// mount. Actions call back into the mount closure so the history and selection stay live.
import { el, button, field, icon } from '../dom.js';
import { keepCastFocus } from '../cast/focus.js';
import { createColumns } from '../columns.js';

export function createStudioTheme({ doc, win }) {
    const media = win?.matchMedia?.('(prefers-color-scheme: light)');
    let themeChoice;
    try { themeChoice = win?.localStorage?.getItem('story-studio-theme'); } catch { /* Storage is optional. */ }
    let themeButton;
    const setTheme = () => {
        const theme = themeChoice === 'dark' || themeChoice === 'light' ? themeChoice : media?.matches ? 'light' : 'dark';
        doc.documentElement.dataset.theme = theme;
        themeButton.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
        themeButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    };
    const cycleTheme = () => {
        themeChoice = doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { win?.localStorage?.setItem('story-studio-theme', themeChoice); } catch { /* Storage is optional. */ }
        setTheme();
    };
    return { media, setTheme, cycleTheme, bindButton(button) { themeButton = button; } };
}

export function createStudioChrome({ doc, win, root, selection, theme, nameChanged, onUndo, onRedo, onOpenFile, onShowProblems, onSelectCheck, render }) {
    const { media, setTheme } = theme;

    const app = el(doc, 'div', '', { class: 'studio' });
    const header = el(doc, 'header', '', { class: 'topbar' });
    const brand = el(doc, 'strong', 'Story Studio', { class: 'brand' });
    brand.prepend(icon(doc, 'logo-mark'));
    const name = el(doc, 'input', '', { id: 'pack-name', placeholder: '[YOUR PACK NAME]', 'aria-label': 'Pack name' });
    name.addEventListener('change', () => nameChanged(name.value));
    const fingerprint = el(doc, 'span', 'pack · —', { class: 'fingerprint muted' });
    const undo = button(doc, '', onUndo, { 'aria-label': 'Undo' });
    undo.append(icon(doc, 'undo'));
    const redo = button(doc, '', onRedo, { 'aria-label': 'Redo' });
    redo.append(icon(doc, 'redo'));
    const file = el(doc, 'input', '', { type: 'file', accept: '.json,application/json,.zip,application/zip', id: 'pack-file', hidden: '', 'aria-label': 'Open pack file' });
    file.addEventListener('change', () => {
        const f = file.files?.[0];
        file.value = '';
        if (f) onOpenFile(f);
    });
    const open = button(doc, 'Open pack…', () => file.click());
    const problems = button(doc, 'Problems (0)', onShowProblems);
    const check = button(doc, 'Check / export', onSelectCheck);
    const exportButton = button(doc, 'Export', onSelectCheck, { class: 'primary' });
    const themeButton = button(doc, '', theme.cycleTheme);
    theme.bindButton(themeButton);
    header.append(brand, field(doc, 'Pack', name), fingerprint, undo, redo, open, problems, exportButton, themeButton, file);

    const workspace = el(doc, 'div', '', { class: 'workspace' });
    const rail = el(doc, 'nav', '', { 'aria-label': 'Pack parts', class: 'rail', id: 'rail' });
    const main = el(doc, 'main', '', { id: 'main', tabindex: '-1' });
    const inspector = el(doc, 'aside', '', { class: 'inspector', 'aria-label': 'Inspector', id: 'inspector' });
    const inspectorClose = button(doc, 'Close inspector', () => { app.classList.remove('inspector-open'); main.focus(); }, { class: 'inspector-close' });
    const inspectorBody = el(doc, 'div', '', { class: 'inspector-body' });
    inspector.append(inspectorClose, inspectorBody);
    const castFocus = keepCastFocus({ doc, win, inspector: inspectorBody, selection, render });
    const notice = el(doc, 'div', '', { role: 'status', 'aria-live': 'polite', class: 'notice' });
    const problemsHost = el(doc, 'div', '', { class: 'problems-drawer-host' });
    const overlays = el(doc, 'div', '', { class: 'overlays' });
    const columns = createColumns({ doc, win, workspace, inspectorShown: () => !inspector.hidden });
    workspace.append(rail, columns.railDivider, main, columns.inspectorDivider, inspector);
    app.append(header, workspace, notice, problemsHost, overlays);
    root.replaceChildren(app);
    return { app, name, fingerprint, undo, redo, file, problems, check, exportButton, rail, main, inspector, inspectorBody, castFocus, notice, problemsHost, overlays, columns, media, setTheme };
}
