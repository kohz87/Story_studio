import { el, field } from '../dom.js';
import { records, localId } from '../records.js';
import { setField } from '../edits.js';
import {
    validateRulesPack,
    powerScore,
    generatePowerUp,
    RULES_V2_CONSTANTS,
    rulesV2Schema,
} from '../../vendor/story-block/src/v2/packs/rules-v2.js';

/** Canonical types and stats derived strictly from rules-v2 JSON schema. */
const SCHEMA_TYPES = rulesV2Schema.$defs.base.properties.type.enum;
const SCHEMA_STATS = rulesV2Schema.$defs.stat.enum;
const SCHEMA_ELEMENTS = rulesV2Schema.$defs.element.enum;

/**
 * Parses and strictly validates integer inputs according to rules-v2 bounds.
 * Refuses empty strings, non-integers, non-finite numbers, and out-of-range values.
 */
function parseIntegerInput(rawValue, min = 0, max = 999) {
    if (typeof rawValue !== 'string') {
        return { ok: false, error: 'Value must be a string' };
    }
    const trimmed = rawValue.trim();
    if (trimmed === '') {
        return { ok: false, error: 'Value cannot be empty' };
    }
    if (!/^-?\d+$/.test(trimmed)) {
        return { ok: false, error: 'Value must be an integer' };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || !Number.isSafeInteger(num)) {
        return { ok: false, error: 'Value must be a finite integer' };
    }
    if (num < min || num > max) {
        return { ok: false, error: `Value must be between ${min} and ${max}` };
    }
    return { ok: true, value: num };
}

/** Calculates power budget for a given progression tier and pathway step. */
export function budgetFor(tier, step = 0, constants = RULES_V2_CONSTANTS) {
    if (typeof tier !== 'number' || tier < 0 || tier > 3) return null;
    const baseBudget = constants.classBudget?.[tier] ?? 12 * (tier + 1);
    return baseBudget + (step ?? 0) * (constants.pathBudgetIncrement ?? 12);
}

/** Finds a skill and its owning class in a model document safely. */
export function findSkillAndOwner(model, skillSlug) {
    const rawSkills = records(model, 'skills');
    const rawClasses = records(model, 'classes');
    const normSlug = localId(model, skillSlug);

    let skill = null;
    let sIdx = -1;
    for (let i = 0; i < rawSkills.length; i++) {
        const s = rawSkills[i];
        if (s && typeof s === 'object' && localId(model, s.slug) === normSlug) {
            skill = s;
            sIdx = i;
            break;
        }
    }

    let ownerClass = null;
    let cIdx = -1;
    for (let i = 0; i < rawClasses.length; i++) {
        const c = rawClasses[i];
        if (c && typeof c === 'object' && Array.isArray(c.skills)) {
            if (c.skills.some(sRef => typeof sRef === 'string' && localId(model, sRef) === normSlug)) {
                ownerClass = c;
                cIdx = i;
                break;
            }
        }
    }

    return { skill, sIdx, ownerClass, cIdx };
}

/** Pure helper to apply authored branch transforms to a form object. */
export function applyTransforms(parentForm, transforms) {
    if (!parentForm || typeof parentForm !== 'object') return null;
    const form = JSON.parse(JSON.stringify(parentForm));
    if (!Array.isArray(form.effects)) form.effects = [];
    if (!Array.isArray(transforms)) return form;

    for (const tr of transforms) {
        if (!tr || typeof tr !== 'object') {
            throw new Error('Malformed transform: transform must be an object');
        }
        if (typeof tr.op !== 'string') {
            throw new Error('Malformed transform: missing op');
        }
        const indexed = ['set-target', 'set-element', 'set-power', 'replace-effect', 'remove-effect'];
        if (indexed.includes(tr.op) && (!Number.isInteger(tr.at) || tr.at < 0 || tr.at >= form.effects.length)) {
            throw new Error('Malformed transform: effect index is out of bounds');
        }
        if (tr.op === 'remove-effect' && form.effects.length <= 1) {
            throw new Error('Malformed transform: cannot remove the sole effect');
        }
        if (tr.op === 'add-effect' && form.effects.length >= 4) {
            throw new Error('Malformed transform: at most four effects are allowed');
        }
        switch (tr.op) {
            case 'set-target': {
                if (typeof tr.at !== 'number' || tr.at < 0 || tr.value === undefined) {
                    throw new Error('Malformed transform: set-target requires numeric "at" and "value"');
                }
                if (form.effects[tr.at]) form.effects[tr.at].target = tr.value;
                break;
            }
            case 'set-element': {
                if (typeof tr.at !== 'number' || tr.at < 0 || tr.value === undefined) {
                    throw new Error('Malformed transform: set-element requires numeric "at" and "value"');
                }
                if (form.effects[tr.at]) form.effects[tr.at].element = tr.value;
                break;
            }
            case 'set-power': {
                if (typeof tr.at !== 'number' || tr.at < 0 || tr.value === undefined) {
                    throw new Error('Malformed transform: set-power requires numeric "at" and "value"');
                }
                if (form.effects[tr.at]) form.effects[tr.at].power = tr.value;
                break;
            }
            case 'replace-effect': {
                if (typeof tr.at !== 'number' || tr.at < 0 || tr.value === undefined || typeof tr.value !== 'object' || tr.value === null) {
                    throw new Error('Malformed transform: replace-effect requires numeric "at" and object "value"');
                }
                if (tr.at >= 0 && tr.at < form.effects.length) {
                    form.effects[tr.at] = JSON.parse(JSON.stringify(tr.value));
                }
                break;
            }
            case 'add-effect': {
                if (tr.value === undefined || typeof tr.value !== 'object' || tr.value === null) {
                    throw new Error('Malformed transform: add-effect requires object "value"');
                }
                if (form.effects.length < 4) {
                    form.effects.push(JSON.parse(JSON.stringify(tr.value)));
                }
                break;
            }
            case 'remove-effect': {
                if (typeof tr.at !== 'number' || tr.at < 0) {
                    throw new Error('Malformed transform: remove-effect requires numeric "at"');
                }
                if (tr.at >= 0 && tr.at < form.effects.length && form.effects.length > 1) {
                    form.effects.splice(tr.at, 1);
                }
                break;
            }
            case 'set-cost': {
                if (tr.value === undefined || typeof tr.value !== 'object' || tr.value === null) {
                    throw new Error('Malformed transform: set-cost requires object "value"');
                }
                form.cost = JSON.parse(JSON.stringify(tr.value));
                break;
            }
            case 'set-stat': {
                if (typeof tr.value !== 'string') {
                    throw new Error('Malformed transform: set-stat requires string "value"');
                }
                form.stat = tr.value;
                break;
            }
            case 'set-type': {
                if (typeof tr.value !== 'string') {
                    throw new Error('Malformed transform: set-type requires string "value"');
                }
                form.type = tr.value;
                break;
            }
            default: {
                throw new Error(`Malformed transform: unknown op "${tr.op}"`);
            }
        }
    }
    return form;
}

