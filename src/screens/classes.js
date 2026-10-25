import { applyEdit } from '../apply-edit.js';
import { safeLabel, el, button, field } from '../dom.js';
import { KINDS, LABELS, records, identity, localId } from '../records.js';
import { add, addClassSkill, resetClassSkills, renameId, remove, moveClass, setSchemaField as setField } from '../edits.js';
import { schemaForKind, validateField } from '../form-schema.js';
import { validateRulesPack } from '../../vendor/story-block/src/v2/packs/rules-v2.js';

// Sets or replaces a field on a class record by slug.
export function classField(model, classSlug, fieldName, value) {
    const list = records(model, 'classes');
    const idx = list.findIndex(c => c && typeof c === 'object' && localId(model, identity(c)) === localId(model, classSlug));
    if (idx === -1) {
        return { ok: false, model, errors: [{ code: 'not-found', message: `Class ${safeLabel(classSlug)} not found` }] };
    }
    return setField(model, ['content', 'rules', 0, 'classes', idx, fieldName], value);
}

// Computes exact removed records, start inventory items, and derived forms.
export function cascadeChanges(beforeModel, previewModel, _targetSlug = null) {
    const changes = [];
    if (!beforeModel?.document || !previewModel?.document) return changes;

    const beforeDoc = beforeModel.document;
    const afterDoc = previewModel.document;

    // Compare records across all KINDS
    for (const kind of KINDS) {
        const beforeList = records(beforeModel, kind);
        const afterList = records(previewModel, kind);
        const afterIds = new Set(
            afterList
                .map(r => (r && typeof r === 'object' ? localId(previewModel, identity(r)) : null))
                .filter(Boolean)
        );

        for (const item of beforeList) {
            if (!item || typeof item !== 'object') continue;
            const rawId = identity(item);
            const id = localId(beforeModel, rawId);
            if (!afterIds.has(id)) {
                const name = typeof item.name === 'string' && item.name ? item.name : id;
                const kindLabel = LABELS[kind] || kind;
                changes.push({
                    kind,
                    id,
                    name,
                    label: `${safeLabel(name)} (${kindLabel})`,
                });
            }
        }
    }

    // Compare start.inventory.items
    const beforeInv = Array.isArray(beforeDoc.start?.inventory?.items) ? beforeDoc.start.inventory.items : [];
    const afterInv = Array.isArray(afterDoc.start?.inventory?.items) ? afterDoc.start.inventory.items : [];
    const normalizeInv = (entry) => {
        const raw = typeof entry === 'string' ? entry : entry?.item;
        return typeof raw === 'string' ? localId(beforeModel, raw) : null;
    };
    const afterInvSet = new Set(afterInv.map(normalizeInv).filter(Boolean));

    for (const entry of beforeInv) {
        const norm = normalizeInv(entry);
        if (norm && !afterInvSet.has(norm)) {
            changes.push({
                kind: 'startInventory',
                id: norm,
                name: norm,
                label: `Start inventory: ${safeLabel(norm)}`,
            });
        }
    }

    // Exact removed forms: base forms labeled "Base form", reachable generated labeled "Generated form"
    const removedSkills = new Set(changes.filter(c => c.kind === 'skills').map(c => c.id));
    const removedBranches = new Set(changes.filter(c => c.kind === 'branches').map(c => c.id));

    let expandedForms = null;
    try {
        const valRes = validateRulesPack(beforeDoc);
        if (valRes?.ok && valRes.resolved?.forms) {
            expandedForms = valRes.resolved.forms;
        }
    } catch {
        expandedForms = null;
    }

    if (expandedForms) {
        for (const form of Object.values(expandedForms)) {
            if (!form?.id) continue;
            const normFormId = localId(beforeModel, form.id);
            const normSkillId = form.skill ? localId(beforeModel, form.skill) : null;
            const normFromForm = form.fromForm ? localId(beforeModel, form.fromForm) : null;

            if (form.origin === 'base') {
                if (normSkillId && removedSkills.has(normSkillId)) {
                    changes.push({
                        kind: 'forms',
                        id: normFormId,
                        name: normFormId,
                        label: `${safeLabel(normFormId)} (Base form)`,
                    });
                }
            } else if (form.origin === 'generated') {
                const isRemoved =
                    (normSkillId && removedSkills.has(normSkillId)) ||
                    (normFromForm && (removedBranches.has(normFromForm) || removedSkills.has(normSkillId)));
                if (isRemoved) {
                    changes.push({
                        kind: 'forms',
                        id: normFormId,
                        name: normFormId,
                        label: `${safeLabel(normFormId)} (Generated form)`,
                    });
                }
            }
        }
    } else {
        const beforeClasses = records(beforeModel, 'classes').filter(c => c && typeof c === 'object');
        const beforeBranches = records(beforeModel, 'branches').filter(b => b && typeof b === 'object');

        for (const skillSlug of removedSkills) {
            const baseSlug = `${safeLabel(skillSlug)}-base`;
            changes.push({
                kind: 'forms',
                id: baseSlug,
                name: baseSlug,
                label: `${baseSlug} (Base form)`,
            });

            const owningClass = beforeClasses.find(c => Array.isArray(c.skills) && c.skills.some(s => s && localId(beforeModel, s) === skillSlug));
            if (owningClass && owningClass.tier === 3) {
                changes.push({
                    kind: 'forms',
                    id: `${baseSlug}-g`,
                    name: `${baseSlug}-g`,
                    label: `${baseSlug}-g (Generated form)`,
                });
                changes.push({
                    kind: 'forms',
                    id: `${baseSlug}-g-g`,
                    name: `${baseSlug}-g-g`,
                    label: `${baseSlug}-g-g (Generated form)`,
                });

                for (const b of beforeBranches) {
                    if (b.skill && localId(beforeModel, b.skill) === skillSlug && b.fromForm && localId(beforeModel, b.fromForm) === baseSlug) {
                        if (b.choice === 'a') {
                            changes.push({
                                kind: 'forms',
                                id: `${baseSlug}-a-g`,
                                name: `${baseSlug}-a-g`,
                                label: `${baseSlug}-a-g (Generated form)`,
                            });
                        } else if (b.choice === 'b') {
                            changes.push({
                                kind: 'forms',
                                id: `${baseSlug}-b-g`,
                                name: `${baseSlug}-b-g`,
                                label: `${baseSlug}-b-g (Generated form)`,
                            });
                        }
                    }
                }
            }
        }

        for (const branchId of removedBranches) {
            const b = beforeBranches.find(r => r.slug && localId(beforeModel, r.slug) === branchId);
            if (b && b.skill && !removedSkills.has(localId(beforeModel, b.skill))) {
                if (b.choice && (b.choice === 'a' || b.choice === 'b') && typeof b.fromForm === 'string' && b.fromForm.endsWith('-base')) {
                    const genFormId = `${safeLabel(branchId)}-g`;
                    if (!changes.some(c => c.kind === 'forms' && c.id === genFormId)) {
                        changes.push({
                            kind: 'forms',
                            id: genFormId,
                            name: genFormId,
                            label: `${safeLabel(genFormId)} (Generated form)`,
                        });
                    }
                }
            }
        }
    }

    return changes;
}

