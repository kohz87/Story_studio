// Pack edit operations tests: add, renameId, remove, moveClass, and setField (SPEC §4, §7, §10 D).

import test from 'node:test';
import assert from 'node:assert/strict';

import { smallRulesPack } from './fixtures/smallRulesPack.js';

import { openPack, exportPack } from '../src/model.js';
import { add, addClassSkill, renameId, remove, moveClass, setField } from '../src/edits.js';

test('add operation is pure and appends record to kind collection', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const newPlace = { slug: 'cave', name: 'Crystal Cave', x: 2, y: 5 };
    const rawPlace = JSON.stringify(newPlace);

    const res = add(model, 'places', newPlace);
    assert.equal(res.ok, true);
    assert.ok(res.model !== model);

    // Caller inputs not mutated or frozen
    assert.equal(JSON.stringify(newPlace), rawPlace);
    assert.equal(Object.isFrozen(newPlace), false);

    // Old model preserved
    assert.equal(model.document.content.places.length, 2);

    // New model has appended record
    assert.equal(res.model.document.content.places.length, 3);
    assert.equal(res.model.document.content.places[2].slug, 'cave');

    // Pure undo returns exact original snapshot
    const undone = res.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('add rejects duplicate IDs and unsupported kinds', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Duplicate place slug
    const dupRes = add(model, 'places', { slug: 'haven', name: 'Duplicate Haven' });
    assert.equal(dupRes.ok, false);
    assert.equal(dupRes.model, model);
    assert.equal(dupRes.errors[0].code, 'dup-id');

    // Duplicate class slug with same-pack prefix
    const dupCls = add(model, 'classes', { slug: 'pack.fixture/c0', name: 'Dup Class' });
    assert.equal(dupCls.ok, false);
    assert.equal(dupCls.errors[0].code, 'dup-id');

    // Unsupported kind
    const badKind = add(model, 'unknownKind', { slug: 'test' });
    assert.equal(badKind.ok, false);
    assert.equal(badKind.errors[0].code, 'unsupported-kind');

    // Missing id/slug
    const noId = add(model, 'items', { name: 'Nameless Sword' });
    assert.equal(noId.ok, false);
    assert.equal(noId.errors[0].code, 'missing-id');

    // Inconsistent branch slug
    const badBranch = add(model, 'branches', {
        slug: 'custom-slug',
        skill: 's30',
        fromForm: 's30-base',
        step: 1,
        choice: 'a',
        transforms: [],
    });
    assert.equal(badBranch.ok, false);
    assert.equal(badBranch.errors[0].code, 'bad-branch-id');
});

test('add allows intermediate invalid state and exposes shared checker errors', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Add a class with incomplete skills
    const partialClass = {
        slug: 'c-invalid',
        name: 'Invalid Class',
        tier: 1,
        parent: 'c0',
        skills: ['s00'],
    };

    const res = add(model, 'classes', partialClass);
    assert.equal(res.ok, true);
    assert.equal(res.model.validation.ok, false);
    assert.ok(res.model.validation.errors.some(e => e.code === 'class-skills'));

    // Intermediate model is frozen snapshot
    assert.ok(Object.isFrozen(res.model.document));
    const undone = res.undo();
    assert.equal(undone, model);
});

