import { el, button, field } from '../dom.js';
import { KINDS, LABELS, records, identity, localId } from '../records.js';
import { add, renameId, remove, moveClass, setField } from '../edits.js';

/**
 * Pure helper to set or replace a field on a class record by slug.
 */
export function classField(model, classSlug, fieldName, value) {
    const list = records(model, 'classes');
    const idx = list.findIndex(c => localId(model, identity(c)) === localId(model, classSlug));
    if (idx === -1) {
        return { ok: false, model, errors: [{ code: 'not-found', message: `Class ${classSlug} not found` }] };
    }
    return setField(model, ['content', 'rules', 0, 'classes', idx, fieldName], value);
}

/**
 * Pure helper to compute exact removed records, start inventory items,
 * and derived generated skill forms between a model and its cascade-preview model.
 */
export function cascadeChanges(beforeModel, previewModel, targetSlug = null) {
    const changes = [];
    if (!beforeModel?.document || !previewModel?.document) return changes;

    const beforeDoc = beforeModel.document;
    const afterDoc = previewModel.document;

    // 1. Compare records across all KINDS
    for (const kind of KINDS) {
        const beforeList = records(beforeModel, kind);
        const afterList = records(previewModel, kind);
        const afterIds = new Set(afterList.map(r => localId(previewModel, identity(r))));

        for (const item of beforeList) {
            const rawId = identity(item);
            const id = localId(beforeModel, rawId);
            if (!afterIds.has(id)) {
                const name = typeof item.name === 'string' && item.name ? item.name : id;
                const kindLabel = LABELS[kind] || kind;
                changes.push({
                    kind,
                    id,
                    name,
                    label: `${name} (${kindLabel})`,
                });
            }
        }
    }

    // 2. Compare start.inventory.items
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
                label: `Start inventory: ${norm}`,
            });
        }
    }

    // 3. Derived generated forms for removed skills
    const removedSkills = changes.filter(c => c.kind === 'skills').map(c => c.id);
    for (const skillSlug of removedSkills) {
        const base = `${skillSlug}-base`;
        const forms = [base];
        const s1 = [`${base}-g`, `${base}-a`, `${base}-b`];
        for (const p of s1) {
            forms.push(p);
            for (const ch of ['g', 'a', 'b']) {
                forms.push(`${p}-${ch}`);
            }
        }
        for (const formSlug of forms) {
            const wasBranch = changes.some(c => c.kind === 'branches' && c.id === formSlug);
            if (!wasBranch) {
                changes.push({
                    kind: 'forms',
                    id: formSlug,
                    name: formSlug,
                    label: `${formSlug} (Generated form)`,
                });
            }
        }
    }

    return changes;
}

/**
 * Finds all problems associated with a class from the live checker validation errors.
 */
function getClassProblems(model, cls, cIdx) {
    if (!model) return [];
    const clsSlug = localId(model, cls.slug);
    const problems = [];
    const errors = model?.validation?.errors || [];

    const pathBracket = `classes[${cIdx}]`;
    const pathDot = `classes.${cIdx}`;

    for (const err of errors) {
        const p = err.path || '';
        const msg = err.message || '';
        if (p.includes(pathBracket) || p.includes(pathDot) || p === `content.rules.0.classes[${cIdx}]`) {
            problems.push(err);
        } else if (msg.includes(`"${clsSlug}"`)) {
            problems.push(err);
        }
    }

    // Live draft check if not yet caught by validator errors:
    if (Array.isArray(cls.skills) && cls.skills.length !== 3) {
        if (!problems.some(e => e.code === 'class-skills')) {
            problems.push({
                code: 'class-skills',
                path: `content.rules[0].classes[${cIdx}].skills`,
                message: `Class "${clsSlug}" has ${cls.skills.length} skills; every class needs exactly 3.`,
            });
        }
    }

    return problems;
}

/**
 * Finds valid parent candidates for a class according to progression rules.
 */
