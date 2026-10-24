// Fixture integration tests (SPEC §4, §7, §10 D).
// Validates static JSON fixtures, builders, all invalid categories, edit scenarios, and host parity.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { openPack, exportPack, indexReferences } from '../src/model.js';
import { renameId, remove, moveClass, setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';

import {
    validateRulesPack,
    exportRulesV2,
    expandRulesV2,
    powerScore,
    generatePowerUp,
    checkResolvedLimits,
    budgetOf,
    RULES_V2_CONSTANTS,
    RULES_V2_ERROR_CODES,
    RULES_V2_STATS,
    RULES_V2_SLOTS,
    RULES_V2_LIMITS,
} from '../vendor/story-block/src/v2/packs/rules-v2.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';

import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { makeValidExtendedPack, makeBrokenPack } from './fixtures/builders.js';
import { makeEveryKindPack } from './fixtures/everyKindPack.js';
import { editScenarios } from './fixtures/edit-scenarios.js';
import {
    makeOversizedFilePack,
    makeOversizedGraphPack,
    makeParentErrorPack,
    makeLegendaryProvenancePack,
    makeLegendaryPositiveControlPack,
    makeDescendantNumericClosurePack,
    makeDescendantNumericClosurePositivePack,
    makeXpPack,
    makeMissingCapabilityPack,
    makeCleanItemCollisionPack,
} from './fixtures/extra-cases.js';

// -----------------------------------------------------------------------------
// 1. Static Fixtures: valid-pack, broken-bad-ref, broken-tier-chain
// -----------------------------------------------------------------------------

test('static valid-pack.json validates cleanly and round-trips through openPack and exportPack', () => {
    const rawText = readFileSync(new URL('./fixtures/valid-pack.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(rawText);

    const direct = validateRulesPack(parsed);
    assert.equal(direct.ok, true, 'direct validateRulesPack must succeed on valid fixture');
    assert.equal(direct.errors.length, 0);

    const model = openPack(rawText);
    assert.equal(model.validation.ok, true, 'openPack must succeed on valid fixture');
    assert.equal(model.validation.errors.length, 0);
    assert.equal(model.rulesHash, direct.rulesHash);
    assert.equal(model.packHash, direct.packHash);
    assert.equal('hash' in model, false, 'model must not contain ambiguous hash property');

    // Canonical round-trip twice
    const exported1 = exportPack(model);
    const model2 = openPack(exported1);
    assert.equal(model2.validation.ok, true);
    assert.equal(model2.rulesHash, model.rulesHash);
    assert.equal(model2.packHash, model.packHash);

    const exported2 = exportPack(model2);
    assert.equal(exported2, exported1, 'exportPack must be byte-for-byte identical on second round-trip');
});

test('static broken-bad-ref.json fails with bad-ref and passes after single-reference repair', () => {
    const rawText = readFileSync(new URL('./fixtures/broken-bad-ref.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(rawText);

    const model = openPack(parsed);
    assert.equal(model.validation.ok, false);
    assert.ok(
        model.validation.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_REF && e.path.includes('classes[0].skills[0]')),
        'broken-bad-ref.json must fail with bad-ref at classes[0].skills[0]'
    );

    // Repair single reference
    parsed.content.rules[0].classes[0].skills[0] = 's00';
    const repaired = openPack(parsed);
    assert.equal(repaired.validation.ok, true);
    assert.equal(repaired.validation.errors.length, 0);
    assert.ok(repaired.rulesHash && repaired.packHash);
});

test('static broken-tier-chain.json fails with tier-chain and passes after single-parent repair', () => {
    const rawText = readFileSync(new URL('./fixtures/broken-tier-chain.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(rawText);

    const model = openPack(parsed);
    assert.equal(model.validation.ok, false);
    assert.ok(
        model.validation.errors.some(e => e.code === RULES_V2_ERROR_CODES.TIER_CHAIN && e.path.includes('classes[2].parent')),
        'broken-tier-chain.json must fail with tier-chain at classes[2].parent'
    );

    // Repair single parent link
    parsed.content.rules[0].classes[2].parent = 'c1';
    const repaired = openPack(parsed);
    assert.equal(repaired.validation.ok, true);
    assert.equal(repaired.validation.errors.length, 0);
    assert.ok(repaired.rulesHash && repaired.packHash);
});

// -----------------------------------------------------------------------------
// 2. Integration: Canonical round-trip twice, hash stability, and 24+12 graph
// -----------------------------------------------------------------------------

test('canonical export round-trip twice preserves bytes, both hashes, forms, and authored order', () => {
    for (const makePack of [smallRulesPack, makeValidExtendedPack, makeEveryKindPack]) {
        const initial = makePack();
        const initialRawText = JSON.stringify(initial);

        // Validate twice same input
        const val1 = validateRulesPack(initial);
        const val2 = validateRulesPack(JSON.parse(initialRawText));
        assert.equal(val1.ok, true, 'first validation must succeed');
        assert.equal(val2.ok, true, 'second validation must succeed');
        assert.deepEqual(val2.resolved.forms, val1.resolved.forms, 'resolved.forms must match across duplicate validation');
        assert.equal(val2.rulesHash, val1.rulesHash, 'rulesHash must match');
        assert.equal(val2.packHash, val1.packHash, 'packHash must match');

        // First export round-trip
        const model1 = openPack(initial);
        assert.equal(model1.validation.ok, true);
        assert.equal(model1.rulesHash, val1.rulesHash);
        assert.equal(model1.packHash, val1.packHash);

        const exp1 = exportPack(model1);
        const valExp1 = validateRulesPack(exp1);
        assert.equal(valExp1.ok, true);
        assert.deepEqual(valExp1.resolved.forms, val1.resolved.forms, 'resolved.forms must match after export 1');
        assert.equal(valExp1.rulesHash, val1.rulesHash);
        assert.equal(valExp1.packHash, val1.packHash);

        // Second export round-trip
        const model2 = openPack(exp1);
        assert.equal(model2.validation.ok, true);
        assert.equal(model2.rulesHash, model1.rulesHash);
        assert.equal(model2.packHash, model1.packHash);

        const exp2 = exportPack(model2);
        assert.equal(exp2, exp1, 'second export text must match first exactly');

        const valExp2 = validateRulesPack(exp2);
        assert.equal(valExp2.ok, true);
        assert.deepEqual(valExp2.resolved.forms, val1.resolved.forms, 'resolved.forms must match after export 2');
        assert.equal(valExp2.rulesHash, val1.rulesHash);
        assert.equal(valExp2.packHash, val1.packHash);

        const model3 = openPack(exp2);
        assert.equal(model3.rulesHash, model1.rulesHash);
        assert.equal(model3.packHash, model1.packHash);
        assert.deepEqual(model3.document, model2.document);

        // Assert authored class/skill/branch/effect/transform order unchanged across round-trips
        const origRules = initial.content.rules[0];
        const m2Rules = model2.document.content.rules[0];
        const m3Rules = model3.document.content.rules[0];

        for (const docRules of [m2Rules, m3Rules]) {
            // Class order
            assert.deepEqual(
                docRules.classes.map(c => c.slug),
                origRules.classes.map(c => c.slug),
                'class order must be preserved'
            );

            // Skill order
            assert.deepEqual(
                docRules.skills.map(s => s.slug),
                origRules.skills.map(s => s.slug),
                'skill order must be preserved'
            );

            // Branch order
            assert.deepEqual(
                docRules.branches.map(b => b.slug),
                origRules.branches.map(b => b.slug),
                'branch order must be preserved'
            );

            // Effect order within skills
            for (let i = 0; i < origRules.skills.length; i++) {
                assert.deepEqual(
                    docRules.skills[i].base.effects,
                    origRules.skills[i].base.effects,
                    `skill[${i}] effect order must be preserved`
                );
            }

            // Transform order within branches
            for (let i = 0; i < origRules.branches.length; i++) {
                assert.deepEqual(
                    docRules.branches[i].transforms,
                    origRules.branches[i].transforms,
                    `branch[${i}] transform order must be preserved`
                );
            }
        }
    }
});

test('advanced tier-3 class has exactly 24 written and 12 generated forms (resolved API inspection)', () => {
    const pack = smallRulesPack();
    const result = validateRulesPack(pack);
    assert.equal(result.ok, true);

    const forms = result.resolved.forms;
    const formKeys = Object.keys(forms);
    // 4 classes * 3 skills = 12 base forms. Tier 3 has 3 skills with 12 descendants each = 36 descendants.
    // Total forms = 12 + 36 = 48.
    assert.equal(formKeys.length, 48);

    const tier3Forms = Object.values(forms).filter(f => f.tier === 3);
    const baseCount = tier3Forms.filter(f => f.origin === 'base').length;
    const writtenCount = tier3Forms.filter(f => f.origin === 'written').length;
    const generatedCount = tier3Forms.filter(f => f.origin === 'generated').length;

    assert.equal(baseCount, 3, 'tier 3 has exactly 3 base forms (1 per skill)');
    assert.equal(writtenCount, 24, 'tier 3 has exactly 24 written branch forms (8 per skill)');
    assert.equal(generatedCount, 12, 'tier 3 has exactly 12 generated power-up forms (4 per skill)');

    // Inspect each advanced skill graph structure
    for (const slug of ['s30', 's31', 's32']) {
        const baseId = `pack.fixture/${slug}-base`;
        const skillForms = Object.values(forms).filter(f => f.skill === `pack.fixture/${slug}`);

        assert.equal(skillForms.filter(f => f.origin === 'written').length, 8);
        assert.equal(skillForms.filter(f => f.origin === 'generated').length, 4);

        // Step 1: base-g, base-a, base-b
        assert.ok(forms[`${baseId}-g`]);
        assert.equal(forms[`${baseId}-g`].step, 1);
        assert.equal(forms[`${baseId}-g`].origin, 'generated');

        assert.ok(forms[`${baseId}-a`]);
        assert.equal(forms[`${baseId}-a`].step, 1);
        assert.equal(forms[`${baseId}-a`].origin, 'written');

        assert.ok(forms[`${baseId}-b`]);
        assert.equal(forms[`${baseId}-b`].step, 1);
        assert.equal(forms[`${baseId}-b`].origin, 'written');

        // Step 2 from each step 1 parent
        for (const parent of [`${baseId}-g`, `${baseId}-a`, `${baseId}-b`]) {
            assert.ok(forms[`${parent}-g`], `missing generated form from ${parent}`);
            assert.equal(forms[`${parent}-g`].step, 2);
            assert.equal(forms[`${parent}-g`].origin, 'generated');
            assert.equal(forms[`${parent}-g`].fromForm, parent);

            assert.ok(forms[`${parent}-a`], `missing written a form from ${parent}`);
            assert.equal(forms[`${parent}-a`].step, 2);
            assert.equal(forms[`${parent}-a`].origin, 'written');
            assert.equal(forms[`${parent}-a`].fromForm, parent);

            assert.ok(forms[`${parent}-b`], `missing written b form from ${parent}`);
            assert.equal(forms[`${parent}-b`].step, 2);
            assert.equal(forms[`${parent}-b`].origin, 'written');
            assert.equal(forms[`${parent}-b`].fromForm, parent);
        }
    }
});

test('everyKindPack fixture covers every effect variant, both unit variants, all 9 transform ops, and typed records', () => {
    const pack = makeEveryKindPack();
    const result = validateRulesPack(pack);
    assert.equal(result.ok, true, `everyKindPack must be valid: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 0);

    const rules = pack.content.rules[0];

    // Effect variants coverage
    const allEffects = rules.skills.flatMap(s => s.base.effects);
    const ops = new Set(allEffects.map(e => e.op));
    assert.ok(ops.has('damage'));
    assert.ok(ops.has('heal'));
    assert.ok(ops.has('shield'));
    assert.ok(ops.has('condition'));
    assert.ok(ops.has('stat'));

    // Damage types
    const damageTypes = new Set(allEffects.filter(e => e.op === 'damage').map(e => e.damageType));
    assert.ok(damageTypes.has('physical'));
    assert.ok(damageTypes.has('magic'));

    // Condition kinds (harmful debuffs and beneficial buffs)
    const conditionKinds = new Set(allEffects.filter(e => e.op === 'condition').map(e => e.kind));
    assert.ok(conditionKinds.has('poison'));
    assert.ok(conditionKinds.has('regen'));
    assert.ok(conditionKinds.has('guard'));

    // Both unit variants: summon and pet
    const units = rules.skills.map(s => s.base.unit).filter(Boolean);
    const unitKinds = new Set(units.map(u => u.kind));
    assert.ok(unitKinds.has('summon'), 'must include summon unit');
    assert.ok(unitKinds.has('pet'), 'must include pet unit');

    // Transform ops: all 9 ops on s30 branches
    const s30Transforms = rules.branches.filter(b => b.skill === 's30').flatMap(b => b.transforms);
    const transformOps = new Set(s30Transforms.map(t => t.op));
    const expectedTransformOps = [
        'set-element',
        'set-power',
        'remove-effect',
        'add-effect',
        'set-target',
        'replace-effect',
        'set-stat',
        'set-cost',
        'set-type',
    ];
    for (const op of expectedTransformOps) {
        assert.ok(transformOps.has(op), `s30 branches must cover transform op "${op}"`);
    }

    // 7 renamed stat labels
    assert.equal(Object.keys(rules.statLabels).length, 7);
    for (const stat of RULES_V2_STATS) {
        assert.ok(rules.statLabels[stat], `stat label for ${stat} must be present`);
    }

    // Equipment items: 2H weapon, 1H dual-slot, consumable non-equipment
    const greatsword = pack.content.items.find(i => i.slug === 'greatsword');
    const dagger = pack.content.items.find(i => i.slug === 'dagger');
    const potion = pack.content.items.find(i => i.slug === 'potion');
    assert.ok(greatsword && dagger && potion);

    const gsRule = rules.itemRules.find(r => r.def === 'greatsword');
    const dgRule = rules.itemRules.find(r => r.def === 'dagger');
    const ptRule = rules.itemRules.find(r => r.def === 'potion');
    assert.deepEqual(gsRule.allowedSlots, ['weapon']);
    assert.equal(gsRule.hands, 2);
    assert.deepEqual(dgRule.allowedSlots, ['weapon', 'offhand']);
    assert.equal(dgRule.hands, 1);
    assert.deepEqual(ptRule.allowedSlots, []);
    assert.equal(ptRule.hands, 0);

    // Trainer with event template
    assert.ok(rules.trainers.length > 0);
    assert.ok(rules.trainers[0].eventTemplates.includes('trial-combat'));
    assert.ok(pack.content.events.some(e => e.id === 'trial-combat'));

    // Typed quests, shops, recipes
    assert.ok(pack.content.quests.length >= 2);
    const supplyRun = pack.content.quests.find(q => q.slug === 'supply-run');
    assert.ok(supplyRun);
    const reqKinds = new Set(supplyRun.requirements.map(r => r.kind));
    for (const rk of ['level', 'stat', 'quest', 'item', 'place', 'thread', 'class', 'flag']) {
        assert.ok(reqKinds.has(rk), `quest requirements must cover kind "${rk}"`);
    }
    const objKinds = new Set(supplyRun.objectives.map(o => o.kind));
    for (const ok of ['collect', 'visit', 'story', 'kill']) {
        assert.ok(objKinds.has(ok), `quest objectives must cover kind "${ok}"`);
    }

    assert.ok(pack.content.shops.length >= 1);
    assert.ok(pack.content.recipes.length >= 1);
});

test('defaults normalization applies cleanly and external canonical refs pass structure', () => {
    const pack = makeValidExtendedPack();
    delete pack.content.rules[0].statLabels;
    delete pack.content.rules[0].memory;
    delete pack.content.rules[0].classes[0].note;
    delete pack.content.rules[0].skills[0].note;
    delete pack.content.rules[0].skills[0].replaces;
    delete pack.content.rules[0].branches[0].note;
    delete pack.content.rules[0].itemRules[0].unique;
    delete pack.content.recipes[0].known;

    // External canonical SD place and NSD NPC references
    pack.content.shops[0].place = 'pl_0000abcd';
    pack.content.quests[0].giver = 'np_0000ef01';
    pack.content.quests[0].turnInPlace = 'pack.world/citadel';

    const res = validateRulesPack(pack);
    assert.equal(res.ok, true, `must validate cleanly: ${JSON.stringify(res.errors)}`);
    assert.equal(res.errors.length, 0);

    // Schema defaults
    assert.deepEqual(res.pack.content.rules[0].statLabels, {});
    assert.equal(res.pack.content.rules[0].memory, 'deja-vu');
    assert.equal(res.pack.content.rules[0].classes[0].note, '');
    assert.equal(res.pack.content.rules[0].skills[0].note, '');
    assert.equal(res.pack.content.rules[0].skills[0].replaces, null);
    assert.equal(res.pack.content.rules[0].branches[0].note, '');
    assert.equal(res.pack.content.rules[0].itemRules[0].unique, false);
    assert.equal(res.pack.content.recipes[0].known, true);

    // Foreign reference warnings
    assert.ok(res.warnings.some(w => w.path.includes('turnInPlace')));
});

// -----------------------------------------------------------------------------
// 3. Section 10 D: All 37 Invalid Categories with Stable Error Codes
// -----------------------------------------------------------------------------

test('section 10 D: covers 37 invalid fixture cases with stable error codes', () => {
    // Explicit data table matching expected primary error codes for fixture cases
    const INVALID_FIXTURES_TABLE = [
        ['envelope-unknown', 'envelope-unknown'],
        ['bad-capability', 'bad-capability'],
        ['unsafe-markup', 'unsafe-markup'],
        ['unsafe-key', 'unsafe-key'],
        ['control-character', 'control-character'],
        ['dup-id', 'dup-id'],
        ['tier-chain', 'tier-chain'],
        ['class-skills', 'class-skills'],
        ['branch-graph', 'branch-graph'],
        ['numeric-range', 'numeric-range'],
        ['bad-transform', 'bad-transform'],
        ['bad-effect', 'bad-effect'],
        ['mp-sp-conflict', 'mp-sp-conflict'],
        ['numeric-only-branch', 'numeric-only-branch'],
        ['budget-closure', 'budget-closure'],
        ['bad-ref', 'bad-ref'],
        ['item-rule-mismatch', 'item-rule-mismatch'],
        ['bad-xp-per-level', 'bad-xp-per-level'],
        ['bad-schema', 'bad-schema'],
        ['generated-collision', 'dup-id'],
        ['skill-generated-collision', 'dup-id'],
        ['class-generated-collision', 'dup-id'],
        ['item-generated-collision', 'UNKNOWN_REF'],
        ['cycle-class', 'tier-chain'],
        ['orphan-class', 'bad-ref'],
        ['leaf-not-tier3', 'tier-chain'],
        ['root-not-tier0', 'tier-chain'],
        ['foreign-internal-ref', 'bad-ref'],
        ['skills-count-2', 'class-skills'],
        ['skills-count-4', 'class-skills'],
        ['orphan-skill', 'class-skills'],
        ['missing-step2-branch', 'branch-graph'],
        ['unknown-kind', 'envelope-unknown'],
        ['unaccounted-branch', 'branch-graph'],
        ['item-rule-duplicate', 'item-rule-mismatch'],
        ['item-rule-2h-offhand', 'item-rule-mismatch'],
        ['item-rule-non-equip-slot', 'item-rule-mismatch'],
    ];

    assert.equal(INVALID_FIXTURES_TABLE.length, 37, 'must cover all 37 invalid fixture cases');

    for (const [fixtureKey, expectedCode] of INVALID_FIXTURES_TABLE) {
        const { pack, constants } = makeBrokenPack(fixtureKey);
        const options = constants ? { constants } : {};
        const res = validateRulesPack(pack, options);

        assert.equal(res.ok, false, `fixture for "${fixtureKey}" must fail validation`);
        assert.ok(res.errors.length > 0, `fixture for "${fixtureKey}" must report errors`);

        // Assert exact error code for EVERY row without loose alternatives
        assert.ok(
            res.errors.some(e => e.code === expectedCode),
            `fixture for "${fixtureKey}" must fail with exact code "${expectedCode}", got: ${JSON.stringify(res.errors.map(e => e.code))}`
        );

        // Verify missing-step2-branch has exactly 12 written branches
        if (fixtureKey === 'missing-step2-branch') {
            assert.equal(pack.content.rules[0].branches.length, 12, 'missing-step2-branch fixture must have exactly 12 written branches');
        }
    }

    // Clean generated item collision fixture proves dup-id without incidental references
    const cleanItemPack = makeCleanItemCollisionPack();
    const resCleanItem = validateRulesPack(cleanItemPack);
    assert.equal(resCleanItem.ok, false);
    assert.equal(resCleanItem.errors.length, 1);
    assert.equal(resCleanItem.errors[0].code, RULES_V2_ERROR_CODES.DUP_ID);
    assert.equal(resCleanItem.errors[0].path, 'content.items[0].slug');
    assert.ok(
        resCleanItem.errors[0].message.includes('pack.fixture/s30-base-g'),
        'item collision message must identify colliding generated form'
    );

    // Skill collision proves dup-id at content.rules[0].skills[0].slug
    const { pack: skillPack } = makeBrokenPack('skill-generated-collision');
    const resSkill = validateRulesPack(skillPack);
    assert.equal(resSkill.ok, false);
    assert.ok(
        resSkill.errors.some(e => e.code === RULES_V2_ERROR_CODES.DUP_ID && e.path === 'content.rules[0].skills[0].slug'),
        'skill collision must report dup-id at content.rules[0].skills[0].slug'
    );
});

test('exact parent errors: missing, wrong skill, wrong step, and generated-parent', () => {
    // Missing parent form
    const missingPack = makeParentErrorPack('missing-parent');
    const resMissing = validateRulesPack(missingPack);
    assert.equal(resMissing.ok, false);
    assert.ok(resMissing.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.path.includes('branches[0].fromForm')));

    // Foreign parent form
    const foreignPack = makeParentErrorPack('foreign-parent');
    const resForeign = validateRulesPack(foreignPack);
    assert.equal(resForeign.ok, false);
    assert.ok(resForeign.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.path.includes('branches[0].fromForm')));

    // Wrong skill parent form
    const wrongSkillPack = makeParentErrorPack('wrong-skill-parent');
    const resWrongSkill = validateRulesPack(wrongSkillPack);
    assert.equal(resWrongSkill.ok, false);
    assert.ok(resWrongSkill.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.path.includes('branches[0].fromForm')));

    // Wrong step parent form (step 2 branch pointing to step 0 base)
    const wrongStepPack = makeParentErrorPack('wrong-step-parent');
    const resWrongStep = validateRulesPack(wrongStepPack);
    assert.equal(resWrongStep.ok, false);
    assert.ok(resWrongStep.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.path.includes('branches[2].fromForm')));

    // Generated parent is VALID: step 2 branches with fromForm = 's30-base-g' succeed in golden control
    const validPack = smallRulesPack();
    const resValid = validateRulesPack(validPack);
    assert.equal(resValid.ok, true);
    assert.ok(resValid.resolved.forms['pack.fixture/s30-base-g-a']);
    assert.ok(resValid.resolved.forms['pack.fixture/s30-base-g-b']);

    // Invalid generated-parent exactness test:
    // in golden pack find branch slug s30-base-g-a then change fromForm to s30-base-a, leave slug unchanged.
    const mismatchPack = makeParentErrorPack('generated-parent-mismatch');
    const resMismatch = validateRulesPack(mismatchPack);
    assert.equal(resMismatch.ok, false);
    assert.ok(
        resMismatch.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.path.includes('branches[2].slug')),
        'branch slug mismatch must report branch-graph error at branches[2].slug'
    );
    assert.ok(
        resMismatch.errors.some(e => e.code === RULES_V2_ERROR_CODES.BRANCH_GRAPH && e.message.includes('Parent form "pack.fixture/s30-base-g" must have written step-2 choices')),
        'generated parent missing written choice must report branch-graph error'
    );
});

test('closed schema rejects generated legendary author metadata without claiming runtime provenance', () => {
    // Positive control: authored legendary item without injected authoring metadata passes
    const validLegendary = makeLegendaryPositiveControlPack();
    const resValid = validateRulesPack(validLegendary);
    assert.equal(resValid.ok, true, `authored legendary item without metadata must pass: ${JSON.stringify(resValid.errors)}`);
    assert.equal(resValid.errors.length, 0);

    // Closed schema rejects authoring metadata on itemRule:
    // extra author metadata returns envelope-unknown because the engine authoring schema is closed.
    const pack = makeLegendaryProvenancePack();
    const res = validateRulesPack(pack);
    assert.equal(res.ok, false);
    assert.ok(
        res.errors.some(e => e.code === RULES_V2_ERROR_CODES.ENVELOPE_UNKNOWN && e.path === 'content.rules[0].itemRules[0].provenance'),
        'injected provenance metadata on itemRule must be rejected by closed authoring schema with envelope-unknown'
    );
});

test('oversized file (>512 KiB) and oversized graph (array limit) fail with expected limits', () => {
    // Oversized file > 512 KiB
    const filePack = makeOversizedFilePack();
    const fileBytes = new TextEncoder().encode(JSON.stringify(filePack)).length;
    assert.ok(fileBytes > 512 * 1024, `oversized file fixture must exceed 512 KiB (got ${fileBytes})`);

    const resFile = validateRulesPack(filePack);
    assert.equal(resFile.ok, false);
    assert.ok(resFile.errors.some(e => e.code === RULES_V2_ERROR_CODES.TOO_LARGE));

    // Oversized graph: > 1000 rules branches, safely under 512 KiB raw
    const graphPack = makeOversizedGraphPack();
    const graphBytes = new TextEncoder().encode(JSON.stringify(graphPack)).length;
    assert.ok(
        graphPack.content.rules[0].branches.length > RULES_V2_LIMITS.branches,
        `graph branches (${graphPack.content.rules[0].branches.length}) must exceed RULES_V2_LIMITS.branches (${RULES_V2_LIMITS.branches})`
    );
    assert.ok(graphBytes < 512 * 1024, `graphPack should remain under 512 KiB raw (got ${graphBytes})`);

    const resGraph = validateRulesPack(graphPack);
    assert.equal(resGraph.ok, false);
    assert.ok(
        resGraph.errors.some(e => e.code === RULES_V2_ERROR_CODES.TOO_LARGE && e.path === 'content.rules[0].branches'),
        'oversized branches array must fail with too-large only at content.rules[0].branches'
    );
});

test('descendant generation numeric closure: condition rounds 6 generates 7 failing limit 6, rounds 5 passes', () => {
    // Numeric closure failure: branch s30-base-a has condition with rounds: 6.
    // Written step-2 branches have valid replace-effect damage 80, but generated s30-base-a-g tries 7 rounds.
    // Shared checker returns bad-rules at effects[0].rounds with message "Condition rounds exceed 6".
    const closurePack = makeDescendantNumericClosurePack();
    const resClosure = validateRulesPack(closurePack);
    assert.equal(resClosure.ok, false);
    assert.ok(
        resClosure.errors.some(
            e => e.code === RULES_V2_ERROR_CODES.BAD_RULES && e.path === 'effects[0].rounds' && e.message === 'Condition rounds exceed 6'
        ),
        'generated form exceeding condition rounds limit 6 must fail with bad-rules at effects[0].rounds'
    );

    // Positive control: same authored branch with rounds 5 generates rounds 6 and full pack passes
    const posPack = makeDescendantNumericClosurePositivePack();
    const resPos = validateRulesPack(posPack);
    assert.equal(resPos.ok, true, `positive control rounds 5 -> 6 must pass: ${JSON.stringify(resPos.errors)}`);
    assert.equal(resPos.errors.length, 0);
    assert.equal(resPos.resolved.forms['pack.fixture/s30-base-a-g'].effects[0].rounds, 6);

    // Budget-closure case with exact code
    const { pack: budgetPack } = makeBrokenPack(RULES_V2_ERROR_CODES.BUDGET_CLOSURE);
    const resBudget = validateRulesPack(budgetPack);
    assert.equal(resBudget.ok, false);
    assert.ok(
        resBudget.errors.some(e => e.code === RULES_V2_ERROR_CODES.BUDGET_CLOSURE),
        'power score exceeding budget must fail with budget-closure'
    );
});

test('constants xpPerLevel: xp95 invalid multipleOf 10, xp100 passes', () => {
    const { pack: pack95, constants: c95 } = makeXpPack(95);
    const res95 = validateRulesPack(pack95, { constants: c95 });
    assert.equal(res95.ok, false);
    assert.ok(res95.errors.some(e => e.code === RULES_V2_ERROR_CODES.BAD_XP_PER_LEVEL && e.path.includes('xpPerLevel')));

    const { pack: pack100, constants: c100 } = makeXpPack(100);
    const res100 = validateRulesPack(pack100, { constants: c100 });
    assert.equal(res100.ok, true);
    assert.equal(res100.errors.length, 0);
});

// -----------------------------------------------------------------------------
// 4. Host Registration and Capability Parity
// -----------------------------------------------------------------------------

test('host validatePack succeeds on valid fixture with hash parity and rejects empty capabilities', () => {
    const pack = makeValidExtendedPack();

    const direct = validateRulesPack(pack);
    assert.equal(direct.ok, true);

    const hostRes = validatePack(pack);
    assert.equal(hostRes.ok, true);
    assert.equal(hostRes.rulesHash, direct.rulesHash, 'host rulesHash must equal direct rulesHash');
    assert.equal(hostRes.packHash, direct.packHash, 'host packHash must equal direct packHash');

    // Host with empty capabilities rejects with MISSING_CAPABILITY
    const hostNoCaps = validatePack(pack, { capabilities: [] });
    assert.equal(hostNoCaps.ok, false);
    assert.ok(
        hostNoCaps.errors.some(e => e.code === RULES_V2_ERROR_CODES.MISSING_CAPABILITY && e.path.includes('capabilities')),
        'host with empty capabilities must reject with MISSING_CAPABILITY'
    );

    // Truly unknown kind is rejected as UNKNOWN_KIND with path content.trulyUnknownKind
    const packUnknownKind = makeValidExtendedPack();
    packUnknownKind.content.trulyUnknownKind = [];
    const hostUnknown = validatePack(packUnknownKind);
    assert.equal(hostUnknown.ok, false);
    assert.ok(
        hostUnknown.errors.some(e => e.code === 'UNKNOWN_KIND' && e.path === 'content.trulyUnknownKind'),
        'host validatePack must reject truly unknown kind with UNKNOWN_KIND code and exact path'
    );
});

test('pack with content.rules and empty requires.capabilities fails with MISSING_CAPABILITY', () => {
    // Missing capability on pack (separate from host options capabilities)
    const packMissingCap = makeMissingCapabilityPack();
    const resMissingCap = validateRulesPack(packMissingCap);
    assert.equal(resMissingCap.ok, false);
    assert.ok(
        resMissingCap.errors.some(e => e.code === RULES_V2_ERROR_CODES.MISSING_CAPABILITY && e.path === 'requires.capabilities'),
        'pack with content.rules and empty capabilities must fail with MISSING_CAPABILITY'
    );
});

test('budgetOf remains null compatibility stub while pure powerScore and generatePowerUp function', () => {
    assert.equal(budgetOf(), null);

    const form = {
        effects: [{ op: 'damage', target: 'one', power: 40, element: 'none', damageType: 'physical' }],
        unit: null,
    };
    const scoreRes = powerScore(form);
    assert.equal(scoreRes.ok, true);
    assert.equal(scoreRes.score, 4);

    const validPack = validateRulesPack(smallRulesPack());
    assert.equal(validPack.ok, true);
    const baseForm = validPack.resolved.forms['pack.fixture/s30-base'];
    assert.ok(baseForm);

    const genRes = generatePowerUp(baseForm);
    assert.equal(genRes.ok, true);
    assert.equal(genRes.form.origin, 'generated');
    assert.equal(genRes.form.step, 1);
    assert.equal(genRes.form.id, 'pack.fixture/s30-base-g');

    const limitsRes = checkResolvedLimits(validPack.resolved);
    assert.equal(limitsRes.ok, true);
});

// -----------------------------------------------------------------------------
// 5. Edit Scenarios: Real Edits, History, and Exact Undo Verification
// -----------------------------------------------------------------------------

for (const scenario of editScenarios()) {
    test(`edit scenario: ${scenario.name}`, () => {
        const initialModel = openPack(scenario.pack);
        assert.equal(initialModel.validation.ok, true, `${scenario.name}: starting model must be valid`);
        const initialExport = exportPack(initialModel);
        const initialRulesHash = initialModel.rulesHash;
        const initialPackHash = initialModel.packHash;
        const initialDocSnapshot = initialModel.document;

        const history = createHistory(initialModel);
        assert.equal(history.canUndo, false);
        assert.equal(history.canRedo, false);

        if (scenario.name === 'refused-referenced-deletion') {
            for (const step of scenario.steps) {
                assert.equal(step.op, 'remove');
                const res = remove(history.current, step.kind, step.id, { cascade: step.cascade });
                assert.equal(res.ok, false, 'refused removal must return ok: false');
                assert.equal(res.model, initialModel, 'refused remove must return strict initialModel identity');
                assert.equal(res.errors[0].code, scenario.expected.errorCode);
                assert.ok(Array.isArray(res.references));
                assert.ok(res.references.length >= scenario.expected.minReferencesCount);

                // Assert actual reference paths
                const actualPaths = res.references.map(r => r.path);
                assert.ok(
                    actualPaths.some(p => JSON.stringify(p) === JSON.stringify(['content', 'rules', 0, 'itemRules', 2, 'def'])),
                    'must include itemRules reference path'
                );
                assert.ok(
                    actualPaths.some(p => JSON.stringify(p) === JSON.stringify(['content', 'recipes', 0, 'materials', 0, 'item'])),
                    'must include recipe materials reference path'
                );
                assert.ok(
                    actualPaths.some(p => JSON.stringify(p) === JSON.stringify(['content', 'shops', 0, 'stock', 1, 'item'])),
                    'must include shop stock reference path'
                );

                // No history change
                assert.equal(history.canUndo, false);
                assert.equal(history.canRedo, false);
                assert.equal(history.current, initialModel);
                assert.equal(exportPack(history.current), initialExport);
            }
            return;
        }

        if (scenario.name === 'safe-invalid-set-then-undo') {
            for (const step of scenario.steps) {
                if (step.op === 'setField') {
                    const res = setField(history.current, step.path, step.value);
                    assert.equal(res.ok, true, 'setField on invalid value returns ok: true');
                    history.commit(res);
                }
            }

            // Assert invalid state before undo
            assert.equal(history.current.validation.ok, false);
            assert.ok(history.current.validation.errors.some(e => e.code === scenario.expected.invalidErrorCode));
            assert.equal(
                history.current.document.content.rules[0].skills[0].base.effects[0].power,
                scenario.expected.invalidPower
            );
            const invalidSnapshot = history.current;

            // Undo restores exact clean snapshot
            assert.equal(history.canUndo, true);
            history.undo();
            assert.equal(history.current, initialModel);
            assert.equal(history.current.document, initialDocSnapshot);
            assert.equal(exportPack(history.current), initialExport);
            assert.equal(history.current.rulesHash, initialRulesHash);
            assert.equal(history.current.packHash, initialPackHash);
            assert.equal(history.current.validation.ok, true);
            assert.equal(
                history.current.document.content.rules[0].skills[0].base.effects[0].power,
                scenario.expected.restoredPower
            );

            // Redo restores exact invalid snapshot
            assert.equal(history.canRedo, true);
            history.redo();
            assert.equal(history.current, invalidSnapshot);
            assert.equal(history.current.document, invalidSnapshot.document);
            assert.equal(history.current.validation.ok, false);

            // Undo again restores exact initial snapshot
            history.undo();
            assert.equal(history.current, initialModel);
            assert.equal(history.current.document, initialDocSnapshot);
            return;
        }

        // For all other successful scenarios:
        for (const step of scenario.steps) {
            let res;
            if (step.op === 'renameId') {
                res = renameId(history.current, step.kind, step.id, step.nextId);
            } else if (step.op === 'remove') {
                res = remove(history.current, step.kind, step.id, { cascade: step.cascade });
            } else if (step.op === 'moveClass') {
                res = moveClass(history.current, step.classId, step.newParentId);
            } else if (step.op === 'setField') {
                res = setField(history.current, step.path, step.value);
            }
            assert.equal(res.ok, true, `${scenario.name}: step ${step.op} failed: ${JSON.stringify(res.errors)}`);
            assert.equal(res.model.validation.ok, true, `${scenario.name}: step result must be valid`);

            // Re-export and reopen
            const exported = exportPack(res.model);
            const reopened = openPack(exported);
            assert.equal(reopened.validation.ok, true, `${scenario.name}: re-opened exported model must be valid`);
            assert.equal(reopened.rulesHash, res.model.rulesHash);
            assert.equal(reopened.packHash, res.model.packHash);

            history.commit(res);
        }

        // Scenario-specific assertions
        if (scenario.name === 'rename-advanced-skill-graph') {
            const doc = history.current.document;
            const skill = doc.content.rules[0].skills.find(s => s.slug === scenario.expected.skillSlug);
            assert.ok(skill, 'renamed skill must exist with new slug');

            const cls = doc.content.rules[0].classes.find(c => c.slug === 'c3');
            assert.deepEqual(cls.skills, scenario.expected.classSkills);

            const trainer = doc.content.rules[0].trainers[0];
            assert.deepEqual(trainer.skills, scenario.expected.trainerSkills);

            const s30Branches = doc.content.rules[0].branches.filter(b => b.skill === scenario.expected.skillSlug);
            assert.equal(s30Branches.length, 8);
            assert.deepEqual(s30Branches.map(b => b.slug), scenario.expected.s30BranchSlugs);
            assert.deepEqual(s30Branches.map(b => b.fromForm), scenario.expected.s30BranchFromForms);
            assert.deepEqual(s30Branches.map(b => b.skill), scenario.expected.s30BranchSkills);

            // Unrelated classes and skills order preserved
            assert.deepEqual(
                doc.content.rules[0].classes.map(c => c.slug),
                initialDocSnapshot.content.rules[0].classes.map(c => c.slug)
            );
        } else if (scenario.name === 'rename-referenced-item') {
            const doc = history.current.document;
            const item = doc.content.items.find(i => i.slug === scenario.expected.itemSlug);
            assert.ok(item);
            assert.equal(doc.content.rules[0].itemRules.find(ir => ir.def === scenario.expected.itemRuleDef).def, scenario.expected.itemRuleDef);
            assert.equal(doc.content.creatures[0].loot[0].def, scenario.expected.creatureLootDef);
            assert.equal(doc.content.shops[0].stock[1].item, scenario.expected.shopStockItem);
            assert.equal(doc.content.recipes[0].makes, scenario.expected.recipeMakes);
            assert.equal(doc.content.recipes[0].materials[0].item, scenario.expected.recipeMaterialItem);
            assert.equal(doc.content.quests[0].reward.items[0].def, scenario.expected.questRewardItemDef);

            // Unrelated items order preserved
            assert.deepEqual(
                doc.content.items.map(i => i.slug),
                ['greatsword', 'dagger', scenario.expected.itemSlug]
            );
        } else if (scenario.name === 'rename-local-place-and-routes') {
            const doc = history.current.document;
            assert.ok(doc.content.places.some(p => p.slug === scenario.expected.placeSlug));
            assert.equal(doc.content.shops[0].place, scenario.expected.shopPlace);
            assert.equal(doc.content.rules[0].trainers[0].place, scenario.expected.trainerPlace);
            assert.equal(doc.content.quests[0].turnInPlace, scenario.expected.questTurnInPlace);

            const r1 = doc.content.routes.find(r => r.slug === 'harbor-to-mill');
            assert.equal(r1.from, scenario.expected.routeFromHavenName);
            const r2 = doc.content.routes.find(r => r.slug === 'mill-to-port');
            assert.equal(r2.to, scenario.expected.routeToHavenAlias);
            const r3 = doc.content.routes.find(r => r.slug === 'direct-slug-route');
            assert.equal(r3.from, scenario.expected.routeFromHavenSlug);

            // Unrelated places order preserved
            assert.deepEqual(
                doc.content.places.map(p => p.slug),
                [scenario.expected.placeSlug, 'mill']
            );
        } else if (scenario.name === 'rename-referenced-class') {
            const doc = history.current.document;
            assert.ok(doc.content.rules[0].classes.some(c => c.slug === scenario.expected.classSlug));
            const c1 = doc.content.rules[0].classes.find(c => c.slug === 'c1');
            assert.equal(c1.parent, scenario.expected.childClassParent);

            // Unrelated classes order preserved
            assert.deepEqual(
                doc.content.rules[0].classes.map(c => c.slug),
                [scenario.expected.classSlug, 'c1', 'c2', 'c3']
            );
        } else if (scenario.name === 'cascade-deletion') {
            const doc = history.current.document;
            assert.equal(doc.content.items.length, scenario.expected.itemRemainingCount);
            assert.equal(doc.content.rules[0].itemRules.length, scenario.expected.itemRuleRemainingCount);
            assert.equal(doc.content.shops.length, scenario.expected.shopRemainingCount);

            // Unrelated items order preserved
            assert.deepEqual(
                doc.content.items.map(i => i.slug),
                ['dagger', 'potion']
            );
        } else if (scenario.name === 'move-class-parent') {
            const doc = history.current.document;
            const c3 = doc.content.rules[0].classes.find(c => c.slug === scenario.expected.classSlug);
            assert.equal(c3.parent, scenario.expected.newParent);
            assert.equal(c3.tier, scenario.expected.newTier);

            const c2 = doc.content.rules[0].classes.find(c => c.slug === 'c2');
            assert.equal(c2.tier, 2);
            const c2b = doc.content.rules[0].classes.find(c => c.slug === 'c2b');
            assert.equal(c2b.tier, 2);

            // Unrelated classes order preserved
            assert.deepEqual(
                doc.content.rules[0].classes.map(c => c.slug),
                initialDocSnapshot.content.rules[0].classes.map(c => c.slug)
            );
        }

        // All successful scenarios: assert undo strict snapshot identity, canonical export bytes, both hashes
        assert.ok(history.canUndo);
        history.undo();
        assert.equal(history.current, initialModel);
        assert.equal(history.current.document, initialDocSnapshot);
        assert.equal(exportPack(history.current), initialExport);
        assert.equal(history.current.rulesHash, initialRulesHash);
        assert.equal(history.current.packHash, initialPackHash);
    });
}