// Maps live validation errors to a class record safely by path or message reference.
function getClassProblems(model, cls, cIdx) {
    if (!model || !cls) return [];
    const clsSlug = cls.slug ? localId(model, cls.slug) : '';
    const problems = [];
    const errors = model?.validation?.errors || [];
    const pathRegex = new RegExp(`classes(?:\\[|\\.)${cIdx}(?:\\]|\\.|$)`);

    for (const err of errors) {
        const p = err.path || '';
        const msg = err.message || '';
        if (pathRegex.test(p)) {
            problems.push(err);
        } else if (clsSlug && (msg.includes(`"${safeLabel(clsSlug)}"`) || msg.includes(`'${safeLabel(clsSlug)}'`))) {
            problems.push(err);
        }
    }
    return problems;
}

// Authoritative candidate parent selection using moveClass.ok; safe against cycles.
function getValidParentCandidates(model, validClasses, cls) {
    if (!model || !cls?.slug) return [];
    const clsSlug = localId(model, cls.slug);
    return validClasses
        .filter(({ cls: cand }) => {
            if (!cand?.slug) return false;
            const candSlug = localId(model, cand.slug);
            if (candSlug === clsSlug) return false;
            return moveClass(model, cls.slug, cand.slug).ok;
        })
        .map(({ cls: cand }) => cand);
}