function getValidParentCandidates(classes, cls, packId) {
    const clsSlug = localId({ document: { id: packId } }, cls.slug);

    // BFS to find all descendants of cls (cannot be parent of cls)
    const descendants = new Set([clsSlug]);
    const queue = [clsSlug];
    while (queue.length > 0) {
        const cur = queue.shift();
        for (const other of classes) {
            const oSlug = localId({ document: { id: packId } }, other.slug);
            const oParent = other.parent ? localId({ document: { id: packId } }, other.parent) : null;
            if (oParent === cur && !descendants.has(oSlug)) {
                descendants.add(oSlug);
                queue.push(oSlug);
            }
        }
    }

    // Maximum depth in descendant subtree
    function getSubtreeDepth(rootSlug) {
        let maxDepth = 0;
        for (const other of classes) {
            const oParent = other.parent ? localId({ document: { id: packId } }, other.parent) : null;
            if (oParent === rootSlug) {
                const oSlug = localId({ document: { id: packId } }, other.slug);
                maxDepth = Math.max(maxDepth, 1 + getSubtreeDepth(oSlug));
            }
        }
        return maxDepth;
    }
    const subtreeDepth = getSubtreeDepth(clsSlug);

    return classes.filter(candidate => {
        const cSlug = localId({ document: { id: packId } }, candidate.slug);
        if (descendants.has(cSlug)) return false;
        if (typeof candidate.tier !== 'number' || candidate.tier < 0 || candidate.tier >= 3) return false;
        if (candidate.tier + 1 + subtreeDepth > 3) return false;
        return true;
    });
}

/**
 * Generates an unused slug in the pack.
 */
function getUniqueClassSlug(model, base = 'new-class') {
    const existing = new Set();
    for (const k of KINDS) {
        for (const r of records(model, k)) {
            const id = identity(r);
            if (id) existing.add(localId(model, id));
        }
    }
    if (!existing.has(base)) return base;
    let n = 1;
    while (existing.has(`${base}-${n}`)) {
        n++;
    }
    return `${base}-${n}`;
}

/**
 * Renders the Classes screen, Inspector, and sets up Cascade Removal dialog.
 */