/** Node coordinates and proportional positions matching StudioSkill design component. */
const NODE_COORDS = {
    'base': { x: 24,  y: 298, w: 150, left: '2.857%', width: '17.857%' },
    'a':    { x: 266, y: 96,  w: 210, left: '31.667%', width: '25%' },
    'g':    { x: 266, y: 298, w: 210, left: '31.667%', width: '25%' },
    'b':    { x: 266, y: 500, w: 210, left: '31.667%', width: '25%' },
    'a-a':  { x: 568, y: 40,  w: 240, left: '67.619%', width: '28.571%' },
    'a-g':  { x: 568, y: 92,  w: 240, left: '67.619%', width: '28.571%' },
    'a-b':  { x: 568, y: 144, w: 240, left: '67.619%', width: '28.571%' },
    'g-a':  { x: 568, y: 244, w: 240, left: '67.619%', width: '28.571%' },
    'g-g':  { x: 568, y: 296, w: 240, left: '67.619%', width: '28.571%' },
    'g-b':  { x: 568, y: 348, w: 240, left: '67.619%', width: '28.571%' },
    'b-a':  { x: 568, y: 448, w: 240, left: '67.619%', width: '28.571%' },
    'b-g':  { x: 568, y: 500, w: 240, left: '67.619%', width: '28.571%' },
    'b-b':  { x: 568, y: 552, w: 240, left: '67.619%', width: '28.571%' },
};

/**
 * Resolves the 13 pathway forms for a tier-3 skill (1 base, 3 step-1, 9 step-2).
 * Uses shared validateRulesPack resolved.forms when valid; uses generatePowerUp and
 * powerScore for invalid drafts to allow continuous editing and repair without
 * pretending invalid transforms are valid.
 */
