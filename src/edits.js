// Pack edit operations: add, renameId, remove, moveClass, and setField (pure).

import { openPack } from './model.js';
import { schemaForKind, validateChange } from './form-schema.js';
import { RULES_V2_LIMITS, RULES_V2_PROGRESSION, rulesV2Schema } from '../vendor/story-block/src/v2/packs/rules-v2.js';

const RULES_KINDS = new Set(['classes', 'skills', 'branches', 'itemRules', 'trainers']);
const SHARED_RULES_KINDS = new Set(['classes', 'skills', 'branches', 'trainers']);
const SB_KINDS = new Set([
    'items', 'creatures', 'quests', 'shops', 'recipes',
    'places', 'events', 'routes', 'races', 'talents',
    'presets', 'legacySkills',
]);
const ALL_KINDS = new Set([...RULES_KINDS, ...SB_KINDS]);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SLUG_REGEX = new RegExp(rulesV2Schema.$defs.slug.pattern);
const ID_REGEX = new RegExp(rulesV2Schema.$defs.id.pattern);
const MAX_SLUG = RULES_V2_LIMITS.slug;
const MAX_TIER = Math.max(...RULES_V2_PROGRESSION.tiers);
const WRITTEN_CHOICES = RULES_V2_PROGRESSION.writtenChoices;
const GENERATED_CHOICE = RULES_V2_PROGRESSION.generatedChoice;
const PATHWAY_STEPS = RULES_V2_PROGRESSION.pathwaySteps;
const MAX_SKILL_SLUG = 52; // Awaiting a dedicated upstream limit export.

const MAX_DEPTH = RULES_V2_LIMITS?.depth ?? 16;
const MAX_ARRAY = RULES_V2_LIMITS?.array ?? 1000;
const MAX_KEYS = RULES_V2_LIMITS?.keys ?? 200;
const MAX_STRING = RULES_V2_LIMITS?.string ?? 4000;
const MAX_BYTES = RULES_V2_LIMITS?.packBytes ?? (512 * 1024);

/** Helper to extract the pack identifier from a document. */
function getPackId(document) {
    return typeof document?.id === 'string' && document.id ? document.id : 'pack';
}

/** Strips the pack.<id>/ prefix if present, returning the local slug or id. */
function normalizeId(id, packId) {
    if (typeof id !== 'string' || !id) return null;
    const prefix = `pack.${packId}/`;
    if (id.startsWith(prefix)) {
        return id.slice(prefix.length);
    }
    return id;
}

/** Checks whether an ID belongs to a foreign pack. */
function isForeignId(id, packId) {
    if (typeof id !== 'string') return false;
    return id.startsWith('pack.') && !id.startsWith(`pack.${packId}/`);
}

/** Validates raw slug format (1..max chars, lowercase alphanumeric with single hyphens). */
function isValidRawSlug(slug) {
    return typeof slug === 'string' && SLUG_REGEX.test(slug) && slug.length >= 1 && slug.length <= MAX_SLUG;
}

/** Validates identifier format (slug, record id, or def id). */
function isValidIdentifier(id) {
    if (typeof id !== 'string' || !id) return false;
    return isValidRawSlug(id) || ID_REGEX.test(id);
}

/** Returns all identities across shared rules collections (classes, skills, branches, trainers, and rule sets). */
function getSharedRulesIdentities(document, packId, excludeKind = null, excludeNormId = null) {
    const ids = new Set();
    const rulesList = Array.isArray(document?.content?.rules) ? document.content.rules : [];
    for (const r of rulesList) {
        if (!r || typeof r !== 'object') continue;
        const rSlug = normalizeId(r.slug || r.id, packId);
        if (rSlug) ids.add(rSlug);
        for (const rk of SHARED_RULES_KINDS) {
            const list = r[rk];
            if (!Array.isArray(list)) continue;
            for (const item of list) {
                if (!item || typeof item !== 'object') continue;
                const itemId = normalizeId(getRecordIdentity(rk, item), packId);
                if (itemId) {
                    if (excludeKind === rk && itemId === excludeNormId) continue;
                    ids.add(itemId);
                }
            }
        }
    }
    return ids;
}

/**
 * Safely validates and clones plain JSON values without invoking getters or prototype accessors.
 * Bounds traversal by depth 16, array length 1000, keys 200, string length 4000, and exact JSON bytes.
 * Returns { ok: true, value } on success, or { ok: false, error } on unsafe or non-JSON input.
 */
function validateAndCloneValue(val, seen = new Set(), depth = 0) {
    try {
        if (val === null) return { ok: true, value: null };

        const type = typeof val;
        if (type === 'boolean') return { ok: true, value: val };
        if (type === 'number') {
            if (!Number.isFinite(val)) return { ok: false, error: 'Non-finite number' };
            return { ok: true, value: val };
        }
        if (type === 'string') {
            if (val.length > MAX_STRING) return { ok: false, error: `String length exceeds limit of ${MAX_STRING}` };
            return { ok: true, value: val };
        }
        if (type !== 'object') return { ok: false, error: `Unsupported non-JSON type: ${type}` };

        if (depth >= MAX_DEPTH) return { ok: false, error: 'Maximum depth exceeded' };

        const proto = Object.getPrototypeOf(val);
        if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
            return { ok: false, error: 'Unsupported object prototype' };
        }

        if (seen.has(val)) return { ok: false, error: 'Cyclic value detected' };
        seen.add(val);

        try {
            if (Array.isArray(val)) {
                if (val.length > MAX_ARRAY) return { ok: false, error: `Array length exceeds limit of ${MAX_ARRAY}` };
                const keys = Reflect.ownKeys(val);
                if (keys.length !== val.length + 1) {
                    return { ok: false, error: 'Array has non-index own properties' };
                }
                const out = [];
                for (let i = 0; i < val.length; i++) {
                    const desc = Object.getOwnPropertyDescriptor(val, String(i));
                    if (!desc || !desc.enumerable || desc.get || desc.set) {
                        return { ok: false, error: 'Array element accessor or non-enumerable' };
                    }
                    const res = validateAndCloneValue(desc.value, seen, depth + 1);
                    if (!res.ok) return res;
                    out.push(res.value);
                }
                if (depth === 0) {
                    const text = JSON.stringify(out);
                    if (new TextEncoder().encode(text).length > MAX_BYTES) {
                        return { ok: false, error: 'Value exceeds byte limit' };
                    }
                }
                return { ok: true, value: out };
            }

            const keys = Reflect.ownKeys(val);
            if (keys.length > MAX_KEYS) return { ok: false, error: `Object key count exceeds limit of ${MAX_KEYS}` };
            const out = {};
            for (const key of keys) {
                if (typeof key !== 'string') return { ok: false, error: 'Symbol property key' };
                if (UNSAFE_KEYS.has(key)) return { ok: false, error: `Unsafe property key: ${key}` };
                if (key.length > MAX_STRING) return { ok: false, error: 'Object key exceeds length limit' };

                const desc = Object.getOwnPropertyDescriptor(val, key);
                if (!desc || !desc.enumerable || desc.get || desc.set) {
                    return { ok: false, error: `Getter or accessor on key: ${key}` };
                }
                const res = validateAndCloneValue(desc.value, seen, depth + 1);
                if (!res.ok) return res;
                out[key] = res.value;
            }
            if (depth === 0) {
                const text = JSON.stringify(out);
                if (new TextEncoder().encode(text).length > MAX_BYTES) {
                    return { ok: false, error: 'Value exceeds byte limit' };
                }
            }
            return { ok: true, value: out };
        } finally {
            seen.delete(val);
        }
    } catch {
        return { ok: false, error: 'Error inspecting value (possible hostile proxy)' };
    }
}

/** Deeply clones a verified plain document object. */
function cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc));
}

