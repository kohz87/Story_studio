import { safeLabel } from './dom.js';
export { identity } from './identity.js';
export const RULES_KINDS = new Set(['classes', 'skills', 'branches', 'itemRules', 'trainers']);
export const KINDS = ['classes', 'skills', 'items', 'creatures', 'places', 'quests', 'shops', 'trainers', 'branches', 'itemRules', 'recipes', 'events', 'routes', 'races', 'talents', 'presets', 'legacySkills'];
export const LABELS = { classes: 'Classes', skills: 'Skills', items: 'Items', creatures: 'Foes', places: 'Places', quests: 'Quests', shops: 'Shops', trainers: 'Trainers', branches: 'Branches', itemRules: 'Item rules', recipes: 'Recipes', events: 'Events', routes: 'Routes', races: 'Races', talents: 'Talents', presets: 'Presets', legacySkills: 'Legacy skills' };
export function kindPath(kind) {
    return RULES_KINDS.has(kind) ? ['content', 'rules', 0, kind] : ['content', kind === 'legacySkills' ? 'skills' : kind];
}
export function records(model, kind) {
    let value = model?.document;
    for (const key of kindPath(kind)) value = value?.[key];
    return Array.isArray(value) ? value : [];
}
export function localId(model, id) {
    const prefix = `pack.${safeLabel(model?.document?.id)}/`;
    return typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

// Whether a record is a template (a base the narrator offers scaled or filled in) or fixed (exactly as written):
// foes are templates, shops and trainers are fixed, and a quest is a template when it is open. Other kinds have neither.
export const TRAITS = { template: 'Template', fixed: 'Fixed' };
export function trait(kind, record) {
    if (kind === 'creatures') return 'template';
    if (kind === 'shops' || kind === 'trainers') return 'fixed';
    if (kind === 'quests') return record?.open === true ? 'template' : 'fixed';
    return null;
}
