// The two complete packs from DATA_MODULES.md §6 and §7, as parsed JSON and as the original text.
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8');
export const factionsText = () => read('ersveil-factions');
export const survivalText = () => read('ersveil-survival');
export const factions = () => JSON.parse(factionsText());
export const survival = () => JSON.parse(survivalText());

/** A pack with two modules: the survival module plus a second module that imports its export (cross-module import). */
export function linked() {
    const pack = survival();
    pack.requires.capabilities = ['data-modules-v1', 'story-director'];
    pack.content.dataModules.push({
        slug: 'fatigue-watch', name: 'Fatigue watch', schema: 1, stateVersion: 1, scope: 'chat',
        imports: { needs: { query: 'dataModules.public', args: { module: 'pack.ersveil-survival/survival', export: 'needs', who: 'ca_wessel' }, mode: 'prefix', projection: ['fatigue'] } },
        state: { warned: { type: 'bool', default: false } },
        kinds: {},
        rules: [{ id: 'tired', when: ['ge', ['input', 'needs', 'fatigue'], 50], then: [{ op: 'set', path: ['warned'], value: true }] }],
        screens: [{ id: 'watch', title: 'Watch', mounts: ['tab'], layout: { root: { type: 'text', label: 'Warned', bind: { query: 'dataModules.view', args: { module: 'pack.ersveil-survival/fatigue-watch' }, path: 'chat.warned' } } } }],
    });
    return pack;
}