test('full class rename updates all typed inbound references and preserves note text', () => {
    const pack = smallRulesPack({
        quests: [{
            slug: 'job-1',
            name: 'Job 1',
            category: 'side',
            giver: null,
            turnInPlace: 'pack.fixture/haven',
            requirements: [{ kind: 'class', classes: ['c0'] }],
            objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/haven' }],
            reward: { coin: 10, xp: 10, items: [] },
            durationMinutes: null,
            repeat: null,
            chain: null,
        }],
    });
    // Add skill summon unit referencing class c0 in tier 1 skill (budget 24)
    pack.content.rules[0].skills[3].base.unit = {
        kind: 'summon',
        class: 'c0',
        statShare: 50,
        poolShare: 50,
        rounds: 3,
    };
    pack.content.rules[0].classes[0].note = 'Literal class note text';

    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const res = renameId(model, 'classes', 'c0', 'novice');
    assert.equal(res.ok, true);

    const newDoc = res.model.document;
    const manifest = newDoc.content.rules[0];

    // Class slug renamed
    assert.equal(manifest.classes[0].slug, 'novice');
    assert.equal(manifest.classes[0].note, 'Literal class note text');

    // Child class parent updated
    assert.equal(manifest.classes[1].parent, 'novice');

    // Quest requirement updated
    assert.deepEqual(newDoc.content.quests[0].requirements[0].classes, ['novice']);

    // Skill summon unit updated
    assert.equal(manifest.skills[3].base.unit.class, 'novice');

    // Revalidated successfully
    assert.equal(res.model.validation.ok, true, JSON.stringify(res.model.validation.errors));

    // Pure undo restores exact original model
    const undone = res.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('full item rename updates itemRules, creature loot, shops, recipes, quests, and start inventory', () => {
    const pack = smallRulesPack({
        items: [
            { slug: 'sword', name: 'Iron Sword', aliases: ['Blade of Valor'], kind: 'equipment', rarity: 'common', value: 50, slot: 'weapon' },
            { slug: 'ore', name: 'Iron Ore', kind: 'material', rarity: 'common', value: 5 },
        ],
        itemRules: [
            { def: 'sword', allowedSlots: ['weapon'], hands: 1, requires: { STR: 5 }, weight: 20 },
            { def: 'ore', allowedSlots: [], hands: 0, requires: {}, weight: 5 },
        ],
        creatures: [{
            slug: 'bandit',
            name: 'Bandit',
            tier: 1,
            level: 2,
            stats: { STR: 6, VIT: 6, AGI: 6, DEX: 6, INT: 5, LUK: 5, CHA: 5 },
            skills: ['s00'],
            loot: [{ def: 'sword', chance: 50, qty: 1 }],
            loreTags: ['human'],
        }],
        shops: [{
            slug: 'armory',
            name: 'Armory',
            place: 'pack.fixture/haven',
            kind: 'general',
            stock: [{ item: 'sword', qty: 3, price: 50 }],
        }],
        recipes: [{
            slug: 'forge-sword',
            name: 'Forge Sword',
            craft: 'smithing',
            makes: 'sword',
            qty: 1,
            materials: [{ item: 'ore', qty: 2 }],
            fee: 10,
            minutes: 30,
            dc: 10,
            stat: 'STR',
        }],
        quests: [{
            slug: 'arm-scouts',
            name: 'Arm the Scouts',
            category: 'side',
            giver: null,
            turnInPlace: 'pack.fixture/haven',
            requirements: [{ kind: 'item', def: 'sword', qty: 1 }],
            objectives: [{ id: 'ob_00000001', kind: 'collect', def: 'sword', count: 1, consume: true }],
            reward: { coin: 50, xp: 20, items: [{ def: 'sword', qty: 1 }] },
            durationMinutes: null,
            repeat: null,
            chain: null,
        }],
    });
    pack.start = {
        inventory: {
            items: [
                { item: 'Iron Sword', qty: 1, note: 'Ancestral blade' },
                'Blade of Valor',
            ],
        },
    };

    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const res = renameId(model, 'items', 'sword', 'claymore');
    assert.equal(res.ok, true);

    const doc = res.model.document;

    // Item slug updated
    assert.equal(doc.content.items[0].slug, 'claymore');

    // ItemRule updated
    assert.equal(doc.content.rules[0].itemRules[0].def, 'claymore');

    // Creature loot updated
    assert.equal(doc.content.creatures[0].loot[0].def, 'claymore');

    // Shop stock updated
    assert.equal(doc.content.shops[0].stock[0].item, 'claymore');

    // Recipe makes updated
    assert.equal(doc.content.recipes[0].makes, 'claymore');

    // Quest requirements, objectives, reward updated
    assert.equal(doc.content.quests[0].requirements[0].def, 'claymore');
    assert.equal(doc.content.quests[0].objectives[0].def, 'claymore');
    assert.equal(doc.content.quests[0].reward.items[0].def, 'claymore');

    // Start inventory resolved references updated to local slug while note preserved
    assert.equal(doc.start.inventory.items[0].item, 'claymore');
    assert.equal(doc.start.inventory.items[0].note, 'Ancestral blade');
    assert.equal(doc.start.inventory.items[1], 'claymore');

    // Revalidated cleanly
    assert.equal(res.model.validation.ok, true, JSON.stringify(res.model.validation.errors));

    // Pure undo restores exact previous model and hash
    const undone = res.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('full skill rename atomically rebases base-forms, generated-parent graph, branches, and typed refs', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Skill s30 is an advanced tier 3 skill with 8 written branches
    const res = renameId(model, 'skills', 's30', 'nova');
    assert.equal(res.ok, true);

    const newDoc = res.model.document;
    const manifest = newDoc.content.rules[0];

    // Skill slug renamed
    const novaSkill = manifest.skills.find(s => s.slug === 'nova');
    assert.ok(novaSkill);

    // Class skills list updated
    const c3 = manifest.classes.find(c => c.slug === 'c3');
    assert.deepEqual(c3.skills, ['nova', 's31', 's32']);

    // Branches for nova rebased
    const novaBranches = manifest.branches.filter(b => b.skill === 'nova');
    assert.equal(novaBranches.length, 8);

    // Check step 1 branch
    const b1 = novaBranches.find(b => b.step === 1 && b.choice === 'a');
    assert.equal(b1.fromForm, 'nova-base');
    assert.equal(b1.slug, 'nova-base-a');
    // Literal name and note strings must be preserved
    assert.equal(b1.name, 's30-base-a');

    // Check step 2 branch from generated parent
    const b2Gen = novaBranches.find(b => b.fromForm === 'nova-base-g' && b.choice === 'a');
    assert.ok(b2Gen);
    assert.equal(b2Gen.slug, 'nova-base-g-a');
    assert.equal(b2Gen.name, 's30-base-g-a');

    // No old IDs in identity/reference fields across all branches
    for (const b of manifest.branches) {
        assert.ok(!b.slug.includes('s30'));
        assert.ok(!b.skill.includes('s30'));
        assert.ok(!b.fromForm.includes('s30'));
    }

    // Entire pack revalidated and valid per shared rules-v2 checker
    assert.equal(res.model.validation.ok, true, JSON.stringify(res.model.validation.errors));
    assert.equal(res.model.validation.errors.length, 0);
    assert.ok(typeof res.model.rulesHash === 'string' && res.model.rulesHash.length === 64);
    assert.ok(typeof res.model.packHash === 'string' && res.model.packHash.length === 64);

    // Export canonical and round trip
    const exportedText = exportPack(res.model);
    assert.ok(exportedText.includes('nova-base-g-a'));

    // Round trip and hash parity
    const model2 = openPack(exportedText);
    assert.equal(model2.validation.ok, true, JSON.stringify(model2.validation.errors));
    assert.equal(model2.rulesHash, res.model.rulesHash);
    assert.equal(model2.packHash, res.model.packHash);
    assert.deepEqual(model2.document, res.model.document);

    // Pure undo returns exact original snapshot
    const undone = res.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('renameId refuses invalid IDs, foreign pack IDs, and inconsistent branch slugs', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Missing record
    const missing = renameId(model, 'classes', 'c99', 'hero');
    assert.equal(missing.ok, false);
    assert.equal(missing.errors[0].code, 'not-found');

    // Duplicate target ID
    const dup = renameId(model, 'classes', 'c0', 'c1');
    assert.equal(dup.ok, false);
    assert.equal(dup.errors[0].code, 'dup-id');

    // Foreign source ID
    const foreignSrc = renameId(model, 'classes', 'pack.foreign/c0', 'c0-new');
    assert.equal(foreignSrc.ok, false);
    assert.equal(foreignSrc.errors[0].code, 'bad-ref');

    // Foreign target ID
    const foreignTgt = renameId(model, 'classes', 'c0', 'pack.foreign/c0-new');
    assert.equal(foreignTgt.ok, false);
    assert.equal(foreignTgt.errors[0].code, 'bad-ref');

    // Invalid slug syntax
    const badSlug = renameId(model, 'classes', 'c0', 'Invalid_Slug!');
    assert.equal(badSlug.ok, false);
    assert.equal(badSlug.errors[0].code, 'bad-id');

    // Inconsistent branch slug
    const badBranch = renameId(model, 'branches', 's30-base-a', 'custom-branch-name');
    assert.equal(badBranch.ok, false);
    assert.equal(badBranch.errors[0].code, 'bad-branch-id');
});

test('legacy skills and rules skills are never confused during rename', () => {
    const pack = smallRulesPack();
    pack.content.skills = [
        { slug: 'slash', name: 'Quick Slash' },
    ];
    pack.content.presets = [
        { id: 'warrior', name: 'Warrior', skills: ['slash'] },
    ];

    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Rename legacy skill
    const res = renameId(model, 'legacySkills', 'slash', 'heavy-slash');
    assert.equal(res.ok, true);

    const doc = res.model.document;
    assert.equal(doc.content.skills[0].slug, 'heavy-slash');
    assert.deepEqual(doc.content.presets[0].skills, ['heavy-slash']);

    // Rules skills are completely untouched
    assert.ok(doc.content.rules[0].skills.every(s => s.slug.startsWith('s')));
});

test('external place, NPC, and thread IDs remain untouched unless targeting local place def', () => {
    const pack = smallRulesPack({
        quests: [{
            slug: 'q1',
            name: 'External Quest',
            category: 'side',
            giver: 'np_00000001',
            turnInPlace: 'pl_00000001',
            requirements: [{ kind: 'thread', thread: 'th_00000001' }],
            objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/haven' }],
            reward: { coin: 10, xp: 10, items: [] },
            durationMinutes: null,
            repeat: null,
            chain: null,
        }],
    });

    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Rename local place haven
    const res = renameId(model, 'places', 'haven', 'sanctuary');
    assert.equal(res.ok, true);

    const doc = res.model.document;
    assert.equal(doc.content.places[0].slug, 'sanctuary');
    assert.equal(doc.content.quests[0].objectives[0].place, 'pack.fixture/sanctuary');

    // External IDs unchanged
    assert.equal(doc.content.quests[0].giver, 'np_00000001');
    assert.equal(doc.content.quests[0].turnInPlace, 'pl_00000001');
    assert.equal(doc.content.quests[0].requirements[0].thread, 'th_00000001');

    // Renamed pack validates cleanly
    assert.equal(res.model.validation.ok, true, JSON.stringify(res.model.validation.errors));

    // Attempting to rename foreign place pl_00000001 is refused as not-found
    const failRes = renameId(model, 'places', 'pl_00000001', 'pl-renamed');
    assert.equal(failRes.ok, false);
    assert.equal(failRes.errors[0].code, 'not-found');
});

test('remove without cascade refuses with actual paths when inbound references exist', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Class c0 is referenced as parent of c1
    const refDel = remove(model, 'classes', 'c0', { cascade: false });
    assert.equal(refDel.ok, false);
    assert.equal(refDel.model, model);
    assert.equal(refDel.errors[0].code, 'referenced');
    assert.ok(Array.isArray(refDel.references));
    assert.ok(refDel.references.length > 0);

    const parentRef = refDel.references.find(r => r.path.join('.') === 'content.rules.0.classes.1.parent');
    assert.ok(parentRef);
    assert.equal(parentRef.targetId, 'pack.fixture/c0');

    // Removing an unreferenced record succeeds without cascade
    const placeDel = remove(model, 'places', 'mill', { cascade: false });
    assert.equal(placeDel.ok, true);
    assert.equal(placeDel.model.document.content.places.length, 1);
    assert.equal(placeDel.model.document.content.places[0].slug, 'haven');
});

test('cascade delete transitively removes class, owned skills, branches, and descendants', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Deleting c2 with cascade:true should remove c2, its skills, and child c3 + its skills and branches
    const res = remove(model, 'classes', 'c2', { cascade: true });
    assert.equal(res.ok, true);

    const doc = res.model.document;
    const manifest = doc.content.rules[0];

    // Only c0 and c1 remain
    assert.deepEqual(manifest.classes.map(c => c.slug), ['c0', 'c1']);

    // Skills belonging to c2 and c3 are removed
    const skillSlugs = manifest.skills.map(s => s.slug);
    assert.ok(!skillSlugs.some(s => s.startsWith('s2') || s.startsWith('s3')));
    assert.equal(manifest.skills.length, 6);

    // Branches belonging to c3 skills are removed
    assert.equal(manifest.branches.length, 0);

    // Places and items preserved
    assert.equal(doc.content.places.length, 2);

    // Pure undo restores exact previous model
    const undone = res.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('cascade delete removes item, itemRules, start inventory, and related references cleanly', () => {
    const pack = smallRulesPack({
        items: [
            { slug: 'sword', name: 'Iron Sword', kind: 'equipment', rarity: 'common', value: 50, slot: 'weapon' },
            { slug: 'potion', name: 'Potion', kind: 'consumable', rarity: 'common', value: 10 },
        ],
        itemRules: [
            { def: 'sword', allowedSlots: ['weapon'], hands: 1, requires: { STR: 5 }, weight: 20 },
            { def: 'potion', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
        ],
    });
    pack.start = {
        inventory: {
            items: [
                { item: 'sword', qty: 1 },
                { item: 'potion', qty: 3 },
            ],
        },
    };

    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const res = remove(model, 'items', 'sword', { cascade: true });
    assert.equal(res.ok, true);

    const doc = res.model.document;

    // Item deleted
    assert.deepEqual(doc.content.items.map(i => i.slug), ['potion']);

    // ItemRule deleted
    assert.deepEqual(doc.content.rules[0].itemRules.map(ir => ir.def), ['potion']);

    // Start inventory entry removed
    assert.equal(doc.start.inventory.items.length, 1);
    assert.equal(doc.start.inventory.items[0].item, 'potion');

    // Pure undo restores exact previous model
    const undone = res.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('moveClass coherently updates tiers, descendant tiers, and rejects cycles/overflow', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // 1. Valid move: move c2 to parent null (making it tier 0 root)
    const rootRes = moveClass(model, 'c2', null);
    assert.equal(rootRes.ok, true);
    assert.equal(rootRes.model.document.content.rules[0].classes[2].parent, null);
    assert.equal(rootRes.model.document.content.rules[0].classes[2].tier, 0);

    // Child c3 tier shifted from 3 to 1
    assert.equal(rootRes.model.document.content.rules[0].classes[3].tier, 1);

    // 2. Reject self parenting
    const selfRes = moveClass(model, 'c1', 'c1');
    assert.equal(selfRes.ok, false);
    assert.equal(selfRes.errors[0].code, 'tier-chain');

    // 3. Reject cycle (c0 -> c2 when c2 is descendant of c0)
    const cycleRes = moveClass(model, 'c0', 'c2');
    assert.equal(cycleRes.ok, false);
    assert.equal(cycleRes.errors[0].code, 'tier-chain');

    // 4. Reject unresolved parent
    const unresRes = moveClass(model, 'c1', 'nonexistent');
    assert.equal(unresRes.ok, false);
    assert.equal(unresRes.errors[0].code, 'bad-ref');

    // 5. Reject tier > 3 overflow (parent c3 is tier 3 -> child becomes tier 4)
    const overflowRes = moveClass(model, 'c1', 'c3');
    assert.equal(overflowRes.ok, false);
    assert.equal(overflowRes.errors[0].code, 'tier-chain');

    // 6. Reject descendant depth overflow
    const altPack = smallRulesPack();
    altPack.content.rules[0].classes.push({
        slug: 'c-alt2',
        name: 'Alt Tier 2',
        tier: 2,
        parent: 'c1',
        skills: ['s20', 's21', 's22'],
    });
    const altModel = openPack(altPack);
    const descOverflow = moveClass(altModel, 'c1', 'c-alt2');
    assert.equal(descOverflow.ok, false);
    assert.equal(descOverflow.errors[0].code, 'tier-chain');

    // Pure undo restores exact original model
    const undone = rootRes.undo();
    assert.equal(undone, model);
    assert.equal(undone.rulesHash, model.rulesHash);
    assert.equal(undone.packHash, model.packHash);
});

test('setField is pure, replaces leaf values, and exposes intermediate validation errors', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].statLabels = {};
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Modify statLabels
    const res = setField(model, ['content', 'rules', 0, 'statLabels', 'STR'], 'Strength');
    assert.equal(res.ok, true);
    assert.equal(res.model.document.content.rules[0].statLabels.STR, 'Strength');

    // Input model unchanged: statLabels original default is {}
    assert.deepEqual(model.document.content.rules[0].statLabels, {});

    // Intermediate invalid state allowed (e.g. invalid effect power 9999 exceeds 1000)
    const badPower = setField(model, ['content', 'rules', 0, 'skills', 0, 'base', 'effects', 0, 'power'], 9999);
    assert.equal(badPower.ok, true);
    assert.equal(badPower.model.validation.ok, false);
    assert.ok(badPower.model.validation.errors.some(e => e.code === 'numeric-range'));

    // Pure undo returns exact original model
    assert.equal(res.undo(), model);
    assert.equal(badPower.undo(), model);
});

test('setField refuses identity fields and directs callers to renameId', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Pack top-level id
    const packIdRes = setField(model, ['id'], 'new-pack-id');
    assert.equal(packIdRes.ok, false);
    assert.equal(packIdRes.errors[0].code, 'identity-field');

    // Class slug
    const classSlugRes = setField(model, ['content', 'rules', 0, 'classes', 0, 'slug'], 'new-slug');
    assert.equal(classSlugRes.ok, false);
    assert.equal(classSlugRes.errors[0].code, 'identity-field');

    // Item slug
    const itemSlugRes = setField(model, ['content', 'items', 0, 'slug'], 'new-item');
    assert.equal(itemSlugRes.ok, false);
    assert.equal(itemSlugRes.errors[0].code, 'identity-field');

    // ItemRule def
    const itemRuleDefRes = setField(model, ['content', 'rules', 0, 'itemRules', 0, 'def'], 'new-def');
    assert.equal(itemRuleDefRes.ok, false);
    assert.equal(itemRuleDefRes.errors[0].code, 'identity-field');
});

test('setField refuses unsafe keys, getters without invocation, cyclic values, and bad array indices', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Unsafe path key
    const protoRes = setField(model, ['content', '__proto__', 'polluted'], true);
    assert.equal(protoRes.ok, false);
    assert.equal(protoRes.errors[0].code, 'unsafe-key');

    // Getter on value without invocation
    let getterRan = false;
    const getterVal = {
        get evil() {
            getterRan = true;
            return 'exploit';
        },
    };
    const getRes = setField(model, ['content', 'rules', 0, 'statLabels', 'AGI'], getterVal);
    assert.equal(getRes.ok, false);
    assert.equal(getterRan, false, 'Getter must not be invoked');
    assert.equal(getRes.errors[0].code, 'bad-value');

    // Cyclic value
    const cyclicVal = {};
    cyclicVal.self = cyclicVal;
    const cycRes = setField(model, ['content', 'rules', 0, 'statLabels', 'AGI'], cyclicVal);
    assert.equal(cycRes.ok, false);
    assert.equal(cycRes.errors[0].code, 'bad-value');

    // Negative array index
    const negIdx = setField(model, ['content', 'rules', 0, 'classes', -1], {});
    assert.equal(negIdx.ok, false);
    assert.equal(negIdx.errors[0].code, 'bad-index');

    // Out of bounds array index (> length)
    const oobIdx = setField(model, ['content', 'rules', 0, 'classes', 10], {});
    assert.equal(oobIdx.ok, false);
    assert.equal(oobIdx.errors[0].code, 'out-of-bounds');

    // Setting array length
    const lenRes = setField(model, ['content', 'rules', 0, 'classes', 'length'], 0);
    assert.equal(lenRes.ok, false);
    assert.equal(lenRes.errors[0].code, 'out-of-bounds');
});

// ---------------------- REGRESSION TESTS ----------------------

test('cascade delete removes routes and handles case-insensitive / alias endpoints', () => {
    const pack = smallRulesPack();
    pack.content.routes = [
        { slug: 'road', from: 'HAVEN', to: 'Mill', kind: 'road' },
        { slug: 'trail', from: 'haven', to: 'mill', kind: 'trail' },
    ];
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // 1. remove route directly with cascade: true removes route
    const delRoute = remove(model, 'routes', 'road', { cascade: true });
    assert.equal(delRoute.ok, true);
    assert.equal(delRoute.model.document.content.routes.length, 1);
    assert.equal(delRoute.model.document.content.routes[0].slug, 'trail');

    // 2. remove place haven with cascade: true removes routes with mixed-case/alias endpoints
    const delPlace = remove(model, 'places', 'haven', { cascade: true });
    assert.equal(delPlace.ok, true);
    // Both routes depend on haven (HAVEN and haven) -> both removed
    assert.equal(delPlace.model.document.content.routes.length, 0);
    assert.equal(delPlace.model.document.content.places.length, 1);
    assert.equal(delPlace.model.document.content.places[0].slug, 'mill');
});

test('cascade delete removes after events and trainer eventTemplates', () => {
    const pack = smallRulesPack();
    pack.content.events = [
        { id: 'intro', when: 'Morning', cue: 'Welcome', once: true },
        { id: 'follow-up', when: 'Later', cue: 'Continue', once: true, after: 'intro' },
    ];
    pack.content.rules[0].trainers = [
        { slug: 'master', name: 'Master Trainer', place: 'pack.fixture/haven', skills: ['s00'], fee: 100, minutes: 60, eventTemplates: ['intro'] },
    ];
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Test event rename intro->sunrise keeps after local 'sunrise', follows trainer.eventTemplates, validates before/after and keeps cue/when strings
    const renRes = renameId(model, 'events', 'intro', 'sunrise');
    assert.equal(renRes.ok, true);
    assert.equal(renRes.model.validation.ok, true, JSON.stringify(renRes.model.validation.errors));
    const renEvents = renRes.model.document.content.events;
    assert.equal(renEvents.length, 2);
    assert.equal(renEvents[0].id, 'sunrise');
    assert.equal(renEvents[0].when, 'Morning');
    assert.equal(renEvents[0].cue, 'Welcome');
    assert.equal(renEvents[0].once, true);
    assert.equal(renEvents[1].id, 'follow-up');
    assert.equal(renEvents[1].after, 'sunrise');
    assert.equal(renEvents[1].when, 'Later');
    assert.equal(renEvents[1].cue, 'Continue');
    assert.deepEqual(renRes.model.document.content.rules[0].trainers[0].eventTemplates, ['sunrise']);

    // Trainer referencing intro must delete on cascading intro, follow-up deletes too
    const res = remove(model, 'events', 'intro', { cascade: true });
    assert.equal(res.ok, true);
    assert.equal(res.model.document.content.events.length, 0);
    assert.equal(res.model.document.content.rules[0].trainers.length, 0);
    assert.equal(res.undo(), model);
});

test('cascade delete removes item dependencies preserving unrelated records, and itemRule removal only deletes itemRule', () => {
    const pack = smallRulesPack({
        items: [
            { slug: 'sword', name: 'Sword', kind: 'equipment', rarity: 'common', value: 50, slot: 'weapon' },
            { slug: 'shield', name: 'Shield', kind: 'equipment', rarity: 'common', value: 40, slot: 'offhand' },
        ],
        itemRules: [
            { def: 'sword', allowedSlots: ['weapon'], hands: 1, requires: {}, weight: 10 },
            { def: 'shield', allowedSlots: ['offhand'], hands: 1, requires: {}, weight: 15 },
        ],
        shops: [{
            slug: 'armory',
            name: 'Armory',
            place: 'pack.fixture/haven',
            kind: 'general',
            stock: [
                { item: 'sword', qty: 2, price: 50 },
                { item: 'shield', qty: 1, price: 40 },
            ],
        }],
    });
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Removing itemRule 'sword' alone should NOT delete the item or consumers of the item
    const irDel = remove(model, 'itemRules', 'sword', { cascade: true });
    assert.equal(irDel.ok, true);
    assert.deepEqual(irDel.model.document.content.items.map(i => i.slug), ['sword', 'shield']);
    assert.deepEqual(irDel.model.document.content.rules[0].itemRules.map(ir => ir.def), ['shield']);
    assert.equal(irDel.model.document.content.shops[0].stock.length, 2);

    // Deleting item 'sword' deletes itemRule and shop (which stocked sword), while preserving shield
    const itemDel = remove(model, 'items', 'sword', { cascade: true });
    assert.equal(itemDel.ok, true);
    assert.deepEqual(itemDel.model.document.content.items.map(i => i.slug), ['shield']);
    assert.deepEqual(itemDel.model.document.content.rules[0].itemRules.map(ir => ir.def), ['shield']);
    assert.equal(itemDel.model.document.content.shops.length, 0);
});

test('cascade delete on skill removes owning classes, forms, and branches', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Deleting skill s30 (in class c3) cascades to class c3 and all its branches
    const res = remove(model, 'skills', 's30', { cascade: true });
    assert.equal(res.ok, true);
    const doc = res.model.document;
    assert.ok(!doc.content.rules[0].skills.some(s => s.slug === 's30'));
    assert.ok(!doc.content.rules[0].classes.some(c => c.slug === 'c3'));
    assert.equal(doc.content.rules[0].branches.length, 0);
});

test('cascade delete on legacy skills, races, and talents removes referencing presets', () => {
    const pack = smallRulesPack();
    pack.content.skills = [{ slug: 'slash', name: 'Slash' }];
    pack.content.races = [{ id: 'elf', name: 'Elf' }];
    pack.content.talents = [{ id: 'focus', name: 'Focus' }];
    pack.content.presets = [
        { id: 'ranger', name: 'Ranger', race: 'elf', talents: ['focus'], skills: ['slash'] },
        { id: 'civilian', name: 'Civilian' },
    ];
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Deleting race elf removes preset ranger but preserves civilian
    const res = remove(model, 'races', 'elf', { cascade: true });
    assert.equal(res.ok, true);
    assert.deepEqual(res.model.document.content.presets.map(p => p.id), ['civilian']);
});

test('table-based cascade regression covers every supported kind without dangling refs', () => {
    for (const kind of [
        'classes', 'skills', 'branches', 'itemRules', 'trainers',
        'items', 'creatures', 'quests', 'shops', 'recipes',
        'places', 'events', 'routes', 'races', 'talents',
        'presets', 'legacySkills',
    ]) {
        const pack = smallRulesPack();
        pack.content.skills = [{ slug: 'l-skill', name: 'Legacy' }];
        pack.content.races = [{ id: 'l-race', name: 'Race' }];
        pack.content.talents = [{ id: 'l-talent', name: 'Talent' }];
        pack.content.presets = [{ id: 'l-preset', name: 'Preset' }];
        pack.content.events = [{ id: 'ev1', when: 'Morning', cue: 'Welcome', once: true }];
        pack.content.routes = [{ slug: 'rt1', from: 'haven', to: 'mill', kind: 'road' }];
        pack.content.recipes = [{
            slug: 'rc1', name: 'R', craft: 'smithing', makes: 's-item', qty: 1,
            materials: [{ item: 's-item', qty: 1 }], fee: 0, minutes: 10, dc: 10, stat: 'STR',
        }];
        pack.content.items = [{ slug: 's-item', name: 'Item', kind: 'material', rarity: 'common', value: 1 }];
        pack.content.rules[0].itemRules = [{ def: 's-item', allowedSlots: [], hands: 0, requires: {}, weight: 1 }];
        pack.content.shops = [{ slug: 'sh1', name: 'Shop', place: 'pack.fixture/haven', kind: 'gen', stock: [{ item: 's-item', qty: 1, price: 1 }] }];
        pack.content.creatures = [{ slug: 'cr1', name: 'Foe', tier: 1, level: 1, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: ['s00'], loot: [], loreTags: [] }];
        pack.content.quests = [{ slug: 'q1', name: 'Q', category: 'side', giver: null, turnInPlace: 'pack.fixture/haven', requirements: [], objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/haven' }], reward: { coin: 0, xp: 0, items: [] }, durationMinutes: null, repeat: null, chain: null }];
        pack.content.rules[0].trainers = [{ slug: 'tr1', name: 'Trainer', place: 'pack.fixture/haven', skills: ['s00'], fee: 10, minutes: 60, eventTemplates: [] }];

        const model = openPack(pack);
        assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));
        let targetId = 'haven';
        if (kind === 'classes') targetId = 'c3';
        else if (kind === 'skills') targetId = 's32';
        else if (kind === 'branches') targetId = 's30-base-a';
        else if (kind === 'itemRules') targetId = 's-item';
        else if (kind === 'trainers') targetId = 'tr1';
        else if (kind === 'items') targetId = 's-item';
        else if (kind === 'creatures') targetId = 'cr1';
        else if (kind === 'quests') targetId = 'q1';
        else if (kind === 'shops') targetId = 'sh1';
        else if (kind === 'recipes') targetId = 'rc1';
        else if (kind === 'events') targetId = 'ev1';
        else if (kind === 'routes') targetId = 'rt1';
        else if (kind === 'races') targetId = 'l-race';
        else if (kind === 'talents') targetId = 'l-talent';
        else if (kind === 'presets') targetId = 'l-preset';
        else if (kind === 'legacySkills') targetId = 'l-skill';

        const res = remove(model, kind, targetId, { cascade: true });
        assert.equal(res.ok, true, `Cascade remove for kind ${kind} should succeed`);
        assert.equal(res.undo(), model, `Exact undo for kind ${kind} should restore original snapshot`);

        // Target absent for every kind in document
        const remainingList = (kind === 'classes' || kind === 'skills' || kind === 'branches' || kind === 'itemRules' || kind === 'trainers')
            ? res.model.document.content?.rules?.[0]?.[kind]
            : (kind === 'legacySkills' ? res.model.document.content?.skills : res.model.document.content?.[kind]);
        if (Array.isArray(remainingList)) {
            assert.ok(!remainingList.some(item => (item?.slug ?? item?.id ?? item?.def) === targetId), `Target ${targetId} must be absent from ${kind}`);
        }

        // Unrelated records remain in authored order
        if (kind === 'classes') {
            assert.deepEqual(res.model.document.content.rules[0].classes.map(c => c.slug), ['c0', 'c1', 'c2']);
        }

        // No old typed refs to target
        const fullTargetId = `pack.fixture/${targetId}`;
        const refs = res.model.references || [];
        const targetKind = kind === 'legacySkills' ? 'legacySkills' : kind;
        assert.ok(!refs.some(r => r.targetKind === targetKind && (r.targetId === fullTargetId || r.targetId === targetId)), `No old typed refs to ${kind}/${targetId}`);
        if (kind === 'skills' || kind === 'branches' || kind === 'classes') {
            const remainingSkills = new Set(res.model.document.content.rules[0].skills.map(s => s.slug));
            const removedSkills = model.document.content.rules[0].skills.filter(s => !remainingSkills.has(s.slug));
            assert.ok(!refs.some(r => r.targetKind === 'forms' && (
                (kind === 'branches' && (r.targetId === fullTargetId || r.targetId.startsWith(`${fullTargetId}-`)))
                || removedSkills.some(s => r.targetId === `pack.fixture/${s.slug}-base` || r.targetId.startsWith(`pack.fixture/${s.slug}-base-`))
            )), 'No refs to removed derived forms');
        }

        // Specific cascade behaviors:
        if (kind === 'itemRules') {
            // itemRule removal only deletes itemRule: items and shops stocking it remain
            assert.ok(res.model.document.content.items.some(i => i.slug === 's-item'));
            assert.ok(res.model.document.content.shops.some(s => s.slug === 'sh1'));
            assert.ok(refs.some(r => r.kind === 'shops' && r.targetKind === 'items' && r.targetId === fullTargetId));
        } else if (kind === 'items') {
            // item removal cascades to itemRules, recipes, shops
            assert.equal(res.model.document.content.rules[0].itemRules.length, 0);
            assert.equal(res.model.document.content.shops.length, 0);
            assert.equal(res.model.document.content.recipes.length, 0);
        } else if (kind === 'classes') {
            // class removal cascades to owned skills and branches, no dangling refs
            assert.ok(!res.model.document.content.rules[0].skills.some(s => ['s30', 's31', 's32'].includes(s.slug)));
            assert.equal(res.model.document.content.rules[0].branches.length, 0);
        }
    }

    // Start inventory entries remove exact affected rows
    const startPack = smallRulesPack({
        items: [
            { slug: 'bread', name: 'Bread', kind: 'consumable', rarity: 'common', value: 1 },
            { slug: 'torch', name: 'Torch', kind: 'goods', rarity: 'common', value: 1 },
        ],
        itemRules: [
            { def: 'bread', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
            { def: 'torch', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
        ],
    });
    startPack.start = {
        inventory: {
            items: [
                { item: 'pack.fixture/bread', qty: 3 },
                { item: 'pack.fixture/torch', qty: 1 },
            ],
        },
    };
    const startModel = openPack(startPack);
    assert.equal(startModel.validation.ok, true, JSON.stringify(startModel.validation.errors));
    const delItem = remove(startModel, 'items', 'bread', { cascade: true });
    assert.equal(delItem.ok, true);
    assert.equal(delItem.model.document.start.inventory.items.length, 1);
    assert.equal(delItem.model.document.start.inventory.items[0].item, 'pack.fixture/torch');
    assert.equal(delItem.undo(), startModel);
});

test('remove with cascade handles malformed branch with null fromForm safely without throwing', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].branches.push({
        slug: 'bad-branch',
        skill: 's30',
        fromForm: null,
        step: 1,
        choice: 'a',
        name: 'Bad Branch',
        transforms: [],
    });
    const model = openPack(pack);
    assert.ok(model.document);

    assert.doesNotThrow(() => {
        const res = remove(model, 'skills', 's30', { cascade: true });
        assert.equal(res.ok, true);
    });
});

test('remove without cascade returns complete inbound ref paths and unchanged snapshot', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    const res = remove(model, 'skills', 's30', { cascade: false });
    assert.equal(res.ok, false);
    assert.equal(res.model, model);
    assert.equal(res.errors[0].code, 'referenced');
    assert.ok(Array.isArray(res.references));
    assert.ok(res.references.some(r => r.targetKind === 'skills'));
    assert.ok(res.references.some(r => r.targetKind === 'forms'));
});

