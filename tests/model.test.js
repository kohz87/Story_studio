// Pack model tests: openPack, exportPack, and indexReferences (pure).

import test from 'node:test';
import assert from 'node:assert/strict';

import { openPack, exportPack, indexReferences, rulesV2Schema } from '../src/model.js';
import {
    exportRulesV2,
    validateRulesPack,
    RULES_V2_CONSTANTS,
} from '../vendor/story-block/src/v2/packs/rules-v2.js';

/** Local smallRulesPack helper matching SPEC §10 golden seed tree. */
function smallRulesPack(options = {}) {
    const classes = [];
    const skills = [];
    const branches = [];

    for (let tier = 0; tier < 4; tier++) {
        const names = [0, 1, 2].map(n => `s${tier}${n}`);
        classes.push({
            slug: `c${tier}`,
            name: `Class ${tier}`,
            tier,
            parent: tier ? `c${tier - 1}` : null,
            skills: names,
        });

        for (const slug of names) {
            skills.push({
                slug,
                name: slug,
                base: {
                    type: 'physical',
                    stat: 'STR',
                    unit: null,
                    cost: { mp: 0, sp: 1, cooldown: 0 },
                    effects: [{
                        op: 'damage',
                        target: 'one',
                        power: 20 * (tier + 1),
                        element: 'none',
                        damageType: 'physical',
                    }],
                },
            });

            if (tier !== 3) continue;

            const base = `${slug}-base`;
            for (const parent of [base, ...['g', 'a', 'b'].map(c => `${base}-${c}`)]) {
                const step = parent === base ? 1 : 2;
                for (const choice of ['a', 'b']) {
                    const transforms = step === 1
                        ? [{ op: 'set-element', at: 0, value: choice === 'a' ? 'fire' : 'ice' }]
                        : [choice === 'a' ? { op: 'set-target', at: 0, value: 'all' } : { op: 'set-element', at: 0, value: 'lightning' }];
                    branches.push({
                        slug: `${parent}-${choice}`,
                        name: `${parent}-${choice}`,
                        skill: slug,
                        fromForm: parent,
                        step,
                        choice,
                        transforms,
                    });
                }
            }
        }
    }

    return {
        id: options.id ?? 'fixture',
        version: options.version ?? '2.0.0',
        name: options.name ?? 'Fixture',
        requires: options.requires ?? { storyBlock: '^2', capabilities: ['rb-rules-v2'] },
        content: {
            rules: [{
                slug: 'rules',
                name: 'Fixture rules',
                schema: 2,
                classes: options.classes ?? classes,
                skills: options.skills ?? skills,
                branches: options.branches ?? branches,
                itemRules: options.itemRules ?? [],
                trainers: options.trainers ?? [],
                ...(options.statLabels ? { statLabels: options.statLabels } : {}),
            }],
            items: options.items ?? [],
            creatures: options.creatures ?? [],
            shops: options.shops ?? [],
            recipes: options.recipes ?? [],
            quests: options.quests ?? [],
            places: options.places ?? [
                { slug: 'haven', name: 'Haven', x: 0, y: 0 },
                { slug: 'mill', name: 'Mill', x: 1, y: 0 },
            ],
        },
    };
}

test('golden seed tree structure: 4 tiers, 3 skills/class (12 total), 24 branches', () => {
    const pack = smallRulesPack();
    const manifest = pack.content.rules[0];

    assert.equal(manifest.classes.length, 4);
    assert.equal(manifest.skills.length, 12);
    assert.equal(manifest.branches.length, 24);

    for (let t = 0; t < 4; t++) {
        assert.equal(manifest.classes[t].tier, t);
        assert.equal(manifest.classes[t].skills.length, 3);
        if (t === 0) {
            assert.equal(manifest.classes[t].parent, null);
        } else {
            assert.equal(manifest.classes[t].parent, `c${t - 1}`);
        }
    }

    const model = openPack(pack);
    assert.equal(model.validation.ok, true);
    assert.equal(model.validation.errors.length, 0);
    assert.ok(typeof model.hash === 'string' && model.hash.length === 64);
});

test('canonical round trip twice equals shared exporter and hash parity', () => {
    const pack = smallRulesPack();
    const sharedExp = exportRulesV2(pack);
    assert.equal(sharedExp.ok, true);

    // First round trip: open authored pack object -> export
    const model1 = openPack(pack);
    assert.equal(model1.validation.ok, true);
    assert.equal(model1.hash, sharedExp.hash);

    const text1 = exportPack(model1);
    assert.equal(text1, sharedExp.text);

    // Second round trip: open exported canonical text -> export again
    const model2 = openPack(text1);
    assert.equal(model2.validation.ok, true);
    assert.equal(model2.hash, model1.hash);
    assert.deepEqual(model2.document, model1.document);

    const text2 = exportPack(model2);
    assert.equal(text2, text1);
    assert.equal(text2, sharedExp.text);
});