/** Returns the property name used as the identity for a record of the given kind. */
function getIdentityKey(kind, record) {
    if (kind === 'itemRules') return 'def';
    if (kind === 'events' || kind === 'races' || kind === 'talents' || kind === 'presets') {
        if (record && 'id' in record && record.id !== undefined) return 'id';
        if (record && 'slug' in record && record.slug !== undefined) return 'slug';
        return 'id';
    }
    if (record && 'slug' in record && record.slug !== undefined) return 'slug';
    if (record && 'id' in record && record.id !== undefined) return 'id';
    return 'slug';
}

/** Extracts the identity string from a record of the given kind. */
function getRecordIdentity(kind, record) {
    if (!record || typeof record !== 'object') return null;
    const key = getIdentityKey(kind, record);
    return record[key] ?? null;
}

/** Returns read-only access to a kind's array in a document. */
function readKindList(doc, kind) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    if (!doc.content || typeof doc.content !== 'object' || Array.isArray(doc.content)) return null;

    if (RULES_KINDS.has(kind)) {
        const rules = doc.content.rules;
        if (!Array.isArray(rules) || rules.length === 0 || !rules[0] || typeof rules[0] !== 'object' || Array.isArray(rules[0])) return null;
        return Array.isArray(rules[0][kind]) ? rules[0][kind] : null;
    }
    if (kind === 'legacySkills') {
        return Array.isArray(doc.content.skills) ? doc.content.skills : null;
    }
    if (SB_KINDS.has(kind)) {
        return Array.isArray(doc.content[kind]) ? doc.content[kind] : null;
    }
    return null;
}

/** Returns or creates the mutable target array for a kind in a cloned document. */
function ensureKindList(doc, kind) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    if (!doc.content || typeof doc.content !== 'object' || Array.isArray(doc.content)) return null;

    if (RULES_KINDS.has(kind)) {
        if (!Array.isArray(doc.content.rules) || doc.content.rules.length === 0) {
            doc.content.rules = [{ slug: 'rules', name: 'Rules', schema: 2 }];
        }
        if (!doc.content.rules[0] || typeof doc.content.rules[0] !== 'object' || Array.isArray(doc.content.rules[0])) {
            return null;
        }
        if (!Array.isArray(doc.content.rules[0][kind])) {
            doc.content.rules[0][kind] = [];
        }
        return doc.content.rules[0][kind];
    }
    if (kind === 'legacySkills') {
        if (!Array.isArray(doc.content.skills)) {
            doc.content.skills = [];
        }
        return doc.content.skills;
    }
    if (SB_KINDS.has(kind)) {
        if (!Array.isArray(doc.content[kind])) {
            doc.content[kind] = [];
        }
        return doc.content[kind];
    }
    return null;
}

/** Maps a document collection kind to its indexed targetKind in model.references. */
function getTargetKind(kind) {
    switch (kind) {
        case 'classes': return 'classes';
        case 'skills': return 'skills';
        case 'legacySkills': return 'legacySkills';
        case 'branches': return 'branches';
        case 'itemRules': return 'itemRules';
        case 'items': return 'items';
        case 'places': return 'places';
        case 'creatures': return 'creatures';
        case 'quests': return 'quests';
        case 'shops': return 'shops';
        case 'recipes': return 'recipes';
        case 'routes': return 'routes';
        case 'events': return 'events';
        case 'races': return 'races';
        case 'talents': return 'talents';
        case 'presets': return 'presets';
        default: return kind;
    }
}

/** Sets a value at a structured path in a cloned document. */
function setValueAtPath(doc, path, value) {
    if (!Array.isArray(path) || path.length === 0) return false;
    let curr = doc;
    for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        if (curr === null || typeof curr !== 'object' || !(seg in curr)) return false;
        curr = curr[seg];
    }
    const last = path[path.length - 1];
    if (curr === null || typeof curr !== 'object') return false;
    curr[last] = value;
    return true;
}

/** Computes base and pathway form slugs using the shared progression structure. */
function getSkillDerivedFormSlugs(skillSlug, isAdvanced = true) {
    const base = `${skillSlug}-base`;
    const slugs = new Set([base]);
    const choices = [GENERATED_CHOICE, ...WRITTEN_CHOICES];
    let parents = [base];
    for (let step = 0; isAdvanced && step < PATHWAY_STEPS; step++) {
        const children = [];
        for (const parent of parents) {
            for (const choice of choices) {
                const slug = `${parent}-${choice}`;
                slugs.add(slug);
                children.push(slug);
            }
        }
        parents = children;
    }
    return slugs;
}

/** Gathers all existing record identities across all document collections. */
function getAllExistingIdentities(doc, packId) {
    const identities = new Set();
    for (const k of ALL_KINDS) {
        const list = readKindList(doc, k);
        if (Array.isArray(list)) {
            for (const item of list) {
                if (!item || typeof item !== 'object') continue;
                const id = getRecordIdentity(k, item);
                if (typeof id === 'string' && id) {
                    const norm = normalizeId(id, packId);
                    if (norm) {
                        identities.add(norm);
                        identities.add(`pack.${packId}/${norm}`);
                    }
                }
            }
        }
    }
    return identities;
}

/** Gathers all reserved form IDs for all skills currently in the document, optionally excluding a skill. */
function getAllReservedFormSlugs(doc, packId, excludeSkill = null) {
    const reserved = new Set();
    const skills = Array.isArray(doc?.content?.rules?.[0]?.skills) ? doc.content.rules[0].skills : [];
    const classes = Array.isArray(doc?.content?.rules?.[0]?.classes) ? doc.content.rules[0].classes : [];

    for (const skl of skills) {
        if (!skl || typeof skl !== 'object' || !skl.slug) continue;
        const normSkill = normalizeId(skl.slug, packId);
        if (!normSkill || (excludeSkill && normSkill === excludeSkill)) continue;
        let isAdv = true;
        const owningClass = classes.find(c => c && typeof c === 'object' && Array.isArray(c.skills) && c.skills.some(s => typeof s === 'string' && normalizeId(s, packId) === normSkill));
        if (owningClass && owningClass.tier < MAX_TIER) {
            isAdv = false;
        }
        for (const s of getSkillDerivedFormSlugs(normSkill, isAdv)) {
            reserved.add(s);
            reserved.add(`pack.${packId}/${s}`);
        }
    }

    const branches = Array.isArray(doc?.content?.rules?.[0]?.branches) ? doc.content.rules[0].branches : [];
    for (const br of branches) {
        if (br && typeof br === 'object' && br.slug) {
            if (excludeSkill && normalizeId(br.skill, packId) === excludeSkill) continue;
            const normB = normalizeId(br.slug, packId);
            if (normB) {
                reserved.add(normB);
                reserved.add(`pack.${packId}/${normB}`);
            }
        }
    }
    return reserved;
}

/**
 * Commits a mutated document snapshot through openPack.
 * Reuses openPack's null-document safety outcome to refuse unsafe edits and keep original model.
 */
function commitSnapshot(newDoc, originalModel) {
    const snapshot = openPack(newDoc);
    if (!snapshot || snapshot.document === null) {
        return {
            ok: false,
            model: originalModel,
            errors: (snapshot?.validation?.errors?.length) ? snapshot.validation.errors : [{
                code: 'unsafe-edit',
                path: '',
                message: 'Edit produced unsafe or out-of-limits document',
            }],
        };
    }
    return {
        ok: true,
        model: snapshot,
        undo: () => originalModel,
    };
}

/**
 * Appends a cloned record to the supported collection kind.
 * Rejects duplicate IDs, foreign pack IDs, derived collisions, and unsupported kinds.
 * Exempts missing exact written branch derived from its fromForm/choice for the skill.
 */
