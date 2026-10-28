import { safeLabel } from './dom.js';
export { identity } from './identity.js';
export const KINDS = ['places', 'routes', 'events', 'items', 'creatures', 'races', 'talents', 'presets', 'legacySkills'];
export const CASCADE_KINDS = [...KINDS, 'shops', 'recipes', 'quests'];
export const LABELS = { places: 'Places', routes: 'Routes', events: 'Events', items: 'Items', creatures: 'People / creatures', races: 'Races', talents: 'Talents', presets: 'Presets', legacySkills: 'Skills' };
export function kindPath(kind) { return ['content', kind === 'legacySkills' ? 'skills' : kind]; }
export function records(model, kind) {
    const key = kind === 'legacySkills' ? 'skills' : kind;
    const list = model?.document?.content?.[key];
    return Array.isArray(list) ? list : [];
}
export function localId(model, id) {
    const prefix = `pack.${safeLabel(model?.document?.id)}/`;
    return typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