export function resolveSkillForms(model, skillSlug) {
    const { skill, sIdx } = findSkillAndOwner(model, skillSlug);
    if (!skill) return [];

    const packId = model?.document?.id || 'pack';
    const normSkill = localId(model, skillSlug);
    const prefix = `pack.${packId}/`;

    let resolvedForms = null;
    try {
        if (model?.document) {
            const check = validateRulesPack(model.document);
            if (check.ok && check.resolved?.forms) {
                resolvedForms = check.resolved.forms;
            }
        }
    } catch {
        resolvedForms = null;
    }

    const baseId = `${prefix}${normSkill}-base`;
    const baseFormObj = {
        id: baseId,
        skill: `${prefix}${normSkill}`,
        name: skill.name || normSkill,
        note: skill.note ?? '',
        step: 0,
        fromForm: null,
        origin: 'base',
        type: skill.base?.type ?? SCHEMA_TYPES[0],
        stat: skill.base?.stat ?? SCHEMA_STATS[0],
        cost: skill.base?.cost ?? { mp: 0, sp: 0, cooldown: 0 },
        effects: Array.isArray(skill.base?.effects) ? JSON.parse(JSON.stringify(skill.base.effects)) : [],
        unit: skill.base?.unit ?? null,
        tier: 3,
    };
    const baseScoreRes = powerScore(baseFormObj);
    if (baseScoreRes.ok) {
        baseFormObj.powerScore = baseScoreRes.score;
    }

    const allBranches = records(model, 'branches');
    const skillBranches = [];
    for (let i = 0; i < allBranches.length; i++) {
        const b = allBranches[i];
        if (b && typeof b === 'object' && localId(model, b.skill) === normSkill) {
            skillBranches.push({ branch: b, idx: i });
        }
    }

    const findBranch = (fromFormSlug, choice, step) => {
        return skillBranches.find(({ branch: b }) => {
            if (b.step !== step || b.choice !== choice) return false;
            const bFrom = localId(model, b.fromForm);
            return bFrom === fromFormSlug;
        });
    };

    const nodesMap = new Map();

    // Base Node
    const baseResolved = resolvedForms?.[baseId];
    const baseScore = baseResolved?.powerScore ?? baseFormObj.powerScore ?? 0;
    const baseBudget = budgetFor(3, 0);
    const baseNode = {
        key: 'base',
        id: baseId,
        localId: `${normSkill}-base`,
        label: skill.name || normSkill,
        step: 0,
        stepLabel: 'base',
        origin: 'base',
        gen: false,
        kind: 'Base skill',
        from: null,
        fromName: '—',
        powerScore: baseScore,
        budget: baseBudget,
        isOverBudget: baseScore > baseBudget,
        previewUnavailable: !baseResolved && !baseScoreRes.ok,
        error: baseScoreRes.errors?.[0]?.message ?? null,
        coords: NODE_COORDS['base'],
        form: baseResolved || baseFormObj,
        skill,
        skillIdx: sIdx,
    };
    nodesMap.set('base', baseNode);

    // Step 1: a, g, b
    const step1Keys = ['a', 'g', 'b'];
    for (const key of step1Keys) {
        const id = `${baseId}-${key}`;
        const local = `${normSkill}-base-${key}`;
        const gen = key === 'g';
        const step1Budget = budgetFor(3, 1);

        if (gen) {
            let gForm = resolvedForms?.[id];
            if (!gForm) {
                const gRes = generatePowerUp(baseFormObj, RULES_V2_CONSTANTS);
                if (gRes.ok) {
                    gForm = gRes.form;
                } else {
                    gForm = {
                        id,
                        skill: baseFormObj.skill,
                        name: `${baseNode.label}+`,
                        step: 1,
                        origin: 'generated',
                        fromForm: baseId,
                        tier: 3,
                        effects: [],
                        powerScore: 0,
                        invalid: true,
                        error: gRes.errors?.[0]?.message ?? 'Failed to generate power-up',
                    };
                }
            }
            const previewUnavailable = !!(gForm.previewUnavailable || gForm.invalid);
            const score = previewUnavailable ? 0 : (gForm.powerScore ?? (powerScore(gForm).ok ? powerScore(gForm).score : 0));
            nodesMap.set('g', {
                key: 'g',
                id,
                localId: local,
                label: gForm.name || `${baseNode.label}+`,
                step: 1,
                stepLabel: 'step 1',
                origin: 'generated',
                gen: true,
                kind: 'Generated',
                from: baseId,
                fromName: baseNode.label,
                powerScore: score,
                budget: step1Budget,
                isOverBudget: !previewUnavailable && (score > step1Budget),
                previewUnavailable,
                error: gForm.error ?? null,
                coords: NODE_COORDS['g'],
                form: gForm,
            });
        } else {
            const bItem = findBranch(`${normSkill}-base`, key, 1);
            const branch = bItem?.branch;
            const branchIdx = bItem?.idx ?? -1;
            let form = resolvedForms?.[id];
            if (!form) {
                try {
                    if (!branch) throw new Error('Written branch has not been authored');
                    form = applyTransforms(baseFormObj, branch.transforms);
                    delete form.powerScore;
                    form.id = id;
                    form.skill = baseFormObj.skill;
                    form.name = branch?.name || local;
                    form.step = 1;
                    form.origin = 'written';
                    form.fromForm = baseId;
                    form.tier = 3;
                    const scoreRes = powerScore(form);
                    if (scoreRes.ok) {
                        form.powerScore = scoreRes.score;
                    } else {
                        form.powerScore = 0;
                        form.invalid = true;
                        form.previewUnavailable = true;
                        form.error = scoreRes.errors?.[0]?.message ?? 'Invalid power score';
                    }
                } catch (err) {
                    form = {
                        id,
                        skill: baseFormObj.skill,
                        name: branch?.name || local,
                        step: 1,
                        origin: 'written',
                        fromForm: baseId,
                        tier: 3,
                        effects: [],
                        powerScore: 0,
                        invalid: true,
                        previewUnavailable: true,
                        error: err.message,
                    };
                }
            }
            const previewUnavailable = !!(form.previewUnavailable || form.invalid);
            const score = previewUnavailable ? 0 : (form.powerScore ?? (powerScore(form).ok ? powerScore(form).score : 0));
            nodesMap.set(key, {
                key,
                id,
                localId: local,
                label: branch?.name || form.name || local,
                step: 1,
                stepLabel: 'step 1',
                origin: 'written',
                gen: false,
                kind: 'Written',
                from: baseId,
                fromName: baseNode.label,
                powerScore: score,
                budget: step1Budget,
                isOverBudget: !previewUnavailable && (score > step1Budget),
                previewUnavailable,
                error: form.error ?? null,
                coords: NODE_COORDS[key],
                form,
                branch,
                branchIdx,
            });
        }
    }

    // Step 2: for each parent in [a, g, b], kids in [a, g, b]
    const step2Budget = budgetFor(3, 2);
    for (const pKey of step1Keys) {
        const parentNode = nodesMap.get(pKey);
        for (const cKey of ['a', 'g', 'b']) {
            const nodeKey = `${pKey}-${cKey}`;
            const id = `${baseId}-${nodeKey}`;
            const local = `${normSkill}-base-${nodeKey}`;
            const gen = cKey === 'g';

            if (gen) {
                let gForm = resolvedForms?.[id];
                if (!gForm) {
                    if (parentNode?.form && !parentNode.form.invalid && !parentNode.previewUnavailable) {
                        const gRes = generatePowerUp(parentNode.form, RULES_V2_CONSTANTS);
                        if (gRes.ok) {
                            gForm = gRes.form;
                        } else {
                            gForm = {
                                id,
                                skill: baseFormObj.skill,
                                name: `${parentNode.label} II`,
                                step: 2,
                                origin: 'generated',
                                fromForm: parentNode.id,
                                tier: 3,
                                effects: [],
                                powerScore: 0,
                                invalid: true,
                                previewUnavailable: true,
                                error: gRes.errors?.[0]?.message ?? 'Failed to generate power-up',
                            };
                        }
                    } else {
                        gForm = {
                            id,
                            skill: baseFormObj.skill,
                            name: `${parentNode?.label || nodeKey} II`,
                            step: 2,
                            origin: 'generated',
                            fromForm: parentNode?.id,
                            tier: 3,
                            effects: [],
                            powerScore: 0,
                            invalid: true,
                            previewUnavailable: true,
                            error: parentNode?.form?.error ?? 'Parent form invalid',
                        };
                    }
                }
                const previewUnavailable = !!(gForm?.previewUnavailable || gForm?.invalid);
                const score = previewUnavailable ? 0 : (gForm.powerScore ?? (powerScore(gForm).ok ? powerScore(gForm).score : 0));
                nodesMap.set(nodeKey, {
                    key: nodeKey,
                    id,
                    localId: local,
                    label: gForm?.name || `${parentNode?.label || nodeKey} II`,
                    step: 2,
                    stepLabel: 'step 2',
                    origin: 'generated',
                    gen: true,
                    kind: 'Generated',
                    from: parentNode.id,
                    fromName: parentNode.label,
                    powerScore: score,
                    budget: step2Budget,
                    isOverBudget: !previewUnavailable && (score > step2Budget),
                    previewUnavailable,
                    error: gForm?.error ?? null,
                    coords: NODE_COORDS[nodeKey],
                    form: gForm,
                });
            } else {
                // Written child of step 1 parent (contract wins: g-a, g-b written and editable!)
                const bItem = findBranch(`${normSkill}-base-${pKey}`, cKey, 2);
                const branch = bItem?.branch;
                const branchIdx = bItem?.idx ?? -1;
                let form = resolvedForms?.[id];
                if (!form) {
                    if (parentNode?.form?.previewUnavailable || parentNode?.form?.invalid) {
                        form = {
                            id,
                            skill: baseFormObj.skill,
                            name: branch?.name || local,
                            step: 2,
                            origin: 'written',
                            fromForm: parentNode ? parentNode.id : baseId,
                            tier: 3,
                            effects: [],
                            powerScore: 0,
                            invalid: true,
                            previewUnavailable: true,
                            error: parentNode?.form?.error ?? 'Parent form invalid',
                        };
                    } else if (parentNode?.form) {
                        try {
                            if (!branch) throw new Error('Written branch has not been authored');
                            form = applyTransforms(parentNode.form, branch.transforms);
                            delete form.powerScore;
                            form.id = id;
                            form.skill = baseFormObj.skill;
                            form.name = branch?.name || local;
                            form.step = 2;
                            form.origin = 'written';
                            form.fromForm = parentNode.id;
                            form.tier = 3;
                            const scoreRes = powerScore(form);
                            if (scoreRes.ok) {
                                form.powerScore = scoreRes.score;
                            } else {
                                form.powerScore = 0;
                                form.invalid = true;
                                form.previewUnavailable = true;
                                form.error = scoreRes.errors?.[0]?.message ?? 'Invalid power score';
                            }
                        } catch (err) {
                            form = {
                                id,
                                skill: baseFormObj.skill,
                                name: branch?.name || local,
                                step: 2,
                                origin: 'written',
                                fromForm: parentNode.id,
                                tier: 3,
                                effects: [],
                                powerScore: 0,
                                invalid: true,
                                previewUnavailable: true,
                                error: err.message,
                            };
                        }
                    }
                }
                const previewUnavailable = !!(form?.previewUnavailable || form?.invalid);
                const score = previewUnavailable ? 0 : (form?.powerScore ?? (form && powerScore(form).ok ? powerScore(form).score : 0));
                nodesMap.set(nodeKey, {
                    key: nodeKey,
                    id,
                    localId: local,
                    label: branch?.name || form?.name || local,
                    step: 2,
                    stepLabel: 'step 2',
                    origin: 'written',
                    gen: false,
                    kind: 'Written',
                    from: parentNode.id,
                    fromName: parentNode.label,
                    powerScore: score,
                    budget: step2Budget,
                    isOverBudget: !previewUnavailable && (score > step2Budget),
                    previewUnavailable,
                    error: form?.error ?? null,
                    coords: NODE_COORDS[nodeKey],
                    form,
                    branch,
                    branchIdx,
                });
            }
        }
    }

    return Array.from(nodesMap.values());
}

