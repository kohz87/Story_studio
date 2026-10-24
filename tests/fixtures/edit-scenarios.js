// Edit scenarios fixture: data-only scenario descriptions for editor operations and history.

import { makeValidExtendedPack } from './builders.js';

/** Helper to append a valid class, its 3 skills, and branches (for tier 3) to a pack. */
function addClassWithSkills(pack, slug, name, tier, parent, skillPrefix) {
    const skillSlugs = [0, 1, 2].map(n => `${skillPrefix}${n}`);
    pack.content.rules[0].classes.push({
        slug,
        name,
        tier,
        parent,
        skills: skillSlugs,
        note: '',
    });
    for (const sSlug of skillSlugs) {
        pack.content.rules[0].skills.push({
            slug: sSlug,
            name: sSlug,
            base: {
                type: 'physical',
                stat: 'STR',
                unit: null,
                cost: { mp: 0, sp: 1, cooldown: 0 },
                effects: [{ op: 'damage', target: 'one', power: 20 * (tier + 1), element: 'none', damageType: 'physical' }],
            },
        });
        if (tier === 3) {
            const base = `${sSlug}-base`;
            for (const p of [base, ...['g', 'a', 'b'].map(c => `${base}-${c}`)]) {
                const step = p === base ? 1 : 2;
                for (const choice of ['a', 'b']) {
                    const transforms = step === 1
                        ? [{ op: 'set-element', at: 0, value: choice === 'a' ? 'fire' : 'ice' }]
                        : [choice === 'a' ? { op: 'set-target', at: 0, value: 'all' } : { op: 'set-element', at: 0, value: 'lightning' }];
                    pack.content.rules[0].branches.push({
                        slug: `${p}-${choice}`,
                        name: `${p}-${choice}`,
                        skill: sSlug,
                        fromForm: p,
                        step,
                        choice,
                        transforms,
                    });
                }
            }
        }
    }
}

/**
 * Returns a fresh array of edit scenario definitions (pure data).
 * Each scenario carries:
 *   - name: identifier for the scenario
 *   - pack: valid starting pack document
 *   - steps: sequence of pure edit operations
 *   - expected: concrete expected values, paths, and undo verification data
 *
 * @returns {Array<{ name: string, pack: object, steps: Array<object>, expected: object }>}
 */