test('authored class/skill/branch/effect/transform array order is strictly retained', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    const docManifest = model.document.content.rules[0];
    const origManifest = pack.content.rules[0];

    // Class order
    assert.deepEqual(
        docManifest.classes.map(c => c.slug),
        origManifest.classes.map(c => c.slug)
    );

    // Skill order
    assert.deepEqual(
        docManifest.skills.map(s => s.slug),
        origManifest.skills.map(s => s.slug)
    );

    // Branch order
    assert.deepEqual(
        docManifest.branches.map(b => b.slug),
        origManifest.branches.map(b => b.slug)
    );

    // Effect order within skills
    for (let i = 0; i < origManifest.skills.length; i++) {
        assert.deepEqual(
            docManifest.skills[i].base.effects,
            origManifest.skills[i].base.effects
        );
    }

    // Transform order within branches
    for (let i = 0; i < origManifest.branches.length; i++) {
        assert.deepEqual(
            docManifest.branches[i].transforms,
            origManifest.branches[i].transforms
        );
    }

    // Object keys are sorted alphabetically
    const keys = Object.keys(docManifest.classes[0]);
    const sortedKeys = [...keys].sort();
    assert.deepEqual(keys, sortedKeys);
});

test('caller inputs are never mutated; returned model is immutable snapshot', () => {
    const pack = smallRulesPack();
    const rawSnapshot = JSON.stringify(pack);

    const model = openPack(pack);

    // Caller pack was not mutated or frozen
    assert.equal(Object.isFrozen(pack), false);
    assert.equal(JSON.stringify(pack), rawSnapshot);

    // Modifying caller input does not affect model
    pack.name = 'Mutated';
    assert.notEqual(model.document.name, 'Mutated');

    // Model and internal structures are deeply frozen
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.document));
    assert.ok(Object.isFrozen(model.validation));
    assert.ok(Object.isFrozen(model.references));

    assert.throws(() => {
        model.document.name = 'Illegal';
    }, TypeError);

    assert.throws(() => {
        model.validation.ok = false;
    }, TypeError);
});

test('malformed JSON returns null document, structured errors, and export throws', () => {
    const badJson = '{ "id": "broken", invalid }';
    const model = openPack(badJson);

    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.equal(model.hash, null);
    assert.deepEqual(model.references, []);
    assert.ok(model.validation.errors.length > 0);
    assert.equal(model.validation.errors[0].code, 'bad-schema');

    // Exporting invalid model throws Error with errors property
    assert.throws(
        () => exportPack(model),
        err => {
            assert.ok(err instanceof Error);
            assert.ok(Array.isArray(err.errors));
            assert.equal(err.errors[0].code, 'bad-schema');
            return true;
        }
    );

    // Non-object inputs also produce structured errors
    for (const nonObj of [null, 123, 'not a json', []]) {
        const m = openPack(nonObj);
        assert.equal(m.document, null);
        assert.equal(m.validation.ok, false);
        assert.ok(m.validation.errors.length > 0);
        assert.throws(() => exportPack(m));
    }
});

test('invalid documents remain editable with checker errors and indexed references', () => {
    const broken = smallRulesPack();
    // Invalidate class hierarchy: tier 1 parent points to non-existent class
    broken.content.rules[0].classes[1].parent = 'nonexistent';

    const model = openPack(broken);

    assert.equal(model.validation.ok, false);
    assert.ok(model.validation.errors.length > 0);
    assert.equal(model.hash, null);

    // Authored document is preserved safely for editing
    assert.ok(model.document !== null);
    assert.equal(model.document.content.rules[0].classes[1].parent, 'nonexistent');

    // Caller object is NOT frozen
    assert.equal(Object.isFrozen(broken), false);
    assert.ok(Object.isFrozen(model.document));

    // References are still safely indexed
    assert.ok(Array.isArray(model.references));
    assert.ok(model.references.length > 0);

    const badRef = model.references.find(
        r => r.kind === 'classes' && r.path.join('.') === 'content.rules.0.classes.1.parent'
    );
    assert.ok(badRef);
    assert.equal(badRef.targetId, 'pack.fixture/nonexistent');

    // Export throws Error with checker errors
    assert.throws(
        () => exportPack(model),
        err => {
            assert.ok(err instanceof Error);
            assert.deepEqual(err.errors, model.validation.errors);
            return true;
        }
    );
});