export function add(model, kind, record) {
    if (!model || !model.document || typeof model.document !== 'object' || Array.isArray(model.document)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: '', message: 'Model document is missing or invalid' }],
        };
    }

    if (!ALL_KINDS.has(kind)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'unsupported-kind', path: '', message: `Unsupported collection kind: ${kind}` }],
        };
    }

    if (!model.document.content || typeof model.document.content !== 'object' || Array.isArray(model.document.content)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-container', path: 'content', message: 'Document content must be an object' }],
        };
    }

    if (RULES_KINDS.has(kind)) {
        const r = model.document.content.rules;
        if (!Array.isArray(r) || r.length === 0 || !r[0] || typeof r[0] !== 'object' || Array.isArray(r[0])) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-container', path: 'content.rules.0', message: 'Rules container is missing or invalid' }],
            };
        }
        if (r[0][kind] !== undefined && !Array.isArray(r[0][kind])) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-container', path: `content.rules.0.${kind}`, message: `Collection ${kind} container is invalid` }],
            };
        }
    } else if (kind === 'legacySkills') {
        if (model.document.content.skills !== undefined && !Array.isArray(model.document.content.skills)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-container', path: 'content.skills', message: 'Collection skills container is invalid' }],
            };
        }
    } else if (SB_KINDS.has(kind)) {
        if (model.document.content[kind] !== undefined && !Array.isArray(model.document.content[kind])) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-container', path: `content.${kind}`, message: `Collection ${kind} container is invalid` }],
            };
        }
    }

    const validated = validateAndCloneValue(record);
    if (!validated.ok) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-value', path: kind, message: validated.error }],
        };
    }
    const clonedRecord = validated.value;
    if (!clonedRecord || typeof clonedRecord !== 'object' || Array.isArray(clonedRecord)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-value', path: kind, message: 'Record must be a plain object' }],
        };
    }

    const packId = getPackId(model.document);
    const rawId = getRecordIdentity(kind, clonedRecord);
    if (typeof rawId !== 'string' || !rawId.trim()) {
        return {
            ok: false,
            model,
            errors: [{ code: 'missing-id', path: kind, message: `Record missing required identity for kind ${kind}` }],
        };
    }

    if (isForeignId(rawId, packId)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-ref', path: kind, message: `Record identity cannot belong to foreign pack: ${rawId}` }],
        };
    }

    const normId = normalizeId(rawId, packId);
    if (SHARED_RULES_KINDS.has(kind)) {
        const sharedRulesIds = getSharedRulesIdentities(model.document, packId);
        if (sharedRulesIds.has(normId)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'dup-id', path: kind, message: `Duplicate ${kind} id: ${rawId}` }],
            };
        }
    } else {
        const existingList = readKindList(model.document, kind) || [];
        const isDup = existingList.some(item => item && typeof item === 'object' && normalizeId(getRecordIdentity(kind, item), packId) === normId);
        if (isDup) {
            return {
                ok: false,
                model,
                errors: [{ code: 'dup-id', path: kind, message: `Duplicate ${kind} id: ${rawId}` }],
            };
        }
    }

    let isLegitWrittenBranch = false;
    if (kind === 'branches') {
        const fromFormSlug = normalizeId(clonedRecord.fromForm, packId);
        const choice = clonedRecord.choice;
        const normSkill = normalizeId(clonedRecord.skill, packId);
        const expectedSlug = fromFormSlug && clonedRecord.choice ? `${fromFormSlug}-${clonedRecord.choice}` : null;
        if (!expectedSlug || normId !== expectedSlug) {
            return {
                ok: false,
                model,
                errors: [{
                    code: 'bad-branch-id',
                    path: 'content.rules.0.branches',
                    message: `Branch slug must match derived fromForm-choice: ${expectedSlug}`,
                }],
            };
        }
        if (normSkill && fromFormSlug && (fromFormSlug === `${normSkill}-base` || fromFormSlug.startsWith(`${normSkill}-base-`)) && WRITTEN_CHOICES.includes(choice) && !normId.endsWith(`-${GENERATED_CHOICE}`) && !normId.endsWith('-base')) {
            isLegitWrittenBranch = true;
        }
    }

    if (isLegitWrittenBranch) {
        const normSkill = normalizeId(clonedRecord.skill, packId);
        const existingIdentities = getAllExistingIdentities(model.document, packId);
        if (existingIdentities.has(normId)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'dup-id', path: kind, message: `Duplicate id collision: ${rawId}` }],
            };
        }
        const otherReservedForms = getAllReservedFormSlugs(model.document, packId, normSkill);
        if (otherReservedForms.has(normId)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'dup-id', path: kind, message: `Identity ${rawId} collides with reserved form ID of another skill` }],
            };
        }
    } else {
        const reservedForms = getAllReservedFormSlugs(model.document, packId);
        if (reservedForms.has(normId)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'dup-id', path: kind, message: `Identity ${rawId} collides with reserved form ID` }],
            };
        }
    }

    if (kind === 'skills') {
        const nextDerived = getSkillDerivedFormSlugs(normId, true);
        const existingIdentities = getAllExistingIdentities(model.document, packId);
        const reservedForms = getAllReservedFormSlugs(model.document, packId);
        for (const dSlug of nextDerived) {
            if (existingIdentities.has(dSlug) || reservedForms.has(dSlug)) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'dup-id', path: kind, message: `Derived skill form ${dSlug} collides with existing definition` }],
                };
            }
        }
    }

    const newDoc = cloneDoc(model.document);
    const targetList = ensureKindList(newDoc, kind);
    if (!targetList) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-container', path: kind, message: `Could not access container for ${kind}` }],
        };
    }
    targetList.push(clonedRecord);

    return commitSnapshot(newDoc, model);
}

/** Resets a damaged skills container so skills can be added one at a time. */
export function resetClassSkills(model, classId) {
    const refuse = (code, message) => ({ ok: false, model, errors: [{ code, path: 'content.rules.0.classes', message }] });
    if (!model?.document) return refuse('bad-model', 'Open a pack first');
    if (typeof classId !== 'string' || !classId) return refuse('bad-id', 'Choose a class ID');
    const packId = getPackId(model.document);
    const classes = readKindList(model.document, 'classes');
    const index = Array.isArray(classes) ? classes.findIndex(cls => cls && normalizeId(cls.slug, packId) === normalizeId(classId, packId)) : -1;
    if (index < 0) return refuse('not-found', 'Class not found');
    if (Array.isArray(classes[index].skills)) return refuse('bad-value', 'The skills list is already an array');
    return setField(model, ['content', 'rules', 0, 'classes', index, 'skills'], []);
}

/** Creates one owned skill and its authored pathways as a single undoable edit. */
export function addClassSkill(model, classId) {
    const refuse = (code, message) => ({ ok: false, model, errors: [{ code, path: 'content.rules.0.classes', message }] });
    if (!model?.document) return refuse('bad-model', 'Open a pack first');
    if (typeof classId !== 'string' || !classId) return refuse('bad-id', 'Choose a class ID');
    const packId = getPackId(model.document);
    const classes = readKindList(model.document, 'classes');
    const index = Array.isArray(classes) ? classes.findIndex(cls => cls && normalizeId(cls.slug, packId) === normalizeId(classId, packId)) : -1;
    if (index < 0) return refuse('not-found', 'Class not found');
    const cls = classes[index];
    if (!RULES_V2_PROGRESSION.tiers.includes(cls.tier) || !Array.isArray(cls.skills)) return refuse('bad-value', 'Repair the class tier and skills list first');
    if (cls.skills.length >= RULES_V2_PROGRESSION.skillsPerClass) return refuse('class-skills', 'The class already has all its skills');
    const skill = {
        slug: 'new-skill',
        name: '[YOUR SKILL NAME]',
        base: {
            type: 'physical', stat: 'STR', unit: null,
            cost: { mp: 0, sp: 0, cooldown: 0 },
            effects: [{ op: 'damage', target: 'one', power: 1, element: 'none', damageType: 'physical' }],
        },
    };
    // Addition owns all namespace and derived-form collision checks.
    const attempts = getAllExistingIdentities(model.document, packId).size + getAllReservedFormSlugs(model.document, packId).size + 1;
    let result;
    for (let n = 0; n <= attempts; n++) {
        skill.slug = n ? `new-skill-${n}` : 'new-skill';
        result = add(model, 'skills', skill);
        if (result.ok || !result.errors.every(error => error.code === 'dup-id')) break;
    }
    if (!result.ok) return { ...result, model };
    let next = result.model;
    if (cls.tier === MAX_TIER) {
        let parents = [`${skill.slug}-base`];
        for (let step = 1; step <= PATHWAY_STEPS; step++) {
            const children = [];
            for (const parent of parents) {
                for (const choice of WRITTEN_CHOICES) {
                    const slug = `${parent}-${choice}`;
                    result = add(next, 'branches', {
                        slug, skill: skill.slug, fromForm: parent, step, choice,
                        name: '[YOUR FORM NAME]',
                        transforms: step === 1
                            ? [{ op: 'set-element', at: 0, value: choice === WRITTEN_CHOICES[0] ? 'fire' : 'ice' }]
                            : [choice === WRITTEN_CHOICES[0] ? { op: 'set-target', at: 0, value: 'all' } : { op: 'set-element', at: 0, value: 'lightning' }],
                    });
                    if (!result.ok) return { ...result, model };
                    next = result.model;
                    children.push(slug);
                }
                children.push(`${parent}-${GENERATED_CHOICE}`);
            }
            parents = children;
        }
    }
    result = setField(next, ['content', 'rules', 0, 'classes', index, 'skills'], [...cls.skills, skill.slug]);
    return result.ok ? { ...result, undo: () => model } : { ...result, model };
}