/** Renders the Skills screen (Tier 3 pathway map or lower-tier simple list) and Inspector. */
export function renderSkills(ctx) {
    const model = ctx.model;
    const doc = ctx.doc;

    if (!model?.document) return;

    const rawSkills = records(model, 'skills').filter(s => s && typeof s === 'object' && !Array.isArray(s));
    if (rawSkills.length === 0) {
        ctx.main.append(el(doc, 'h1', 'Skills'));
        ctx.main.append(el(doc, 'p', 'No skills found in rules pack.', { class: 'muted' }));
        ctx.inspector.append(el(doc, 'p', 'No skills available to inspect.', { class: 'muted' }));
        return;
    }

    const normRequested = ctx.selection.id ? localId(model, ctx.selection.id) : null;
    let { skill, sIdx, ownerClass } = normRequested ? findSkillAndOwner(model, normRequested) : { skill: null, sIdx: -1, ownerClass: null };

    if (!skill) {
        skill = rawSkills[0];
        sIdx = records(model, 'skills').indexOf(skill);
        ownerClass = findSkillAndOwner(model, skill.slug).ownerClass;
    }

    const normSkill = localId(model, skill.slug);
    ctx.selection.id = normSkill;

    const isTier3 = ownerClass ? (ownerClass.tier === 3) : records(model, 'branches').some(b => b && localId(model, b.skill) === normSkill);

    // Screen shell container
    const screen = el(doc, 'div', '', { class: 'skills-screen' });

    // Breadcrumb and Skill Tabs Header
    const header = el(doc, 'div', '', { class: 'skills-screen-header' });
    const nav = el(doc, 'nav', '', { 'aria-label': 'Breadcrumb', class: 'skills-breadcrumb' });

    const classesBtn = el(doc, 'button', 'Classes', { type: 'button', class: 'breadcrumb-link' });
    classesBtn.addEventListener('click', () => {
        ctx.select('classes', ownerClass ? localId(model, ownerClass.slug) : null);
    });

    nav.append(classesBtn, el(doc, 'span', '›', { 'aria-hidden': 'true' }));

    if (ownerClass) {
        const classBtn = el(doc, 'button', ownerClass.name || ownerClass.slug, { type: 'button', class: 'breadcrumb-link' });
        classBtn.addEventListener('click', () => {
            ctx.select('classes', localId(model, ownerClass.slug));
        });
        nav.append(classBtn, el(doc, 'span', '›', { 'aria-hidden': 'true' }));
    }

    nav.append(el(doc, 'span', skill.name || normSkill, { class: 'breadcrumb-current' }));

    header.append(nav, el(doc, 'div', '', { class: 'header-spacer' }));

    // Skill Tabs
    const tabSkills = ownerClass && Array.isArray(ownerClass.skills) && ownerClass.skills.length > 0
        ? ownerClass.skills.map(sRef => {
            const sSlug = localId(model, sRef);
            const found = rawSkills.find(s => localId(model, s.slug) === sSlug);
            return { slug: sSlug, name: found?.name || sSlug };
        })
        : rawSkills.slice(0, 8).map(s => ({ slug: localId(model, s.slug), name: s.name || localId(model, s.slug) }));

    const tabsGroup = el(doc, 'div', '', { role: 'group', 'aria-label': 'Skill', class: 'skill-tabs' });
    for (const ts of tabSkills) {
        const isCurrent = ts.slug === normSkill;
        const tabBtn = el(doc, 'button', ts.name, {
            type: 'button',
            class: 'skill-tab-btn',
            'aria-pressed': isCurrent ? 'true' : 'false',
        });
        tabBtn.addEventListener('click', () => {
            ctx.select('skills', ts.slug, 'base');
        });
        tabsGroup.append(tabBtn);
    }
    header.append(tabsGroup);
    screen.append(header);

    if (!isTier3) {
        renderLowerTierScreen(ctx, screen, skill, sIdx, ownerClass, tabSkills);
        return;
    }

    renderTier3Screen(ctx, screen, skill, sIdx, ownerClass);
}

/** Renders Lower-tier skills as a simple list. */
function renderLowerTierScreen(ctx, screen, skill, sIdx, ownerClass, tabSkills) {
    const doc = ctx.doc;
    const model = ctx.model;
    const tier = ownerClass?.tier ?? 0;
    const normSkill = localId(model, skill.slug);

    const section = el(doc, 'section', '', { 'aria-label': 'Lower tier skills' });
    const titleRow = el(doc, 'div', '', { class: 'skills-title-row' });
    titleRow.append(
        el(doc, 'h1', `${ownerClass?.name || ownerClass?.slug || 'Starter'} · Skills`),
        el(doc, 'span', `Tier ${tier} · simple list (starter/intermediate skills have no branching pathways)`, { class: 'skills-subtitle' })
    );
    section.append(titleRow);

    const list = el(doc, 'div', '', { class: 'lower-tier-list' });
    for (const ts of tabSkills) {
        const { skill: itemSkill } = findSkillAndOwner(model, ts.slug);
        const isSelected = ts.slug === normSkill;
        const card = el(doc, 'button', '', {
            type: 'button',
            class: 'lower-tier-card',
            'aria-pressed': isSelected ? 'true' : 'false',
            'data-slug': ts.slug,
        });
        card.addEventListener('click', () => {
            ctx.select('skills', ts.slug);
        });

        const headerRow = el(doc, 'div', '', { class: 'lower-tier-card-header' });
        headerRow.append(
            el(doc, 'span', ts.name, { class: 'lower-tier-card-name' }),
            el(doc, 'span', `Tier ${tier}`, { class: 'chip' })
        );

        const type = itemSkill?.base?.type || SCHEMA_TYPES[0];
        const stat = itemSkill?.base?.stat || SCHEMA_STATS[0];
        const costMp = itemSkill?.base?.cost?.mp ?? 0;
        const costSp = itemSkill?.base?.cost?.sp ?? 0;
        const scoreResult = powerScore(itemSkill?.base || {});
        const score = scoreResult.ok ? scoreResult.score : 'unavailable';
        const budget = budgetFor(tier, 0);

        const metaRow = el(doc, 'div', `${ts.slug} · ${type} · ${stat} · MP: ${costMp}, SP: ${costSp} · Power: ${score} / ${budget}`, {
            class: scoreResult.ok ? 'lower-tier-card-meta' : 'lower-tier-card-meta warn',
        });

        card.append(headerRow, metaRow);
        list.append(card);
    }

    section.append(list);
    screen.append(section);
    ctx.main.append(screen);

    // Inspector for lower-tier base skill
    renderBaseSkillInspector(ctx, skill, sIdx, tier, 0, 'base');
}