test('complete reference paths including generated parent form, foreign place/NPC, literal names untouched', () => {
    // Construct rich pack exercising all typed reference varieties with valid canonical place IDs
    const pack = smallRulesPack({
        items: [
            { slug: 'sword', name: 'Iron Sword', kind: 'equipment', rarity: 'common', value: 50, slot: 'weapon' },
            { slug: 'potion', name: 'Healing Potion', kind: 'consumable', rarity: 'common', value: 10 },
            { slug: 'ingot', name: 'Iron Ingot', kind: 'material', rarity: 'common', value: 5 },
        ],
        itemRules: [
            { def: 'sword', allowedSlots: ['weapon'], hands: 1, requires: { STR: 5 }, weight: 20 },
            { def: 'potion', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
            { def: 'ingot', allowedSlots: [], hands: 0, requires: {}, weight: 5 },
        ],
        trainers: [{
            slug: 'master-swordsman',
            name: 'Master Swordsman',
            place: 'pack.fixture/haven',
            skills: ['s00', 's10'],
            fee: 100,
            minutes: 60,
            eventTemplates: ['event-duel'],
        }],
        creatures: [{
            slug: 'goblin',
            name: 'Cave Goblin',
            tier: 1,
            level: 3,
            stats: { STR: 8, VIT: 6, AGI: 10, DEX: 8, INT: 4, LUK: 5, CHA: 3 },
            skills: ['s00'],
            loot: [{ def: 'potion', chance: 50, qty: 1 }],
            loreTags: ['cave', 'goblinoid'],
        }],
        quests: [{
            slug: 'mill-defense',
            name: 'Defend the Mill',
            category: 'side',
            giver: 'np_00000001', // Foreign NSD NPC ID
            turnInPlace: 'pl_00000001', // Foreign place ID
            requirements: [
                { kind: 'class', classes: ['c0'] },
                { kind: 'item', def: 'sword', qty: 1 },
                { kind: 'quest', template: 'mill-defense' },
                { kind: 'place', place: 'pack.fixture/haven' },
                { kind: 'thread', thread: 'th_00000001' }, // Foreign thread ID
            ],
            objectives: [
                { id: 'ob_00000001', kind: 'kill', foe: 'goblin', count: 3 },
                { id: 'ob_00000002', kind: 'collect', def: 'ingot', count: 2, consume: false },
                { id: 'ob_00000003', kind: 'visit', place: 'pack.fixture/mill' },
                { id: 'ob_00000004', kind: 'story', text: 'Talk to the injured scout' },
            ],
            reward: {
                coin: 100,
                xp: 50,
                items: [{ def: 'potion', qty: 2 }],
            },
            chain: { previous: null, next: 'mill-defense' },
            durationMinutes: 1440,
            repeat: null,
        }],
        shops: [{
            slug: 'haven-armory',
            name: 'Haven Armory',
            place: 'pack.fixture/haven',
            kind: 'general',
            stock: [{ item: 'sword', qty: 5, price: 50 }],
        }],
        recipes: [{
            slug: 'craft-sword',
            name: 'Forge Sword',
            craft: 'smithing',
            makes: 'sword',
            qty: 1,
            materials: [{ item: 'ingot', qty: 3 }],
            fee: 10,
            minutes: 30,
            dc: 12,
            stat: 'STR+DEX',
        }],
    });

    // Add SB routes, events (omitting after rather than null), and start inventory
    pack.content.routes = [
        { slug: 'road-haven-mill', from: 'haven', to: 'mill', kind: 'road' },
    ];
    pack.content.events = [
        { id: 'event-duel', when: 'always', cue: 'Duel at noon', once: true },
    ];
    pack.start = {
        inventory: {
            items: [{ item: 'sword', qty: 1 }],
        },
    };

    // Assert shared validateRulesPack(pack).ok true BEFORE testing positive index behavior
    const valCheck = validateRulesPack(pack);
    assert.equal(
        valCheck.ok,
        true,
        `Expected valid rich pack, got errors: ${JSON.stringify(valCheck.errors)}`
    );

    const refs = indexReferences(pack);
    assert.ok(refs.length > 50);

    // 1. Class parent and skills
    const c1Parent = refs.find(r => r.kind === 'classes' && r.id === 'pack.fixture/c1' && r.targetKind === 'classes');
    assert.deepEqual(c1Parent, {
        kind: 'classes',
        id: 'pack.fixture/c1',
        path: ['content', 'rules', 0, 'classes', 1, 'parent'],
        targetKind: 'classes',
        targetId: 'pack.fixture/c0',
    });

    const c0Skill = refs.find(r => r.kind === 'classes' && r.id === 'pack.fixture/c0' && r.targetKind === 'skills');
    assert.deepEqual(c0Skill, {
        kind: 'classes',
        id: 'pack.fixture/c0',
        path: ['content', 'rules', 0, 'classes', 0, 'skills', 0],
        targetKind: 'skills',
        targetId: 'pack.fixture/s00',
    });

    // 2. Branch skill and fromForm (including generated parent form)
    const baseBranch = refs.find(r => r.kind === 'branches' && r.id === 'pack.fixture/s30-base-a' && r.targetKind === 'forms');
    assert.deepEqual(baseBranch, {
        kind: 'branches',
        id: 'pack.fixture/s30-base-a',
        path: ['content', 'rules', 0, 'branches', 0, 'fromForm'],
        targetKind: 'forms',
        targetId: 'pack.fixture/s30-base',
    });

    // Generated parent form s30-base-g
    const genBranch = refs.find(r => r.kind === 'branches' && r.id === 'pack.fixture/s30-base-g-a' && r.targetKind === 'forms');
    assert.ok(genBranch);
    assert.equal(genBranch.targetId, 'pack.fixture/s30-base-g');
    assert.equal(genBranch.targetKind, 'forms');
    assert.deepEqual(genBranch.path.slice(-1), ['fromForm']);

    // 3. Item rules
    const swordRule = refs.find(r => r.kind === 'itemRules' && r.id === 'pack.fixture/sword');
    assert.deepEqual(swordRule, {
        kind: 'itemRules',
        id: 'pack.fixture/sword',
        path: ['content', 'rules', 0, 'itemRules', 0, 'def'],
        targetKind: 'items',
        targetId: 'pack.fixture/sword',
    });

    // 4. Trainer place, skills, eventTemplates
    const trnPlace = refs.find(r => r.kind === 'trainers' && r.targetKind === 'places');
    assert.deepEqual(trnPlace, {
        kind: 'trainers',
        id: 'pack.fixture/master-swordsman',
        path: ['content', 'rules', 0, 'trainers', 0, 'place'],
        targetKind: 'places',
        targetId: 'pack.fixture/haven',
    });

    const trnEvt = refs.find(r => r.kind === 'trainers' && r.targetKind === 'events');
    assert.deepEqual(trnEvt, {
        kind: 'trainers',
        id: 'pack.fixture/master-swordsman',
        path: ['content', 'rules', 0, 'trainers', 0, 'eventTemplates', 0],
        targetKind: 'events',
        targetId: 'pack.fixture/event-duel',
    });

    // 5. Creature skills and loot
    const foeSkill = refs.find(r => r.kind === 'creatures' && r.targetKind === 'skills');
    assert.deepEqual(foeSkill, {
        kind: 'creatures',
        id: 'pack.fixture/goblin',
        path: ['content', 'creatures', 0, 'skills', 0],
        targetKind: 'skills',
        targetId: 'pack.fixture/s00',
    });

    const foeLoot = refs.find(r => r.kind === 'creatures' && r.targetKind === 'items');
    assert.deepEqual(foeLoot, {
        kind: 'creatures',
        id: 'pack.fixture/goblin',
        path: ['content', 'creatures', 0, 'loot', 0, 'def'],
        targetKind: 'items',
        targetId: 'pack.fixture/potion',
    });

    // 6. Quest giver (foreign NSD NPC preserved) and turnInPlace (foreign place preserved)
    const qGiver = refs.find(r => r.kind === 'quests' && r.path.join('.') === 'content.quests.0.giver');
    assert.deepEqual(qGiver, {
        kind: 'quests',
        id: 'pack.fixture/mill-defense',
        path: ['content', 'quests', 0, 'giver'],
        targetKind: 'npcs',
        targetId: 'np_00000001', // Foreign NPC ID preserved unchanged
    });

    const qTurnIn = refs.find(r => r.kind === 'quests' && r.path.join('.') === 'content.quests.0.turnInPlace');
    assert.deepEqual(qTurnIn, {
        kind: 'quests',
        id: 'pack.fixture/mill-defense',
        path: ['content', 'quests', 0, 'turnInPlace'],
        targetKind: 'places',
        targetId: 'pl_00000001', // Foreign place ID preserved unchanged
    });

    // 7. Quest requirements: class, item, quest, internal place, foreign thread
    const qReqClass = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('requirements.0.classes'));
    assert.equal(qReqClass.targetId, 'pack.fixture/c0');

    const qReqItem = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('requirements.1.def'));
    assert.equal(qReqItem.targetId, 'pack.fixture/sword');

    const qReqPlace = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('requirements.3.place'));
    assert.equal(qReqPlace.targetId, 'pack.fixture/haven');

    const qReqThread = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('requirements.4.thread'));
    assert.deepEqual(qReqThread, {
        kind: 'quests',
        id: 'pack.fixture/mill-defense',
        path: ['content', 'quests', 0, 'requirements', 4, 'thread'],
        targetKind: 'threads',
        targetId: 'th_00000001', // Foreign thread ID preserved unchanged
    });

    // 8. Quest objectives: kill (foe), collect (def), visit (place)
    const objKill = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('objectives.0.foe'));
    assert.equal(objKill.targetId, 'pack.fixture/goblin');
    assert.equal(objKill.targetKind, 'creatures');

    const objCollect = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('objectives.1.def'));
    assert.equal(objCollect.targetId, 'pack.fixture/ingot');
    assert.equal(objCollect.targetKind, 'items');

    const objVisit = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('objectives.2.place'));
    assert.equal(objVisit.targetId, 'pack.fixture/mill');
    assert.equal(objVisit.targetKind, 'places');

    // Literal text in objective 3 ('Talk to the injured scout') is NOT indexed
    const textRef = refs.find(r => r.targetId?.includes('scout') || r.targetId?.includes('injured'));
    assert.equal(textRef, undefined, 'Literal story text must not be treated as a reference');

    // 9. Quest reward item & chain
    const qRewardItem = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('reward.items.0.def'));
    assert.equal(qRewardItem.targetId, 'pack.fixture/potion');

    const qChainNext = refs.find(r => r.kind === 'quests' && r.path.join('.').includes('chain.next'));
    assert.equal(qChainNext.targetId, 'pack.fixture/mill-defense');

    // 10. Shop place and stock item
    const shopPlace = refs.find(r => r.kind === 'shops' && r.targetKind === 'places');
    assert.equal(shopPlace.targetId, 'pack.fixture/haven');

    const shopStock = refs.find(r => r.kind === 'shops' && r.targetKind === 'items');
    assert.equal(shopStock.targetId, 'pack.fixture/sword');

    // 11. Recipe makes and materials
    const recipeMakes = refs.find(r => r.kind === 'recipes' && r.path.join('.').includes('makes'));
    assert.equal(recipeMakes.targetId, 'pack.fixture/sword');

    const recipeMat = refs.find(r => r.kind === 'recipes' && r.path.join('.').includes('materials.0.item'));
    assert.equal(recipeMat.targetId, 'pack.fixture/ingot');

    // 12. Routes from / to
    const routeFrom = refs.find(r => r.kind === 'routes' && r.path.join('.').includes('from'));
    assert.equal(routeFrom.targetId, 'pack.fixture/haven');

    const routeTo = refs.find(r => r.kind === 'routes' && r.path.join('.').includes('to'));
    assert.equal(routeTo.targetId, 'pack.fixture/mill');

    // 13. Start inventory items
    const startItem = refs.find(r => r.kind === 'start');
    assert.deepEqual(startItem, {
        kind: 'start',
        id: 'pack.fixture/start',
        path: ['start', 'inventory', 'items', 0, 'item'],
        targetKind: 'items',
        targetId: 'pack.fixture/sword',
    });

    // Rich pack round trip through openPack and exportPack
    const richModel = openPack(pack);
    assert.equal(richModel.validation.ok, true);
    assert.equal(richModel.validation.errors.length, 0);
    const richExport = exportPack(richModel);
    assert.ok(richExport.length > 0);
    const richModel2 = openPack(richExport);
    assert.equal(richModel2.validation.ok, true);
    assert.equal(exportPack(richModel2), richExport);
});

