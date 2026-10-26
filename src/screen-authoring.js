// Authoring goes through the pack importer, including its deliberately open layout envelope.
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { SCREEN_FIELDS, MOUNTS, PACK_FIELDS } from '../vendor/story-block/src/v2/packs/limits.js';
import { standardWidgets } from '../vendor/story-block/src/v2/view/widgets/index.js';
import { NODE_TYPES } from '../vendor/story-block/src/v2/layout/schema.js';
import { openPack } from './model.js';

export { SCREEN_FIELDS, MOUNTS, NODE_TYPES, standardWidgets };

// PACKS.md has no module-settings field. Keep the empty catalogue explicit rather than advertising
// reader settings as pack defaults. A future host schema must add the transport before these can ship.
export const SETTINGS_DEFAULTS = Object.freeze([]);
export const hasSettingsTransport = PACK_FIELDS.includes('settings');

export function checkDefaults(model, requested) {
    return validatePack({ ...model.document, ...requested });
}

export function replacePresentation(model, field, value) {
    if (!['screens', 'layouts'].includes(field) || !model?.document) {
        return { ok: false, model, errors: [{ code: 'bad-edit', path: String(field), message: 'Choose screens or layouts in an open pack.' }] };
    }
    const candidate = { ...model.document, [field]: value };
    const checked = validatePack(candidate);
    if (!checked.ok) return { ok: false, model, errors: checked.errors };
    const next = openPack(candidate);
    if (!next.document || !next.validation.ok) return { ok: false, model, errors: next.validation.errors };
    return { ok: true, model: next, undo: () => model };
}

// Documented query examples from PACKS.md, TEMPLATES.md, LAYOUTS.md, WIDGETS.md and MODULES.md.
// Queries are names, never callbacks: Studio answers them only from the sample JSON.
export const QUERIES = Object.freeze([
    ['party.pc', 'RPG Battle', 'Player character'], ['party.actor', 'RPG Battle', 'Actor by id or name'],
    ['party.combatNumbers', 'RPG Battle', 'Actor numbers with gear'], ['party.ranks', 'RPG Battle', 'Rank ladder'], ['party.actors', 'RPG Battle', 'Party members'],
    ['party.creation', 'RPG Battle', 'Character creation choices'], ['party.offers', 'RPG Battle', 'Party offers'],
    ['party.encumbered', 'RPG Battle', 'Carry status'], ['items.carry', 'RPG Battle', 'Capacity from items'],
    ['items.usable', 'RPG Battle', 'Usable items for an actor'], ['items.gear', 'RPG Battle', 'Equipped gear'],
    ['combat.offers', 'RPG Battle', 'Encounter offers'], ['combat.session', 'RPG Battle', 'Current fight view'],
    ['combat.foesBeaten', 'RPG Battle', 'Foes beaten since a reply'],
    ['director.time', 'Story Director', 'Story clock'], ['director.threads', 'Story Director', 'Thread list'],
    ['director.thread', 'Story Director', 'Thread by key'], ['quest.progress', 'Story Director', 'Quest progress'],
    ['quest.details', 'Story Director', 'Quest details'], ['quest.ranks', 'Story Director', 'Quest rank ladder'],
    ['scene.place', 'Story Block', 'Current place'], ['scene.map', 'Story Block', 'Known places'],
    ['inventory.items', 'Story Block', 'Item stacks'], ['inventory.wallet', 'Story Block', 'Wallet'],
    ['inventory.economy', 'Story Block', 'Effective money scale'],
    ['npc.present', 'NPC State Delta', 'Present NPCs'], ['npc.dossier', 'NPC State Delta', 'Dossier by name'],
    ['npc.known', 'NPC State Delta', 'Known NPCs'], ['npc.portrait', 'NPC State Delta', 'Portrait by name'],
    ...['list', 'content', 'markets', 'crafts', 'calendar', 'weather', 'economy', 'rules', 'item', 'start']
        .map(name => [`packs.${name}`, 'Story Block', `Pack ${name}`]),
    ['events.status', 'Story Block', 'Event status'],
]);

export const SAMPLE = Object.freeze({
    state: { v: 2, meta: {}, domains: { scene: { place: { name: 'Sample village' } } } },
    draft: {}, settings: {}, ops: [],
    queries: {
        'party.pc': { name: 'River', level: 3, hp: { cur: 24, max: 30 } },
        'inventory.items': [{ id: 'rope', name: 'Rope', qty: 2 }, { id: 'torch', name: 'Torch', qty: 1 }],
        'scene.place': { name: 'Sample village' },
    },
});

export function escapeMarkup(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function elementSnippet(tag, text, condition = '', each = '') {
    if (!['section', 'div', 'p', 'span', 'h2', 'ul', 'li', 'button', 'input'].includes(tag)) throw new Error('Choose a palette element.');
    const attrs = `${condition ? ` data-if="${escapeMarkup(condition)}"` : ''}${each ? ` data-each="${escapeMarkup(each)}"` : ''}`;
    return `<${tag}${attrs}>${escapeMarkup(text)}${tag === 'input' ? '' : `</${tag}>`}`;
}

export function widgetSnippet(name, props) {
    if (!Object.hasOwn(standardWidgets, name)) throw new Error('Choose a standard widget.');
    return `<ss-widget name="${name}" data-props="${escapeMarkup(JSON.stringify(props))}"></ss-widget>`;
}
