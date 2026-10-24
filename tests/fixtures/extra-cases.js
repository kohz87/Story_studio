// Additional rules-pack boundary fixtures.
// Pure builders for oversized files/graphs, exact parent tests, legendary provenance metadata,
// descendant numeric closure, xp constants, and missing capabilities.

import { smallRulesPack } from './smallRulesPack.js';
import { makeValidExtendedPack } from './builders.js';

/** Oversized file fixture exceeding 512 KiB raw boundary. */
export function makeOversizedFilePack() {
    const pack = makeValidExtendedPack();
    pack.content.places = Array.from({ length: 600 }, (_, i) => ({
        slug: `place-${i}`,
        name: 'P'.repeat(70),
        note: '界'.repeat(500),
        x: i,
        y: i,
    }));
    return pack;
}

/** Oversized graph fixture: > 1000 rules branches, safely under 512 KiB. */
export function makeOversizedGraphPack() {
    const pack = makeValidExtendedPack();
    const template = JSON.parse(JSON.stringify(pack.content.rules[0].branches[0]));
    pack.content.rules[0].branches = Array.from({ length: 1005 }, () => JSON.parse(JSON.stringify(template)));
    return pack;
}

/** Parent error fixtures for missing, foreign, wrong skill, wrong step, and generated-parent mismatch. */
export function makeParentErrorPack(type) {
    const pack = makeValidExtendedPack();
    switch (type) {
        case 'missing-parent':
            pack.content.rules[0].branches[0].fromForm = 'missing-parent';
            break;
        case 'foreign-parent':
            pack.content.rules[0].branches[0].fromForm = 'pack.other/s30-base';
            break;
        case 'wrong-skill-parent':
            pack.content.rules[0].branches[0].fromForm = 's31-base';
            break;
        case 'wrong-step-parent':
            pack.content.rules[0].branches[2].fromForm = 's30-base';
            break;
        case 'generated-parent-mismatch': {
            const p = smallRulesPack();
            const b = p.content.rules[0].branches.find(br => br.slug === 's30-base-g-a');
            if (b) b.fromForm = 's30-base-a';
            return p;
        }
        default:
            throw new Error(`Unknown parent error type: ${type}`);
    }
    return pack;
}

/** Authored legendary item with injected runtime/generated provenance authoring metadata. */
export function makeLegendaryProvenancePack() {
    const pack = makeValidExtendedPack();
    pack.content.items[0].rarity = 'legendary';
    pack.content.items[0].name = 'Excalibur';
    pack.content.rules[0].itemRules[0].provenance = {
        author: 'legendary',
        generated: true,
        source: 'procedural-forge',
    };
    return pack;
}

/** Positive control: authored legendary item without injected authoring metadata. */
export function makeLegendaryPositiveControlPack() {
    const pack = makeValidExtendedPack();
    pack.content.items[0].rarity = 'legendary';
    pack.content.items[0].name = 'Excalibur';
    return pack;
}

/** Descendant generation numeric closure: condition rounds: 6 generating rounds: 7 exceeding limit 6. */
export function makeDescendantNumericClosurePack() {
    const pack = smallRulesPack();
    const branchS30A = pack.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    branchS30A.transforms = [{
        op: 'replace-effect',
        at: 0,
        value: { op: 'condition', target: 'one', kind: 'poison', chance: 25, rounds: 6 },
    }];
    for (const b of pack.content.rules[0].branches) {
        if (b.step === 2 && b.fromForm === 's30-base-a') {
            b.transforms = [{
                op: 'replace-effect',
                at: 0,
                value: {
                    op: 'damage',
                    target: 'one',
                    power: 80,
                    element: b.choice === 'a' ? 'fire' : 'ice',
                    damageType: 'physical',
                },
            }];
        }
    }
    return pack;
}

/** Positive control: condition rounds: 5 generating rounds: 6, within limit 6. */
export function makeDescendantNumericClosurePositivePack() {
    const pack = smallRulesPack();
    const branchS30A = pack.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    branchS30A.transforms = [{
        op: 'replace-effect',
        at: 0,
        value: { op: 'condition', target: 'one', kind: 'poison', chance: 25, rounds: 5 },
    }];
    for (const b of pack.content.rules[0].branches) {
        if (b.step === 2 && b.fromForm === 's30-base-a') {
            b.transforms = [{
                op: 'replace-effect',
                at: 0,
                value: {
                    op: 'damage',
                    target: 'one',
                    power: 80,
                    element: b.choice === 'a' ? 'fire' : 'ice',
                    damageType: 'physical',
                },
            }];
        }
    }
    return pack;
}

/** XP constants fixtures. */
export function makeXpPack(xpPerLevel) {
    const pack = makeValidExtendedPack();
    return { pack, constants: { xpPerLevel } };
}

/** Missing capability on pack: requires.capabilities = []. */
export function makeMissingCapabilityPack() {
    const pack = makeValidExtendedPack();
    pack.requires.capabilities = [];
    return pack;
}

/** Clean independent generated item collision fixture. */
export function makeCleanItemCollisionPack() {
    const pack = smallRulesPack();
    pack.content.items = [{ slug: 's30-base-g', name: 'Collision', kind: 'material', rarity: 'common', value: 1 }];
    pack.content.rules[0].itemRules = [{ def: 's30-base-g', allowedSlots: [], hands: 0, requires: {}, weight: 1 }];
    return pack;
}
