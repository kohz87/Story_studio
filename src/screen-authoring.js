// Authoring goes through the pack importer, including its deliberately open layout envelope.
import { validatePack } from './data-modules/sb-adapter.js';
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

// The queries the suite's modules answer, under the module that answers them (PACKS.md, TEMPLATES.md, LAYOUTS.md,
// MODULES.md). Queries are names, never callbacks: Studio answers them only from the sample JSON. Another module's
// query is typed into the screen's data by hand.
export const QUERIES = Object.freeze([
    ['scene.place', 'Story Block', 'Current place'], ['scene.present', 'Story Block', 'Who is here'],
    ['director.time', 'Story Director', 'Story clock'], ['director.threads', 'Story Director', 'Thread list'],
    ['director.thread', 'Story Director', 'Thread by key'],
    ['inventory.items', 'Story Block', 'Item stacks'], ['inventory.wallet', 'Story Block', 'Wallet'],
    ['inventory.economy', 'Story Block', 'Effective money scale'],
    ['npc.present', 'NPC State Delta', 'Present NPCs'], ['npc.dossier', 'NPC State Delta', 'Dossier by name'],
    ['npc.known', 'NPC State Delta', 'Known NPCs'], ['npc.portrait', 'NPC State Delta', 'Portrait by name'],
    ...['list', 'content', 'markets', 'crafts', 'calendar', 'weather', 'economy', 'item', 'start']
        .map(name => [`packs.${name}`, 'Story Block', `Pack ${name}`]),
    ['events.status', 'Story Block', 'Event status'],
]);

// The commands a reader's button may run in the suite, with the payload for a row of `inventory.items` (the ones Story
// Block's own Inventory screen uses). Commands that make items or money (`inventory.grant`, `wallet.receive`) are refused
// from a button, so the builder never offers them; another module's command is typed into the node by hand.
export const UI_COMMANDS = Object.freeze([
    ['inventory.drop', 'Drop one', { stack: '$item.stack', qty: 1 }],
    ['inventory.equip', 'Equip', { stack: '$item.stack' }],
    ['inventory.unequip', 'Unequip', { stack: '$item.stack' }],
]);

export const SAMPLE = Object.freeze({
    state: { v: 2, meta: {}, domains: { scene: { place: { name: 'Sample village' } } } },
    draft: {}, settings: {}, ops: [],
    queries: {
        'inventory.items': [
            { stack: 'it_sample01', def: 'story/rope', name: 'Rope', kind: 'goods', qty: 2, owner: 'party', equipped: null, note: '' },
            { stack: 'it_sample02', def: 'story/torch', name: 'Torch', kind: 'goods', qty: 1, owner: 'party', equipped: null, note: '' },
        ],
        'scene.place': { name: 'Sample village' },
        'scene.present': ['Hollis'],
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