test('setField refuses string length > 4000 and retains original model without committing null document', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const res = setField(model, ['name'], 'a'.repeat(4001));
    assert.equal(res.ok, false);
    assert.equal(res.model, model);
    assert.ok(res.errors.length > 0);
});

test('setField refuses array > 1000, depth > 16, and file byte budget limits', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Array > 1000
    const bigArr = new Array(1001).fill(0);
    const arrRes = setField(model, ['content', 'rules', 0, 'classes', 0, 'skills'], bigArr);
    assert.equal(arrRes.ok, false);
    assert.equal(arrRes.model, model);

    // Depth > 16
    let deepObj = 'leaf';
    for (let d = 0; d < 18; d++) deepObj = { nest: deepObj };
    const depthRes = setField(model, ['content', 'rules', 0, 'statLabels'], deepObj);
    assert.equal(depthRes.ok, false);
    assert.equal(depthRes.model, model);

    // Whole-doc candidate > 512 KiB within per-string/key/array/depth limits (including UTF-8 bytes)
    const bigArrOfStrings = [];
    const utf8Chunk = 'abc🔥'.repeat(600); // 3000 chars, well within 4000 char string limit
    for (let i = 0; i < 200; i++) {
        bigArrOfStrings.push(utf8Chunk);
    }
    const byteRes = setField(model, ['content', 'routes'], bigArrOfStrings);
    assert.equal(byteRes.ok, false);
    assert.equal(byteRes.model, model);
    assert.equal(byteRes.model.document, model.document);
});

