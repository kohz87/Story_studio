import { safeLabel, el, button, field, icon } from '../dom.js';
import { KINDS, LABELS, records, identity, localId } from '../records.js';
import { timelineNotes } from '../timeline/notes.js';


const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const GROUP_TITLES = {
    'bad-ref': 'Something points at a missing record',
    'not-found': 'Record not found',
    'bad-value': 'Invalid value',
    'dup-id': 'Duplicate identifier',
};

export function problemGroups(model) {
    const errors = model?.validation?.errors;
    if (!Array.isArray(errors)) return [];
    const map = new Map();
    for (const err of errors) {
        if (!err || typeof err !== 'object') continue;
        const code = String(err.code || 'unknown');
        if (!map.has(code)) {
            map.set(code, {
                code,
                title: GROUP_TITLES[code] || code,
                get n() { return this.rows.length; },
                get count() { return this.rows.length; },
                rows: [],
                errors: [],
            });
        }
        const g = map.get(code);
        const row = { ...err, text: err.message || '', message: err.message || '', path: err.path || '', code };
        g.rows.push(row);
        g.errors.push(row);
    }
    return [...map.values()];
}

export function diagnosticPath(path) {
    if (!path) return [];
    let parts;
    if (Array.isArray(path)) {
        parts = path.map(p => (typeof p === 'number' || /^\d+$/.test(String(p))) ? Number(p) : String(p));
    } else if (typeof path === 'string') {
        const matches = path.replace(/^\$\.?/, '').match(/[^.[\]]+/g);
        if (!matches) return [];
        parts = matches.map(m => {
            const clean = m.replace(/^['"]|['"]$/g, '');
            return /^\d+$/.test(clean) ? Number(clean) : clean;
        });
    } else {
        return [];
    }
    for (const p of parts) {
        if (UNSAFE.has(String(p)) || (typeof p === 'number' ? !Number.isSafeInteger(p) || p < 0 : !/^[a-zA-Z_][\w-]*$/.test(p))) return [];
    }
    return parts;
}

export function goToProblem(ctx, issue) {
    if (!ctx || !issue) return;
    const rawPath = issue?.path ?? (typeof issue === 'string' ? issue : '');
    const tokens = diagnosticPath(rawPath);
    if (!tokens.length) {
        if (typeof rawPath === 'string' && rawPath === 'name') focusTarget(ctx, '#pack-name');
        else focusMain(ctx);
        if (typeof ctx.closeProblems === 'function') ctx.closeProblems(false);
        return;
    }

    let norm = [...tokens];
    if (norm[0] !== 'content' && KINDS.includes(norm[0])) norm = ['content', ...norm];
    let coll = null, idx = null;
    if (norm[0] === 'content') {
        coll = norm[1] === 'skills' ? 'legacySkills' : norm[1];
        idx = norm[2];
    }
    if (coll && KINDS.includes(coll)) {
        const rec = typeof idx === 'number' ? records(ctx.model, coll)[idx] : null;
        const id = localId(ctx.model, identity(rec, coll)) || identity(rec, coll) || '';
        if (id) ctx.select(coll, id);
    }

    if (typeof ctx.closeProblems === 'function') ctx.closeProblems(false);

    let target = null;
    if (!target) {
        const root = ctx.root || ctx.app || ctx.doc.body || ctx.doc.documentElement;
        const elements = root?.querySelectorAll?.('[data-path]') || [];
        let best = null, bestScore = -1;
        for (const el of elements) {
            try {
                const arr = JSON.parse(el.getAttribute('data-path'));
                if (!Array.isArray(arr)) continue;
                let score = -1;
                if (arr.length === norm.length && arr.every((v, i) => String(v) === String(norm[i]))) score = 1000 + arr.length;
                else if (arr.every((v, i) => String(v) === String(norm[i]))) score = 500 + arr.length;
                else if (norm.every((v, i) => String(v) === String(arr[i]))) score = 200 + arr.length;
                if (score > bestScore) { bestScore = score; best = el; }
            } catch {}
        }
        target = best;
    }

    if (!target) {
        if (norm.length === 1 && norm[0] === 'name') target = findControl(ctx, '#pack-name');
        else target = ctx.main;
    }

    if (target && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName) && !target.hasAttribute('tabindex')) {
        target = target.querySelector('input') || target.querySelector('select') || target.querySelector('textarea') || ctx.main;
    }
    if (target) {
        if (target === ctx.main) target.setAttribute('tabindex', '-1');
        let p = target.parentElement;
        while (p) {
            if (p.tagName === 'DETAILS') p.open = true;
            p = p.parentElement;
        }
        if (typeof target.focus === 'function') target.focus();
        target.scrollIntoView?.({ block: 'nearest' });
    }
}

function focusMain(ctx) { ctx.main.setAttribute('tabindex', '-1'); ctx.main.focus(); }

function findControl(ctx, selector) {
    const root = ctx.root || ctx.app || ctx.doc.body || ctx.doc.documentElement;
    return root?.querySelector?.(selector) || null;
}

function focusTarget(ctx, selector) {
    const t = findControl(ctx, selector);
    if (t && typeof t.focus === 'function') t.focus();
}

// What the Timeline adds that is no error: the requirement of a lasting change, and delays that wait for nothing.
function renderNotes(ctx, container) {
    const doc = ctx.doc;
    const notes = timelineNotes(ctx.model?.document);
    if (!notes.length) return;
    const groupEl = el(doc, 'div', '', { class: 'problem-group' });
    const hdr = el(doc, 'div', '', { class: 'problem-group-hdr' });
    hdr.append(el(doc, 'span', 'note', { class: 'problem-chip mono' }), el(doc, 'span', 'Good to know', { class: 'problem-title' }), el(doc, 'span', String(notes.length), { class: 'problem-count muted' }));
    groupEl.append(hdr);
    for (const note of notes) {
        const rowEl = el(doc, 'div', '', { class: 'problem-row', 'data-note': note.kind });
        rowEl.append(el(doc, 'span', note.message, { class: 'problem-msg' }));
        if (note.path) rowEl.append(el(doc, 'span', note.path, { class: 'problem-path mono muted' }), button(doc, 'Go to', () => goToProblem(ctx, note), { class: 'btn-goto', 'aria-label': `Go to ${safeLabel(note.path)}` }));
        groupEl.append(rowEl);
    }
    container.append(groupEl);
}

export function renderProblemGroups(ctx, container) {
    const doc = ctx.doc;
    const groups = problemGroups(ctx.model);
    container.replaceChildren();
    if (!groups.length) {
        const message = ctx.model?.validation?.ok ? "No problems. Story Block's checker accepts this pack." : 'Open a pack to see its diagnostics.';
        container.append(el(doc, 'div', message, { class: 'clean-note' }));
        renderNotes(ctx, container);
        return;
    }
    for (const g of groups) {
        const groupEl = el(doc, 'div', '', { class: 'problem-group' });
        const hdr = el(doc, 'div', '', { class: 'problem-group-hdr' });
        hdr.append(
            el(doc, 'span', g.code, { class: 'problem-chip mono' }),
            el(doc, 'span', g.title, { class: 'problem-title' }),
            el(doc, 'span', String(g.n), { class: 'problem-count muted' })
        );
        groupEl.append(hdr);
        for (const r of g.rows) {
            const rowEl = el(doc, 'div', '', { class: 'problem-row' });
            rowEl.append(
                el(doc, 'span', r.text, { class: 'problem-msg' }),
                el(doc, 'span', r.path, { class: 'problem-path mono muted' }),
                button(doc, 'Go to', () => goToProblem(ctx, r), { class: 'btn-goto', 'aria-label': `Go to problem at ${safeLabel(r.path)}` })
            );
            groupEl.append(rowEl);
        }
        container.append(groupEl);
    }
    renderNotes(ctx, container);
}

export function renderProblemsDrawer(ctx, host, close) {
    const doc = ctx.doc;
    const drawer = el(doc, 'section', '', { class: 'problems-drawer', 'aria-label': 'Problems', role: 'region' });
    const hdr = el(doc, 'div', '', { class: 'drawer-hdr' });
    hdr.append(
        el(doc, 'h2', 'Problems · checked by Story Block', { class: 'drawer-title' }),
        button(doc, '×', () => {
            if (typeof close === 'function') close();
            else if (typeof ctx.closeProblems === 'function') ctx.closeProblems();
        }, { class: 'drawer-close-btn', 'aria-label': 'Close problems' })
    );
    drawer.append(hdr);
    const list = el(doc, 'div', '', { class: 'drawer-list' });
    renderProblemGroups(ctx, list);
    drawer.append(list);
    if (host) host.append(drawer);
    return drawer;
}

export function renderCheck(ctx) {
    const doc = ctx.doc;
    ctx.main.replaceChildren();
    if (ctx.inspector) ctx.inspector.replaceChildren();

    const ok = Boolean(ctx.model?.validation?.ok);
    const errCount = (ctx.model?.validation?.errors || []).length;
    const otherCount = KINDS.reduce((sum, k) => sum + records(ctx.model, k).length, 0);

    const root = el(doc, 'div', '', { class: 'check-screen' });
    const left = el(doc, 'section', '', { class: 'check-left', 'aria-label': 'Check' });
    const statusBox = el(doc, 'div', '', { class: 'check-status' });
    const iconSpan = el(doc, 'span', '', { class: `status-badge ${ok ? 'status-good' : 'status-warn'}` });
    iconSpan.append(icon(doc, ok ? 'ready' : 'warning'));
    const statusText = el(doc, 'div', '', { class: 'status-meta' });
    statusText.append(
        el(doc, 'h1', ok ? 'Ready to export' : errCount ? `${errCount} problems to fix` : 'Open a pack to check', { class: 'status-heading' }),
        el(doc, 'div', ok ? "Checked just now by Story Block's checker, the same one used on import." : 'Drafts may be invalid; export opens after check passes', { class: 'status-sub muted' })
    );
    statusBox.append(iconSpan, statusText);
    left.append(statusBox);

    const countsGrid = el(doc, 'div', '', { class: 'counts-grid' });
    for (const [k, v] of [['PLACES', records(ctx.model, 'places').length], ['ROUTES', records(ctx.model, 'routes').length], ['EVENTS', records(ctx.model, 'events').length], ['RECORDS', otherCount]]) {
        const card = el(doc, 'div', '', { class: 'count-card' });
        card.append(el(doc, 'div', k, { class: 'count-k muted' }), el(doc, 'div', String(v), { class: 'count-v' }));
        countsGrid.append(card);
    }
    left.append(countsGrid);
    const problemsList = el(doc, 'div', '', { class: 'problems-box' });
    renderProblemGroups(ctx, problemsList);
    left.append(problemsList);

    const right = el(doc, 'section', '', { class: 'check-right', 'aria-label': 'Export' });
    right.append(el(doc, 'h2', 'Export', { class: 'export-title' }));
    const defaultFilename = ctx.filename || (ctx.model?.document?.id ? `${localId(ctx.model, ctx.model.document.id)}.json` : 'pack.json');
    const fnInput = el(doc, 'input', '', { id: 'filename', class: 'fn-input mono', value: defaultFilename });
    fnInput.addEventListener('input', () => { ctx.filename = fnInput.value; });
    right.append(field(doc, 'FILE NAME', fnInput));

    const fpBox = el(doc, 'div', '', { class: 'fp-section' });
    fpBox.append(el(doc, 'div', 'FINGERPRINTS', { class: 'section-label muted' }));
    const fpCard = el(doc, 'div', '', { class: 'fp-card' });
    const pRow = el(doc, 'div', '', { class: 'fp-row' });
    pRow.append(el(doc, 'span', 'Whole pack', { class: 'fp-label muted' }), el(doc, 'span', ctx.model?.packHash || '—', { class: 'fp-val mono' }));
    fpCard.append(pRow);
    fpBox.append(fpCard);
    right.append(fpBox);

    const insideBox = el(doc, 'div', '', { class: 'inside-section' });
    insideBox.append(el(doc, 'div', "WHAT'S INSIDE", { class: 'section-label muted' }));
    const insideRows = KINDS.map(kind => [LABELS[kind] || kind, String(records(ctx.model, kind).length)]);
    for (const [label, val] of insideRows) {
        const row = el(doc, 'div', '', { class: 'inside-row' });
        row.append(el(doc, 'span', label), el(doc, 'span', val, { class: 'inside-val' }));
        insideBox.append(row);
    }
    right.append(insideBox);

    const bottom = el(doc, 'div', '', { class: 'export-bottom' });
    if (!ok) bottom.append(el(doc, 'div', `Fix the ${errCount} problems first.`, { role: 'status', class: 'export-warn' }));
    const expBtn = button(doc, 'Export pack file', () => {
        if (ok && typeof ctx.download === 'function') ctx.download(fnInput.value || 'pack.json');
    }, { id: 'export-btn', class: `primary btn-export ${ok ? 'btn-export-active' : 'btn-export-disabled'}`, 'aria-disabled': ok ? 'false' : 'true' });
    if (!ok) { expBtn.disabled = true; expBtn.title = 'Fix the problems first'; }
    bottom.append(expBtn);
    right.append(bottom);

    root.append(left, right);
    ctx.main.append(root);
}