/**
 * Renames a record and all inbound typed references atomically.
 * Preserves literal note and name strings and rebases derived skill graphs.
 * Refuses length > 52 for skills and collisions with derived or existing IDs BEFORE mutating.
 */
export function renameId(model, kind, id, nextId) {
    if (!model || !model.document || typeof model.document !== 'object' || Array.isArray(model.document)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: '', message: 'Model document is missing or invalid' }],
        };
    }

    if (!ALL_KINDS.has(kind)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'unsupported-kind', path: '', message: `Unsupported collection kind: ${kind}` }],
        };
    }

    if (kind === 'itemRules') {
        return {
            ok: false,
            model,
            errors: [{
                code: 'identity-field',
                path: 'content.rules.0.itemRules',
                message: 'Cannot rename itemRule identity directly; rename the item instead',
            }],
        };
    }

    const packId = getPackId(model.document);
    if (typeof id !== 'string' || !id.trim()) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-id', path: kind, message: 'Current id must be a non-empty string' }],
        };
    }
    if (typeof nextId !== 'string' || !nextId.trim()) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-id', path: kind, message: 'New id must be a non-empty string' }],
        };
    }

    if (isForeignId(id, packId)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-ref', path: kind, message: `Target id belongs to foreign pack: ${id}` }],
        };
    }
    if (isForeignId(nextId, packId)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-ref', path: kind, message: `Renamed id must stay in same pack: ${nextId}` }],
        };
    }

    const normId = normalizeId(id, packId);
    const normNextId = normalizeId(nextId, packId);

    if (kind === 'skills' && [...normNextId].length > MAX_SKILL_SLUG) {
        return {
            ok: false,
            model,
            errors: [{
                code: 'numeric-range',
                path: 'content.rules.0.skills',
                message: `Skill slug "${normNextId}" exceeds maximum length ${MAX_SKILL_SLUG}`,
            }],
        };
    }

    const isEvents = kind === 'events';
    const isPresetOrTrait = kind === 'races' || kind === 'talents' || kind === 'presets';
    const validSyntax = (isEvents || isPresetOrTrait) ? isValidIdentifier(normNextId) : isValidRawSlug(normNextId);
    if (!validSyntax) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-id', path: kind, message: `Invalid identifier syntax: ${nextId}` }],
        };
    }

    const currentList = readKindList(model.document, kind);
    if (!Array.isArray(currentList)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: kind, message: `No collection found for kind: ${kind}` }],
        };
    }

    const targetIdx = currentList.findIndex(item => item && typeof item === 'object' && normalizeId(getRecordIdentity(kind, item), packId) === normId);
    if (targetIdx < 0) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: kind, message: `Record ${id} not found in ${kind}` }],
        };
    }

    if (kind === 'branches') {
        const br = currentList[targetIdx];
        const fromFormSlug = normalizeId(br?.fromForm, packId);
        const expectedSlug = fromFormSlug && br?.choice ? `${fromFormSlug}-${br.choice}` : null;
        if (!expectedSlug || normNextId !== expectedSlug) {
            return {
                ok: false,
                model,
                errors: [{
                    code: 'bad-branch-id',
                    path: 'content.rules.0.branches',
                    message: `Branch slug must match derived fromForm-choice: ${expectedSlug}`,
                }],
            };
        }
    }

    if (normId !== normNextId) {
        if (SHARED_RULES_KINDS.has(kind)) {
            const sharedRulesIds = getSharedRulesIdentities(model.document, packId, kind, normId);
            if (sharedRulesIds.has(normNextId)) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'dup-id', path: kind, message: `Duplicate id collision: ${nextId}` }],
                };
            }
        } else {
            const isDup = currentList.some(item => item && typeof item === 'object' && normalizeId(getRecordIdentity(kind, item), packId) === normNextId);
            if (isDup) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'dup-id', path: kind, message: `Duplicate id collision: ${nextId}` }],
                };
            }
        }

        const otherReservedForms = getAllReservedFormSlugs(model.document, packId, kind === 'skills' ? normId : null);
        if (otherReservedForms.has(normNextId) || otherReservedForms.has(`pack.${packId}/${normNextId}`)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'dup-id', path: kind, message: `Collision against derived node: ${nextId}` }],
            };
        }

        if (kind === 'skills') {
            const existingIdentities = getAllExistingIdentities(model.document, packId);
            const nextDerived = getSkillDerivedFormSlugs(normNextId, true);
            for (const dSlug of nextDerived) {
                if (existingIdentities.has(dSlug) || existingIdentities.has(`pack.${packId}/${dSlug}`) || otherReservedForms.has(dSlug) || otherReservedForms.has(`pack.${packId}/${dSlug}`)) {
                    return {
                        ok: false,
                        model,
                        errors: [{ code: 'dup-id', path: kind, message: `Derived skill form ${dSlug} collides with existing definition` }],
                    };
                }
            }
        }
    }

    if (normId === normNextId) {
        return {
            ok: true,
            model,
            undo: () => model,
        };
    }

    const newDoc = cloneDoc(model.document);
    const mutableList = ensureKindList(newDoc, kind);
    const record = mutableList[targetIdx];
    const idKey = getIdentityKey(kind, record);
    record[idKey] = normNextId;

    const fullOldId = `pack.${packId}/${normId}`;
    const fullNewId = `pack.${packId}/${normNextId}`;
    const targetKind = getTargetKind(kind);

    if (kind === 'skills') {
        const oldBase = `${normId}-base`;
        const newBase = `${normNextId}-base`;

        const branches = newDoc.content?.rules?.[0]?.branches;
        if (Array.isArray(branches)) {
            for (const br of branches) {
                if (!br || typeof br !== 'object') continue;
                if (normalizeId(br.skill, packId) === normId) {
                    br.skill = normNextId;
                }
                const fSlug = normalizeId(br.fromForm, packId);
                if (typeof fSlug === 'string' && (fSlug === oldBase || fSlug.startsWith(`${oldBase}-`))) {
                    const suffix = fSlug.slice(oldBase.length);
                    br.fromForm = `${newBase}${suffix}`;
                }
                const bSlug = normalizeId(br.slug, packId);
                if (typeof bSlug === 'string' && (bSlug === oldBase || bSlug.startsWith(`${oldBase}-`))) {
                    const suffix = bSlug.slice(oldBase.length);
                    br.slug = `${newBase}${suffix}`;
                }
            }
        }

        const refs = Array.isArray(model.references) ? model.references : [];
        for (const ref of refs) {
            if (ref.targetKind === 'skills' && (ref.targetId === fullOldId || ref.targetId === normId)) {
                setValueAtPath(newDoc, ref.path, normNextId);
            } else if (ref.targetKind === 'forms') {
                const targetSlug = normalizeId(ref.targetId, packId);
                if (typeof targetSlug === 'string' && (targetSlug === oldBase || targetSlug.startsWith(`${oldBase}-`))) {
                    const suffix = targetSlug.slice(oldBase.length);
                    setValueAtPath(newDoc, ref.path, `${newBase}${suffix}`);
                }
            }
        }
    } else if (kind === 'places') {
        const refs = Array.isArray(model.references) ? model.references : [];
        for (const ref of refs) {
            if (ref.targetKind === 'places' && (ref.targetId === fullOldId || ref.targetId === normId)) {
                if (ref.kind === 'routes') {
                    setValueAtPath(newDoc, ref.path, normNextId);
                } else {
                    setValueAtPath(newDoc, ref.path, fullNewId);
                }
            }
        }
    } else {
        const refs = Array.isArray(model.references) ? model.references : [];
        for (const ref of refs) {
            if (ref.targetKind === targetKind && (ref.targetId === fullOldId || ref.targetId === normId)) {
                setValueAtPath(newDoc, ref.path, normNextId);
            }
        }
    }

    return commitSnapshot(newDoc, model);
}