test('indexing handles invalid plain document safely without throwing', () => {
    const brokenDoc = {
        id: 'broken-pack',
        content: {
            rules: [{
                slug: 'rules',
                classes: [
                    null,
                    { slug: 'c0', parent: null, skills: null },
                    { slug: 'c1', parent: 'c0', skills: ['s0', 123, null] },
                ],
                skills: [
                    { slug: 's0', base: { unit: { class: 'c0' } } },
                ],
                branches: [
                    { slug: 'b0', skill: 's0', fromForm: 's0-base' },
                ],
                itemRules: [
                    { def: 'iron-sword' },
                ],
                trainers: [
                    { slug: 't0', place: 'unknown-place', skills: ['s0'], eventTemplates: ['evt0'] },
                ],
            }],
            creatures: [
                { slug: 'f0', skills: ['s0'], loot: [{ def: 'iron-sword' }] },
            ],
            quests: [
                {
                    slug: 'q0',
                    giver: 'np_00000001',
                    turnInPlace: 'pl_00000001',
                    requirements: [
                        { kind: 'class', classes: ['c0'] },
                        { kind: 'item', def: 'iron-sword' },
                        { kind: 'quest', template: 'q0' },
                        { kind: 'place', place: 'pl_00000001' },
                        { kind: 'thread', thread: 'th_00000001' },
                    ],
                    objectives: [
                        { kind: 'kill', foe: 'f0' },
                        { kind: 'collect', def: 'iron-sword' },
                        { kind: 'visit', place: 'pl_00000001' },
                    ],
                    reward: { items: [{ def: 'iron-sword' }] },
                    chain: { previous: 'q_prev', next: null },
                },
            ],
            shops: [
                { slug: 'sh0', place: 'pl_00000001', stock: [{ item: 'iron-sword' }] },
            ],
            recipes: [
                { slug: 'rc0', makes: 'iron-sword', materials: [{ item: 'iron-ore' }] },
            ],
            routes: [
                { slug: 'rt0', from: 'pl_00000001', to: 'pl_00000002' },
            ],
            events: [
                { id: 'ev0', after: 'ev_prev' },
            ],
            presets: [
                { slug: 'pr0', race: 'human', talents: ['strong'], skills: ['s0'] },
            ],
        },
        start: {
            inventory: {
                items: [{ item: 'iron-sword' }],
            },
        },
    };

    const refs = indexReferences(brokenDoc);
    assert.ok(Array.isArray(refs));
    assert.ok(refs.length > 0);

    // Completely empty / null / primitive inputs safely return empty array
    assert.deepEqual(indexReferences(null), []);
    assert.deepEqual(indexReferences(undefined), []);
    assert.deepEqual(indexReferences(''), []);
    assert.deepEqual(indexReferences(123), []);
    assert.deepEqual(indexReferences({}), []);
});