test('validateAndCloneValue handles hostile proxy and getters without invocation', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].statLabels = {};
    const model = openPack(pack);

    // 1. Throwing ownKeys / getPrototypeOf trap
    let trapInvoked = false;
    const hostileObj = new Proxy({}, {
        ownKeys() {
            trapInvoked = true;
            throw new Error('Hostile ownKeys trap triggered');
        },
        getPrototypeOf() {
            trapInvoked = true;
            throw new Error('Hostile getPrototypeOf trap triggered');
        },
    });

    const res = setField(model, ['content', 'rules', 0, 'statLabels', 'STR'], hostileObj);
    assert.equal(res.ok, false);
    assert.equal(res.model, model);
    assert.equal(trapInvoked, true);

    // 2. Get-only proxy case proving get trap is not invoked
    let getTrapInvoked = false;
    const getOnlyProxy = new Proxy({}, {
        get(target, prop) {
            getTrapInvoked = true;
            throw new Error('Hostile get trap triggered');
        },
    });

    const getRes = setField(model, ['content', 'rules', 0, 'statLabels', 'STR'], getOnlyProxy);
    assert.equal(getTrapInvoked, false);
    assert.equal(getRes.ok, true);
    // Safely copied {} becomes ordinary invalid draft with shared schema errors / document retained
    assert.equal(getRes.model.validation.ok, false);
    assert.notEqual(getRes.model.document, null);

    // 3. Normal getter test with getter never invoked
    let getterInvoked = false;
    const getterObj = {};
    Object.defineProperty(getterObj, 'bad', {
        get() {
            getterInvoked = true;
            throw new Error('Getter invoked');
        },
        enumerable: true,
    });
    const getterRes = setField(model, ['content', 'rules', 0, 'statLabels'], getterObj);
    assert.equal(getterRes.ok, false);
    assert.equal(getterRes.model, model);
    assert.equal(getterInvoked, false);
});