/** Renders the 3-column Tier 3 Pathway Map and Inspector. */
function renderTier3Screen(ctx, screen, skill, sIdx, _ownerClass) {
    const doc = ctx.doc;
    const model = ctx.model;
    const normSkill = localId(model, skill.slug);

    const section = el(doc, 'section', '', { 'aria-label': 'Skill paths' });

    const titleRow = el(doc, 'div', '', { class: 'skills-title-row' });
    titleRow.append(
        el(doc, 'h1', `${skill.name || normSkill} · paths`),
        el(doc, 'span', '12 forms: 8 you write, 4 Story Block makes', { class: 'skills-subtitle' })
    );

    const legend = el(doc, 'div', '', { class: 'skills-legend' });
    const writtenLegend = el(doc, 'span', '', { class: 'skills-legend-item' });
    writtenLegend.append(el(doc, 'span', '', { class: 'legend-box legend-written' }), doc.createTextNode('Written'));
    const genLegend = el(doc, 'span', '', { class: 'skills-legend-item' });
    genLegend.append(el(doc, 'span', '', { class: 'legend-box legend-gen' }), doc.createTextNode('Generated (read-only)'));
    legend.append(writtenLegend, genLegend);
    titleRow.append(legend);
    section.append(titleRow);

    const mapContainer = el(doc, 'div', '', { class: 'pathway-map-container' });
    const canvas = el(doc, 'div', '', { class: 'pathway-canvas' });

    // SVG Connector Links with proportional viewBox
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pathway-connectors');
    svg.setAttribute('viewBox', '0 0 840 640');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const nodes = resolveSkillForms(model, normSkill);
    const nodesByKey = new Map(nodes.map(n => [n.key, n]));

    const LINKS = [
        { from: 'base', to: 'a' },
        { from: 'base', to: 'g' },
        { from: 'base', to: 'b' },
        { from: 'a', to: 'a-a' },
        { from: 'a', to: 'a-g' },
        { from: 'a', to: 'a-b' },
        { from: 'g', to: 'g-a' },
        { from: 'g', to: 'g-g' },
        { from: 'g', to: 'g-b' },
        { from: 'b', to: 'b-a' },
        { from: 'b', to: 'b-g' },
        { from: 'b', to: 'b-b' },
    ];

    const curve = (a, b) => `M${a[0]},${a[1]} C${a[0] + 46},${a[1]} ${b[0] - 46},${b[1]} ${b[0]},${b[1]}`;

    for (const link of LINKS) {
        const aNode = nodesByKey.get(link.from);
        const bNode = nodesByKey.get(link.to);
        if (!aNode || !bNode) continue;

        const ptA = [aNode.coords.x + aNode.coords.w, aNode.coords.y + 22];
        const ptB = [bNode.coords.x, bNode.coords.y + 22];
        const d = curve(ptA, ptB);

        const pathEl = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('class', 'connector-path');
        pathEl.setAttribute('d', d);
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke', bNode.gen ? 'var(--link)' : 'var(--accent)');
        pathEl.setAttribute('stroke-width', bNode.gen ? '1.5' : '2');
        if (bNode.gen) {
            pathEl.setAttribute('stroke-dasharray', '5 5');
        }
        svg.append(pathEl);
    }
    canvas.append(svg);

    // Column Headers
    const colHeaders = el(doc, 'div', '', { class: 'pathway-columns-header' });
    colHeaders.append(
        el(doc, 'div', 'BASE', { class: 'pathway-column-title', style: 'left: 2.857%; width: 17.857%;' }),
        el(doc, 'div', 'STEP 1', { class: 'pathway-column-title', style: 'left: 31.667%; width: 25%;' }),
        el(doc, 'div', 'STEP 2', { class: 'pathway-column-title', style: 'left: 67.619%; width: 28.571%;' })
    );
    canvas.append(colHeaders);

    // Selected Form resolution
    const requestedForm = ctx.selection.form;
    let selectedNode = nodes.find(n =>
        n.key === requestedForm ||
        n.localId === requestedForm ||
        n.id === requestedForm ||
        (requestedForm && localId(model, requestedForm) === n.localId)
    ) || nodes[0];

    // Node Buttons
    for (const node of nodes) {
        const isSelected = node.key === selectedNode.key;
        const ariaLabel = `${node.label}${node.gen ? ' (generated)' : ''}${node.previewUnavailable ? ', preview unavailable' : (node.isOverBudget ? ', over budget' : '')}, power ${node.previewUnavailable ? 'unavailable' : node.powerScore} of ${node.budget}`;
        const btn = el(doc, 'button', '', {
            type: 'button',
            class: `path-node ${node.gen ? 'path-node-gen' : 'path-node-written'}`,
            'aria-pressed': isSelected ? 'true' : 'false',
            'aria-label': ariaLabel,
            'data-key': node.key,
            'data-form-id': node.id,
            'data-gen': node.gen ? 'true' : 'false',
            'data-step': String(node.step),
            style: `left: ${node.coords.left}; top: ${node.coords.y}px; width: ${node.coords.width};`,
        });

        if (node.isOverBudget) {
            btn.setAttribute('data-over-budget', 'true');
        }
        if (node.previewUnavailable) {
            btn.setAttribute('data-preview-unavailable', 'true');
        }

        btn.addEventListener('click', () => {
            ctx.select('skills', normSkill, node.key);
        });

        if (node.gen) {
            const lockSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
            lockSvg.setAttribute('width', '14');
            lockSvg.setAttribute('height', '14');
            lockSvg.setAttribute('viewBox', '0 0 24 24');
            lockSvg.setAttribute('fill', 'none');
            lockSvg.setAttribute('stroke', 'currentColor');
            lockSvg.setAttribute('stroke-width', '2');
            lockSvg.setAttribute('stroke-linecap', 'round');
            lockSvg.setAttribute('stroke-linejoin', 'round');
            lockSvg.setAttribute('aria-hidden', 'true');
            const lockPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
            lockPath.setAttribute('d', 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z');
            lockSvg.append(lockPath);
            btn.append(lockSvg);
        }

        btn.append(el(doc, 'span', node.label, { class: 'path-node-label' }));

        // Visible power budget indication on every node
        const badgeText = node.previewUnavailable ? `—/${node.budget}` : `${node.powerScore}/${node.budget}`;
        const badgeClass = (node.previewUnavailable || node.isOverBudget) ? 'path-node-budget warn' : 'path-node-budget good';
        btn.append(el(doc, 'span', badgeText, {
            class: badgeClass,
            'aria-hidden': 'true',
        }));

        // Small actual bar meter on every pathway node
        const miniPct = node.previewUnavailable ? 0 : Math.min(100, Math.round(((node.powerScore || 0) / (node.budget || 1)) * 100));
        const miniTrack = el(doc, 'span', '', {
            class: 'node-budget-track',
            role: 'meter',
            'aria-label': 'Power budget',
            'aria-valuenow': node.previewUnavailable ? '0' : String(Math.min(node.powerScore || 0, node.budget)),
            'aria-valuemin': '0',
            'aria-valuemax': String(node.budget),
            'aria-valuetext': node.previewUnavailable ? 'Preview unavailable' : `${node.powerScore || 0} of ${node.budget}`,
        });
        miniTrack.append(el(doc, 'span', '', {
            class: `node-budget-bar ${(node.previewUnavailable || node.isOverBudget) ? 'warn' : 'good'}`,
            style: `width: ${miniPct}%`,
        }));
        btn.append(miniTrack);

        if (node.isOverBudget || node.previewUnavailable) {
            btn.append(el(doc, 'span', '', {
                class: 'path-warn-dot',
                'aria-label': node.previewUnavailable ? 'Preview unavailable' : 'Over budget',
            }));
        }

        canvas.append(btn);
    }

    mapContainer.append(canvas);
    section.append(mapContainer);
    screen.append(section);
    ctx.main.append(screen);

    // Inspector for Selected Form
    renderFormInspector(ctx, selectedNode, skill, sIdx);
}

/** Renders the inspector drawer for a selected form. */
function renderFormInspector(ctx, node, skill, sIdx) {
    const doc = ctx.doc;

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(
        el(doc, 'h2', node.label),
        el(doc, 'span', node.kind, { class: node.gen ? 'chip chip-gen' : 'chip' })
    );

    const prov = el(doc, 'div', `${node.localId} · from ${node.fromName}`, {
        class: 'inspector-provenance muted mono',
    });

    ctx.inspector.append(titleRow, prov);

    if (node.gen) {
        ctx.inspector.append(el(doc, 'div', 'Story Block makes this form from its parent. Edit the parent to change it; it can\'t be renamed or removed.', {
            class: 'generated-explanation',
        }));
    } else if (node.origin === 'base') {
        renderBaseSkillControls(ctx, skill, sIdx);
    } else if (node.origin === 'written') {
        renderBranchControls(ctx, node);
    }

    if (node.previewUnavailable || node.form?.invalid) {
        const errorBox = el(doc, 'div', '', { role: 'status', class: 'warning preview-error' });
        errorBox.append(
            el(doc, 'span', 'preview-error', { class: 'mono' }),
            doc.createTextNode(`: Preview unavailable — ${node.error || node.form?.error || 'malformed transforms'}`)
        );
        ctx.inspector.append(errorBox);
    }

    // Power Budget Bar Section with accessible meter
    const budgetSection = el(doc, 'div', '', { class: 'budget-section' });
    const budgetHeader = el(doc, 'div', '', { class: 'budget-header' });

    let ratioText = `${node.powerScore} / ${node.budget}`;
    let ratioClass = node.isOverBudget ? 'budget-ratio warn' : 'budget-ratio good';
    if (node.previewUnavailable) {
        ratioText = 'Preview unavailable';
        ratioClass = 'budget-ratio warn';
    }

    budgetHeader.append(
        el(doc, 'span', `POWER BUDGET · ${node.stepLabel.toUpperCase()}`),
        el(doc, 'span', ratioText, { class: ratioClass })
    );

    const pct = node.previewUnavailable ? 0 : Math.min(100, Math.round(((node.powerScore || 0) / (node.budget || 1)) * 100));
    const track = el(doc, 'div', '', {
        class: 'budget-track',
        role: 'meter',
        'aria-label': 'Power budget',
        'aria-valuenow': node.previewUnavailable ? '0' : String(Math.min(node.powerScore || 0, node.budget)),
        'aria-valuemin': '0',
        'aria-valuemax': String(node.budget),
        'aria-valuetext': node.previewUnavailable ? 'Preview unavailable' : `${node.powerScore || 0} of ${node.budget}`,
    });
    track.append(el(doc, 'div', '', {
        class: (node.previewUnavailable || node.isOverBudget) ? 'budget-bar warn' : 'budget-bar good',
        style: `width: ${pct}%`,
    }));
    budgetSection.append(budgetHeader, track);

    if (node.isOverBudget && !node.previewUnavailable) {
        const warnBox = el(doc, 'div', '', { role: 'status', class: 'warning budget-warning' });
        warnBox.append(
            el(doc, 'span', 'budget-closure', { class: 'mono' }),
            doc.createTextNode(': this form is stronger than its step allows. Lower its power or cost.')
        );
        budgetSection.append(warnBox);
    }
    ctx.inspector.append(budgetSection);

    ctx.inspector.append(el(doc, 'div', 'Each step-1 form leads to 3 step-2 forms: 2 you write and 1 generated. A reader picks one path per skill as they level.', {
        class: 'skills-footer-note muted',
    }));
}

/** Renders base skill controls in inspector with schema-driven types and stats. */
function renderBaseSkillControls(ctx, skill, sIdx) {
    const doc = ctx.doc;
    const skillPath = ['content', 'rules', 0, 'skills', sIdx];

    const nameInput = el(doc, 'input', '', {
        id: 'form-name',
        value: skill.name ?? '',
        'data-path': JSON.stringify([...skillPath, 'name']),
    });
    nameInput.addEventListener('change', () => {
        const val = nameInput.value;
        if (val !== (skill.name ?? '')) {
            if (!ctx.apply(setField(ctx.model, [...skillPath, 'name'], val))) {
                nameInput.value = skill.name ?? '';
            }
        }
    });
    ctx.inspector.append(field(doc, 'NAME', nameInput));

    const costMp = skill.base?.cost?.mp ?? 0;
    const costSp = skill.base?.cost?.sp ?? 0;
    const costGrid = el(doc, 'div', '', { class: 'inspector-grid' });

    const mpInput = el(doc, 'input', '', {
        id: 'form-cost-mp',
        type: 'number',
        min: '0',
        max: '999',
        value: String(costMp),
        'data-path': JSON.stringify([...skillPath, 'base', 'cost', 'mp']),
    });
    mpInput.addEventListener('change', () => {
        const parsed = parseIntegerInput(mpInput.value, 0, 999);
        if (!parsed.ok) {
            ctx.apply({
                ok: false,
                model: ctx.model,
                errors: [{ code: 'bad-value', path: [...skillPath, 'base', 'cost', 'mp'].join('.'), message: parsed.error }],
            });
            mpInput.value = String(costMp);
            return;
        }
        const curCost = typeof skill.base?.cost === 'object' && skill.base.cost !== null ? skill.base.cost : { mp: 0, sp: 0, cooldown: 0 };
        ctx.apply(setField(ctx.model, [...skillPath, 'base', 'cost'], { ...curCost, mp: parsed.value }));
    });
    costGrid.append(field(doc, 'COST (MP)', mpInput));

    const spInput = el(doc, 'input', '', {
        id: 'form-cost-sp',
        type: 'number',
        min: '0',
        max: '999',
        value: String(costSp),
        'data-path': JSON.stringify([...skillPath, 'base', 'cost', 'sp']),
    });
    spInput.addEventListener('change', () => {
        const parsed = parseIntegerInput(spInput.value, 0, 999);
        if (!parsed.ok) {
            ctx.apply({
                ok: false,
                model: ctx.model,
                errors: [{ code: 'bad-value', path: [...skillPath, 'base', 'cost', 'sp'].join('.'), message: parsed.error }],
            });
            spInput.value = String(costSp);
            return;
        }
        const curCost = typeof skill.base?.cost === 'object' && skill.base.cost !== null ? skill.base.cost : { mp: 0, sp: 0, cooldown: 0 };
        ctx.apply(setField(ctx.model, [...skillPath, 'base', 'cost'], { ...curCost, sp: parsed.value }));
    });
    costGrid.append(field(doc, 'COST (SP)', spInput));
    ctx.inspector.append(costGrid);

    const typeSelect = el(doc, 'select', '', {
        id: 'form-type',
        'data-path': JSON.stringify([...skillPath, 'base', 'type']),
    });
    for (const t of SCHEMA_TYPES) {
        const opt = el(doc, 'option', t, { value: t });
        if (skill.base?.type === t) opt.selected = true;
        typeSelect.append(opt);
    }
    if (typeof skill.base?.type === 'string' && !SCHEMA_TYPES.includes(skill.base.type)) {
        const current = el(doc, 'option', skill.base.type, { value: skill.base.type });
        current.selected = true;
        typeSelect.append(current);
    }
    typeSelect.addEventListener('change', () => {
        ctx.apply(setField(ctx.model, [...skillPath, 'base', 'type'], typeSelect.value));
    });
    ctx.inspector.append(field(doc, 'TYPE', typeSelect));

    const statSelect = el(doc, 'select', '', {
        id: 'form-stat',
        'data-path': JSON.stringify([...skillPath, 'base', 'stat']),
    });
    for (const s of SCHEMA_STATS) {
        const opt = el(doc, 'option', s, { value: s });
        if (skill.base?.stat === s) opt.selected = true;
        statSelect.append(opt);
    }
    if (typeof skill.base?.stat === 'string' && !SCHEMA_STATS.includes(skill.base.stat)) {
        const current = el(doc, 'option', skill.base.stat, { value: skill.base.stat });
        current.selected = true;
        statSelect.append(current);
    }
    statSelect.addEventListener('change', () => {
        ctx.apply(setField(ctx.model, [...skillPath, 'base', 'stat'], statSelect.value));
    });
    ctx.inspector.append(field(doc, 'STAT', statSelect));

    const details = el(doc, 'details', '', { class: 'advanced-json' });
    details.append(el(doc, 'summary', 'Effects (JSON)'));

    const effectsTextarea = el(doc, 'textarea', JSON.stringify(skill.base?.effects ?? [], null, 2), {
        id: 'form-effects',
        'data-path': JSON.stringify([...skillPath, 'base', 'effects']),
    });
    effectsTextarea.addEventListener('change', () => {
        try {
            const parsed = JSON.parse(effectsTextarea.value);
            if (!Array.isArray(parsed)) {
                ctx.notify('Effects must be an array of effect objects');
                return;
            }
            ctx.apply(setField(ctx.model, [...skillPath, 'base', 'effects'], parsed));
        } catch (err) {
            ctx.notify(`Invalid JSON in effects: ${err.message}`);
        }
    });
    details.append(field(doc, 'EFFECTS (JSON)', effectsTextarea));
    ctx.inspector.append(details);
}

/** Renders written branch controls in inspector with labeled controls for cost/power/effect and advanced JSON. */
function renderBranchControls(ctx, node) {
    const doc = ctx.doc;
    const branch = node.branch;
    const bIdx = node.branchIdx;

    if (!branch || bIdx < 0) return;

    const branchPath = ['content', 'rules', 0, 'branches', bIdx];

    const nameInput = el(doc, 'input', '', {
        id: 'form-name',
        value: branch.name ?? '',
        'data-path': JSON.stringify([...branchPath, 'name']),
    });
    nameInput.addEventListener('change', () => {
        const val = nameInput.value;
        if (val !== (branch.name ?? '')) {
            if (!ctx.apply(setField(ctx.model, [...branchPath, 'name'], val))) {
                nameInput.value = branch.name ?? '';
            }
        }
    });
    ctx.inspector.append(field(doc, 'NAME', nameInput));

    const currentEffects = Array.isArray(node.form?.effects) ? node.form.effects : [];
    const primaryEffect = currentEffects[0] || {};
    const curPower = primaryEffect.power ?? 0;
    const curCost = node.form?.cost ?? { mp: 0, sp: 0, cooldown: 0 };
    const curCostVal = (node.form?.type === 'physical') ? (curCost.sp ?? 0) : (curCost.mp ?? 0);
    const curElement = primaryEffect.element ?? 'none';

    const costPowerGrid = el(doc, 'div', '', { class: 'inspector-grid' });

    const costInput = el(doc, 'input', '', {
        id: 'form-cost',
        type: 'number',
        min: '0',
        max: '999',
        value: String(curCostVal),
        'aria-label': 'Cost',
        'data-path': JSON.stringify([...branchPath, 'transforms']),
    });
    costInput.addEventListener('change', () => {
        const parsed = parseIntegerInput(costInput.value, 0, 999);
        if (!parsed.ok) {
            ctx.apply({
                ok: false,
                model: ctx.model,
                errors: [{ code: 'bad-value', path: [...branchPath, 'transforms'].join('.'), message: parsed.error }],
            });
            costInput.value = String(curCostVal);
            return;
        }
        const val = parsed.value;
        const curTransforms = Array.isArray(branch.transforms) ? JSON.parse(JSON.stringify(branch.transforms)) : [];
        const isPhysical = node.form?.type === 'physical';
        const newCost = {
            ...curCost,
            mp: isPhysical ? (curCost.mp ?? 0) : val,
            sp: isPhysical ? val : (curCost.sp ?? 0),
            cooldown: curCost.cooldown ?? 0,
        };
        const remaining = curTransforms.filter(t => !(t && typeof t === 'object' && t.op === 'set-cost'));
        remaining.push({ op: 'set-cost', value: newCost });
        ctx.apply(setField(ctx.model, [...branchPath, 'transforms'], remaining));
    });
    costPowerGrid.append(field(doc, 'COST', costInput));

    const powerInput = el(doc, 'input', '', {
        id: 'form-power',
        type: 'number',
        min: '1',
        max: '1000',
        value: String(curPower),
        'aria-label': 'Power',
        'data-path': JSON.stringify([...branchPath, 'transforms']),
    });
    powerInput.addEventListener('change', () => {
        const parsed = parseIntegerInput(powerInput.value, 1, 1000);
        if (!parsed.ok) {
            ctx.apply({
                ok: false,
                model: ctx.model,
                errors: [{ code: 'bad-value', path: [...branchPath, 'transforms'].join('.'), message: parsed.error }],
            });
            powerInput.value = String(curPower);
            return;
        }
        const val = parsed.value;
        const curTransforms = Array.isArray(branch.transforms) ? JSON.parse(JSON.stringify(branch.transforms)) : [];
        const remaining = curTransforms.filter(t => !(t && typeof t === 'object' && t.op === 'set-power' && (t.at === undefined || t.at === 0)));
        remaining.push({ op: 'set-power', at: 0, value: val });
        ctx.apply(setField(ctx.model, [...branchPath, 'transforms'], remaining));
    });
    costPowerGrid.append(field(doc, 'POWER', powerInput));
    ctx.inspector.append(costPowerGrid);

    const effectSelect = el(doc, 'select', '', {
        id: 'form-effect',
        'aria-label': 'Effect',
        'data-path': JSON.stringify([...branchPath, 'transforms']),
    });
    for (const elem of SCHEMA_ELEMENTS) {
        const opt = el(doc, 'option', `${primaryEffect.op || 'damage'} · ${elem}`, { value: elem });
        if (elem === curElement) opt.selected = true;
        effectSelect.append(opt);
    }
    effectSelect.addEventListener('change', () => {
        const newElem = effectSelect.value;
        const curTransforms = Array.isArray(branch.transforms) ? JSON.parse(JSON.stringify(branch.transforms)) : [];
        const remaining = curTransforms.filter(t => !(t && typeof t === 'object' && t.op === 'set-element' && (t.at === undefined || t.at === 0)));
        remaining.push({ op: 'set-element', at: 0, value: newElem });
        ctx.apply(setField(ctx.model, [...branchPath, 'transforms'], remaining));
    });
    ctx.inspector.append(field(doc, 'EFFECT', effectSelect));

    const details = el(doc, 'details', '', { class: 'advanced-json' });
    details.append(el(doc, 'summary', 'Advanced transforms (JSON)'));

    const transformsTextarea = el(doc, 'textarea', JSON.stringify(branch.transforms ?? [], null, 2), {
        id: 'form-transforms',
        'data-path': JSON.stringify([...branchPath, 'transforms']),
    });
    transformsTextarea.addEventListener('change', () => {
        try {
            const parsed = JSON.parse(transformsTextarea.value);
            if (!Array.isArray(parsed)) {
                ctx.notify('Transforms must be an array of transform objects');
                return;
            }
            ctx.apply(setField(ctx.model, [...branchPath, 'transforms'], parsed));
        } catch (err) {
            ctx.notify(`Invalid JSON in transforms: ${err.message}`);
        }
    });
    details.append(field(doc, 'TRANSFORMS (JSON)', transformsTextarea));
    ctx.inspector.append(details);
}

/** Helper for lower-tier inspector with accessible meter. */
function renderBaseSkillInspector(ctx, skill, sIdx, tier, step, stepLabel) {
    const doc = ctx.doc;
    const normSkill = localId(ctx.model, skill.slug);

    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(
        el(doc, 'h2', skill.name || normSkill),
        el(doc, 'span', `Tier ${tier} Base Skill`, { class: 'chip' })
    );

    const prov = el(doc, 'div', `${normSkill}-base · from —`, {
        class: 'inspector-provenance muted mono',
    });

    ctx.inspector.append(titleRow, prov);
    renderBaseSkillControls(ctx, skill, sIdx);

    const scoreResult = powerScore(skill.base || {});
    const score = scoreResult.ok ? scoreResult.score : 0;
    const budget = budgetFor(tier, step);
    const isOverBudget = score > budget;

    const budgetSection = el(doc, 'div', '', { class: 'budget-section' });
    const budgetHeader = el(doc, 'div', '', { class: 'budget-header' });
    budgetHeader.append(
        el(doc, 'span', `POWER BUDGET · TIER ${tier}`),
        el(doc, 'span', scoreResult.ok ? `${score} / ${budget}` : 'Preview unavailable', {
            class: isOverBudget || !scoreResult.ok ? 'budget-ratio warn' : 'budget-ratio good',
        })
    );

    const pct = Math.min(100, Math.round((score / (budget || 1)) * 100));
    const track = el(doc, 'div', '', {
        class: 'budget-track',
        role: 'meter',
        'aria-label': 'Power budget',
        'aria-valuenow': String(Math.min(score, budget)),
        'aria-valuemin': '0',
        'aria-valuemax': String(budget),
        'aria-valuetext': scoreResult.ok ? `${score} of ${budget}` : 'Preview unavailable',
    });
    track.append(el(doc, 'div', '', {
        class: isOverBudget ? 'budget-bar warn' : 'budget-bar good',
        style: `width: ${pct}%`,
    }));
    budgetSection.append(budgetHeader, track);

    if (isOverBudget) {
        const warnBox = el(doc, 'div', '', { role: 'status', class: 'warning budget-warning' });
        warnBox.append(
            el(doc, 'span', 'budget-closure', { class: 'mono' }),
            doc.createTextNode(': this form is stronger than its step allows. Lower its power or cost.')
        );
        budgetSection.append(warnBox);
    }
    ctx.inspector.append(budgetSection);
}