/**
 * Removes a record.
 * When inbound references exist without cascade, refuses with the full reference list.
 * With cascade: true, transitively removes dependent closure without leaving dangling refs.
 */
export function remove(model, kind, id, { cascade = false } = {}) {
    if (!model || !model.document || typeof model.document !== 'object' || Array.isArray(model.document)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: '', message: 'Model document is missing or invalid' }],
        };
    }

    if (!ALL_KINDS.has(kind)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'unsupported-kind', path: '', message: `Unsupported collection kind: ${kind}` }],
        };
    }

    const packId = getPackId(model.document);
    if (typeof id !== 'string' || !id.trim() || isForeignId(id, packId)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: kind, message: `Record not found or foreign: ${id}` }],
        };
    }

    const normId = normalizeId(id, packId);
    const currentList = readKindList(model.document, kind);
    if (!Array.isArray(currentList)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: kind, message: `No collection found for kind: ${kind}` }],
        };
    }

    const targetIdx = currentList.findIndex(item => item && typeof item === 'object' && normalizeId(getRecordIdentity(kind, item), packId) === normId);
    if (targetIdx < 0) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: kind, message: `Record ${id} not found in ${kind}` }],
        };
    }

    const fullTargetId = `pack.${packId}/${normId}`;
    const targetKind = getTargetKind(kind);
    const allRefs = Array.isArray(model.references) ? model.references : [];

    const inboundRefs = allRefs.filter(ref => {
        if (ref.kind === kind && (ref.id === fullTargetId || ref.id === normId)) {
            return false;
        }

        if (kind === 'skills') {
            const oldBase = `${normId}-base`;
            if (ref.targetKind === 'skills' && (ref.targetId === fullTargetId || ref.targetId === normId)) {
                return true;
            }
            if (ref.targetKind === 'forms') {
                const fSlug = normalizeId(ref.targetId, packId);
                return typeof fSlug === 'string' && (fSlug === oldBase || fSlug.startsWith(`${oldBase}-`));
            }
            return false;
        }

        if (kind === 'branches') {
            if (ref.targetKind === 'branches' && (ref.targetId === fullTargetId || ref.targetId === normId)) {
                return true;
            }
            if (ref.targetKind === 'forms' && (ref.targetId === fullTargetId || ref.targetId === normId)) {
                return true;
            }
            return false;
        }

        if (kind === 'itemRules') {
            return false;
        }

        return ref.targetKind === targetKind && (ref.targetId === fullTargetId || ref.targetId === normId);
    });

    if (!cascade) {
        if (inboundRefs.length > 0) {
            return {
                ok: false,
                model,
                errors: [{
                    code: 'referenced',
                    path: kind,
                    message: `Cannot remove ${id}: referenced by ${inboundRefs.length} other record(s)`,
                }],
                references: inboundRefs,
            };
        }

        const newDoc = cloneDoc(model.document);
        const targetList = ensureKindList(newDoc, kind);
        targetList.splice(targetIdx, 1);

        return commitSnapshot(newDoc, model);
    }

    // Generic transitive dependent closure
    const visited = new Set();
    const toDeleteQueue = [{ kind, id: normId }];

    const classesList = Array.isArray(readKindList(model.document, 'classes')) ? readKindList(model.document, 'classes') : [];
    const skillsList = Array.isArray(readKindList(model.document, 'skills')) ? readKindList(model.document, 'skills') : [];
    const branchesList = Array.isArray(readKindList(model.document, 'branches')) ? readKindList(model.document, 'branches') : [];
    const itemRulesList = Array.isArray(readKindList(model.document, 'itemRules')) ? readKindList(model.document, 'itemRules') : [];

    while (toDeleteQueue.length > 0) {
        const item = toDeleteQueue.shift();
        const key = `${item.kind}:${item.id}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const itemFullId = `pack.${packId}/${item.id}`;
        const itemTargetKind = getTargetKind(item.kind);

        // 1. Structural ownership edges
        if (item.kind === 'classes') {
            const cls = classesList.find(c => c && typeof c === 'object' && normalizeId(c.slug, packId) === item.id);
            if (cls && Array.isArray(cls.skills)) {
                for (const s of cls.skills) {
                    const normS = normalizeId(s, packId);
                    if (normS) toDeleteQueue.push({ kind: 'skills', id: normS });
                }
            }
            for (const otherCls of classesList) {
                if (!otherCls || typeof otherCls !== 'object') continue;
                if (normalizeId(otherCls.parent, packId) === item.id) {
                    const normOther = normalizeId(otherCls.slug, packId);
                    if (normOther) toDeleteQueue.push({ kind: 'classes', id: normOther });
                }
            }
        } else if (item.kind === 'skills') {
            const baseForm = `${item.id}-base`;
            for (const br of branchesList) {
                if (!br || typeof br !== 'object') continue;
                const bSkill = normalizeId(br.skill, packId);
                const bFrom = normalizeId(br.fromForm, packId);
                if (bSkill === item.id || (typeof bFrom === 'string' && (bFrom === baseForm || bFrom.startsWith(`${baseForm}-`)))) {
                    const normB = normalizeId(br.slug, packId);
                    if (normB) toDeleteQueue.push({ kind: 'branches', id: normB });
                }
            }
            for (const cls of classesList) {
                if (!cls || typeof cls !== 'object') continue;
                if (Array.isArray(cls.skills) && cls.skills.some(s => normalizeId(s, packId) === item.id)) {
                    const normCls = normalizeId(cls.slug, packId);
                    if (normCls) toDeleteQueue.push({ kind: 'classes', id: normCls });
                }
            }
        } else if (item.kind === 'branches') {
            for (const br of branchesList) {
                if (!br || typeof br !== 'object') continue;
                const bFrom = normalizeId(br.fromForm, packId);
                if (typeof bFrom === 'string' && bFrom === item.id) {
                    const normB = normalizeId(br.slug, packId);
                    if (normB) toDeleteQueue.push({ kind: 'branches', id: normB });
                }
            }
        } else if (item.kind === 'items') {
            for (const ir of itemRulesList) {
                if (!ir || typeof ir !== 'object') continue;
                if (normalizeId(ir.def, packId) === item.id) {
                    const normIR = normalizeId(ir.def, packId);
                    if (normIR) toDeleteQueue.push({ kind: 'itemRules', id: normIR });
                }
            }
        }

        // 2. Inbound references from model.references (owning records dependent on deleted target)
        if (item.kind !== 'itemRules') {
            for (const ref of allRefs) {
                let matches = false;
                if (item.kind === 'skills') {
                    if (ref.targetKind === 'skills' && (ref.targetId === itemFullId || ref.targetId === item.id)) {
                        matches = true;
                    } else if (ref.targetKind === 'forms') {
                        const fSlug = normalizeId(ref.targetId, packId);
                        const baseForm = `${item.id}-base`;
                        if (typeof fSlug === 'string' && (fSlug === baseForm || fSlug.startsWith(`${baseForm}-`))) {
                            matches = true;
                        }
                    }
                } else if (item.kind === 'branches') {
                    if ((ref.targetKind === 'branches' || ref.targetKind === 'forms') && (ref.targetId === itemFullId || ref.targetId === item.id)) {
                        matches = true;
                    }
                } else {
                    if (ref.targetKind === itemTargetKind && (ref.targetId === itemFullId || ref.targetId === item.id)) {
                        matches = true;
                    }
                }

                if (matches && ref.kind !== 'start') {
                    const ownerSlug = normalizeId(ref.id, packId);
                    if (ownerSlug && ALL_KINDS.has(ref.kind)) {
                        toDeleteQueue.push({ kind: ref.kind, id: ownerSlug });
                    }
                }
            }
        }
    }

    const toDeleteByKind = new Map();
    for (const vKey of visited) {
        const [k, vId] = vKey.split(':');
        if (!toDeleteByKind.has(k)) toDeleteByKind.set(k, new Set());
        toDeleteByKind.get(k).add(vId);
    }

    const newDoc = cloneDoc(model.document);

    // Prune primary collections
    function filterCollection(list, kindName) {
        if (!Array.isArray(list)) return list;
        const set = toDeleteByKind.get(kindName);
        if (!set || set.size === 0) return list;
        return list.filter(item => {
            if (!item || typeof item !== 'object') return true;
            const id = getRecordIdentity(kindName, item);
            const norm = normalizeId(id, packId);
            return !set.has(norm);
        });
    }

    if (newDoc.content?.rules?.[0]) {
        const r = newDoc.content.rules[0];
        if (Array.isArray(r.classes)) r.classes = filterCollection(r.classes, 'classes');
        if (Array.isArray(r.skills)) r.skills = filterCollection(r.skills, 'skills');
        if (Array.isArray(r.branches)) r.branches = filterCollection(r.branches, 'branches');
        if (Array.isArray(r.itemRules)) r.itemRules = filterCollection(r.itemRules, 'itemRules');
        if (Array.isArray(r.trainers)) r.trainers = filterCollection(r.trainers, 'trainers');
    }

    if (Array.isArray(newDoc.content?.items)) newDoc.content.items = filterCollection(newDoc.content.items, 'items');
    if (Array.isArray(newDoc.content?.places)) newDoc.content.places = filterCollection(newDoc.content.places, 'places');
    if (Array.isArray(newDoc.content?.creatures)) newDoc.content.creatures = filterCollection(newDoc.content.creatures, 'creatures');
    if (Array.isArray(newDoc.content?.quests)) newDoc.content.quests = filterCollection(newDoc.content.quests, 'quests');
    if (Array.isArray(newDoc.content?.shops)) newDoc.content.shops = filterCollection(newDoc.content.shops, 'shops');
    if (Array.isArray(newDoc.content?.recipes)) newDoc.content.recipes = filterCollection(newDoc.content.recipes, 'recipes');
    if (Array.isArray(newDoc.content?.routes)) newDoc.content.routes = filterCollection(newDoc.content.routes, 'routes');
    if (Array.isArray(newDoc.content?.events)) newDoc.content.events = filterCollection(newDoc.content.events, 'events');
    if (Array.isArray(newDoc.content?.races)) newDoc.content.races = filterCollection(newDoc.content.races, 'races');
    if (Array.isArray(newDoc.content?.talents)) newDoc.content.talents = filterCollection(newDoc.content.talents, 'talents');
    if (Array.isArray(newDoc.content?.presets)) newDoc.content.presets = filterCollection(newDoc.content.presets, 'presets');
    if (Array.isArray(newDoc.content?.skills)) newDoc.content.skills = filterCollection(newDoc.content.skills, 'legacySkills');

    // Start inventory references: prune affected item entries directly
    const visitedItems = toDeleteByKind.get('items');
    if (visitedItems && visitedItems.size > 0 && Array.isArray(newDoc.start?.inventory?.items)) {
        const itemLookup = new Map();
        for (const it of model.document.content?.items || []) {
            if (!it || typeof it !== 'object') continue;
            const target = normalizeId(it.slug || it.id, packId);
            if (it.id) itemLookup.set(it.id, target);
            if (it.slug) itemLookup.set(it.slug, target);
            if (it.name) {
                itemLookup.set(it.name, target);
                itemLookup.set(it.name.trim().toLowerCase(), target);
            }
            if (Array.isArray(it.aliases)) {
                for (const a of it.aliases) {
                    if (typeof a === 'string') {
                        itemLookup.set(a, target);
                        itemLookup.set(a.trim().toLowerCase(), target);
                    }
                }
            }
        }

        newDoc.start.inventory.items = newDoc.start.inventory.items.filter(entry => {
            const rawRef = typeof entry === 'string' ? entry : entry?.item;
            if (typeof rawRef !== 'string') return true;
            const norm = normalizeId(rawRef, packId);
            const resolved = itemLookup.get(rawRef) || itemLookup.get(rawRef.trim().toLowerCase()) || norm;
            return !visitedItems.has(resolved) && !visitedItems.has(norm);
        });
    }

    return commitSnapshot(newDoc, model);
}

/**
 * Moves a class to a new parent in the progression tree.
 * Guards against pre-existing cycles in parent walk and descendant BFS.
 * Computes tiers by actual descendant depth from new parent, rejects noninteger parent tier and >3.
 */
export function moveClass(model, id, parentId) {
    if (!model || !model.document || typeof model.document !== 'object' || Array.isArray(model.document)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: '', message: 'Model document is missing or invalid' }],
        };
    }

    const packId = getPackId(model.document);
    if (typeof id !== 'string' || !id.trim() || isForeignId(id, packId)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: 'content.rules.0.classes', message: `Class not found: ${id}` }],
        };
    }

    const classSlug = normalizeId(id, packId);
    const classes = model.document.content?.rules?.[0]?.classes;
    if (!Array.isArray(classes)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: 'content.rules.0.classes', message: 'No classes collection found' }],
        };
    }

    const cls = classes.find(c => c && typeof c === 'object' && normalizeId(c.slug, packId) === classSlug);
    if (!cls) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: 'content.rules.0.classes', message: `Class ${id} not found` }],
        };
    }

    let newTier = 0;
    let normParent = null;

    if (parentId !== null && parentId !== undefined) {
        if (typeof parentId !== 'string' || !parentId.trim() || isForeignId(parentId, packId)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-ref', path: 'content.rules.0.classes', message: `Parent class not found: ${parentId}` }],
            };
        }

        normParent = normalizeId(parentId, packId);
        if (classSlug === normParent) {
            return {
                ok: false,
                model,
                errors: [{ code: 'tier-chain', path: 'content.rules.0.classes', message: 'Class cannot be its own parent' }],
            };
        }

        const parentCls = classes.find(c => c && typeof c === 'object' && normalizeId(c.slug, packId) === normParent);
        if (!parentCls) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-ref', path: 'content.rules.0.classes', message: `Parent class ${parentId} not found` }],
            };
        }

        if (typeof parentCls.tier !== 'number' || !Number.isInteger(parentCls.tier) || parentCls.tier < 0 || parentCls.tier >= MAX_TIER) {
            return {
                ok: false,
                model,
                errors: [{ code: 'tier-chain', path: 'content.rules.0.classes', message: `Invalid parent class tier: ${parentCls.tier}` }],
            };
        }

        // Guard parent walk with visited set against existing cycles
        const walkVisited = new Set([classSlug]);
        let curr = parentCls;
        while (curr && curr.parent !== null && curr.parent !== undefined) {
            const pSlug = normalizeId(curr.parent, packId);
            if (pSlug === classSlug || walkVisited.has(pSlug)) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'tier-chain', path: 'content.rules.0.classes', message: 'Cyclic class hierarchy detected' }],
                };
            }
            walkVisited.add(pSlug);
            curr = classes.find(c => c && typeof c === 'object' && normalizeId(c.slug, packId) === pSlug);
        }

        newTier = parentCls.tier + 1;
        if (newTier > MAX_TIER) {
            return {
                ok: false,
                model,
                errors: [{ code: 'tier-chain', path: 'content.rules.0.classes', message: `Class tier ${newTier} exceeds tier ${MAX_TIER} limit` }],
            };
        }
    }

    // Guard descendant BFS with visited set and compute tiers by actual depth from new parent
    const descendantTiers = new Map();
    const queue = [{ slug: classSlug, tier: newTier }];
    const visitedDesc = new Set([classSlug]);

    while (queue.length > 0) {
        const { slug: curSlug, tier: curTier } = queue.shift();
        for (const c of classes) {
            if (!c || typeof c !== 'object') continue;
            const cSlug = normalizeId(c.slug, packId);
            const cParent = normalizeId(c.parent, packId);
            if (cParent === curSlug) {
                if (visitedDesc.has(cSlug)) {
                    return {
                        ok: false,
                        model,
                        errors: [{ code: 'tier-chain', path: 'content.rules.0.classes', message: 'Cyclic class hierarchy detected among descendants' }],
                    };
                }
                visitedDesc.add(cSlug);
                const childTier = curTier + 1;
                if (childTier > MAX_TIER) {
                    return {
                        ok: false,
                        model,
                        errors: [{
                            code: 'tier-chain',
                            path: 'content.rules.0.classes',
                            message: `Descendant class ${cSlug} tier ${childTier} exceeds tier ${MAX_TIER} limit`,
                        }],
                    };
                }
                descendantTiers.set(cSlug, childTier);
                queue.push({ slug: cSlug, tier: childTier });
            }
        }
    }

    const newDoc = cloneDoc(model.document);
    const targetClasses = newDoc.content?.rules?.[0]?.classes;
    if (!Array.isArray(targetClasses)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: 'content.rules.0.classes', message: 'No target classes collection found' }],
        };
    }
    const targetCls = targetClasses.find(c => c && typeof c === 'object' && normalizeId(c.slug, packId) === classSlug);
    if (!targetCls) {
        return {
            ok: false,
            model,
            errors: [{ code: 'not-found', path: 'content.rules.0.classes', message: `Class ${id} not found in cloned document` }],
        };
    }
    targetCls.parent = normParent;
    targetCls.tier = newTier;

    for (const [dSlug, dTier] of descendantTiers) {
        const mutD = targetClasses.find(c => c && typeof c === 'object' && normalizeId(c.slug, packId) === dSlug);
        if (mutD) {
            mutD.tier = dTier;
        }
    }

    return commitSnapshot(newDoc, model);
}

/** Checks whether a path directly targets a definition collection container. */
function isDefinitionCollectionPath(path) {
    if (path.length === 1 && path[0] === 'content') return true;
    if (path.length === 2 && path[0] === 'content' && (path[1] === 'rules' || path[1] === 'skills' || SB_KINDS.has(path[1]))) return true;
    if (path.length === 4 && path[0] === 'content' && path[1] === 'rules' && typeof path[2] === 'number' && RULES_KINDS.has(path[3])) return true;
    return false;
}

/** Recursively verifies that existing definition identities are not altered or removed when replacing an ancestor. */
function checkAncestorIdentitiesPreserved(oldContainer, newContainer, packId) {
    if (!oldContainer || typeof oldContainer !== 'object' || !newContainer || typeof newContainer !== 'object') {
        return false;
    }
    for (const kind of RULES_KINDS) {
        const oldList = oldContainer[kind];
        if (Array.isArray(oldList)) {
            const newList = newContainer[kind];
            if (!Array.isArray(newList)) return false;
            for (const oldItem of oldList) {
                if (!oldItem || typeof oldItem !== 'object') continue;
                const oldId = normalizeId(getRecordIdentity(kind, oldItem), packId);
                if (!oldId) continue;
                const found = newList.some(newItem => newItem && typeof newItem === 'object' && normalizeId(getRecordIdentity(kind, newItem), packId) === oldId);
                if (!found) return false;
            }
        }
    }
    if (Array.isArray(oldContainer.rules)) {
        if (!Array.isArray(newContainer.rules)) return false;
        for (let rIdx = 0; rIdx < oldContainer.rules.length; rIdx++) {
            const oldR = oldContainer.rules[rIdx];
            const newR = newContainer.rules[rIdx];
            if (!checkAncestorIdentitiesPreserved(oldR, newR, packId)) return false;
        }
    }
    for (const kind of SB_KINDS) {
        const oldList = oldContainer[kind];
        if (Array.isArray(oldList)) {
            const newList = newContainer[kind];
            if (!Array.isArray(newList)) return false;
            for (const oldItem of oldList) {
                if (!oldItem || typeof oldItem !== 'object') continue;
                const oldId = normalizeId(getRecordIdentity(kind, oldItem), packId);
                if (!oldId) continue;
                const found = newList.some(newItem => newItem && typeof newItem === 'object' && normalizeId(getRecordIdentity(kind, newItem), packId) === oldId);
                if (!found) return false;
            }
        }
    }
    if (Array.isArray(oldContainer.skills)) {
        const newList = newContainer.skills;
        if (!Array.isArray(newList)) return false;
        for (const oldItem of oldContainer.skills) {
            if (!oldItem || typeof oldItem !== 'object') continue;
            const oldId = normalizeId(getRecordIdentity('legacySkills', oldItem), packId);
            if (!oldId) continue;
            const found = newList.some(newItem => newItem && typeof newItem === 'object' && normalizeId(getRecordIdentity('legacySkills', newItem), packId) === oldId);
            if (!found) return false;
        }
    }
    return true;
}

/**
 * Replaces or sets a field at a structured path rooted in the document.
 * Refuses identity field modifications, unsafe keys, getters, non-JSON values, and array index errors.
 * Traverses only own properties and valid numeric array indices at every segment.
 */
export function setField(model, path, value) {
    if (!model || !model.document || typeof model.document !== 'object' || Array.isArray(model.document)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-model', path: '', message: 'Model document is missing or invalid' }],
        };
    }

    if (!Array.isArray(path)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: 'Path must be a non-empty array' }],
        };
    }

    // Inspect and safely clone path BEFORE for-of, join, or getter invocations
    const validatedPath = validateAndCloneValue(path);
    if (!validatedPath.ok || !Array.isArray(validatedPath.value)) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: validatedPath.error || 'Path must be a plain array' }],
        };
    }

    const safePath = validatedPath.value;
    if (safePath.length === 0) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: 'Path must be a non-empty array' }],
        };
    }

    if (safePath.length > 32) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: '', message: 'Path exceeds maximum supported depth' }],
        };
    }

    let pathParent = model.document;
    for (let i = 0; i < safePath.length; i++) {
        const seg = safePath[i];
        if (typeof seg !== 'string' && typeof seg !== 'number') {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: '', message: 'Path segments must be strings or numbers' }],
            };
        }
        if (typeof seg === 'number' && !Number.isFinite(seg)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: '', message: 'Path numeric segments must be finite' }],
            };
        }
        if (typeof seg === 'string' && UNSAFE_KEYS.has(seg)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'unsafe-key', path: '', message: `Unsafe path segment: ${seg}` }],
            };
        }
        // Traversal accepts canonical numeric strings as array indices. Identity guards
        // must see the same path, including when a record or its ancestor is replaced.
        if (Array.isArray(pathParent) && typeof seg === 'string') {
            const index = Number(seg);
            if (Number.isInteger(index) && index >= 0 && String(index) === seg) safePath[i] = index;
        }
        pathParent = pathParent !== null && typeof pathParent === 'object'
            ? Object.getOwnPropertyDescriptor(pathParent, safePath[i])?.value
            : undefined;
    }

    const pathStr = safePath.join('.');
    const last = safePath[safePath.length - 1];

    if (safePath.length === 1 && last === 'id') {
        return {
            ok: false,
            model,
            errors: [{ code: 'identity-field', path: 'id', message: 'Cannot modify pack id directly; use renameId instead' }],
        };
    }
    if (last === 'slug' || last === 'id' || (last === 'def' && safePath.includes('itemRules'))) {
        return {
            ok: false,
            model,
            errors: [{
                code: 'identity-field',
                path: pathStr,
                message: `Cannot modify identity field "${last}" directly; use renameId instead`,
            }],
        };
    }

    if (isDefinitionCollectionPath(safePath)) {
        return {
            ok: false,
            model,
            errors: [{
                code: 'identity-field',
                path: pathStr,
                message: `Cannot replace collection "${last}" directly; use add, remove, renameId, or leaf setField instead`,
            }],
        };
    }

    const validated = validateAndCloneValue(value);
    if (!validated.ok) {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-value', path: pathStr, message: validated.error }],
        };
    }

    const packId = getPackId(model.document);

    // Guard direct replacement of identity-bearing definition records
    const isRecordPath = (safePath.length === 5 && safePath[0] === 'content' && safePath[1] === 'rules' && typeof safePath[2] === 'number' && RULES_KINDS.has(safePath[3]) && typeof safePath[4] === 'number')
        || (safePath.length === 3 && safePath[0] === 'content' && (SB_KINDS.has(safePath[1]) || safePath[1] === 'skills') && typeof safePath[2] === 'number');

    if (isRecordPath) {
        if (validated.value === null || typeof validated.value !== 'object' || Array.isArray(validated.value)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot replace identity-bearing record with null, non-object, or array' }],
            };
        }
        const recordKind = safePath.length === 5 ? safePath[3] : (safePath[1] === 'skills' ? 'legacySkills' : safePath[1]);
        const existingRecord = safePath.length === 5
            ? model.document.content?.rules?.[safePath[2]]?.[safePath[3]]?.[safePath[4]]
            : (safePath[1] === 'skills' ? model.document.content?.skills?.[safePath[2]] : model.document.content?.[safePath[1]]?.[safePath[2]]);

        if (existingRecord && typeof existingRecord === 'object') {
            const oldId = normalizeId(getRecordIdentity(recordKind, existingRecord), packId);
            const newId = normalizeId(getRecordIdentity(recordKind, validated.value), packId);
            if (!newId || newId !== oldId) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot modify or remove identity field through structural replacement; use renameId instead' }],
                };
            }
        }
    }

    // Guard ancestor containers against removal or alteration of existing identities
    const isAncestorPath = (safePath.length === 3 && safePath[0] === 'content' && safePath[1] === 'rules' && typeof safePath[2] === 'number')
        || (safePath.length === 2 && safePath[0] === 'content' && safePath[1] === 'rules')
        || (safePath.length === 1 && safePath[0] === 'content');

    if (isAncestorPath) {
        let oldContainer = model.document;
        for (const seg of safePath) {
            oldContainer = oldContainer?.[seg];
        }
        if (!checkAncestorIdentitiesPreserved(oldContainer, validated.value, packId)) {
            return {
                ok: false,
                model,
                errors: [{
                    code: 'identity-field',
                    path: pathStr,
                    message: 'Existing identities cannot be changed or removed when replacing an ancestor container; use renameId or remove',
                }],
            };
        }
    }

    const newDoc = cloneDoc(model.document);
    let curr = newDoc;

    for (let i = 0; i < safePath.length - 1; i++) {
        const seg = safePath[i];

        if (Array.isArray(curr)) {
            const idx = typeof seg === 'number' ? seg : Number(seg);
            if (!Number.isInteger(idx) || idx < 0 || String(idx) !== String(seg) || idx >= curr.length) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-index', path: pathStr, message: `Invalid array index segment: ${seg}` }],
                };
            }
            const desc = Object.getOwnPropertyDescriptor(curr, String(idx));
            if (!desc || desc.get || desc.set) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Accessor on array index: ${seg}` }],
                };
            }
            curr = curr[idx];
        } else if (curr !== null && typeof curr === 'object') {
            if (typeof seg !== 'string') {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Object key must be string, got: ${typeof seg}` }],
                };
            }
            if (!Object.prototype.hasOwnProperty.call(curr, seg)) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Parent path segment not found: ${seg}` }],
                };
            }
            const desc = Object.getOwnPropertyDescriptor(curr, seg);
            if (!desc || desc.get || desc.set) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'bad-path', path: pathStr, message: `Accessor on property key: ${seg}` }],
                };
            }
            curr = curr[seg];
        } else {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: pathStr, message: 'Parent is not an object or array' }],
            };
        }
    }

    if (curr === null || typeof curr !== 'object') {
        return {
            ok: false,
            model,
            errors: [{ code: 'bad-path', path: pathStr, message: 'Parent is not an object or array' }],
        };
    }

    if (Array.isArray(curr)) {
        if (last === 'length') {
            return {
                ok: false,
                model,
                errors: [{ code: 'out-of-bounds', path: pathStr, message: 'Cannot set array length directly' }],
            };
        }
        const idx = typeof last === 'number' ? last : Number(last);
        if (!Number.isInteger(idx) || idx < 0 || String(idx) !== String(last)) {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-index', path: pathStr, message: 'Array index must be a non-negative integer' }],
            };
        }
        if (idx >= curr.length) {
            return {
                ok: false,
                model,
                errors: [{ code: 'out-of-bounds', path: pathStr, message: 'Array index out of bounds' }],
            };
        }

        const existingItem = curr[idx];
        if (existingItem !== null && typeof existingItem === 'object' && validated.value !== null && typeof validated.value === 'object') {
            const oldId = existingItem.slug ?? existingItem.id ?? existingItem.def;
            const newId = validated.value.slug ?? validated.value.id ?? validated.value.def;
            if (oldId !== undefined && oldId !== newId) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot modify identity field through structural replacement; use renameId instead' }],
                };
            }
        }

        curr[idx] = validated.value;
    } else {
        if (typeof last !== 'string') {
            return {
                ok: false,
                model,
                errors: [{ code: 'bad-path', path: pathStr, message: 'Object key must be string' }],
            };
        }

        const existingField = curr[last];
        if (existingField !== null && typeof existingField === 'object' && validated.value !== null && typeof validated.value === 'object') {
            const oldId = existingField.slug ?? existingField.id ?? existingField.def;
            const newId = validated.value.slug ?? validated.value.id ?? validated.value.def;
            if (oldId !== undefined && oldId !== newId) {
                return {
                    ok: false,
                    model,
                    errors: [{ code: 'identity-field', path: pathStr, message: 'Cannot modify identity field through structural replacement; use renameId instead' }],
                };
            }
        }

        curr[last] = validated.value;
    }

    return commitSnapshot(newDoc, model);
}