export function renderClasses(ctx) {
    const model = ctx.model;
    const doc = ctx.doc;
    const packId = model?.document?.id || 'pack';
    const classes = records(model, 'classes');

    // Build child map for parent/child relationship counts
    const childMap = new Map();
    for (const c of classes) {
        if (c.parent) {
            const pSlug = localId(model, c.parent);
            if (!childMap.has(pSlug)) childMap.set(pSlug, []);
            childMap.get(pSlug).push(c);
        }
    }

    // Build main screen container
    const screen = el(doc, 'div', '', { class: 'classes-screen' });

    // Header
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
            ctx.selection.id = slug;
            ctx.apply(result);
        } else {
            ctx.notify((result.errors || [{ code: 'add-failed', message: 'Could not add root class' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
        }
    });
    header.append(title, subtitle, addRootBtn);

    // Tier column headers
    const tierLabels = el(doc, 'div', '', { class: 'classes-tier-labels' });
    const TIER_TITLES = ['TIER 0 · START', 'TIER 1', 'TIER 2', 'TIER 3 · ADVANCED'];
    for (let t = 0; t < 4; t++) {
        tierLabels.append(el(doc, 'div', TIER_TITLES[t]));
    }

    // 4 Tier columns
    const columnsContainer = el(doc, 'div', '', { class: 'classes-columns' });
    const tierColumns = [el(doc, 'div', '', { class: 'classes-column' }), el(doc, 'div', '', { class: 'classes-column' }), el(doc, 'div', '', { class: 'classes-column' }), el(doc, 'div', '', { class: 'classes-column' })];

    // Partition classes into tiers 0..3
    const tierBuckets = [[], [], [], []];
    for (let idx = 0; idx < classes.length; idx++) {
        const cls = classes[idx];
        const tier = typeof cls.tier === 'number' && Number.isInteger(cls.tier) && cls.tier >= 0 && cls.tier <= 3 ? cls.tier : 0;
        tierBuckets[tier].push({ cls, idx });
    }

    // Sort tier 1..3 by parent order in preceding tier for aligned visual hierarchy
    for (let t = 1; t < 4; t++) {
        const parentOrder = new Map(tierBuckets[t - 1].map((item, i) => [localId(model, item.cls.slug), i]));
        tierBuckets[t].sort((a, b) => {
            const pA = a.cls.parent ? parentOrder.get(localId(model, a.cls.parent)) ?? 999 : 999;
            const pB = b.cls.parent ? parentOrder.get(localId(model, b.cls.parent)) ?? 999 : 999;
            return pA - pB;
        });
    }

    // Render class cards in tier columns
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
                'data-slug': cls.slug,
            });
            if (hasProblem) card.setAttribute('data-has-problem', 'true');

            // Name row
            const nameRow = el(doc, 'span', '', { class: 'class-card-header' });
            const nameSpan = el(doc, 'span', cls.name || cls.slug, { class: 'class-card-name' });
            nameRow.append(nameSpan);
            if (hasProblem) {
                nameRow.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has a problem' }));
            }

            // Slug & skill count meta
            const skillCount = Array.isArray(cls.skills) ? cls.skills.length : 0;
            const meta = el(doc, 'span', `${cls.slug} · ${skillCount}/3 skills`, { class: 'class-card-meta' });

            // Parent & children relationship info
            let relText = '';
            if (cls.tier === 0) {
                relText = `${childCount} ${childCount === 1 ? 'child' : 'children'}`;
            } else {
                relText = `parent: ${cls.parent || 'none'}${childCount > 0 ? ` · ${childCount} ${childCount === 1 ? 'child' : 'children'}` : ''}`;
            }
            const relSpan = el(doc, 'span', relText, { class: 'class-card-meta' });

            card.append(nameRow, meta, relSpan);
            tierColumns[t].append(card);
        }
        columnsContainer.append(tierColumns[t]);
    }

    screen.append(header, tierLabels, columnsContainer);
    ctx.main.append(screen);

    // ==========================================
    // Inspector: selected class panel
    // ==========================================
    const selSlug = ctx.selection.id ? localId(model, ctx.selection.id) : null;
    const selectedIdx = classes.findIndex(c => localId(model, c.slug) === selSlug);
    const selectedClass = selectedIdx !== -1 ? classes[selectedIdx] : null;

    if (!selectedClass) {
        ctx.inspector.append(el(doc, 'p', 'Select a class from the tree to inspect and edit.', { class: 'muted' }));
        return;
    }

    const cIdx = selectedIdx;
    const cls = selectedClass;
    const classPath = ['content', 'rules', 0, 'classes', cIdx];

    // Title & Tier Chip
    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(
        el(doc, 'h2', cls.name || cls.slug),
        el(doc, 'span', `Tier ${cls.tier}`, { class: 'chip' })
    );

    // Name & Slug Grid
    const nameSlugGrid = el(doc, 'div', '', { class: 'inspector-grid' });

    // Name input
    const nameInput = el(doc, 'input', '', {
        id: 'class-name',
        value: cls.name ?? '',
        'data-path': JSON.stringify([...classPath, 'name']),
    });
    nameInput.addEventListener('change', () => {
        const val = nameInput.value;
        if (val !== cls.name) {
            ctx.apply(setField(ctx.model, [...classPath, 'name'], val));
        }
    });
    const nameField = field(doc, 'NAME', nameInput);

    // Slug input
    const slugInput = el(doc, 'input', '', {
        id: 'class-id',
        value: cls.slug ?? '',
        'data-path': JSON.stringify([...classPath, 'slug']),
    });
    slugInput.addEventListener('change', () => {
        const nextId = slugInput.value.trim();
        if (nextId && nextId !== cls.slug) {
            const result = renameId(ctx.model, 'classes', cls.slug, nextId);
            if (result.ok) {
                // Update selection before apply so re-render finds the class under its new slug
                ctx.selection.id = nextId;
                const ok = ctx.apply(result);
                if (!ok) ctx.selection.id = cls.slug;
            } else {
                slugInput.value = cls.slug;
                ctx.notify((result.errors || [{ code: 'bad-id', message: 'Invalid slug' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
            }
        }
    });
    const slugField = field(doc, 'ID (SLUG)', slugInput);
    nameSlugGrid.append(nameField, slugField);

    // Inbound references count by typed target
    const fullId = `pack.${packId}/${cls.slug}`;
    const allRefs = ctx.model?.references || [];
    const inboundRefs = allRefs.filter(r => r.targetKind === 'classes' && (r.targetId === fullId || r.targetId === cls.slug));
    const refsByKind = new Map();
    for (const r of inboundRefs) {
        refsByKind.set(r.kind, (refsByKind.get(r.kind) || 0) + 1);
    }
    const breakdown = [...refsByKind.entries()].map(([k, n]) => `${k} (${n})`).join(', ');
    const refsNote = el(doc, 'div', `Renaming the ID updates every reference to it (${inboundRefs.length} places${breakdown ? ': ' + breakdown : ''}).`, { class: 'muted' });

    // Parent select
    const parentSelect = el(doc, 'select', '', {
        id: 'class-parent',
        'data-path': JSON.stringify([...classPath, 'parent']),
    });
    const rootOption = el(doc, 'option', '(none: a root class)', { value: '' });
    if (!cls.parent) rootOption.selected = true;
    parentSelect.append(rootOption);

    const validParents = getValidParentCandidates(classes, cls, packId);
    for (const cand of validParents) {
        const opt = el(doc, 'option', `${cand.name || cand.slug} (${cand.slug} · Tier ${cand.tier})`, { value: cand.slug });
        if (cls.parent && localId(ctx.model, cls.parent) === cand.slug) opt.selected = true;
        parentSelect.append(opt);
    }

    // If current parent is not among valid candidates (e.g. invalid draft), keep it visible
    if (cls.parent && !validParents.some(c => c.slug === localId(ctx.model, cls.parent))) {
        const opt = el(doc, 'option', `${cls.parent} (invalid parent)`, { value: cls.parent });
        opt.selected = true;
        parentSelect.append(opt);
    }

    parentSelect.addEventListener('change', () => {
        const newParent = parentSelect.value || null;
        if (newParent !== (cls.parent || null)) {
            ctx.apply(moveClass(ctx.model, cls.slug, newParent));
        }
    });
    const parentField = field(doc, 'PARENT', parentSelect);

    // Skills group
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

    const availableSkills = records(ctx.model, 'skills');
    const slotCount = Math.max(3, currentSkills.length);

    for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
        const currentSlotSkill = currentSkills[slotIdx] || '';
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
            const opt = el(doc, 'option', `${s.name || sSlug} (${sSlug})`, { value: sSlug });
            if (sSlug === currentSlotSkill) {
                opt.selected = true;
                foundCurrent = true;
            }
            select.append(opt);
        }

        if (currentSlotSkill && !foundCurrent) {
            const missingOpt = el(doc, 'option', `${currentSlotSkill} (missing)`, { value: currentSlotSkill });
            missingOpt.selected = true;
            select.append(missingOpt);
        }

        select.addEventListener('change', () => {
            const picked = select.value;
            let nextSkills = [...(cls.skills || [])];
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
            ctx.apply(setField(ctx.model, [...classPath, 'skills'], nextSkills));
        });

        const rowField = field(doc, `Skill ${slotIdx + 1}`, select);
        row.append(rowField);

        if (currentSlotSkill) {
            const openSkillBtn = button(doc, 'Open', () => ctx.select('skills', currentSlotSkill), {
                'aria-label': `Open ${currentSlotSkill} in skills`,
            });
            row.append(openSkillBtn);
        }

        skillsGroup.append(row);
    }

    // Problems status box
    const clsProblems = getClassProblems(ctx.model, cls, cIdx);
    let problemBox = null;
    if (clsProblems.length > 0) {
        const msg = clsProblems.map(p => p.message).join('\n');
        problemBox = el(doc, 'div', msg, { role: 'status', class: 'warning' });
    }

    // Bottom actions: + Child class and Remove…
    const actionsRow = el(doc, 'div', '', { class: 'row' });
    const childBtn = button(doc, '+ Child class', () => {
        const slug = getUniqueClassSlug(ctx.model, `${cls.slug}-child`);
        const newRecord = {
            slug,
            name: '[CLASS NAME]',
            tier: cls.tier + 1,
            parent: cls.slug,
            skills: [],
        };
        const result = add(ctx.model, 'classes', newRecord);
        if (result.ok) {
            ctx.selection.id = slug;
            ctx.apply(result);
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

/**
 * Opens the native modal cascade removal dialog.
 */
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

    const title = el(ctx.doc, 'h2', `Remove ${cls.name}?`);
    const desc = el(ctx.doc, 'p', 'Other parts of the pack use it. Removing it also removes:');
    const list = el(ctx.doc, 'ul');
    for (const c of changes) {
        list.append(el(ctx.doc, 'li', c.label));
    }
    const note = el(ctx.doc, 'p', 'You can undo this. The pack may need fixes afterwards before it can be exported.', { class: 'muted' });

    const btnRow = el(ctx.doc, 'div', '', { class: 'row' });
    const cancelBtn = button(ctx.doc, 'Keep it', () => closeDialog());
    const confirmBtn = button(ctx.doc, `Remove all ${changes.length}`, () => {
        if (ctx.selection.id === cls.slug) {
            ctx.selection.id = null;
        }
        try { dialog.close?.(); } catch { /* ignore */ }
        dialog.remove();
        ctx.apply(previewResult);
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
