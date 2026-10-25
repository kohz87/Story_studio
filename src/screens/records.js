import { safeLabel, el, button } from '../dom.js';
import { KINDS, LABELS, records, identity, localId, kindPath } from '../records.js';
import { add, remove } from '../edits.js';
import { cascadeChanges } from './classes.js';
import { renderForm, createDefault } from '../forms.js';
import { schemaForKind, validateField } from '../form-schema.js';

function getRecordProblems(model, kind, record, idx) {
    if (!model?.validation?.errors) return [];
    const id = identity(record);
    const normId = localId(model, id);
    const prefix = [...kindPath(kind), idx].join('.');

    return model.validation.errors.filter(err => {
        const p = err.path || '';
        const msg = err.message || '';
        const normalized = p.replace(/\[(\d+)\]/g, '.$1');
        if (normalized === prefix || normalized.startsWith(`${prefix}.`)) return true;
        if (normId && (msg.includes(`"${safeLabel(normId)}"`) || msg.includes(`'${safeLabel(normId)}'`))) return true;
        return false;
    });
}

export function renderRecords(ctx) {
    const model = ctx.model;
    const doc = ctx.doc;
    const kind = ctx.selection.kind;
    const schema = schemaForKind(kind);
    const rawRecords = records(model, kind);

    const validRecords = [];
    for (let i = 0; i < rawRecords.length; i++) {
        const r = rawRecords[i];
        if (r && typeof r === 'object' && !Array.isArray(r)) {
            validRecords.push({ record: r, idx: i });
        }
    }

    const singularLabel = (LABELS[kind] || kind).replace(/s$/, '');
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    header.append(
        el(doc, 'h1', LABELS[kind] || kind),
        el(doc, 'div', `${validRecords.length} ${validRecords.length === 1 ? 'record' : 'records'}`, { class: 'records-subtitle' }),
        button(doc, `+ Add ${singularLabel}`, () => ctx.select(kind, '__new__'))
    );

    const listContainer = el(doc, 'div', '', { class: 'records-list' });
    if (validRecords.length === 0) {
        listContainer.append(el(doc, 'p', `No ${LABELS[kind] || kind} found in pack.`, { class: 'muted' }));
    } else {
        for (const { record, idx } of validRecords) {
            const id = identity(record);
            const normId = localId(model, id);
            const isSelected = ctx.selection.id !== null && ctx.selection.id === normId;
            const problems = getRecordProblems(model, kind, record, idx);

            const card = button(doc, '', () => ctx.select(kind, normId), {
                class: 'record-card',
                'aria-pressed': isSelected ? 'true' : 'false',
                'data-id': normId,
            });
            if (problems.length > 0) card.setAttribute('data-has-problem', 'true');

            const nameRow = el(doc, 'span', '', { class: 'record-card-header' });
            nameRow.append(el(doc, 'span', record.name || normId, { class: 'record-card-name' }));
            if (problems.length > 0) nameRow.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' }));

            const metaText = normId !== record.name ? `${safeLabel(normId)}${record.kind ? ` · ${safeLabel(record.kind)}` : ''}` : (record.kind || '');
            card.append(nameRow);
            if (metaText) card.append(el(doc, 'span', metaText, { class: 'record-card-meta' }));
            listContainer.append(card);
        }
    }

    screen.append(header, listContainer);
    ctx.main.append(screen);

    const inspectorContainer = ctx.inspector || screen;
    renderRecordsInspector(ctx, inspectorContainer, kind, schema, validRecords, singularLabel);
}

function renderRecordsInspector(ctx, container, kind, schema, validRecords, singularLabel) {
    const doc = ctx.doc;
    const model = ctx.model;
    const selId = ctx.selection.id;

    if (selId === '__new__') {
        renderAddForm(ctx, container, kind, schema, singularLabel);
        return;
    }

    const selItem = selId ? validRecords.find(item => localId(model, identity(item.record)) === selId) : null;
    if (!selItem) {
        container.append(el(doc, 'p', 'Select a record from the list to inspect and edit.', { class: 'muted' }));
        return;
    }

    const { record, idx } = selItem;
    const id = identity(record);
    const normId = localId(model, id);
    const baseEnginePath = [...kindPath(kind), idx];

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(
        el(doc, 'h2', record.name || normId),
        el(doc, 'span', LABELS[kind] || kind, { class: 'chip' })
    );
    container.append(titleRow);

    const packId = model?.document?.id || 'pack';
    const fullId = `pack.${safeLabel(packId)}/${safeLabel(normId)}`;
    const refs = (model?.references || []).filter(r => r.targetKind === kind && (r.targetId === fullId || r.targetId === normId));
    if (refs.length > 0) {
        container.append(el(doc, 'div', `Renaming the ID updates every reference to it (${refs.length} places).`, { class: 'muted' }));
    }

    const problems = getRecordProblems(model, kind, record, idx);
    if (problems.length > 0) {
        container.append(el(doc, 'div', problems.map(p => p.message).join('\n'), { role: 'status', class: 'warning' }));
    }

    const formBody = el(doc, 'div', '', { class: 'inspector-form-body' });
    renderForm(ctx, formBody, schema, record, baseEnginePath, { kind, record });
    container.append(formBody);

    const actionsRow = el(doc, 'div', '', { class: 'row' });
    const removeBtn = button(doc, 'Remove…', () => openRecordRemoveDialog(ctx, kind, record, removeBtn), { class: 'danger' });
    actionsRow.append(removeBtn);
    container.append(actionsRow);
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
            const newId = identity(draft);
            const normId = localId(res.model, newId);
            ctx.selection.id = normId;
            if (ctx.apply(res)) {
                ctx.select(kind, normId);
            }
        } else {
            ctx.notify((res.errors || [{ code: 'add-failed', message: 'Could not add record' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        }
    }, { class: 'primary' });

    actionsRow.append(cancelBtn, createBtn);
    container.append(actionsRow);
}

function openRecordRemoveDialog(ctx, kind, record, invoker) {
    const id = identity(record);
    const previewRes = remove(ctx.model, kind, id, { cascade: false });
    if (previewRes.ok) {
        ctx.selection.id = null;
        ctx.apply(previewRes);
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
        if (ctx.selection.id === localId(ctx.model, id)) ctx.selection.id = null;
        closeDialog();
        ctx.apply(cascadePreview);
    }, { class: 'danger primary' });

    btnRow.append(cancelBtn, confirmBtn);
    dialog.append(btnRow);
    ctx.overlays.append(dialog);

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    cancelBtn.focus?.();
}