test('setField refuses prototype property traversals and non-own properties', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Traversal through prototype properties: refused with snapshot unchanged
    const toStringRes = setField(model, ['content', 'toString', 'x'], 'exploit');
    assert.equal(toStringRes.ok, false);
    assert.equal(toStringRes.model, model);

    const valueOfRes = setField(model, ['content', 'valueOf', 'x'], 'exploit');
    assert.equal(valueOfRes.ok, false);
    assert.equal(valueOfRes.model, model);

    // Safe new leaf text key allowed per API
    const safeLeafRes = setField(model, ['content', 'toString'], 'safe-text');
    assert.equal(safeLeafRes.ok, true);
    assert.equal(safeLeafRes.model.document.content.toString, 'safe-text');
});

test('setField refuses array writes where index === length, negative, or fractional', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    const classesLen = model.document.content.rules[0].classes.length;
    const appendRes = setField(model, ['content', 'rules', 0, 'classes', classesLen], { slug: 'c4' });
    assert.equal(appendRes.ok, false);
    assert.equal(appendRes.errors[0].code, 'out-of-bounds');

    const fracRes = setField(model, ['content', 'rules', 0, 'classes', 1.5], { slug: 'c-frac' });
    assert.equal(fracRes.ok, false);
    assert.equal(fracRes.errors[0].code, 'bad-index');
});