export function editScenarios() {
    return [
        // 1. Rename advanced skill including its 8 written branches and generated parent references
        {
            name: 'rename-advanced-skill-graph',
            pack: (() => {
                const p = makeValidExtendedPack();
                return p;
            })(),
            steps: [
                {
                    op: 'renameId',
                    kind: 'skills',
                    id: 's30',
                    nextId: 's30-empowered',
                },
            ],
            expected: {
                skillSlug: 's30-empowered',
                classSkills: ['s30-empowered', 's31', 's32'],
                trainerSkills: ['s30-empowered'],
                branchCount: 24,
                s30BranchSlugs: [
                    's30-empowered-base-a',
                    's30-empowered-base-b',
                    's30-empowered-base-g-a',
                    's30-empowered-base-g-b',
                    's30-empowered-base-a-a',
                    's30-empowered-base-a-b',
                    's30-empowered-base-b-a',
                    's30-empowered-base-b-b',
                ],
                s30BranchFromForms: [
                    's30-empowered-base',
                    's30-empowered-base',
                    's30-empowered-base-g',
                    's30-empowered-base-g',
                    's30-empowered-base-a',
                    's30-empowered-base-a',
                    's30-empowered-base-b',
                    's30-empowered-base-b',
                ],
                s30BranchSkills: [
                    's30-empowered',
                    's30-empowered',
                    's30-empowered',
                    's30-empowered',
                    's30-empowered',
                    's30-empowered',
                    's30-empowered',
                    's30-empowered',
                ],
            },
        },

        // 2. Rename referenced item across itemRules, creatures, shops, recipes, and quests
        {
            name: 'rename-referenced-item',
            pack: (() => {
                const p = makeValidExtendedPack();
                return p;
            })(),
            steps: [
                {
                    op: 'renameId',
                    kind: 'items',
                    id: 'potion',
                    nextId: 'healing-elixir',
                },
            ],
            expected: {
                itemSlug: 'healing-elixir',
                itemRuleDef: 'healing-elixir',
                creatureLootDef: 'healing-elixir',
                shopStockItem: 'healing-elixir',
                recipeMakes: 'healing-elixir',
                recipeMaterialItem: 'healing-elixir',
                questRewardItemDef: 'healing-elixir',
            },
        },

        // 3. Rename local place with mixed-case place-name, alias, and route references
        {
            name: 'rename-local-place-and-routes',
            pack: (() => {
                const p = makeValidExtendedPack();
                p.content.places = [
                    {
                        slug: 'haven',
                        name: 'hAvEn hArBoR',
                        aliases: ['pOrT hAvEn', 'Old Haven'],
                        x: 0,
                        y: 0,
                    },
                    {
                        slug: 'mill',
                        name: 'Windmill Outpost',
                        aliases: ['The Mill'],
                        x: 1,
                        y: 0,
                    },
                ];
                p.content.routes = [
                    {
                        slug: 'harbor-to-mill',
                        kind: 'road',
                        from: 'hAvEn hArBoR',
                        to: 'mill',
                    },
                    {
                        slug: 'mill-to-port',
                        kind: 'road',
                        from: 'mill',
                        to: 'pOrT hAvEn',
                    },
                    {
                        slug: 'direct-slug-route',
                        kind: 'road',
                        from: 'haven',
                        to: 'mill',
                    },
                ];
                return p;
            })(),
            steps: [
                {
                    op: 'renameId',
                    kind: 'places',
                    id: 'haven',
                    nextId: 'sanctuary',
                },
            ],
            expected: {
                placeSlug: 'sanctuary',
                shopPlace: 'pack.fixture/sanctuary',
                trainerPlace: 'pack.fixture/sanctuary',
                questTurnInPlace: 'pack.fixture/sanctuary',
                routeFromHavenName: 'sanctuary',
                routeToHavenAlias: 'sanctuary',
                routeFromHavenSlug: 'sanctuary',
            },
        },

        // 4. Rename referenced class updating child parent link
        {
            name: 'rename-referenced-class',
            pack: (() => {
                const p = makeValidExtendedPack();
                return p;
            })(),
            steps: [
                {
                    op: 'renameId',
                    kind: 'classes',
                    id: 'c0',
                    nextId: 'apprentice',
                },
            ],
            expected: {
                classSlug: 'apprentice',
                childClassParent: 'apprentice',
            },
        },

        // 5. Refused referenced deletion without cascade
        {
            name: 'refused-referenced-deletion',
            pack: (() => {
                const p = makeValidExtendedPack();
                return p;
            })(),
            steps: [
                {
                    op: 'remove',
                    kind: 'items',
                    id: 'potion',
                    cascade: false,
                },
            ],
            expected: {
                refused: true,
                errorCode: 'referenced',
                minReferencesCount: 5,
            },
        },

        // 6. Cascade deletion removing item and its inbound dependents (itemRules and shops)
        {
            name: 'cascade-deletion',
            pack: (() => {
                const p = makeValidExtendedPack();
                return p;
            })(),
            steps: [
                {
                    op: 'remove',
                    kind: 'items',
                    id: 'greatsword',
                    cascade: true,
                },
            ],
            expected: {
                removedItemId: 'greatsword',
                itemRemainingCount: 2,
                itemRuleRemainingCount: 2,
                shopRemainingCount: 0,
            },
        },

        // 7. Move class to new legal parent
        {
            name: 'move-class-parent',
            pack: (() => {
                const p = makeValidExtendedPack();
                // Two tier-2 parents under c1: original c2 and new c2b.
                // Original c2 needs two advanced children: c3 and c3b.
                // New c2b needs >= 1 advanced children: c3c.
                // Then move c3 from c2 to c2b, leaving both parents non-leaf.
                addClassWithSkills(p, 'c3b', 'Class 3B', 3, 'c2', 's3b');
                addClassWithSkills(p, 'c2b', 'Class 2B', 2, 'c1', 's2b');
                addClassWithSkills(p, 'c3c', 'Class 3C', 3, 'c2b', 's3c');
                return p;
            })(),
            steps: [
                {
                    op: 'moveClass',
                    classId: 'c3',
                    newParentId: 'c2b',
                },
            ],
            expected: {
                classSlug: 'c3',
                newParent: 'c2b',
                newTier: 3,
                leafTier: 3,
            },
        },

        // 8. Safe invalid set then undo restoring exact snapshot, bytes, rulesHash, and packHash
        {
            name: 'safe-invalid-set-then-undo',
            pack: (() => {
                const p = makeValidExtendedPack();
                return p;
            })(),
            steps: [
                {
                    op: 'setField',
                    path: ['content', 'rules', 0, 'skills', 0, 'base', 'effects', 0, 'power'],
                    value: -50,
                },
            ],
            expected: {
                invalidErrorCode: 'numeric-range',
                invalidPower: -50,
                restoredPower: 20,
            },
        },
    ];
}
