import { applyEdit } from './apply-edit.js';
import { openPack, draftsOf, portraitsOf, withPortraits } from './model.js';
import { setSchemaField as setField } from './edits.js';
import { createHistory } from './history.js';
import { safeLabel, el, button, icon } from './dom.js';
import { KINDS, RAIL_KINDS, LABELS, records, identity, localId } from './records.js';
import { renderScreen } from './screens/index.js';
import { downloadPack, downloadZip } from './export.js';
import { readDraft, writeDraft } from './session.js';
import { saveHeld, loadHeld, saveCardImage, loadCardImage, saveCardDraft, loadCardDraft } from './portrait-store.js';
import { emptyCard, sanitizeCard, cardTouched } from './card.js';
import { portraitSignature, portraitNames } from './cast/data.js';
import { renderProblemsDrawer } from './screens/problems.js';
import { saveFailed } from './timeline/drafts.js';
import { createStudioTheme, createStudioChrome } from './studio/chrome.js';
import { createStudioEvents } from './studio/events.js';
import { createPackFileReader } from './studio/open-file.js';

// The screens below the record kinds in the rail, in order.
const SCREENS = [['defaults', 'Settings defaults'], ['presentation', 'Screen builder'], ['data-modules', 'Data modules'], ['code-module', 'Code module'], ['card', 'Character card'], ['lorebook', 'Lorebook'], ['lore-import', 'Import lorebook']];
// Parts that are not record lists (a names table and a ripples table), shown after Cast in the rail.
const EXTRA_PARTS = [['names', 'Names'], ['ripples', 'Ripples']];
const SCREEN_LABELS = { ...Object.fromEntries(SCREENS), ...Object.fromEntries(EXTRA_PARTS), settings: 'Pack settings', check: 'Check / export' };