test('rulesV2Schema export is frozen schema definition', () => {
    assert.ok(rulesV2Schema);
    assert.equal(rulesV2Schema.$id, 'urn:story-suite:rb-rules-v2:manifest');
    assert.ok(Object.isFrozen(rulesV2Schema));
});

// Regression 1: quest.giver targetKind is npcs with exact authored value (no creature-name guesses)
test('quest.giver is explicitly external NSD NPC id with targetKind npcs preserving exact authored value', () => {
    const pack = {
        id: 'fixture',
        content: {
            creatures: [
                { slug: 'guide', name: 'Guide Creature' },
            ],
            quests: [
                { slug: 'q-suffix', giver: 'guide' },
                { slug: 'q-foreign', giver: 'pack.npc/guide' },
                { slug: 'q-canon', giver: 'np_00000001' },
            ],
        },
    };

    const refs = indexReferences(pack);

    // NPC and creature sharing local suffix 'guide': giver is npcs, not creatures
    const qSuffix = refs.find(r => r.path.join('.') === 'content.quests.0.giver');
    assert.deepEqual(qSuffix, {
        kind: 'quests',
        id: 'pack.fixture/q-suffix',
        path: ['content', 'quests', 0, 'giver'],
        targetKind: 'npcs',
        targetId: 'guide',
    });

    // Foreign pack.npc/guide unchanged
    const qForeign = refs.find(r => r.path.join('.') === 'content.quests.1.giver');
    assert.deepEqual(qForeign, {
        kind: 'quests',
        id: 'pack.fixture/q-foreign',
        path: ['content', 'quests', 1, 'giver'],
        targetKind: 'npcs',
        targetId: 'pack.npc/guide',
    });

    // Canonical np_00000001 unchanged
    const qCanon = refs.find(r => r.path.join('.') === 'content.quests.2.giver');
    assert.deepEqual(qCanon, {
        kind: 'quests',
        id: 'pack.fixture/q-canon',
        path: ['content', 'quests', 2, 'giver'],
        targetKind: 'npcs',
        targetId: 'np_00000001',
    });
});