// Generates an unused slug in the pack.
function getUniqueClassSlug(model, base = 'new-class') {
    const existing = new Set();
    for (const k of KINDS) {
        for (const r of records(model, k)) {
            if (r && typeof r === 'object') {
                const id = identity(r);
                if (id) existing.add(localId(model, id));
            }
        }
    }
    base = base.slice(0, 54).replace(/-+$/, '');
    if (!existing.has(base)) return base;
    let n = 1;
    while (existing.has(`${base}-${n}`)) {
        n++;
    }
    return `${base}-${n}`;
}

// Renders the Classes screen, Inspector, and Cascade Removal dialog.
export function renderClasses(ctx) {
    const model = ctx.model;
    const doc = ctx.doc;
    const packId = model?.document?.id || 'pack';
    const rawClasses = records(model, 'classes');

    // Filter valid records while retaining original indices for document paths
    const validClasses = [];
    for (let i = 0; i < rawClasses.length; i++) {
        const c = rawClasses[i];
        if (c && typeof c === 'object' && !Array.isArray(c)) {
            validClasses.push({ cls: c, idx: i });
        }
    }

    const childMap = new Map();
    for (const { cls } of validClasses) {
        if (cls.parent && typeof cls.parent === 'string') {
            const pSlug = localId(model, cls.parent);
            if (!childMap.has(pSlug)) childMap.set(pSlug, []);
            childMap.get(pSlug).push(cls);
        }
    }

    const screen = el(doc, 'div', '', { class: 'classes-screen' });

    const header = el(doc, 'div', '', { class: 'classes-header' });
    const title = el(doc, 'h1', 'Classes');
    const subtitle = el(doc, 'div', 'Tier 0 → 3 · every class has exactly 3 skills · every leaf is tier 3', { class: 'classes-subtitle' });
    const addRootBtn = button(doc, '+ Root class', () => {
        const slug = getUniqueClassSlug(ctx.model, 'new-class');
        const newRecord = {
            slug,
            name: '[CLASS NAME]',
            tier: 0,
            parent: null,
            skills: [],
        };
        const result = add(ctx.model, 'classes', newRecord);
        if (result.ok) {
            if (applyEdit(ctx, result, { id: slug })) {
                ctx.select('classes', slug);
            }
        } else {
            ctx.notify((result.errors || [{ code: 'add-failed', message: 'Could not add root class' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        }
    });
    header.append(title, subtitle, addRootBtn);

    const tierLabels = el(doc, 'div', '', { class: 'classes-tier-labels' });
    const TIER_TITLES = ['TIER 0 · START', 'TIER 1', 'TIER 2', 'TIER 3 · ADVANCED'];
    for (let t = 0; t < 4; t++) {
        tierLabels.append(el(doc, 'div', TIER_TITLES[t]));
    }

    const columnsContainer = el(doc, 'div', '', { class: 'classes-columns' });
    const tierColumns = [
        el(doc, 'div', '', { class: 'classes-column' }),
        el(doc, 'div', '', { class: 'classes-column' }),
        el(doc, 'div', '', { class: 'classes-column' }),
        el(doc, 'div', '', { class: 'classes-column' }),
    ];

    const tierBuckets = [[], [], [], []];
    for (const item of validClasses) {
        const cls = item.cls;
        const tier = typeof cls.tier === 'number' && Number.isInteger(cls.tier) && cls.tier >= 0 && cls.tier <= 3 ? cls.tier : 0;
        tierBuckets[tier].push(item);
    }

    for (let t = 1; t < 4; t++) {
        const parentOrder = new Map(tierBuckets[t - 1].map((item, i) => [localId(model, item.cls.slug), i]));
        tierBuckets[t].sort((a, b) => {
            const pA = a.cls.parent ? parentOrder.get(localId(model, a.cls.parent)) ?? 999 : 999;
            const pB = b.cls.parent ? parentOrder.get(localId(model, b.cls.parent)) ?? 999 : 999;
            return pA - pB;
        });
    }

    for (let t = 0; t < 4; t++) {
        for (const { cls, idx } of tierBuckets[t]) {
            const isSelected = ctx.selection.id !== null && localId(model, ctx.selection.id) === localId(model, cls.slug);
            const problems = getClassProblems(model, cls, idx);
            const hasProblem = problems.length > 0;
            const children = childMap.get(localId(model, cls.slug)) || [];
            const childCount = children.length;

            const card = button(doc, '', () => ctx.select('classes', cls.slug), {
                class: 'class-card',
                'aria-pressed': isSelected ? 'true' : 'false',
                'data-slug': cls.slug || '',
            });
            if (hasProblem) card.setAttribute('data-has-problem', 'true');

            const nameRow = el(doc, 'span', '', { class: 'class-card-header' });
            const nameSpan = el(doc, 'span', cls.name || cls.slug || '', { class: 'class-card-name' });
            nameRow.append(nameSpan);
            if (hasProblem) {
                nameRow.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has a problem' }));
            }

            const skillCount = Array.isArray(cls.skills) ? cls.skills.length : 0;
            const meta = el(doc, 'span', `${safeLabel(cls.slug || '')} · ${skillCount}/3 skills`, { class: 'class-card-meta' });

            let relText = '';
            if (cls.tier === 0) {
                relText = `${childCount} ${childCount === 1 ? 'child' : 'children'}`;
            } else {
                relText = `parent: ${safeLabel(cls.parent || 'none')}${childCount > 0 ? ` · ${childCount} ${childCount === 1 ? 'child' : 'children'}` : ''}`;
            }
            const relSpan = el(doc, 'span', relText, { class: 'class-card-meta' });

            card.append(nameRow, meta, relSpan);
            tierColumns[t].append(card);
        }
        columnsContainer.append(tierColumns[t]);
    }

    screen.append(header, tierLabels, columnsContainer);
    ctx.main.append(screen);

    // Inspector
    const selSlug = ctx.selection.id ? localId(model, ctx.selection.id) : null;
    const selectedItem = selSlug ? validClasses.find(item => localId(model, item.cls.slug) === selSlug) : null;

    if (!selectedItem) {
        ctx.inspector.append(el(doc, 'p', 'Select a class from the tree to inspect and edit.', { class: 'muted' }));
        return;
    }

    const { cls, idx: cIdx } = selectedItem;
    const classPath = ['content', 'rules', 0, 'classes', cIdx];

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(
        el(doc, 'h2', cls.name || cls.slug || ''),
        el(doc, 'span', `Tier ${safeLabel(cls.tier ?? 0)}`, { class: 'chip' })
    );

    const nameSlugGrid = el(doc, 'div', '', { class: 'inspector-grid' });

    const nameInput = el(doc, 'input', '', {
        id: 'class-name',
        value: cls.name ?? '',
        'data-path': JSON.stringify([...classPath, 'name']),
    });
    nameInput.addEventListener('change', () => {
        const val = nameInput.value;
        if (val !== (cls.name ?? '')) {
            const checked = validateField(schemaForKind('classes').properties.name, val);
            if (!checked.ok) { ctx.notify(`${checked.code}: ${checked.message}`); nameInput.value = safeLabel(cls.name ?? ''); return; }
            applyEdit(ctx, setField(ctx.model, [...classPath, 'name'], val));
        }
    });
    const nameField = field(doc, 'NAME', nameInput);

    const slugInput = el(doc, 'input', '', {
        id: 'class-id',
        value: cls.slug ?? '',
        'data-path': JSON.stringify([...classPath, 'slug']),
    });
    slugInput.addEventListener('change', () => {
        const nextId = slugInput.value.trim();
        if (nextId !== (cls.slug ?? '')) {
            const result = renameId(ctx.model, 'classes', cls.slug, nextId);
            if (result.ok) {
                const normId = localId(result.model || ctx.model, nextId);
                const ok = applyEdit(ctx, result, { id: normId });
                if (ok) {
                    ctx.select('classes', normId);
                }
            } else {
                slugInput.value = safeLabel(cls.slug ?? '');
                ctx.notify((result.errors || [{ code: 'bad-id', message: 'Invalid slug' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
            }
        }
    });
    const slugField = field(doc, 'ID (SLUG)', slugInput);
    nameSlugGrid.append(nameField, slugField);

    const fullId = `pack.${safeLabel(packId)}/${safeLabel(cls.slug)}`;
    const allRefs = ctx.model?.references || [];
    const inboundRefs = allRefs.filter(r => r.targetKind === 'classes' && (r.targetId === fullId || r.targetId === cls.slug));
    const refsByKind = new Map();
    for (const r of inboundRefs) {
        refsByKind.set(r.kind, (refsByKind.get(r.kind) || 0) + 1);
    }
    const breakdown = [...refsByKind.entries()].map(([k, n]) => `${k} (${n})`).join(', ');
    const refsNote = el(doc, 'div', `Renaming the ID updates every reference to it (${inboundRefs.length} places${breakdown ? ': ' + breakdown : ''}).`, { class: 'muted' });

    const parentSelect = el(doc, 'select', '', {
        id: 'class-parent',
        'data-path': JSON.stringify([...classPath, 'parent']),
    });
    const rootOption = el(doc, 'option', '(none: a root class)', { value: '' });
    if (!cls.parent) rootOption.selected = true;
    parentSelect.append(rootOption);

    const validParents = getValidParentCandidates(ctx.model, validClasses, cls);
    for (const cand of validParents) {
        const cSlug = localId(ctx.model, cand.slug);
        const opt = el(doc, 'option', `${safeLabel(cand.name || cSlug)} (${safeLabel(cSlug)} · Tier ${safeLabel(cand.tier)})`, { value: cSlug });
        if (cls.parent && localId(ctx.model, cls.parent) === cSlug) opt.selected = true;
        parentSelect.append(opt);
    }

    if (cls.parent && !validParents.some(c => localId(ctx.model, c.slug) === localId(ctx.model, cls.parent))) {
        const opt = el(doc, 'option', `${safeLabel(cls.parent)} (invalid parent)`, { value: cls.parent, disabled: '' });
        opt.selected = true;
        parentSelect.append(opt);
    }

    parentSelect.addEventListener('change', () => {
        const newParent = parentSelect.value || null;
        if (newParent !== (cls.parent || null)) {
            if (!applyEdit(ctx, moveClass(ctx.model, cls.slug, newParent))) parentSelect.value = safeLabel(localId(ctx.model, cls.parent) || '');
        }
    });
    const parentField = field(doc, 'PARENT', parentSelect);

    const skillsGroup = el(doc, 'div', '', {
        id: 'class-skills',
        tabindex: '-1',
        class: 'skills-group',
        'data-path': JSON.stringify([...classPath, 'skills']),
    });

    const currentSkills = Array.isArray(cls.skills) ? [...cls.skills] : [];
    const skillsHeader = el(doc, 'div', '', { class: 'skills-header' });
    const skillsTitle = el(doc, 'span', 'SKILLS · EXACTLY 3');
    const skillsCount = el(doc, 'span', `${currentSkills.length} / 3`);
    if (currentSkills.length !== 3) skillsCount.classList.add('warn-count');
    skillsHeader.append(skillsTitle, skillsCount);
    skillsGroup.append(skillsHeader);
    if (!Array.isArray(cls.skills)) {
        skillsGroup.append(button(doc, 'Repair: reset skills list', () => applyEdit(ctx, resetClassSkills(ctx.model, cls.slug))));
    }

    const availableSkills = records(ctx.model, 'skills').filter(s => s && typeof s === 'object');
    const slotCount = Math.max(3, currentSkills.length);

    for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
        const currentSlotSkill = localId(ctx.model, currentSkills[slotIdx]) || '';
        const row = el(doc, 'div', '', { class: 'skill-row' });

        const select = el(doc, 'select', '', {
            'data-path': JSON.stringify([...classPath, 'skills', slotIdx]),
        });

        const noneOpt = el(doc, 'option', '(none / clear)', { value: '' });
        if (!currentSlotSkill) noneOpt.selected = true;
        select.append(noneOpt);

        let foundCurrent = false;
        for (const s of availableSkills) {
            const sSlug = localId(ctx.model, s.slug);
            const opt = el(doc, 'option', `${safeLabel(s.name || sSlug)} (${safeLabel(sSlug)})`, { value: sSlug });
            if (sSlug === currentSlotSkill) {
                opt.selected = true;
                foundCurrent = true;
            }
            select.append(opt);
        }

        if (currentSlotSkill && !foundCurrent) {
            const missingOpt = el(doc, 'option', `${safeLabel(currentSlotSkill)} (missing)`, { value: currentSlotSkill, disabled: '' });
            missingOpt.selected = true;
            select.append(missingOpt);
        }

        select.addEventListener('change', () => {
            const picked = select.value;
            let nextSkills = Array.isArray(cls.skills) ? [...cls.skills] : [];
            if (!picked) {
                if (slotIdx < nextSkills.length) {
                    nextSkills.splice(slotIdx, 1);
                }
            } else {
                if (slotIdx < nextSkills.length) {
                    nextSkills[slotIdx] = picked;
                } else {
                    nextSkills.push(picked);
                }
            }
            if (!applyEdit(ctx, setField(ctx.model, [...classPath, 'skills'], nextSkills))) select.value = currentSlotSkill;
        });

        const rowField = field(doc, `Skill ${slotIdx + 1}`, select);
        row.append(rowField);

        if (currentSlotSkill) {
            const openSkillBtn = button(doc, 'Open', () => ctx.select('skills', currentSlotSkill), {
                'aria-label': `Open ${safeLabel(currentSlotSkill)} in skills`,
            });
            row.append(openSkillBtn);
        }

        skillsGroup.append(row);
    }

    const addSkill = button(doc, '+ Skill', () => applyEdit(ctx, addClassSkill(ctx.model, cls.slug)));
    addSkill.disabled = currentSkills.length >= 3;
    skillsGroup.append(addSkill);

    const clsProblems = getClassProblems(ctx.model, cls, cIdx);
    let problemBox = null;
    if (clsProblems.length > 0) {
        const msg = clsProblems.map(p => p.message).join('\n');
        problemBox = el(doc, 'div', msg, { role: 'status', class: 'warning' });
    }

    const actionsRow = el(doc, 'div', '', { class: 'row' });
    const childBtn = button(doc, '+ Child class', () => {
        const slug = getUniqueClassSlug(ctx.model, `${safeLabel(cls.slug)}-child`);
        const newRecord = {
            slug,
            name: '[CLASS NAME]',
            tier: (typeof cls.tier === 'number' ? cls.tier : 0) + 1,
            parent: cls.slug,
            skills: [],
        };
        const result = add(ctx.model, 'classes', newRecord);
        if (result.ok) {
            if (applyEdit(ctx, result, { id: slug })) {
                ctx.select('classes', slug);
            }
        } else {
            ctx.notify((result.errors || [{ code: 'add-failed', message: 'Could not add child class' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        }
    });
    if (cls.tier >= 3) {
        childBtn.disabled = true;
        childBtn.title = 'Cannot add child class beyond tier 3';
    }

    const removeBtn = button(doc, 'Remove…', () => openCascadeDialog(ctx, cls, removeBtn), { class: 'danger' });
    actionsRow.append(childBtn, removeBtn);

    ctx.inspector.append(titleRow, nameSlugGrid, refsNote, parentField, skillsGroup);
    if (problemBox) ctx.inspector.append(problemBox);
    ctx.inspector.append(actionsRow);
}

// Opens the native modal cascade removal dialog.
function openCascadeDialog(ctx, cls, invoker) {
    const previewResult = remove(ctx.model, 'classes', cls.slug, { cascade: true });
    if (!previewResult.ok) {
        ctx.notify((previewResult.errors || [{ code: 'remove-failed', message: 'Could not remove class' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        return;
    }

    const changes = cascadeChanges(ctx.model, previewResult.model, cls.slug);
    const dialog = el(ctx.doc, 'dialog', '', { 'aria-label': 'Remove class' });

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

    const title = el(ctx.doc, 'h2', `Remove ${safeLabel(cls.name || cls.slug)}?`);
    const desc = el(ctx.doc, 'p', 'Other parts of the pack use it. Removing it also removes:');
    const list = el(ctx.doc, 'ul');
    for (const c of changes) {
        list.append(el(ctx.doc, 'li', c.label));
    }
    const note = el(ctx.doc, 'p', 'You can undo this. The pack may need fixes afterwards before it can be exported.', { class: 'muted' });

    const btnRow = el(ctx.doc, 'div', '', { class: 'row' });
    const cancelBtn = button(ctx.doc, 'Keep it', () => closeDialog());
    const confirmBtn = button(ctx.doc, `Remove all ${changes.length}`, () => {
        try { dialog.close?.(); } catch { /* ignore */ }
        dialog.remove();
        applyEdit(ctx, previewResult, ctx.selection.id === cls.slug ? { id: null } : undefined);
        if (ctx.doc.contains?.(invoker)) invoker.focus?.();
        else ctx.main.focus?.();
    }, { class: 'danger primary' });

    btnRow.append(cancelBtn, confirmBtn);
    dialog.append(title, desc, list, note, btnRow);
    ctx.overlays.append(dialog);

    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
    cancelBtn.focus?.();
}