/** Schema-driven edits share one guard; the pure engine still supports damaged drafts. */
export function setSchemaField(model, path, value, scope) {
    const safePath = validateAndCloneValue(path);
    const safeValue = validateAndCloneValue(value);
    if (!safePath.ok || !Array.isArray(safePath.value) || !safeValue.ok) return setField(model, path, value);
    path = safePath.value;
    if (path.some(key => typeof key === 'string' && UNSAFE_KEYS.has(key))) return setField(model, path, value);
    let rootPath = scope?.rootPath;
    let schema = scope?.rootSchema;
    if (!rootPath) {
        const rules = path[0] === 'content' && path[1] === 'rules' && RULES_KINDS.has(path[3]);
        const kind = rules ? path[3] : path[1] === 'skills' ? 'legacySkills' : path[1];
        rootPath = path[0] === 'content' && schemaForKind(kind) ? path.slice(0, rules ? 5 : 3) : [];
        schema = rootPath.length ? schemaForKind(kind) : { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } };
    }
    let current = model?.document;
    for (const key of rootPath) current = current?.[key];
    const checked = validateChange(schema, current, path.slice(rootPath.length), safeValue.value);
    if (!checked.ok) return { ok: false, model, errors: [{ ...checked, path: path.join('.') }] };
    return setField(model, path, safeValue.value);
}