// Regression 2: safeClone boundary checks, getters, cycles, shared plain objects, functions
test('safeClone handles 10,000 nested objects without RangeError, returning null document with checker errors', () => {
    let deep = { id: 'fixture' };
    let curr = deep;
    for (let i = 0; i < 10000; i++) {
        curr.nested = {};
        curr = curr.nested;
    }

    const model = openPack(deep);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.ok(model.validation.errors.some(e => e.code === 'too-large'));
    assert.deepEqual(model.references, []);

    // indexReferences on deep document also safely returns [] without throwing
    assert.deepEqual(indexReferences(deep), []);
});

test('safeClone preserves duplicated shared (noncyclic) plain objects without treating them as cycles', () => {
    const sameObject = { slug: 'sword', name: 'Iron Sword', kind: 'goods', value: 10 };
    const doc = {
        id: 'fixture',
        content: {
            items: [sameObject, sameObject],
        },
    };

    const model = openPack(doc);
    assert.ok(model.document !== null);
    assert.equal(model.document.content.items.length, 2);
    assert.deepEqual(model.document.content.items[0], sameObject);
    assert.deepEqual(model.document.content.items[1], sameObject);
    assert.notEqual(model.document.content.items[1], null);
});

test('getters on input objects must never run and yield document null', () => {
    let getterRan = false;
    const badObj = {
        id: 'fixture',
        get exploit() {
            getterRan = true;
            return 'malicious';
        },
    };

    const model = openPack(badObj);
    assert.equal(getterRan, false, 'Getter must not run during openPack');
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);

    const refs = indexReferences(badObj);
    assert.equal(getterRan, false, 'Getter must not run during indexReferences');
    assert.deepEqual(refs, []);
});

test('unsafe own __proto__ property yields document null', () => {
    const unsafeProto = JSON.parse('{"id":"fixture","__proto__":{"polluted":true}}');
    const model = openPack(unsafeProto);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(indexReferences(unsafeProto), []);
});

test('cycles yield document null without throwing', () => {
    const cyclic = { id: 'fixture' };
    cyclic.self = cyclic;

    const model = openPack(cyclic);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(indexReferences(cyclic), []);
});

test('oversized array (> 1000 items) yields document null with checker errors', () => {
    const bigArray = new Array(1001).fill('item');
    const doc = {
        id: 'fixture',
        content: {
            items: bigArray,
        },
    };

    const model = openPack(doc);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.ok(model.validation.errors.some(e => e.code === 'too-large'));
});

test('unsupported function values yield document null', () => {
    const docWithFn = {
        id: 'fixture',
        content: {
            customFn: () => 'hello',
        },
    };

    const model = openPack(docWithFn);
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(indexReferences(docWithFn), []);
});

// Regression 4: SB item name/alias lookup in start.inventory.items and preset choice names
test('start.inventory.items resolves item names/aliases and presets resolve choice names with legacySkills', () => {
    const doc = smallRulesPack({
        items: [
            { slug: 'sword', name: 'Iron Sword', aliases: ['Blade of Valor'], kind: 'equipment', rarity: 'common', value: 50, slot: 'weapon' },
        ],
        itemRules: [
            { def: 'sword', allowedSlots: ['weapon'], hands: 1, requires: { STR: 5 }, weight: 20 },
        ],
    });
    doc.content.races = [
        { id: 'human', name: 'Human' },
    ];
    doc.content.talents = [
        { id: 'strong', name: 'Strong' },
    ];
    // Legacy Story Block skills (content.skills)
    doc.content.skills = [
        { slug: 'slash', name: 'Quick Slash' },
    ];
    doc.content.presets = [
        {
            id: 'warrior',
            name: 'Warrior',
            race: 'Human',
            talents: ['Strong'],
            skills: ['Quick Slash'],
            note: 'A stalwart warrior preset',
        },
    ];
    doc.start = {
        inventory: {
            items: [
                { item: 'Iron Sword', qty: 2, note: 'Ancestral blade' },
                'Blade of Valor',
            ],
        },
    };

    const val = validateRulesPack(doc);
    assert.equal(val.ok, true, `Expected valid pack, got errors: ${JSON.stringify(val.errors)}`);

    const refs = indexReferences(doc);

    // start.inventory.items: object entry with item name 'Iron Sword' resolves to actual qualified ID
    const startObjItem = refs.find(r => r.kind === 'start' && r.path.join('.') === 'start.inventory.items.0.item');
    assert.deepEqual(startObjItem, {
        kind: 'start',
        id: 'pack.fixture/start',
        path: ['start', 'inventory', 'items', 0, 'item'],
        targetKind: 'items',
        targetId: 'pack.fixture/sword',
    });

    // start.inventory.items: string entry with item alias 'Blade of Valor' resolves to actual qualified ID
    const startStrItem = refs.find(r => r.kind === 'start' && r.path.join('.') === 'start.inventory.items.1');
    assert.deepEqual(startStrItem, {
        kind: 'start',
        id: 'pack.fixture/start',
        path: ['start', 'inventory', 'items', 1],
        targetKind: 'items',
        targetId: 'pack.fixture/sword',
    });

    // Presets: race name 'Human' resolves to 'pack.fixture/human'
    const prsRace = refs.find(r => r.kind === 'presets' && r.path.join('.') === 'content.presets.0.race');
    assert.deepEqual(prsRace, {
        kind: 'presets',
        id: 'pack.fixture/warrior',
        path: ['content', 'presets', 0, 'race'],
        targetKind: 'races',
        targetId: 'pack.fixture/human',
    });

    // Presets: talent name 'Strong' resolves to 'pack.fixture/strong'
    const prsTalent = refs.find(r => r.kind === 'presets' && r.path.join('.') === 'content.presets.0.talents.0');
    assert.deepEqual(prsTalent, {
        kind: 'presets',
        id: 'pack.fixture/warrior',
        path: ['content', 'presets', 0, 'talents', 0],
        targetKind: 'talents',
        targetId: 'pack.fixture/strong',
    });

    // Presets: legacy skill name 'Quick Slash' resolves to 'pack.fixture/slash' with targetKind 'legacySkills'
    const prsSkill = refs.find(r => r.kind === 'presets' && r.path.join('.') === 'content.presets.0.skills.0');
    assert.deepEqual(prsSkill, {
        kind: 'presets',
        id: 'pack.fixture/warrior',
        path: ['content', 'presets', 0, 'skills', 0],
        targetKind: 'legacySkills',
        targetId: 'pack.fixture/slash',
    });

    // Literal notes are not indexed
    const noteRef = refs.find(r => r.targetId?.includes('Ancestral') || r.targetId?.includes('stalwart'));
    assert.equal(noteRef, undefined, 'Literal notes in start items or presets must not be treated as references');
});