test('setField refuses replacing a record to change its identity', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    const oldClass = model.document.content.rules[0].classes[0];
    const replacedClass = { ...oldClass, slug: 'c0-changed' };

    const res = setField(model, ['content', 'rules', 0, 'classes', 0], replacedClass);
    assert.equal(res.ok, false);
    assert.equal(res.errors[0].code, 'identity-field');

    // Refuses replacing entire collection
    const replaceColl = setField(model, ['content', 'items'], [{ slug: 'new-sword', name: 'New Sword' }]);
    assert.equal(replaceColl.ok, false);
    assert.equal(replaceColl.errors[0].code, 'identity-field');
});

test('moveClass refuses on pre-existing cyclic class hierarchy in parent walk and descendant BFS', () => {
    const pack = smallRulesPack();
    // Introduce an existing cycle between c1 and c2
    pack.content.rules[0].classes[1].parent = 'c2';
    pack.content.rules[0].classes[2].parent = 'c1';
    const model = openPack(pack);

    // Attempting to move c0 to parent c2 terminates safely and returns cycle error
    const res = moveClass(model, 'c0', 'c2');
    assert.equal(res.ok, false);
    assert.equal(res.errors[0].code, 'tier-chain');

    // Attempting to move c1 to parent c0 terminates safely
    const res2 = moveClass(model, 'c1', 'c0');
    assert.equal(res2.ok, false);
    assert.equal(res2.errors[0].code, 'tier-chain');
});

test('moveClass rejects noninteger parent tier and tier > 3', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[0].tier = 'zero'; // noninteger tier
    const model = openPack(pack);

    const res = moveClass(model, 'c1', 'c0');
    assert.equal(res.ok, false);
    assert.equal(res.errors[0].code, 'tier-chain');
});

test('renameId allows 52-character skill slug and rejects 53-character skill slug before mutating', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const legal52 = 's'.repeat(52);
    const res52 = renameId(model, 'skills', 's30', legal52);
    assert.equal(res52.ok, true);
    assert.equal(res52.model.validation.ok, true, JSON.stringify(res52.model.validation.errors));

    const illegal53 = 's'.repeat(53);
    const res53 = renameId(model, 'skills', 's30', illegal53);
    assert.equal(res53.ok, false);
    assert.equal(res53.model, model);
    assert.equal(res53.errors[0].code, 'numeric-range');
});

test('renameId allows host namespace sharing, refuses derived nodes, and accepts same-pack qualified input', () => {
    const pack = smallRulesPack({
        items: [{ slug: 'iron-bar', name: 'Iron Bar', kind: 'material', rarity: 'common', value: 10 }],
        itemRules: [{ def: 'iron-bar', allowedSlots: [], hands: 0, requires: {}, weight: 1 }],
    });
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    // Host items have a separate namespace from rules classes.
    const kindColl = renameId(model, 'classes', 'c0', 'iron-bar');
    assert.equal(kindColl.ok, true);
    assert.equal(kindColl.model.validation.ok, true);
    assert.equal(kindColl.model.document.content.items[0].slug, 'iron-bar');
    assert.equal(kindColl.model.document.content.rules[0].classes[1].parent, 'iron-bar');

    // Collides with derived node s30-base
    const derivedColl = renameId(model, 'classes', 'c0', 's30-base');
    assert.equal(derivedColl.ok, false);
    assert.equal(derivedColl.errors[0].code, 'dup-id');

    // Accepts same-pack qualified input
    const samePackRes = renameId(model, 'classes', 'c0', 'pack.fixture/hero');
    assert.equal(samePackRes.ok, true);
    assert.equal(samePackRes.model.document.content.rules[0].classes[0].slug, 'hero');
});

test('place rename updates routes to local slug and typed quest/shop/trainer place refs to canonical full ID', () => {
    const pack = smallRulesPack({
        items: [{ slug: 'potion', name: 'Potion', kind: 'consumable', rarity: 'common', value: 10 }],
        itemRules: [{ def: 'potion', allowedSlots: [], hands: 0, requires: {}, weight: 1 }],
        routes: [{ slug: 'road', from: 'haven', to: 'mill', kind: 'road' }],
        shops: [{ slug: 'market', name: 'Market', place: 'pack.fixture/haven', kind: 'general', stock: [{ item: 'potion', qty: 1, price: 10 }] }],
        quests: [{
            slug: 'q1',
            name: 'Q1',
            category: 'side',
            giver: null,
            turnInPlace: 'pack.fixture/haven',
            requirements: [{ kind: 'place', place: 'pack.fixture/haven' }],
            objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/haven' }],
            reward: { coin: 0, xp: 0, items: [] },
            durationMinutes: null,
            repeat: null,
            chain: null,
        }],
        trainers: [{ slug: 'tr1', name: 'Trainer', place: 'pack.fixture/haven', skills: ['s00'], fee: 10, minutes: 60, eventTemplates: [] }],
    });
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));

    const res = renameId(model, 'places', 'haven', 'haven-city');
    assert.equal(res.ok, true);
    const doc = res.model.document;

    // Routes store local slug
    assert.equal(doc.content.routes[0].from, 'haven-city');

    // Shops, quests, trainers store canonical full ID
    assert.equal(doc.content.shops[0].place, 'pack.fixture/haven-city');
    assert.equal(doc.content.quests[0].turnInPlace, 'pack.fixture/haven-city');
    assert.equal(doc.content.quests[0].requirements[0].place, 'pack.fixture/haven-city');
    assert.equal(doc.content.quests[0].objectives[0].place, 'pack.fixture/haven-city');
    assert.equal(doc.content.rules[0].trainers[0].place, 'pack.fixture/haven-city');

    // Renamed pack validates cleanly
    assert.equal(res.model.validation.ok, true, JSON.stringify(res.model.validation.errors));
});

