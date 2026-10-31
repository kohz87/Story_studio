import { applyEdit } from '../apply-edit.js';
import { safeLabel, el, button } from '../dom.js';
import { KINDS, CASCADE_KINDS, LABELS, SINGULAR, records, identity, localId, kindPath } from '../records.js';
import { add, remove } from '../edits.js';
import { renderForm, createDefault } from '../forms.js';
import { schemaForRecord, validateField } from '../form-schema.js';

export function getRecordProblems(model, kind, record, idx) {
    const prefix = [...kindPath(kind), idx].join('.');
    return (model?.validation?.errors ?? []).filter(err => {
        const path = String(err.path ?? '').replace(/\[(\d+)\]/g, '.$1');
        return path === prefix || path.startsWith(`${prefix}.`);
    });
}

function cascadeChanges(before, after) {
    const changes = [];
    for (const kind of CASCADE_KINDS) {
        const remaining = new Set(records(after, kind).map(item => localId(after, identity(item, kind))));
        for (const item of records(before, kind)) {
            const id = localId(before, identity(item, kind));
            if (id && !remaining.has(id)) changes.push({ label: `${safeLabel(item.name || id)} (${LABELS[kind] || kind})` });
        }
    }
    return changes;
}

// `hooks` lets a screen that shows one kind its own way (the Timeline) keep the list: `title`, `toolbar` (a node for the
// header), `addLabel` and `add` (what the add button does), and `inspect` (draws the selected record in the inspector).
export function renderRecords(ctx, hooks = {}) {
    const { doc, model } = ctx;
    const kind = ctx.selection.kind;
    const schema = schemaForRecord(kind);
    const list = records(model, kind).map((record, idx) => ({ record, idx })).filter(({ record }) => record && typeof record === 'object' && !Array.isArray(record));
    const singular = SINGULAR[kind] ?? (LABELS[kind] || kind).replace(/s$/, '');
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    header.append(el(doc, 'h1', LABELS[kind] || kind),
        el(doc, 'div', `${list.length} ${list.length === 1 ? 'record' : 'records'}`, { class: 'records-subtitle' }),
        ...hooks.toolbar ? [hooks.toolbar(doc)] : [],
        button(doc, hooks.addLabel ?? `+ Add ${singular}`, hooks.add ?? (() => ctx.select(kind, '__new__'))));
    screen.append(header);
    const cards = el(doc, 'div', '', { class: 'records-list' });
    if (!list.length) cards.append(el(doc, 'p', `No ${LABELS[kind] || kind} found in pack.`, { class: 'muted' }));
    for (const { record, idx } of list) {
        const id = localId(model, identity(record, kind));
        const card = button(doc, '', () => ctx.select(kind, id), { class: 'record-card', 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
        if (!id) card.disabled = true;
        const problems = getRecordProblems(model, kind, record, idx);
        if (problems.length) card.setAttribute('data-has-problem', 'true');
        const title = el(doc, 'span', '', { class: 'record-card-header' });
        title.append(el(doc, 'span', record.name || id || `${LABELS[kind]} ${idx + 1}`, { class: 'record-card-name' }));
        if (problems.length) title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' }));
        card.append(title);
        const meta = !id ? 'No ID: give it a name or a slug' : id !== record.name ? `${safeLabel(id)}${record.kind ? ` · ${safeLabel(record.kind)}` : ''}` : (record.kind || '');
        if (meta) card.append(el(doc, 'span', meta, { class: 'record-card-meta' }));
        cards.append(card);
    }
    screen.append(cards);
    ctx.main.append(screen);
    const inspector = ctx.inspector || screen;
    if (ctx.selection.id === '__new__') return renderAddForm(ctx, inspector, kind, schema, singular);
    const selected = list.find(({ record }) => localId(model, identity(record, kind)) === ctx.selection.id);
    if (!selected) { inspector.append(el(doc, 'p', 'Select a record from the list to inspect and edit.', { class: 'muted' })); return; }
    const { record, idx } = selected;
    const id = localId(model, identity(record, kind));
    if (hooks.inspect) { hooks.inspect(ctx, inspector, { record, idx, id, problems: getRecordProblems(model, kind, record, idx) }); return; }
    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(el(doc, 'h2', record.name || id), el(doc, 'span', SINGULAR[kind] ?? (LABELS[kind] || kind), { class: 'chip' }));
    inspector.append(titleRow);
    const fullId = `pack.${safeLabel(model?.document?.id || 'pack')}/${safeLabel(id)}`;
    const references = (model?.references || []).filter(ref => ref.targetKind === kind && (ref.targetId === fullId || ref.targetId === id));
    if (references.length) inspector.append(el(doc, 'div', `Renaming the ID updates every reference to it (${references.length} places).`, { class: 'muted' }));
    const problems = getRecordProblems(model, kind, record, idx);
    if (problems.length) inspector.append(el(doc, 'div', problems.map(problem => problem.message).join('\n'), { role: 'status', class: 'warning' }));
    const form = el(doc, 'div', '', { class: 'inspector-form-body' });
    renderForm(ctx, form, schema, record, [...kindPath(kind), idx], { kind, record, label: singular });
    inspector.append(form);
    const removeButton = button(doc, 'Remove…', () => openRecordRemoveDialog(ctx, kind, record, removeButton), { class: 'danger' });
    inspector.append(removeButton);
}

function renderAddForm(ctx, container, kind, schema, singularLabel) {
    const doc = ctx.doc;
    const draftPath = [...kindPath(kind), 'draft'];
    const defaults = { model: ctx.model, kind, path: draftPath };
    let draft = createDefault(schema, defaults) ?? createDefault(schema, { ...defaults, partial: true });

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(el(doc, 'h2', `+ Add ${singularLabel}`));
    container.append(titleRow);

    const formBody = el(doc, 'div', '', { class: 'inspector-form-body' });
    const renderDraft = () => {
        formBody.replaceChildren();
        renderForm(ctx, formBody, schema, draft, draftPath, {
            kind, isNew: true, pending: true, record: draft,
            onChange(next, path) {
                const relative = path.slice(draftPath.length);
                if (!relative.length) draft = next;
                else {
                    const copy = JSON.parse(JSON.stringify(draft));
                    let parent = copy;
                    for (const key of relative.slice(0, -1)) parent = parent[key];
                    Object.defineProperty(parent, relative.at(-1), { value: next, enumerable: true, writable: true, configurable: true });
                    draft = copy;
                }
                renderDraft();
            },
        });
    };
    renderDraft();
    container.append(formBody);

    const actionsRow = el(doc, 'div', '', { class: 'row' });
    const cancelBtn = button(doc, 'Cancel', () => ctx.select(kind, null));
    const createBtn = button(doc, `Add ${singularLabel}`, () => {
        const checked = validateField(schema, draft);
        if (!checked.ok) { ctx.notify(`${checked.code}: ${checked.message}`); return; }
        const res = add(ctx.model, kind, draft);
        if (res.ok) {
            const newId = identity(draft, kind);
            const normId = localId(res.model, newId);
            if (applyEdit(ctx, res, { id: normId })) {
                ctx.select(kind, normId);
            }
        } else {
            ctx.notify((res.errors || [{ code: 'add-failed', message: 'Could not add record' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        }
    }, { class: 'primary' });

    actionsRow.append(cancelBtn, createBtn);
    container.append(actionsRow);
}

export function openRecordRemoveDialog(ctx, kind, record, invoker) {
    const id = identity(record, kind);
    const previewRes = remove(ctx.model, kind, id, { cascade: false });
    if (previewRes.ok) {
        applyEdit(ctx, previewRes, { id: null });
        if (ctx.doc.contains?.(invoker)) invoker.focus?.();
        else ctx.main.focus?.();
        return;
    }

    const cascadePreview = remove(ctx.model, kind, id, { cascade: true });
    if (!cascadePreview.ok) {
        ctx.notify((cascadePreview.errors || [{ code: 'remove-failed', message: 'Could not remove record' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        return;
    }

    const changes = cascadeChanges(ctx.model, cascadePreview.model, id);
    const dialog = el(ctx.doc, 'dialog', '', { 'aria-label': `Remove ${safeLabel(record.name || id)}` });

    const closeDialog = () => {
        try { dialog.close?.(); } catch { /* ignore */ }
        dialog.remove();
        if (ctx.doc.contains?.(invoker)) invoker.focus?.();
        else ctx.main.focus?.();
    };

    dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        closeDialog();
    });

    dialog.append(
        el(ctx.doc, 'h2', `Remove ${safeLabel(record.name || id)}?`),
        el(ctx.doc, 'p', 'Other parts of the pack use it. Removing it also removes:')
    );

    const list = el(ctx.doc, 'ul');
    for (const c of changes) list.append(el(ctx.doc, 'li', c.label));
    dialog.append(list);
    dialog.append(el(ctx.doc, 'p', 'You can undo this. The pack may need fixes afterwards before it can be exported.', { class: 'muted' }));

    const btnRow = el(ctx.doc, 'div', '', { class: 'row' });
    const cancelBtn = button(ctx.doc, 'Keep it', () => closeDialog());
    const confirmBtn = button(ctx.doc, `Remove all ${changes.length}`, () => {
        closeDialog();
        applyEdit(ctx, cascadePreview, ctx.selection.id === localId(ctx.model, id) ? { id: null } : undefined);
    }, { class: 'danger primary' });

    btnRow.append(cancelBtn, confirmBtn);
    dialog.append(btnRow);
    ctx.overlays.append(dialog);

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    cancelBtn.focus?.();
}