// Regression 5: Authored display order survives open/export twice with reversed arrays, two effects, and two transforms
test('authored display order survives open and export twice with reversed arrays, two effects, and two transforms', () => {
    const pack = smallRulesPack();
    const manifest = pack.content.rules[0];

    // Give tier 3 skill s30 TWO effects within tier 3 budget (classBudget[3] = 48)
    // Damage: power 20 -> score 2. Condition: burn, chance 100, rounds 3 -> score 12. Total 14 <= 48.
    const s30 = manifest.skills.find(s => s.slug === 's30');
    s30.base.effects = [
        { op: 'damage', target: 'one', power: 20, element: 'none', damageType: 'physical' },
        { op: 'condition', target: 'one', kind: 'burn', chance: 100, rounds: 3 },
    ];

    // Update branches of s30 with TWO ordered transforms
    for (const b of manifest.branches.filter(br => br.skill === 's30')) {
        if (b.step === 1) {
            b.transforms = [
                { op: 'set-element', at: 0, value: b.choice === 'a' ? 'fire' : 'ice' },
                { op: 'set-power', at: 0, value: b.choice === 'a' ? 30 : 25 },
            ];
        } else {
            b.transforms = b.choice === 'a'
                ? [
                    { op: 'set-target', at: 0, value: 'all' },
                    { op: 'set-power', at: 0, value: 20 },
                ]
                : [
                    { op: 'set-element', at: 0, value: 'lightning' },
                    { op: 'set-power', at: 0, value: 35 },
                ];
        }
    }

    // Reverse the authored display arrays
    manifest.classes.reverse();
    manifest.skills.reverse();
    manifest.branches.reverse();

    // Verify valid pack per shared checker
    const val = validateRulesPack(pack);
    assert.equal(val.ok, true, `Expected valid pack, got errors: ${JSON.stringify(val.errors)}`);

    // First open & export
    const model1 = openPack(pack);
    assert.equal(model1.validation.ok, true);
    const text1 = exportPack(model1);

    // Second open & export
    const model2 = openPack(text1);
    assert.equal(model2.validation.ok, true);
    const text2 = exportPack(model2);

    assert.equal(text2, text1, 'Repeated export must be byte-for-byte identical');

    // Verify reversed class order survived twice
    const expectedClassSlugs = manifest.classes.map(c => c.slug);
    assert.deepEqual(model1.document.content.rules[0].classes.map(c => c.slug), expectedClassSlugs);
    assert.deepEqual(model2.document.content.rules[0].classes.map(c => c.slug), expectedClassSlugs);

    // Verify reversed skill order survived twice
    const expectedSkillSlugs = manifest.skills.map(s => s.slug);
    assert.deepEqual(model1.document.content.rules[0].skills.map(s => s.slug), expectedSkillSlugs);
    assert.deepEqual(model2.document.content.rules[0].skills.map(s => s.slug), expectedSkillSlugs);

    // Verify reversed branch order survived twice
    const expectedBranchSlugs = manifest.branches.map(b => b.slug);
    assert.deepEqual(model1.document.content.rules[0].branches.map(b => b.slug), expectedBranchSlugs);
    assert.deepEqual(model2.document.content.rules[0].branches.map(b => b.slug), expectedBranchSlugs);

    // Verify two effects preserved in exact order
    const s30Doc1 = model1.document.content.rules[0].skills.find(s => s.slug === 's30');
    const s30Doc2 = model2.document.content.rules[0].skills.find(s => s.slug === 's30');
    assert.deepEqual(s30Doc1.base.effects, s30.base.effects);
    assert.deepEqual(s30Doc2.base.effects, s30.base.effects);

    // Verify two ordered transforms preserved in exact order
    const b0Doc1 = model1.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    const b0Doc2 = model2.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    const b0Orig = manifest.branches.find(b => b.slug === 's30-base-a');
    assert.deepEqual(b0Doc1.transforms, b0Orig.transforms);
    assert.deepEqual(b0Doc2.transforms, b0Orig.transforms);
});

