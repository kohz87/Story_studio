import { applyEdit } from '../apply-edit.js';
import { safeLabel, el, button, icon } from '../dom.js';
import { KINDS, LABELS, records, identity, localId, kindPath, TRAITS, trait, FILTERED_KINDS } from '../records.js';
import { add, remove } from '../edits.js';
import { cascadeChanges } from './classes.js';
import { renderForm, createDefault } from '../forms.js';
import { renderTrainerTemplate, convertToTemplate, addTrainerTemplate, templateMeta, canConvertToTemplate } from './trainer-template.js';
import { schemaForRecord, validateField } from '../form-schema.js';

function getRecordProblems(model, kind, record, idx) {
    if (!model?.validation?.errors) return [];
    const id = identity(record, kind);
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

const FILTERS = [['all', 'All'], ['fixed', 'Fixed'], ['template', 'Templates']];

function note(doc, ...parts) {
    const text = el(doc, 'p');
    text.append(...parts);
    const box = el(doc, 'div', '', { class: 'records-note', role: 'note' });
    box.append(icon(doc, 'info'), text);
    return box;
}

// "the 2 markets records set their ..." in the right number, for the notes that explain how shops and places meet markets.
function marketsClause(doc, count, detail, capital) {
    const the = capital ? 'The' : 'the';
    const code = el(doc, 'code', 'markets');
    if (count === 0) return [capital ? 'This pack has no ' : 'this pack has no ', code, ' records'];
    return count === 1 ? [`${the} 1 `, code, ` record sets its ${detail}`] : [`${the} ${count} `, code, ` records set their ${detail}`];
}

function marketPlaces(model) {
    return records(model, 'places').filter(place => typeof place?.market === 'string' && place.market !== '').length;
}

function headerNote(ctx, kind, count) {
    const doc = ctx.doc;
    if (kind === 'creatures') return note(doc, 'Base foes: each fight scales them to its danger; the narrator can make named variants.');
    if (kind === 'trainers') return note(doc, 'Fixed trainers stand at one place with set skills and a fee. Templates are open: a skill list and a fee range by rank; RPG Battle places them where the story offers them.');
    if (kind !== 'shops') return null;
    const places = marketPlaces(ctx.model);
    const link = el(doc, 'a', 'Places / Markets', { class: 'link-ish', href: '#places' });
    link.addEventListener('click', event => { event.preventDefault?.(); ctx.select('places'); });
    const lead = count === 1 ? 'This shop is fixed: a named shop with set stock and prices.'
        : count === 0 ? 'Shops are fixed: named shops with set stock and prices.' : `These ${count} shops are fixed: named shops with set stock and prices.`;
    const where = places === 0 ? 'none in this pack do' : places === 1 ? '1 place in this pack does' : `${places} places in this pack do`;
    return note(doc, `${lead} Separately, RPG Battle\u2019s trade makes traders at any place that has a market type (${where}); `,
        ...marketsClause(doc, records(ctx.model, 'markets').length, 'price factors and how many things a trader has', false), '. See ', link, '.');
}

// The inspector's own note for a template: how the narrator turns the record into a named one.
function templateNote(ctx, kind, record, id) {
    const doc = ctx.doc;
    if (kind === 'creatures') {
        return note(doc, 'Base stat block. Each fight scales it to that fight\u2019s danger when it is offered. For a named variant the narrator writes ',
            el(doc, 'code', `! encounter <name> | like: ${safeLabel(id)}`));
    }
    if (kind === 'trainers') {
        return note(doc, 'Template: the fee is rolled from this range when a trainer is offered with ', el(doc, 'code', `| like: ${safeLabel(id)}`),
            ', and the trainer stays where it was offered.');
    }
    if (kind !== 'quests') return null;
    const rank = typeof record.rank === 'string' && record.rank ? ` for rank ${safeLabel(record.rank)}` : '';
    return note(doc, `Template: a reward range${rank}. The actual reward is fixed when the narrator offers one, with `, el(doc, 'code', `| like: ${safeLabel(id)}`));
}

// The All / Fixed / Templates filter of a list that holds both (quests, trainers). The choice lives in ctx.filters for the session only.
function recordFilter(ctx, kind, counts, active) {
    const doc = ctx.doc;
    const group = el(doc, 'div', '', { class: 'skill-tabs quest-filter', role: 'group', 'aria-label': `Show ${LABELS[kind].toLowerCase()}` });
    for (const [key, label] of FILTERS) {
        const choice = button(doc, '', () => {
            (ctx.filters ??= {})[kind] = key;
            ctx.render();
            ctx.main.querySelector?.(`[data-filter="${key}"]`)?.focus?.();
        }, { class: 'skill-tab-btn', 'aria-pressed': key === active ? 'true' : 'false', 'data-filter': key });
        choice.append(label, el(doc, 'span', counts[key], { class: 'count' }));
        group.append(choice);
    }
    return group;
}

function filterHelp(doc, kind) {
    const help = el(doc, 'p', '', { class: 'muted filter-help' });
    if (kind === 'trainers') {
        help.append('Templates have no place: the story offers one with ', el(doc, 'code', '| like: <slug>'),
            ', or the reader uses Make this a trainer. The fee is rolled from the range then.');
    } else help.append('Templates are open quests: a reward range by rank. The actual reward is fixed when the narrator offers one.');
    return help;
}

// "+ Add Trainer" opens a two-item menu: a fixed trainer (the generic form) or a trainer template (added at once, then edited).
function addTrainerMenu(ctx, singularLabel) {
    const doc = ctx.doc;
    const wrap = el(doc, 'span', '', { class: 'add-wrap' });
    const trigger = button(doc, `+ Add ${singularLabel}`, () => setOpen(menu.hidden, 'first'), { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    const menu = el(doc, 'div', '', { class: 'add-menu', role: 'menu' });
    menu.hidden = true;
    const item = (label, help, action, disabled) => {
        const choice = button(doc, label, () => { setOpen(false); action(); }, { role: 'menuitem' });
        choice.append(el(doc, 'small', help, { class: 'muted' }));
        choice.disabled = disabled;
        return choice;
    };
    const blocked = canConvertToTemplate(ctx.model);
    menu.append(
        item('Fixed trainer', 'Stands at one place, one fee', () => ctx.select('trainers', '__new__'), false),
        item('Trainer template', blocked || 'No place; a skill list and a fee range by rank', () => addTrainerTemplate(ctx), Boolean(blocked)),
    );
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(choice => !choice.disabled);
    function setOpen(open, which) {
        menu.hidden = !open;
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && which) items().at(which === 'last' ? -1 : 0)?.focus?.();
    }
    // The menu pattern: Down and Up from the button open it, then Up, Down, Home and End move through the items; Escape closes it.
    wrap.addEventListener('keydown', event => {
        const now = items();
        const at = now.indexOf(doc.activeElement);
        if (event.key === 'Escape' && !menu.hidden) { event.preventDefault?.(); setOpen(false); trigger.focus?.(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        if (menu.hidden) {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault?.();
            setOpen(true, event.key === 'ArrowUp' ? 'last' : 'first');
            return;
        }
        if (!now.length) return;
        event.preventDefault?.();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? now.length - 1
            : event.key === 'ArrowDown' ? (at + 1) % now.length : (at <= 0 ? now.length - 1 : at - 1);
        now[next].focus?.();
    });
    wrap.addEventListener('focusout', event => {
        if (!menu.hidden && event.relatedTarget && !wrap.contains?.(event.relatedTarget)) setOpen(false);
    });
    wrap.append(trigger, menu);
    return wrap;
}

// A helper line under a field of the open record's form (the form itself knows nothing about it).
function addFieldHint(ctx, formBody, path, parts) {
    const wanted = JSON.stringify(path);
    const control = [...(formBody.querySelectorAll?.('[data-path]') ?? [])].find(node => node.getAttribute('data-path') === wanted);
    const row = control?.closest?.('.fieldset-row');
    if (!row) return;
    const hint = el(ctx.doc, 'small', '', { class: 'field-hint' });
    hint.append(...parts);
    const first = row.children[0];
    if (first && row.insertBefore && first.nextSibling !== undefined) row.insertBefore(hint, first.nextSibling);
    else row.append(hint);
}

export function renderRecords(ctx) {
    const model = ctx.model;
    const doc = ctx.doc;
    const kind = ctx.selection.kind;
    const schema = schemaForRecord(kind, null);
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
        kind === 'trainers' ? addTrainerMenu(ctx, singularLabel) : button(doc, `+ Add ${singularLabel}`, () => ctx.select(kind, '__new__'))
    );

    const counts = { all: validRecords.length, fixed: 0, template: 0 };
    for (const { record } of validRecords) { const t = trait(kind, record); if (t) counts[t]++; }
    const filtered = FILTERED_KINDS.has(kind);
    const active = filtered && FILTERS.some(([key]) => key === ctx.filters?.[kind]) ? ctx.filters[kind] : 'all';
    const shown = validRecords.filter(({ record }) => active === 'all' || trait(kind, record) === active);

    const listContainer = el(doc, 'div', '', { class: 'records-list' });
    if (validRecords.length === 0) {
        listContainer.append(el(doc, 'p', `No ${LABELS[kind] || kind} found in pack.`, { class: 'muted' }));
    } else if (shown.length === 0) {
        listContainer.append(el(doc, 'p', `No ${active} ${LABELS[kind].toLowerCase()}.`, { class: 'muted' }));
    } else {
        for (const { record, idx } of shown) {
            const id = identity(record, kind);
            const normId = localId(model, id);
            const isSelected = Boolean(normId) && ctx.selection.id === normId;
            const problems = getRecordProblems(model, kind, record, idx);

            const card = button(doc, '', () => ctx.select(kind, normId), {
                class: 'record-card',
                'aria-pressed': isSelected ? 'true' : 'false',
                'data-id': normId,
            });
            // A record with no key (no slug, and no name to make one from) cannot be told from another, so it cannot be picked.
            if (!normId) card.disabled = true;
            if (problems.length > 0) card.setAttribute('data-has-problem', 'true');

            const nameRow = el(doc, 'span', '', { class: 'record-card-header' });
            nameRow.append(el(doc, 'span', record.name || normId || `${LABELS[kind] || kind} ${idx + 1}`, { class: 'record-card-name' }));
            const kindTrait = trait(kind, record);
            if (kindTrait) nameRow.append(el(doc, 'span', TRAITS[kindTrait], { class: `chip chip-${kindTrait}` }));
            if (problems.length > 0) nameRow.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' }));

            const metaText = !normId ? 'No ID: give it a name or a slug'
                : kind === 'trainers' && kindTrait === 'template' ? templateMeta(normId, record)
                : normId !== record.name ? `${safeLabel(normId)}${record.kind ? ` · ${safeLabel(record.kind)}` : ''}` : (record.kind || '');
            card.append(nameRow);
            if (metaText) card.append(el(doc, 'span', metaText, { class: 'record-card-meta' }));
            listContainer.append(card);
        }
    }

    screen.append(header);
    const intro = headerNote(ctx, kind, validRecords.length);
    if (intro) screen.append(intro);
    if (filtered) {
        screen.append(recordFilter(ctx, kind, counts, active), filterHelp(doc, kind));
    }
    screen.append(listContainer);
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

    const selItem = selId ? validRecords.find(item => localId(model, identity(item.record, kind)) === selId) : null;
    if (!selItem) {
        container.append(el(doc, 'p', 'Select a record from the list to inspect and edit.', { class: 'muted' }));
        return;
    }

    const { record, idx } = selItem;
    const id = identity(record, kind);
    const normId = localId(model, id);
    const baseEnginePath = [...kindPath(kind), idx];

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(
        el(doc, 'h2', record.name || normId),
        el(doc, 'span', LABELS[kind] || kind, { class: 'chip' })
    );
    const kindTrait = trait(kind, record);
    if (kindTrait) titleRow.append(el(doc, 'span', TRAITS[kindTrait], { class: `chip chip-${kindTrait}` }));
    container.append(titleRow);
    const intro = kindTrait === 'template' ? templateNote(ctx, kind, record, normId) : null;
    if (intro) container.append(intro);

    const packId = model?.document?.id || 'pack';
    const fullId = `pack.${safeLabel(packId)}/${safeLabel(normId)}`;
    const refs = (model?.references || []).filter(r => r.targetKind === kind && (r.targetId === fullId || r.targetId === normId));
    if (refs.length > 0) {
        container.append(el(doc, 'div', `Renaming the ID updates every reference to it (${refs.length} places).`, { class: 'muted' }));
    }

    const problems = getRecordProblems(model, kind, record, idx);
    // A trainer template has its own editor: it shows the problems beside the fields they belong to, and owns the actions.
    if (kind === 'trainers' && kindTrait === 'template') {
        renderTrainerTemplate(ctx, container, { record, idx, id: normId, problems, onDelete: invoker => openRecordRemoveDialog(ctx, kind, record, invoker) });
        return;
    }
    if (problems.length > 0) {
        container.append(el(doc, 'div', problems.map(p => p.message).join('\n'), { role: 'status', class: 'warning' }));
    }

    const formBody = el(doc, 'div', '', { class: 'inspector-form-body' });
    renderForm(ctx, formBody, schemaForRecord(kind, record), record, baseEnginePath, { kind, record, label: singularLabel });
    if (kind === 'places') {
        addFieldHint(ctx, formBody, [...baseEnginePath, 'market'], ['RPG Battle\u2019s trade makes traders at places with a market type. ',
            ...marketsClause(ctx.doc, records(model, 'markets').length, 'price factors and stock size', true), '.']);
    }
    container.append(formBody);

    const actionsRow = el(doc, 'div', '', { class: 'row' });
    const removeBtn = button(doc, 'Remove…', () => openRecordRemoveDialog(ctx, kind, record, removeBtn), { class: 'danger' });
    if (kind === 'trainers') {
        const toTemplate = button(doc, 'Convert to template', () => convertToTemplate(ctx, idx, normId));
        const blocked = canConvertToTemplate(ctx.model);
        toTemplate.disabled = Boolean(blocked);
        actionsRow.append(toTemplate, removeBtn);
        if (blocked) container.append(el(doc, 'p', blocked, { class: 'muted field-hint' }));
    } else actionsRow.append(removeBtn);
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

function openRecordRemoveDialog(ctx, kind, record, invoker) {
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