export function mountStudio(root) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    let destroyed = false;
    let seq = 0;
    const selection = { kind: 'places', id: null, form: null };
    let lastBaselineJson = null;
    // The pictures of the cast are no part of the pack's text: what the last export held, and what the browser last kept.
    let lastBaselinePortraits = '';
    let lastKept = null;

    const restored = readDraft(win);
    let history = createHistory(restored?.model ?? null);
    if (restored?.model?.document) {
        if (restored.dirty) {
            lastBaselineJson = null;
        } else {
            lastBaselineJson = JSON.stringify(restored.model.document);
        }
    }

    lastKept = portraitsOf(history.current);
    const theme = createStudioTheme({ doc, win });
    // The parts list is a disclosure on a phone (up to 600 px): it starts collapsed and collapses again after a part is picked.
    // Everywhere else it is always open.
    const stack = win?.matchMedia?.('(max-width: 600px)');
    let parts = null;
    let partsOpen = false;
    const syncParts = () => { if (parts) parts.open = stack?.matches ? partsOpen : true; };
    stack?.addEventListener?.('change', syncParts);

    // A step through the history that brings drafts back or takes them away is saved with the project like any other. If the
    // browser would not keep that, the step is taken back (the history is as it was) and the writer is told, never left with
    // work that a reload would lose.
    const step = (forward, back, verb) => {
        const before = history.current;
        forward();
        ++seq;
        ctx.saved = true;
        ctx.changed();
        if (ctx.saved === false && draftsOf(history.current) !== draftsOf(before)) {
            back();
            ++seq;
            ctx.changed();
            ctx.notify(saveFailed(`${verb} left them as they were`));
        }
    };
    const {
        app, name, fingerprint, undo, redo, file, problems, check, exportButton, rail, main, inspector, inspectorBody,
        castFocus, notice, problemsHost, overlays, columns, media, setTheme,
    } = createStudioChrome({
        doc, win, root, selection, theme,
        nameChanged: value => applyEdit(ctx, setField(ctx.model, ['name'], value)),
        onUndo: () => step(() => history.undo(), () => history.redo(), 'Undo'),
        onRedo: () => step(() => history.redo(), () => history.undo(), 'Redo'),
        onOpenFile: f => ctx.openFile(f),
        onShowProblems: () => ctx.showProblems(),
        onSelectCheck: () => ctx.select('check'),
        render: () => ctx.render(),
    });

    const events = createStudioEvents({ win, doc, problemsHost, getContext: () => ctx });
    events.attach();

    // The pictures are kept in the browser beside the project, whenever the open pack's set of them is a new one.
    const keepPortraits = () => {
        const held = portraitsOf(history.current);
        if (held === lastKept) return;
        lastKept = held;
        saveHeld(win, held);
    };

    let cardTimer = null;
    const CARD_MIRROR = 'story-studio-card-pending';
    // The mirror is only for a save that did not land: it goes once a save has, once the draft is replaced, and when the pack changes.
    // `upTo` leaves a mirror written after that moment (a newer edit) alone.
    const clearMirror = (upTo = Infinity) => {
        try {
            const mirror = JSON.parse(win.sessionStorage.getItem(CARD_MIRROR));
            if (!mirror || !(Number(mirror.at) > upTo)) win.sessionStorage.removeItem(CARD_MIRROR);
        } catch { /* No mirror. */ }
    };
    const onPageHide = () => { ctx.unloading = true; ctx.flushForUnload(); ctx.unloading = false; };
    const onHidden = () => { if (doc.visibilityState === 'hidden') ctx.flushForUnload(); };
    const writeCard = () => {
        cardTimer = null;
        const id = history.current?.document?.id;
        if (destroyed || typeof id !== 'string') return;
        const touched = cardTouched(ctx.card);
        const started = Date.now();
        saveCardDraft(win, id, touched ? ctx.card : null).then(ok => {
            if (ok) clearMirror(started);
            if (ok || destroyed) return;
            // A draft that could not be written will be lost on reload; one that could not be deleted (Reset) may come back.
            ctx.notify(touched
                ? 'Only the card draft could not be kept in this browser: it will be lost on reload. The pack itself is saved. Download the card to keep it.'
                : 'Only the card draft could not be cleared in this browser: the old draft may come back on reload. The pack itself is saved.');
        });
    };

    const fileReader = createPackFileReader({
        destroyed: () => destroyed,
        nextToken: () => ++seq,
        isStale: token => destroyed || token !== seq,
        notify: message => ctx.notify(message),
        routeZip: file => ctx.openZip(file),
        loadText: (...args) => ctx.loadText(...args),
    });
    const ctx = {
        doc, win, root, app, main, inspector: inspectorBody, overlays, selection, file, authoring: {}, filters: {},
        // The Character card page's draft (saved with the pack) and its picture (PNG bytes, kept in IndexedDB beside it).
        card: emptyCard(), cardImage: null,
        get model() { return history.current; },
        get history() { return history; },
        get dirty() {
            if (!history.current?.document) return false;
            // Drafts are work that no export holds yet.
            return lastBaselineJson === null || JSON.stringify(history.current.document) !== lastBaselineJson || draftsOf(history.current).length > 0
                || portraitSignature(history.current) !== lastBaselinePortraits;
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
                history.revert();
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
            // Whether the browser kept the project: a screen that adds work only a save holds (drafts) checks it.
            if (history.current?.document) ctx.saved = writeDraft(win, history.current, ctx.dirty);
            keepPortraits();
            return true;
        },
        notify(message) { notice.textContent = message; },
        // The card page's draft is kept in the browser's IndexedDB apart from the project's own save, a moment after the last edit
        // (flushCard writes it now). When the browser will not keep it, only the card draft is unsaved, and the notice says so.
        saveCard() {
            if (destroyed || !history.current?.document) return false;
            if (cardTimer !== null) win.clearTimeout(cardTimer);
            cardTimer = win.setTimeout(writeCard, 250);
            return true;
        },
        // The page is going away (or hidden): an edit still waiting for its save is mirrored in sessionStorage first, because the
        // IndexedDB write may not finish; the next load prefers the mirror when it is newer.
        flushForUnload() {
            if (cardTimer !== null && !destroyed && typeof history.current?.document?.id === 'string' && (doc.visibilityState === undefined || doc.visibilityState === 'hidden' || ctx.unloading)) {
                try { win.sessionStorage.setItem(CARD_MIRROR, JSON.stringify({ packId: history.current.document.id, at: Date.now(), draft: ctx.card })); } catch { /* A mirror is a convenience. */ }
            }
            ctx.flushCard();
        },
        flushCard() {
            if (cardTimer === null) return;
            win.clearTimeout(cardTimer);
            writeCard();
        },
        // The card picture: PNG bytes, or null for today's cover.
        setCardImage(bytes) {
            if (destroyed) return false;
            ctx.cardImage = bytes ?? null;
            const id = history.current?.document?.id;
            saveCardImage(win, id, ctx.cardImage).then(ok => {
                if (!ok && ctx.cardImage && !destroyed) ctx.notify('Only the card picture could not be kept in this browser: it will be lost on reload. The pack itself is saved.');
            });
            return true;
        },
        // A new draft (a card was picked, or Reset): the old one is replaced as a whole and kept at once.
        setCard(card) {
            if (destroyed) return false;
            ctx.card = card;
            if (cardTimer !== null) win.clearTimeout(cardTimer);
            clearMirror();
            writeCard();
            return true;
        },
        select(kind, id = null, form = null) {
            if (destroyed) return;
            ctx.flushCard();
            selection.kind = kind; selection.id = id; selection.form = form;
            partsOpen = false;
            ctx.render();
            if (id !== null) {
                app.classList.add('inspector-open');
                if (stack?.matches) inspector.scrollIntoView?.({ block: 'nearest' });
            }
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
        downloadZip(filename) {
            const id = typeof ctx.model?.document?.id === 'string' ? ctx.model.document.id : 'pack';
            return downloadZip(ctx, filename || `${id}.zip`);
        },
        markExported() {
            if (!destroyed && history.current?.validation?.ok) {
                lastBaselineJson = JSON.stringify(history.current.document);
                lastBaselinePortraits = portraitSignature(history.current);
                writeDraft(win, history.current, false);
            }
        },
        loadText(textOrObject, portraits) {
            if (destroyed) return null;
            ++seq;
            let model;
            try {
                model = openPack(textOrObject);
                if (model.document && portraits?.size) model = withPortraits(model, portraits);
            } catch (err) {
                model = {
                    document: null,
                    validation: { ok: false, errors: [{ code: 'bad-schema', message: err?.message || 'Invalid pack' }] },
                };
            }
            if (model?.document) {
                const previous = { history, selection: { ...selection }, baseline: lastBaselineJson, held: lastBaselinePortraits, filename: ctx.filename, authoring: ctx.authoring, filters: ctx.filters, card: ctx.card, cardImage: ctx.cardImage };
                history = createHistory(model);
                ctx.authoring = {};
                ctx.filters = {};
                // The same pack opened again keeps its card draft; another pack starts with none.
                const samePack = previous.history.current?.document?.id === model.document.id;
                if (!samePack) { ctx.card = emptyCard(); ctx.cardImage = null; }
                selection.kind = 'places';
                selection.id = null;
                selection.form = null;
                lastBaselineJson = JSON.stringify(model.document);
                lastBaselinePortraits = portraitSignature(model);
                ctx.filename = null;
                notice.textContent = '';
                app.classList.remove('inspector-open');
                ctx.closeProblems(false);
                if (!ctx.render()) {
                    history = previous.history;
                    Object.assign(selection, previous.selection);
                    lastBaselineJson = previous.baseline;
                    lastBaselinePortraits = previous.held;
                    ctx.filename = previous.filename;
                    ctx.authoring = previous.authoring;
                    ctx.filters = previous.filters;
                    ctx.card = previous.card;
                    ctx.cardImage = previous.cardImage;
                    ctx.render();
                    return null;
                }
                writeDraft(win, model, false);
                if (!samePack) { clearMirror(); saveCardDraft(win, model.document.id, null); saveCardImage(win, model.document.id, null); }
                keepPortraits();
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
        openFile: fileReader.openFile,
        // A pack as one zip (pack.json and portraits/): the same reader the game uses, so Studio and Story Block agree on what is a pack.
        openZip: fileReader.openZip,
        render() {
            if (destroyed) return false;
            try {
                const focus = castFocus.before();
                if (focus.defer) return true;
                ctx.renderContent();
                castFocus.after(focus);
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
            fingerprint.textContent = `pack · ${model?.packHash?.slice(0, 8) ?? '—'}`;
            fingerprint.title = model?.packHash ?? '';
            undo.disabled = !history.canUndo; redo.disabled = !history.canRedo;
            problems.textContent = `Problems (${model?.validation?.errors?.length ?? 0})`;
            exportButton.disabled = !model?.validation?.ok;
            exportButton.title = exportButton.disabled ? 'Fix the problems first' : 'Export pack';
            rail.replaceChildren();
            const list = el(doc, 'div', '', { class: 'parts-list' });
            for (const kind of RAIL_KINDS) {
                const nav = button(doc, '', () => ctx.select(kind), { 'aria-current': selection.kind === kind ? 'page' : 'false' });
                const asset = kind === 'creatures' ? 'kind-foes' : `kind-${kind}`;
                nav.append(icon(doc, asset), el(doc, 'span', LABELS[kind]), el(doc, 'small', records(model, kind).length));
                list.append(nav);
                if (kind !== 'cast') continue;
                for (const [part, label] of EXTRA_PARTS) {
                    const extra = button(doc, '', () => ctx.select(part), { 'aria-current': selection.kind === part ? 'page' : 'false' });
                    extra.append(icon(doc, `kind-${part}`), el(doc, 'span', label), el(doc, 'small', 'NEW', { class: 'new' }));
                    list.append(extra);
                }
            }
            const more = el(doc, 'details');
            const moreKinds = KINDS.filter(kind => !RAIL_KINDS.includes(kind));
            more.open = moreKinds.includes(selection.kind);
            more.append(el(doc, 'summary', 'More kinds'));
            for (const kind of moreKinds) more.append(button(doc, `${LABELS[kind]} (${records(model, kind).length})`, () => ctx.select(kind)));
            list.append(more, button(doc, 'Pack settings', () => ctx.select('settings')));
            for (const [kind, label] of SCREENS) {
                list.append(button(doc, label, () => ctx.select(kind), { 'aria-current': selection.kind === kind ? 'page' : 'false' }));
            }
            list.append(check);
            // On a phone the parts list is a disclosure whose summary names where the creator is; elsewhere it is always open.
            const disclosure = el(doc, 'details', '', { class: 'parts' });
            const railKind = RAIL_KINDS.includes(selection.kind);
            const summary = el(doc, 'summary');
            summary.append(
                icon(doc, EXTRA_PARTS.some(([part]) => part === selection.kind) ? `kind-${selection.kind}` : !railKind ? 'kind-more' : selection.kind === 'creatures' ? 'kind-foes' : `kind-${selection.kind}`),
                el(doc, 'span', LABELS[selection.kind] ?? SCREEN_LABELS[selection.kind] ?? 'Pack parts', { class: 'label' }),
            );
            if (KINDS.includes(selection.kind)) summary.append(el(doc, 'small', records(model, selection.kind).length));
            summary.append(icon(doc, 'chevron-down'));
            disclosure.append(summary, list);
            disclosure.addEventListener('toggle', () => { if (stack?.matches) partsOpen = disclosure.open; });
            parts = disclosure;
            syncParts();
            rail.append(parts);
            ctx.previewCleanup?.();
            ctx.previewCleanup = null;
            main.replaceChildren(); inspectorBody.replaceChildren();
            inspector.hidden = !model?.document || ['check', 'defaults', 'presentation', 'data-modules', 'code-module', 'card', 'lorebook', 'lore-import'].includes(selection.kind);
            columns.refresh();
            renderScreen(ctx);
        },
        destroy() {
            ctx.previewCleanup?.();
            destroyed = true;
            castFocus.destroy();
            ++seq;
            media?.removeEventListener?.('change', setTheme);
            stack?.removeEventListener?.('change', syncParts);
            columns.destroy();
            win?.removeEventListener?.('pagehide', onPageHide);
            doc.removeEventListener?.('visibilitychange', onHidden);
            events.detach();

            root.replaceChildren();
        },
    };

    win?.addEventListener?.('pagehide', onPageHide);
    doc.addEventListener?.('visibilitychange', onHidden);
    media?.addEventListener?.('change', setTheme);
    setTheme();
    ctx.render();
    // A reload brings the cast's pictures back from where they were kept, if nothing has been edited meanwhile.
    if (restored?.model?.document && portraitNames(records(restored.model, 'cast')).length) {
        const start = history.current;
        loadHeld(win).then(held => {
            if (destroyed || !held?.size || history.current !== start) return;
            history = createHistory(withPortraits(start, held));
            lastKept = portraitsOf(history.current);
            lastBaselinePortraits = portraitSignature(history.current);
            ctx.render();
        });
    }
    // ...and so do the card page's draft and picture, kept apart from the project.
    if (restored?.model?.document) {
        const start = history.current?.document?.id;
        let mirror = null;
        try { mirror = JSON.parse(win.sessionStorage.getItem(CARD_MIRROR)); win.sessionStorage.removeItem(CARD_MIRROR); } catch { /* No mirror. */ }
        loadCardDraft(win).then(record => {
            const newer = mirror && mirror.packId === start && mirror.draft && typeof mirror.draft === 'object' && Number(mirror.at) >= (record?.at ?? 0);
            if (destroyed || history.current?.document?.id !== start || cardTouched(ctx.card)) return;
            if (!newer && (!record || record.packId !== start)) return;
            ctx.card = sanitizeCard(newer ? mirror.draft : record.draft);
            if (newer) writeCard();
            if (selection.kind === 'card') ctx.render();
        });
        loadCardImage(win).then(record => {
            if (destroyed || !record || record.packId !== start || history.current?.document?.id !== start || ctx.cardImage) return;
            ctx.cardImage = record.bytes;
            if (selection.kind === 'card') ctx.render();
        });
    }
    return ctx;
}

if (typeof document !== 'undefined') {
    const root = document.getElementById('studio');
    if (root) mountStudio(root);
}