// Regression 6: safeClone preserves plain large documents and indexes class parent
test('preserves invalid-but-plain authored doc with extra large plain array and indexes class parent', () => {
    const probe = {
        id: 'fixture',
        extra: Array(180).fill('x'.repeat(1000)),
        content: {
            rules: [{
                classes: [{ slug: 'c1', parent: 'c0', skills: [] }],
            }],
        },
    };

    const val = validateRulesPack(probe);
    assert.equal(val.ok, false);

    const model = openPack(probe);
    assert.equal(model.validation.ok, false);
    assert.ok(model.document !== null);
    assert.equal(model.document.extra.length, 180);
    assert.equal(model.hash, null);

    const parentRef = model.references.find(
        r => r.kind === 'classes' && r.path.join('.') === 'content.rules.0.classes.0.parent'
    );
    assert.ok(parentRef);
    assert.equal(parentRef.targetId, 'pack.fixture/c0');

    const refs = indexReferences(probe);
    const directRef = refs.find(
        r => r.kind === 'classes' && r.path.join('.') === 'content.rules.0.classes.0.parent'
    );
    assert.ok(directRef);
    assert.equal(directRef.targetId, 'pack.fixture/c0');
});

// Regression 7: Valid smallRulesPack with 600 places each note length 300 ASCII
test('valid smallRulesPack with 600 places note length 300 ASCII passes shared checker and exporter with reference parity', () => {
    const places = Array.from({ length: 600 }, (_, i) => ({
        slug: `place-${i}`,
        name: `Place ${i}`,
        x: i,
        y: 0,
        note: 'x'.repeat(300),
    }));

    const pack = smallRulesPack({ places });

    // Assert shared checker and exporter valid
    const checkRes = validateRulesPack(pack);
    assert.equal(checkRes.ok, true, `Expected valid pack, got: ${JSON.stringify(checkRes.errors)}`);

    const exportRes = exportRulesV2(pack);
    assert.equal(exportRes.ok, true, `Expected valid export, got: ${JSON.stringify(exportRes.errors)}`);

    const model = openPack(pack);
    assert.equal(model.validation.ok, true);
    assert.ok(model.references.length > 0);

    // Parity with golden core refs
    const goldenPack = smallRulesPack();
    const goldenRefs = indexReferences(goldenPack);
    assert.ok(goldenRefs.length > 0);

    for (const gRef of goldenRefs) {
        const found = model.references.find(
            r => r.kind === gRef.kind && r.id === gRef.id && r.targetKind === gRef.targetKind && r.targetId === gRef.targetId
        );
        assert.ok(found, `Expected golden ref ${JSON.stringify(gRef)} in model.references`);
    }
});

// Regression 8: Primitive leaves at depth 16 are allowed following shared safety checker
test('primitive leaves at depth 16 are allowed following shared safety checker', () => {
    let deep = 'leaf-value';
    for (let d = 16; d >= 1; d--) {
        deep = { next: deep };
    }
    const doc = {
        id: 'fixture',
        content: {
            rules: [{
                slug: 'rules',
                classes: [{ slug: 'c1', parent: 'c0', skills: [] }],
            }],
        },
        deep,
    };

    const refs = indexReferences(doc);
    assert.ok(refs.some(r => r.kind === 'classes' && r.targetId === 'pack.fixture/c0'));
});

// Regression 9: Canonical export exceeding 512 KiB handled as immutable invalid model preserving authored document
test('canonical export exceeding 512 KiB handled as immutable invalid model preserving authored document', () => {
    const places = Array.from({ length: 900 }, (_, i) => ({
        slug: `p-${i}`,
        name: 'Place',
        x: i,
        y: 0,
        note: 'x'.repeat(480),
    }));

    const pack = smallRulesPack({ places });

    // Raw input is compact (489,292 bytes < 512 KiB) and passes validateRulesPack
    const checkRes = validateRulesPack(pack);
    assert.equal(checkRes.ok, true);

    // exportRulesV2 fails with too-large due to 2-space canonical indentation
    const exportRes = exportRulesV2(pack);
    assert.equal(exportRes.ok, false);
    assert.ok(exportRes.errors.some(e => e.code === 'too-large'));

    // openPack handles export failure as immutable invalid model: never parses undefined or throws
    const model = openPack(pack);
    assert.equal(model.validation.ok, false);
    assert.equal(model.hash, null);
    assert.deepEqual(model.validation.errors, exportRes.errors);

    // Authored document preserved for editing
    assert.ok(model.document !== null);
    assert.equal(model.document.content.places.length, 900);
    assert.ok(Array.isArray(model.references));

    // exportPack refuses with same errors
    assert.throws(
        () => exportPack(model),
        err => {
            assert.ok(err instanceof Error);
            assert.deepEqual(err.errors, exportRes.errors);
            return true;
        }
    );
});

// Regression 10: Hostile proxy trap does not throw in openPack or indexReferences
test('hostile proxy trap does not throw in openPack or indexReferences', () => {
    const hostile = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('trap');
        },
    });

    // openPack must return safe failure without throwing
    const model = openPack(hostile);
    assert.equal(model.validation.ok, false);
    assert.equal(model.document, null);
    assert.equal(model.hash, null);
    assert.deepEqual(model.references, []);

    // indexReferences must return empty array without throwing
    const refs = indexReferences(hostile);
    assert.deepEqual(refs, []);
});