test('renameId on itemRules is refused with identity-field error', () => {
    const pack = smallRulesPack({
        items: [{ slug: 'potion', name: 'Potion', kind: 'consumable', rarity: 'common', value: 10 }],
        itemRules: [{ def: 'potion', allowedSlots: [], hands: 0, requires: {}, weight: 1 }],
    });
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);

    const res = renameId(model, 'itemRules', 'potion', 'elixir');
    assert.equal(res.ok, false);
    assert.equal(res.errors[0].code, 'identity-field');
});

test('class rename accepts place slug with refs and undo, while shared rules and derived collisions are refused', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);

    const dupClass = renameId(model, 'classes', 'c0', 'c1');
    assert.equal(dupClass.ok, false);
    assert.equal(dupClass.errors[0].code, 'dup-id');

    const collSkill = renameId(model, 'classes', 'c0', 's00');
    assert.equal(collSkill.ok, false);
    assert.equal(collSkill.errors[0].code, 'dup-id');

    const collRules = renameId(model, 'classes', 'c0', 'rules');
    assert.equal(collRules.ok, false);
    assert.equal(collRules.errors[0].code, 'dup-id');

    const collDerived = renameId(model, 'classes', 'c0', 's30-base');
    assert.equal(collDerived.ok, false);
    assert.equal(collDerived.errors[0].code, 'dup-id');

    assert.equal(add(model, 'classes', { ...pack.content.rules[0].classes[0], slug: 'haven' }).ok, true);
    assert.equal(add(model, 'classes', { ...pack.content.rules[0].classes[0], slug: 's00' }).errors[0].code, 'dup-id');

    const resRaw = renameId(model, 'classes', 'c0', 'haven');
    assert.equal(resRaw.ok, true);
    assert.equal(resRaw.model.validation.ok, true, JSON.stringify(resRaw.model.validation.errors));
    assert.equal(resRaw.model.document.content.rules[0].classes[0].slug, 'haven');
    assert.equal(resRaw.model.document.content.rules[0].classes[1].parent, 'haven');

    const resQual = renameId(model, 'classes', 'c0', 'pack.fixture/haven');
    assert.equal(resQual.ok, true);
    assert.equal(resQual.model.validation.ok, true, JSON.stringify(resQual.model.validation.errors));
    assert.equal(resQual.model.document.content.rules[0].classes[0].slug, 'haven');
    assert.equal(resQual.model.document.content.rules[0].classes[1].parent, 'haven');

    const reverted = resRaw.undo();
    assert.equal(reverted, model);
    assert.equal(reverted.document.content.rules[0].classes[0].slug, 'c0');
    assert.equal(reverted.document.content.rules[0].classes[1].parent, 'c0');
});

test('advanced skill rename accepts place slug updating class refs and branch graph with undo, while shared collisions are refused', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);

    const collClass = renameId(model, 'skills', 's30', 'c0');
    assert.equal(collClass.ok, false);
    assert.equal(collClass.errors[0].code, 'dup-id');

    const collRules = renameId(model, 'skills', 's30', 'rules');
    assert.equal(collRules.ok, false);
    assert.equal(collRules.errors[0].code, 'dup-id');

    const collOtherDerived = renameId(model, 'skills', 's30', 's00-base');
    assert.equal(collOtherDerived.ok, false);
    assert.equal(collOtherDerived.errors[0].code, 'dup-id');

    assert.equal(add(model, 'skills', { ...pack.content.rules[0].skills[9], slug: 'haven' }).ok, true);
    assert.equal(add(model, 'skills', { ...pack.content.rules[0].skills[9], slug: 'c0' }).errors[0].code, 'dup-id');
    const qualified = renameId(model, 'skills', 'pack.fixture/s30', 'pack.fixture/haven');
    assert.equal(qualified.ok, true);
    assert.equal(qualified.model.validation.ok, true);
    assert.equal(qualified.undo(), model);

    const collisionPack = smallRulesPack();
    collisionPack.content.places.push({ slug: 'haven-base', name: 'Reserved collision', x: 2, y: 0 });
    const collisionModel = openPack(collisionPack);
    const collision = renameId(collisionModel, 'skills', 's30', 'haven');
    assert.equal(collision.ok, false);
    assert.equal(collision.model, collisionModel);
    assert.equal(collision.errors[0].code, 'dup-id');

    const res = renameId(model, 'skills', 's30', 'haven');
    assert.equal(res.ok, true);
    assert.equal(res.model.validation.ok, true, JSON.stringify(res.model.validation.errors));

    const rules = res.model.document.content.rules[0];
    assert.ok(rules.skills.some(s => s.slug === 'haven'));
    assert.ok(!rules.skills.some(s => s.slug === 's30'));

    const c3 = rules.classes.find(c => c.slug === 'c3');
    assert.ok(c3.skills.includes('haven'));
    assert.ok(!c3.skills.includes('s30'));

    const havenBranches = rules.branches.filter(b => b.skill === 'haven');
    assert.ok(havenBranches.length > 0);
    assert.ok(havenBranches.every(b => b.slug.startsWith('haven-base-')));
    assert.ok(havenBranches.every(b => b.fromForm.startsWith('haven-base')));

    const reverted = res.undo();
    assert.equal(reverted, model);
    const revRules = reverted.document.content.rules[0];
    assert.ok(revRules.skills.some(s => s.slug === 's30'));
    const revC3 = revRules.classes.find(c => c.slug === 'c3');
    assert.ok(revC3.skills.includes('s30'));
});

test('add written branch repairs graph, restores golden export/hash, supports empty lists, and undos cleanly', () => {
    const fullPack = smallRulesPack();
    const fullModel = openPack(fullPack);
    assert.equal(fullModel.validation.ok, true);

    const pack = smallRulesPack();
    const branch = pack.content.rules[0].branches.pop();
    const model = openPack(pack);
    assert.equal(model.validation.ok, false); // initial invalid graph

    const branchCopy = JSON.parse(JSON.stringify(branch));
    const res = add(model, 'branches', branch);
    assert.equal(res.ok, true);
    assert.equal(res.model.validation.ok, true); // final valid
    assert.equal(res.model.rulesHash, fullModel.rulesHash);
    assert.equal(res.model.packHash, fullModel.packHash);
    assert.equal(exportPack(res.model), exportPack(fullModel));
    assert.deepEqual(branch, branchCopy); // no caller mutation
    assert.equal(res.undo(), model); // exact undo

    // Positive add-to-empty-list behavior for normal kinds
    const emptyRoutesPack = smallRulesPack();
    emptyRoutesPack.content.routes = [];
    const emptyModel = openPack(emptyRoutesPack);
    assert.equal(emptyModel.validation.ok, true);
    const addRoute = add(emptyModel, 'routes', { slug: 'new-road', from: 'haven', to: 'haven', kind: 'road' });
    assert.equal(addRoute.ok, true);
    assert.equal(addRoute.model.document.content.routes.length, 1);
    assert.equal(addRoute.undo(), emptyModel);

    // Rejects duplicate authored branch
    const dupBranchRes = add(res.model, 'branches', branch);
    assert.equal(dupBranchRes.ok, false);
    assert.equal(dupBranchRes.errors[0].code, 'dup-id');

    // Rejects base and generated collision
    const baseColl = add(model, 'branches', { slug: 's30-base', skill: 's30', fromForm: 's30-base', choice: 'a', step: 1, name: 'B', transforms: [] });
    assert.equal(baseColl.ok, false);

    const gColl = add(model, 'branches', { slug: 's30-base-g', skill: 's30', fromForm: 's30-base', choice: 'g', step: 1, name: 'B', transforms: [] });
    assert.equal(gColl.ok, false);
});

test('setField allows ordinary reference-field edits and guards against identity bypass and hostile path', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);

    // 1. setField on ordinary reference-field edit is allowed and valid
    const permRes = setField(model, ['content', 'rules', 0, 'classes', 0, 'skills'], ['s01', 's00', 's02']);
    assert.equal(permRes.ok, true);
    assert.equal(permRes.model.validation.ok, true);
    assert.deepEqual(permRes.model.document.content.rules[0].classes[0].skills, ['s01', 's00', 's02']);

    // 2. setField replacing ancestor rules[0] to change skill identity to 'escape' must refuse
    const bypassAttempt = {
        ...model.document.content.rules[0],
        skills: model.document.content.rules[0].skills.map((s, i) => i === 0 ? { ...s, slug: 'escape' } : s),
    };
    const bypassRes = setField(model, ['content', 'rules', 0], bypassAttempt);
    assert.equal(bypassRes.ok, false);
    assert.equal(bypassRes.model, model);
    assert.equal(bypassRes.errors[0].code, 'identity-field');

    // 3. Direct replace identity-bearing record with null, {}, or removed identity must refuse unchanged
    const nullRes = setField(model, ['content', 'rules', 0, 'classes', 0], null);
    assert.equal(nullRes.ok, false);
    assert.equal(nullRes.model, model);

    const emptyRes = setField(model, ['content', 'rules', 0, 'classes', 0], {});
    assert.equal(emptyRes.ok, false);
    assert.equal(emptyRes.model, model);

    const noIdRes = setField(model, ['content', 'rules', 0, 'classes', 0], { name: 'Only Name' });
    assert.equal(noIdRes.ok, false);
    assert.equal(noIdRes.model, model);

    // 4. Same-identity whole-record name/note replacement works
    const oldClass = model.document.content.rules[0].classes[0];
    const updateRes = setField(model, ['content', 'rules', 0, 'classes', 0], { ...oldClass, name: 'Renamed C0', note: 'New Note' });
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.model.document.content.rules[0].classes[0].name, 'Renamed C0');
    assert.equal(updateRes.model.document.content.rules[0].classes[0].slug, 'c0');

    // 5. Reference arrays, effects, transforms ordinary field edits work
    const transRes = setField(model, ['content', 'rules', 0, 'branches', 0, 'transforms'], [{ op: 'set-element', at: 0, value: 'fire' }]);
    assert.equal(transRes.ok, true);

    // 6. Path with getter or hostile proxy: safely inspected BEFORE path.join / for-of
    let pathGetterInvoked = false;
    const pathArr = ['content', 'rules', 0];
    Object.defineProperty(pathArr, 1, {
        get() {
            pathGetterInvoked = true;
            throw new Error('Path getter invoked');
        },
        enumerable: true,
    });
    const pathGetRes = setField(model, pathArr, 'val');
    assert.equal(pathGetRes.ok, false);
    assert.equal(pathGetRes.model, model);
    assert.equal(pathGetterInvoked, false);

    // Coercion object in path
    let coercionInvoked = false;
    const coerceObj = {
        toString() {
            coercionInvoked = true;
            throw new Error('Coercion triggered');
        },
    };
    const coerceRes = setField(model, ['content', coerceObj, 0], 'val');
    assert.equal(coerceRes.ok, false);
    assert.equal(coerceRes.model, model);
    assert.equal(coercionInvoked, false);

    // NaN, fractional, negative at intermediate array segments
    const nanRes = setField(model, ['content', 'rules', NaN, 'classes'], 'val');
    assert.equal(nanRes.ok, false);
    assert.equal(nanRes.model, model);

    const fracRes = setField(model, ['content', 'rules', 1.5, 'classes'], 'val');
    assert.equal(fracRes.ok, false);
    assert.equal(fracRes.model, model);

    const negRes = setField(model, ['content', 'rules', -1, 'classes'], 'val');
    assert.equal(negRes.ok, false);
    assert.equal(negRes.model, model);
});

test('invalid drafts and malformed containers do not crash edit operations', () => {
    // 1. add with content: 'draft' refuses without throwing
    const draftModel = openPack({ id: 'fixture', content: 'draft' });
    assert.doesNotThrow(() => {
        const res = add(draftModel, 'places', { slug: 'town', name: 'Town', x: 0, y: 0 });
        assert.equal(res.ok, false);
        assert.equal(res.model, draftModel);
    });

    // 2. golden pack with content.rules[0].branches=[null], remove cascade does not throw
    const nullBranchPack = smallRulesPack();
    nullBranchPack.content.rules[0].branches = [null];
    const nullBranchModel = openPack(nullBranchPack);
    assert.doesNotThrow(() => {
        const res = remove(nullBranchModel, 'skills', 's30', { cascade: true });
        assert.equal(res.ok, true);
    });

    // 3. non-array classes/skills/branches/itemRules and null records do not throw
    const malformedPack = {
        id: 'fixture',
        version: '2.0.0',
        requires: { storyBlock: '^2', capabilities: ['rb-rules-v2'] },
        content: {
            rules: [{
                slug: 'rules',
                name: 'Rules',
                schema: 2,
                classes: null,
                skills: 'invalid',
                branches: [null, { slug: 'b1', skill: null }],
                itemRules: [null],
            }],
            items: null,
        },
    };
    const malformedModel = openPack(malformedPack);

    assert.doesNotThrow(() => {
        add(malformedModel, 'classes', { slug: 'c1', name: 'C1', tier: 0, parent: null, skills: [] });
        renameId(malformedModel, 'classes', 'c0', 'c1');
        remove(malformedModel, 'skills', 's30', { cascade: true });
        moveClass(malformedModel, 'c1', 'c0');
    });
});

test('numeric-string paths enforce identity guards for records, collections and ancestors', () => {
    const model = openPack(smallRulesPack());
    assert.equal(model.validation.ok, true);
    const before = exportPack(model);
    const manifest = structuredClone(model.document.content.rules[0]);
    manifest.skills[0].slug = 'escape';
    const changedClass = { ...model.document.content.rules[0].classes[0], slug: 'escape' };
    const cases = [
        [['content', 'rules', 0, 'classes', 0], null],
        [['content', 'rules', 0, 'classes', 0], changedClass],
        [['content', 'rules', 0, 'classes'], []],
        [['content', 'rules', 0], manifest],
    ];
    for (const [path, value] of cases) {
        for (const actualPath of [path, path.map(String), path.map((s, i) => i === 2 ? String(s) : s)]) {
            const res = setField(model, actualPath, value);
            assert.equal(res.ok, false, JSON.stringify(actualPath));
            assert.equal(res.errors[0].code, 'identity-field');
            assert.equal(res.model, model);
            assert.equal(exportPack(res.model), before);
            assert.equal(res.model.rulesHash, model.rulesHash);
            assert.equal(res.model.packHash, model.packHash);
        }
    }
    const numeric = setField(model, ['content', 'rules', 0, 'classes', 0, 'name'], 'New class name');
    const strings = setField(model, ['content', 'rules', '0', 'classes', '0', 'name'], 'New class name');
    assert.equal(strings.ok, true);
    assert.equal(strings.model.validation.ok, true);
    assert.equal(exportPack(strings.model), exportPack(numeric.model));
    assert.equal(strings.model.rulesHash, numeric.model.rulesHash);
    assert.equal(strings.model.packHash, numeric.model.packHash);
});


test('addClassSkill creates lower-tier skills without branches and refuses full or missing owners', () => {
    const original = openPack(smallRulesPack());
    assert.equal(addClassSkill(original, 'missing').ok, false);
    const full = addClassSkill(original, 'c0');
    assert.equal(full.ok, false); assert.equal(full.model, original);
    assert.equal(full.errors[0].code, 'class-skills');
    const root = add(original, 'classes', { slug: 'new-skill', name: '[YOUR CLASS NAME]', tier: 0, parent: null, skills: [] }).model;
    const created = addClassSkill(root, 'pack.fixture/new-skill');
    assert.equal(created.ok, true);
    assert.equal(created.undo(), root);
    assert.equal(created.model.document.content.rules[0].branches.length, root.document.content.rules[0].branches.length);
    const skill = created.model.document.content.rules[0].skills.at(-1);
    assert.equal(skill.slug, 'new-skill-1', 'New skills respect the shared rules namespace');
    assert.equal(skill.name, '[YOUR SKILL NAME]');
    assert.deepEqual(created.model.document.content.rules[0].classes.at(-1).skills, [skill.slug]);
    assert.deepEqual(root.document.content.rules[0].classes.at(-1).skills, [], 'The original snapshot is untouched');
});
