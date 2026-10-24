import test from 'node:test';
import assert from 'node:assert/strict';

import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { openPack } from '../src/model.js';
import { setField } from '../src/edits.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import {
    renderSkills,
    resolveSkillForms,
    budgetFor,
    findSkillAndOwner,
    applyTransforms,
} from '../src/screens/skills.js';
import {
    validateRulesPack,
    rulesV2Schema,
} from '../vendor/story-block/src/v2/packs/rules-v2.js';

test('T3-1: 13 pathway nodes (1 base, 3 step-1, 9 step-2), 12 SVG connector paths, coordinates, column headers, visible power budget and accessible meter', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30');

    // 13 node buttons in pathway map
    const nodes = ctx.main.querySelectorAll('.path-node');
    assert.equal(nodes.length, 13, 'Must render exactly 13 pathway nodes (1 base + 12 pathway forms)');

    // 12 SVG connector paths (queried specifically on connector SVG, not lock SVGs)
    const paths = ctx.main.querySelectorAll('.pathway-connectors path');
    assert.equal(paths.length, 12, 'Must render exactly 12 SVG connector paths');

    // 3 Column headers
    const colHeaders = ctx.main.querySelectorAll('.pathway-columns-header div');
    assert.equal(colHeaders.length, 3, 'Must have 3 column headers: BASE, STEP 1, STEP 2');
    assert.equal(colHeaders[0].textContent, 'BASE');
    assert.equal(colHeaders[1].textContent, 'STEP 1');
    assert.equal(colHeaders[2].textContent, 'STEP 2');

    // Node steps: 1 step-0, 3 step-1, 9 step-2
    const step0Nodes = nodes.filter(n => n.getAttribute('data-step') === '0');
    const step1Nodes = nodes.filter(n => n.getAttribute('data-step') === '1');
    const step2Nodes = nodes.filter(n => n.getAttribute('data-step') === '2');
    assert.equal(step0Nodes.length, 1, 'Base column has 1 node');
    assert.equal(step1Nodes.length, 3, 'Step 1 column has 3 nodes');
    assert.equal(step2Nodes.length, 9, 'Step 2 column has 9 nodes');

    // Every node has visible power budget indication
    const budgetBadges = ctx.main.querySelectorAll('.path-node-budget');
    assert.equal(budgetBadges.length, 13, 'Every node must render a visible power budget indication');
    for (const b of budgetBadges) {
        assert.match(b.textContent, /^\d+\s*\/\s*\d+$/, 'Budget badge must display score/budget ratio');
    }

    // Default selection is base node
    const baseNode = nodes.find(n => n.getAttribute('data-key') === 'base');
    assert.ok(baseNode);
    assert.equal(baseNode.getAttribute('aria-pressed'), 'true');

    // Inspector budget bar with accessible meter
    const meter = ctx.inspector.querySelector('.budget-track[role="meter"]');
    assert.ok(meter, 'Inspector budget bar must have role="meter" for accessibility');
    assert.equal(meter.getAttribute('aria-valuenow'), '8');
    assert.equal(meter.getAttribute('aria-valuemin'), '0');
    assert.equal(meter.getAttribute('aria-valuemax'), '48');

    // Clicking a step 2 node updates selection and aria-pressed
    const gaNode = nodes.find(n => n.getAttribute('data-key') === 'g-a');
    assert.ok(gaNode);
    assert.equal(gaNode.getAttribute('aria-pressed'), 'false');
    gaNode.click();

    assert.equal(ctx.selection.form, 'g-a');
    const updatedGaNode = ctx.main.querySelector('.path-node[data-key="g-a"]');
    assert.equal(updatedGaNode.getAttribute('aria-pressed'), 'true');
});

test('T3-2: Contract wins over mock: exactly 4 generated forms (g, g-g, a-g, b-g) locked read-only; written children of generated parent (g-a, g-b) ARE editable', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30');

    // Exactly 4 generated nodes
    const genNodes = ctx.main.querySelectorAll('.path-node[data-gen="true"]');
    assert.equal(genNodes.length, 4, 'Must have exactly 4 generated forms');

    const genKeys = genNodes.map(n => n.getAttribute('data-key')).sort();
    assert.deepEqual(genKeys, ['a-g', 'b-g', 'g', 'g-g'], 'Generated keys must be g, g-g, a-g, b-g');

    for (const gn of genNodes) {
        assert.ok(gn.classList.contains('path-node-gen'), 'Generated node must have class path-node-gen');
        const lockSvg = gn.querySelector('svg');
        assert.ok(lockSvg, 'Generated node must render a lock icon SVG');
    }

    // Inspecting generated form g-g shows read-only explanation and NO editable inputs
    ctx.select('skills', 's30', 'g-g');
    const genExplanation = ctx.inspector.querySelector('.generated-explanation');
    assert.ok(genExplanation, 'Generated form inspector must show read-only explanation');
    assert.match(genExplanation.textContent, /Story Block makes this form from its parent/);
    assert.equal(ctx.inspector.querySelector('#form-name'), null, 'Generated form must have no name input');
    assert.equal(ctx.inspector.querySelector('#form-transforms'), null, 'Generated form must have no transforms textarea');

    // CONTRACT WINS OVER MOCK: written children of generated parent "g" (g-a, g-b) ARE written and editable!
    const gaNode = ctx.main.querySelector('.path-node[data-key="g-a"]');
    assert.ok(gaNode);
    assert.equal(gaNode.getAttribute('data-gen'), 'false', 'g-a must NOT be marked generated');
    assert.ok(gaNode.classList.contains('path-node-written'), 'g-a must have class path-node-written');
    assert.equal(gaNode.querySelector('svg'), null, 'g-a must not have lock icon');

    const gbNode = ctx.main.querySelector('.path-node[data-key="g-b"]');
    assert.ok(gbNode);
    assert.equal(gbNode.getAttribute('data-gen'), 'false', 'g-b must NOT be marked generated');

    // Inspecting g-a shows editable controls with valid data-path
    ctx.select('skills', 's30', 'g-a');
    assert.equal(ctx.inspector.querySelector('.generated-explanation'), null);
    const gaNameInput = ctx.inspector.querySelector('#form-name');
    assert.ok(gaNameInput, 'g-a inspector must have editable name input');
    const gaTransforms = ctx.inspector.querySelector('#form-transforms');
    assert.ok(gaTransforms, 'g-a inspector must have editable transforms textarea');

    // Verify data-path points to branches
    const gaDataPath = JSON.parse(gaNameInput.getAttribute('data-path'));
    assert.equal(gaDataPath[0], 'content');
    assert.equal(gaDataPath[1], 'rules');
    assert.equal(gaDataPath[2], 0);
    assert.equal(gaDataPath[3], 'branches');
    assert.equal(gaDataPath[5], 'name');
});

test('T3-3: Base skill editor and written branch editor edit via setField + undo restores original state', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);

    // Edit base skill
    ctx.select('skills', 's30', 'base');
    const nameInput = ctx.inspector.querySelector('#form-name');
    assert.ok(nameInput);
    assert.equal(nameInput.value, 's30');

    nameInput.value = 'Oath Strike';
    nameInput.dispatchEvent({ type: 'change', target: nameInput });

    assert.equal(ctx.model.document.content.rules[0].skills[9].name, 'Oath Strike');
    assert.equal(ctx.inspector.querySelector('.inspector-title-row h2').textContent, 'Oath Strike');

    // Edit base skill cost
    const mpInput = ctx.inspector.querySelector('#form-cost-mp');
    assert.ok(mpInput);
    mpInput.value = '5';
    mpInput.dispatchEvent({ type: 'change', target: mpInput });
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.cost.mp, 5);

    // Edit written branch
    ctx.select('skills', 's30', 'a');
    const branchNameInput = ctx.inspector.querySelector('#form-name');
    assert.ok(branchNameInput);
    assert.equal(branchNameInput.value, 's30-base-a');

    branchNameInput.value = 'Radiant Oath';
    branchNameInput.dispatchEvent({ type: 'change', target: branchNameInput });

    const updatedBranch = ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    assert.equal(updatedBranch.name, 'Radiant Oath');
    assert.equal(ctx.inspector.querySelector('.inspector-title-row h2').textContent, 'Radiant Oath');

    // Edit branch transforms via labeled JSON textarea
    const transformsTextarea = ctx.inspector.querySelector('#form-transforms');
    assert.ok(transformsTextarea);
    const newTransforms = [{ op: 'set-element', at: 0, value: 'holy' }];
    transformsTextarea.value = JSON.stringify(newTransforms);
    transformsTextarea.dispatchEvent({ type: 'change', target: transformsTextarea });

    const updatedBranch2 = ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    assert.deepEqual(updatedBranch2.transforms, newTransforms);

    // Undo restores previous edits in reverse
    assert.ok(ctx.history.canUndo);
    ctx.history.undo(); // undo transforms
    ctx.changed();
    assert.notDeepEqual(ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a').transforms, newTransforms);

    ctx.history.undo(); // undo branch name
    ctx.changed();
    assert.equal(ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a').name, 's30-base-a');

    ctx.history.undo(); // undo cost
    ctx.changed();
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.cost.mp, 0);

    ctx.history.undo(); // undo skill name
    ctx.changed();
    assert.equal(ctx.model.document.content.rules[0].skills[9].name, 's30');
});

test('T3-4: Lower tier skill renders simple list without pathway graph, shows tier budget in inspector', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);

    // Select lower tier skill s00 (owned by c0, tier 0)
    ctx.select('skills', 's00');

    // Main area must NOT have 3-column pathway map or SVG links
    assert.equal(ctx.main.querySelectorAll('.path-node').length, 0, 'Lower-tier skills must not render pathway nodes');
    assert.equal(ctx.main.querySelectorAll('.pathway-connectors path').length, 0, 'Lower-tier skills must not render pathway connector paths');

    // Main area renders simple list with cards
    const cards = ctx.main.querySelectorAll('.lower-tier-card');
    assert.equal(cards.length, 3, 'Must render simple list of 3 skills for tier-0 class c0');
    assert.equal(cards[0].getAttribute('data-slug'), 's00');
    assert.equal(cards[1].getAttribute('data-slug'), 's01');
    assert.equal(cards[2].getAttribute('data-slug'), 's02');
    assert.equal(cards[0].getAttribute('aria-pressed'), 'true');

    // Inspector shows Tier 0 Base Skill and tier budget 12
    const chip = ctx.inspector.querySelector('.inspector-title-row .chip');
    assert.equal(chip.textContent, 'Tier 0 Base Skill');
    const budgetTitle = ctx.inspector.querySelector('.budget-header span:first-child');
    assert.equal(budgetTitle.textContent, 'POWER BUDGET · TIER 0');
    const budgetRatio = ctx.inspector.querySelector('.budget-ratio');
    assert.match(budgetRatio.textContent, /\/ 12$/);

    // Selecting tier 1 skill s10 shows tier budget 24
    ctx.select('skills', 's10');
    assert.equal(ctx.inspector.querySelector('.inspector-title-row .chip').textContent, 'Tier 1 Base Skill');
    assert.match(ctx.inspector.querySelector('.budget-ratio').textContent, /\/ 24$/);
});

test('T3-5: Real powerScore calculation and power budget closure warning', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30', 'base');

    // In smallRulesPack, s30 has tier 3 power = 20 * 4 = 80. powerScore = ceil(80/10) * 1 = 8.
    // Base budget for tier 3 is 48.
    const budgetRatio = ctx.inspector.querySelector('.budget-ratio');
    assert.equal(budgetRatio.textContent, '8 / 48');
    assert.ok(budgetRatio.classList.contains('good'));
    assert.equal(ctx.inspector.querySelector('.budget-warning'), null, 'Under budget form must have no warning');

    // Inject high power effect into branch s30-base-a to exceed step 1 budget (budget is 60)
    // power: 750 => score = ceil(750/10) = 75 > 60
    const branchIdx = pack.content.rules[0].branches.findIndex(b => b.slug === 's30-base-a');
    pack.content.rules[0].branches[branchIdx].transforms = [
        { op: 'set-power', at: 0, value: 750 },
    ];

    const overBudgetCtx = createTestContext(pack);
    overBudgetCtx.onRender = () => renderSkills(overBudgetCtx);
    overBudgetCtx.select('skills', 's30', 'a');

    // Node shows over-budget warning
    const aNode = overBudgetCtx.main.querySelector('.path-node[data-key="a"]');
    assert.ok(aNode);
    assert.equal(aNode.getAttribute('data-over-budget'), 'true');
    assert.ok(aNode.querySelector('.path-warn-dot'), 'Over budget node must show warning dot');

    // Inspector shows budget-closure warning
    const overBudgetRatio = overBudgetCtx.inspector.querySelector('.budget-ratio');
    assert.equal(overBudgetRatio.textContent, '75 / 60');
    assert.ok(overBudgetRatio.classList.contains('warn'));

    const warnStatus = overBudgetCtx.inspector.querySelector('div[role="status"].budget-warning');
    assert.ok(warnStatus, 'Over budget form inspector must show role=status warning');
    assert.match(warnStatus.textContent, /budget-closure: this form is stronger than its step allows/);
});

test('T3-6: Invalid draft with errors in other records continues rendering forms and permits repair; hostile text safety', () => {
    const pack = smallRulesPack();
    // Intentionally corrupt class c0 to have only 1 skill (fails validateRulesPack with class-skills)
    pack.content.rules[0].classes[0].skills = ['s00'];

    // Also include hostile script injection in skill name
    pack.content.rules[0].skills[9].name = '<b>Hostile</b><script>alert("xss")</script>';

    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);

    // Rendering invalid draft must not throw and must not blank the screen
    assert.doesNotThrow(() => {
        ctx.select('skills', 's30');
    });

    const nodes = ctx.main.querySelectorAll('.path-node');
    assert.equal(nodes.length, 13, 'Must still render all 13 pathway nodes on invalid draft');

    // Hostile text rendered safely with textContent: no <b> or <script> elements created
    const baseNode = ctx.main.querySelector('.path-node[data-key="base"]');
    assert.equal(baseNode.querySelectorAll('b').length, 0);
    assert.equal(baseNode.querySelectorAll('script').length, 0);
    assert.match(baseNode.textContent, /<b>Hostile<\/b><script>alert\("xss"\)<\/script>/);

    const titleH2 = ctx.inspector.querySelector('.inspector-title-row h2');
    assert.equal(titleH2.querySelectorAll('b').length, 0);
    assert.equal(titleH2.querySelectorAll('script').length, 0);
    assert.equal(titleH2.textContent, '<b>Hostile</b><script>alert("xss")</script>');

    const nameInput = ctx.inspector.querySelector('#form-name');
    assert.equal(nameInput.value, '<b>Hostile</b><script>alert("xss")</script>');
});

test('T3-7: Navigation breadcrumbs, skill tabs switching, and bidirectional integration with classes screen', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30');

    // Breadcrumb has Classes, Class 3, and s30
    const breadcrumbLinks = ctx.main.querySelectorAll('.skills-breadcrumb .breadcrumb-link');
    assert.equal(breadcrumbLinks.length, 2);
    assert.equal(breadcrumbLinks[0].textContent, 'Classes');
    assert.equal(breadcrumbLinks[1].textContent, 'Class 3');
    assert.equal(ctx.main.querySelector('.skills-breadcrumb .breadcrumb-current').textContent, 's30');

    // Clicking Classes in breadcrumb navigates to classes screen with c3
    breadcrumbLinks[0].click();
    assert.equal(ctx.selection.kind, 'classes');
    assert.equal(ctx.selection.id, 'c3');

    // Re-select skills screen
    ctx.select('skills', 's30');

    // Skill tabs button group has 3 skills of class c3: s30, s31, s32
    const tabs = ctx.main.querySelectorAll('.skill-tabs .skill-tab-btn');
    assert.equal(tabs.length, 3);
    assert.equal(tabs[0].textContent, 's30');
    assert.equal(tabs[1].textContent, 's31');
    assert.equal(tabs[2].textContent, 's32');
    assert.equal(tabs[0].getAttribute('aria-pressed'), 'true');
    assert.equal(tabs[1].getAttribute('aria-pressed'), 'false');

    // Clicking s31 switches selected skill
    tabs[1].click();
    assert.equal(ctx.selection.id, 's31');
    assert.equal(ctx.main.querySelector('.skills-breadcrumb .breadcrumb-current').textContent, 's31');
    assert.equal(ctx.main.querySelectorAll('.skill-tabs .skill-tab-btn')[1].getAttribute('aria-pressed'), 'true');
});

test('T3-8: Comparison of all valid resolved forms and invalid-draft descendants without cached score corruption', () => {
    const pack = smallRulesPack();
    const check = validateRulesPack(pack);
    assert.ok(check.ok, 'Golden pack must validate cleanly');

    const ctx = createTestContext(pack);
    const validNodes = resolveSkillForms(ctx.model, 's30');
    assert.equal(validNodes.length, 13);

    // Verify all 13 nodes match validateRulesPack resolved.forms
    for (const node of validNodes) {
        const resolved = check.resolved.forms[node.id];
        assert.ok(resolved, `Node ${node.id} must exist in resolved.forms`);
        assert.equal(node.powerScore, resolved.powerScore, `Node ${node.id} score must match engine score`);
        assert.equal(node.step, resolved.step, `Node ${node.id} step must match`);
        assert.equal(node.origin, resolved.origin, `Node ${node.id} origin must match`);
    }

    // Now corrupt an unrelated record (classes[0]) to force validateRulesPack to fail (invalid draft)
    const invalidPack = smallRulesPack();
    invalidPack.content.rules[0].classes[0].skills = ['s00']; // broken class

    const invalidCtx = createTestContext(invalidPack);
    const fallbackNodes = resolveSkillForms(invalidCtx.model, 's30');
    assert.equal(fallbackNodes.length, 13);

    // All 13 fallback nodes must match expected scores and metadata, without inheriting cached parent scores
    for (const fbNode of fallbackNodes) {
        const expected = check.resolved.forms[fbNode.id];
        assert.equal(fbNode.powerScore, expected.powerScore, `Fallback node ${fbNode.id} score must match golden engine score`);
        assert.equal(fbNode.step, expected.step, `Fallback node ${fbNode.id} step must match`);
        assert.equal(fbNode.origin, expected.origin, `Fallback node ${fbNode.id} origin must match`);
        for (const key of ['id', 'step', 'origin', 'fromForm']) {
            assert.equal(fbNode.form[key], expected[key], `Fallback form ${fbNode.id}.${key}`);
        }
    }

    // Corrupt transforms in branch s30-base-a so power-up fails; descendants must NOT pretend to be valid
    invalidPack.content.rules[0].branches[0].transforms = [
        { op: 'set-power', at: 0, value: -100 }, // invalid power
    ];
    const brokenCtx = createTestContext(invalidPack);
    const brokenNodes = resolveSkillForms(brokenCtx.model, 's30');
    const brokenA = brokenNodes.find(n => n.key === 'a');
    assert.equal(brokenA.form.invalid, true, 'Invalid transform form must be marked invalid');
    assert.equal(brokenA.powerScore, 0, 'Invalid transform form must not pretend to have valid score');

    const brokenAG = brokenNodes.find(n => n.key === 'a-g');
    assert.equal(brokenAG.form.invalid, true, 'Generated descendant of broken parent must be marked invalid');
    assert.equal(brokenAG.powerScore, 0);
});

test('T3-9: Typed controls for cost, power, and effect per mock, and schema-driven type and stat selections', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);

    // Select base skill s30
    ctx.select('skills', 's30', 'base');

    // Type options must come strictly from rulesV2Schema, never invented
    const typeSelect = ctx.inspector.querySelector('#form-type');
    assert.ok(typeSelect, 'Must have #form-type select');
    const typeOptions = typeSelect.querySelectorAll('option').map(o => o.value);
    const schemaTypes = rulesV2Schema.$defs.base.properties.type.enum;
    assert.deepEqual(typeOptions, schemaTypes, 'Type options must match schema exactly');

    // Stat options must come strictly from rulesV2Schema, never invented (no atk, mdef, etc.)
    const statSelect = ctx.inspector.querySelector('#form-stat');
    assert.ok(statSelect, 'Must have #form-stat select');
    const statOptions = statSelect.querySelectorAll('option').map(o => o.value);
    const schemaStats = rulesV2Schema.$defs.stat.enum;
    assert.deepEqual(statOptions, schemaStats, 'Stat options must match schema exactly');
    assert.equal(statOptions.includes('atk'), false, 'Stat choices must not contain invented "atk"');

    // Select written branch "a"
    ctx.select('skills', 's30', 'a');

    // Written editor must have real labeled controls for name, cost, power, effect
    const nameInput = ctx.inspector.querySelector('#form-name');
    assert.ok(nameInput, 'Must have #form-name input');

    const costInput = ctx.inspector.querySelector('#form-cost');
    assert.ok(costInput, 'Must have #form-cost input');

    const powerInput = ctx.inspector.querySelector('#form-power');
    assert.ok(powerInput, 'Must have #form-power input');

    const effectSelect = ctx.inspector.querySelector('#form-effect');
    assert.ok(effectSelect, 'Must have #form-effect select');

    // Advanced JSON textarea supplement is inside details
    const transformsTextarea = ctx.inspector.querySelector('#form-transforms');
    assert.ok(transformsTextarea, 'Must have #form-transforms textarea');

    // Changing power via #form-power updates branch transforms and recalculates powerScore
    powerInput.value = '400';
    powerInput.dispatchEvent({ type: 'change', target: powerInput });

    const updatedBranch = ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    const powerTr = updatedBranch.transforms.find(t => t.op === 'set-power');
    assert.ok(powerTr, 'Changing power must add/update set-power transform');
    assert.equal(powerTr.value, 400);

    // Inspector budget ratio reflects updated power
    const ratio = ctx.inspector.querySelector('.budget-ratio');
    assert.match(ratio.textContent, /^40\s*\/\s*60$/); // power: 400 => ceil(400/10) = 40
});

test('T3-10: Refused unsafe edits and malformed input handling', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30', 'a');

    // Enter malformed JSON into transforms textarea
    const transformsTextarea = ctx.inspector.querySelector('#form-transforms');
    transformsTextarea.value = '{"notAnArray": 123}';
    transformsTextarea.dispatchEvent({ type: 'change', target: transformsTextarea });

    // Must notify error and not commit malformed value to model
    assert.ok(ctx.notifications.length > 0);
    assert.match(ctx.notifications.at(-1), /Transforms must be an array/);
    assert.equal(Array.isArray(ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a').transforms), true);

    // Enter syntax error JSON
    transformsTextarea.value = '{invalid json syntax';
    transformsTextarea.dispatchEvent({ type: 'change', target: transformsTextarea });
    assert.match(ctx.notifications.at(-1), /Invalid JSON/);

    // Attempting an edit that setField refuses (invalid path outside document)
    const refused = ctx.apply(setField(ctx.model, ['nonexistent', 'bogus'], 'value'));
    assert.equal(refused, false, 'Invalid edit must be refused');
});

test('T3-11: Malformed drafts regression: applyTransforms catches safe malformed transforms, marks preview unavailable, and shows error in inspector instead of green 0 score', () => {
    // 1. Direct applyTransforms checks with safe malformed drafts
    const sampleForm = {
        id: 'pack.demo/s1-base',
        type: 'physical',
        stat: 'STR',
        cost: { mp: 0, sp: 10, cooldown: 0 },
        effects: [{ op: 'damage', target: 'one', power: 50, element: 'none', damageType: 'physical' }],
    };

    // add-effect missing value
    assert.throws(
        () => applyTransforms(sampleForm, [{ op: 'add-effect' }]),
        /Malformed transform.*add-effect/i,
        'applyTransforms must throw descriptive error on add-effect missing value, not JSON.parse(undefined)'
    );

    // replace-effect missing value
    assert.throws(
        () => applyTransforms(sampleForm, [{ op: 'replace-effect', at: 0 }]),
        /Malformed transform.*replace-effect/i,
        'applyTransforms must throw descriptive error on replace-effect missing value'
    );

    // set-cost missing value
    assert.throws(
        () => applyTransforms(sampleForm, [{ op: 'set-cost' }]),
        /Malformed transform.*set-cost/i,
        'applyTransforms must throw descriptive error on set-cost missing value'
    );

    // 2. Draft with malformed transform in branch s30-base-a
    const pack = smallRulesPack();
    const branchA = pack.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    branchA.transforms = [{ op: 'add-effect' }]; // missing value!

    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30', 'a');

    // Pathway node must NOT show green 0 score
    const nodeA = ctx.main.querySelector('.path-node[data-key="a"]');
    assert.ok(nodeA);
    const budgetSpan = nodeA.querySelector('.path-node-budget');
    assert.ok(budgetSpan);
    assert.ok(budgetSpan.classList.contains('warn'), 'Malformed transform node budget badge must have warn class');
    assert.equal(budgetSpan.classList.contains('good'), false, 'Malformed transform node badge must NOT have good class');
    assert.match(budgetSpan.textContent, /^—\s*\/\s*\d+$/, 'Budget badge shows dash when preview unavailable');

    // Inspector must mark preview unavailable and show its error instead of green 0 score
    const previewError = ctx.inspector.querySelector('.preview-error');
    assert.ok(previewError, 'Inspector must display role=status preview-error box');
    assert.match(previewError.textContent, /Malformed transform/i);

    const budgetRatio = ctx.inspector.querySelector('.budget-ratio');
    assert.ok(budgetRatio);
    assert.equal(budgetRatio.textContent, 'Preview unavailable');
    assert.ok(budgetRatio.classList.contains('warn'), 'Budget ratio must be warn, not good');
    assert.equal(budgetRatio.classList.contains('good'), false, 'Budget ratio must NOT have good class');

    const meter = ctx.inspector.querySelector('.budget-track[role="meter"]');
    assert.ok(meter);
    assert.equal(meter.getAttribute('aria-valuenow'), '0');
    assert.equal(meter.getAttribute('aria-valuetext'), 'Preview unavailable');
});

test('T3-12: Numeric inputs refusal regression: refuses empty, non-integer, and non-finite with bad-value code and no history', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);

    // 1. Base skill numeric inputs: MP and SP
    ctx.select('skills', 's30', 'base');
    const mpInput = ctx.inspector.querySelector('#form-cost-mp');
    const spInput = ctx.inspector.querySelector('#form-cost-sp');
    assert.ok(mpInput && spInput);

    const initialMp = ctx.model.document.content.rules[0].skills[9].base.cost.mp;
    const initialSp = ctx.model.document.content.rules[0].skills[9].base.cost.sp;
    assert.equal(initialMp, 0);
    assert.equal(initialSp, 1);

    // Try empty string on MP
    mpInput.value = '';
    mpInput.dispatchEvent({ type: 'change', target: mpInput });
    assert.equal(ctx.history.canUndo, false, 'Refused empty input must not add history');
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.cost.mp, initialMp, 'Model must remain unchanged');
    assert.equal(mpInput.value, String(initialMp), 'Input value must revert to current model value');
    assert.match(ctx.notifications.at(-1), /bad-value/, 'Notification must contain bad-value code');

    // Try non-integer string on MP ("3.14" should NOT be truncated to 3)
    mpInput.value = '3.14';
    mpInput.dispatchEvent({ type: 'change', target: mpInput });
    assert.equal(ctx.history.canUndo, false, 'Non-integer must not add history');
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.cost.mp, initialMp);
    assert.equal(mpInput.value, String(initialMp));
    assert.match(ctx.notifications.at(-1), /bad-value/);

    // Try non-finite / NaN on SP
    spInput.value = 'Infinity';
    spInput.dispatchEvent({ type: 'change', target: spInput });
    assert.equal(ctx.history.canUndo, false);
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.cost.sp, initialSp);
    assert.equal(spInput.value, String(initialSp));
    assert.match(ctx.notifications.at(-1), /bad-value/);

    // Try text string on SP
    spInput.value = 'abc';
    spInput.dispatchEvent({ type: 'change', target: spInput });
    assert.equal(ctx.history.canUndo, false);
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.cost.sp, initialSp);
    assert.equal(spInput.value, String(initialSp));
    assert.match(ctx.notifications.at(-1), /bad-value/);

    // 2. Branch numeric inputs: Cost and Power
    ctx.select('skills', 's30', 'a');
    const costInput = ctx.inspector.querySelector('#form-cost');
    const powerInput = ctx.inspector.querySelector('#form-power');
    assert.ok(costInput && powerInput);

    const initialPower = 80;

    // Try empty on power (must not coerce to 1)
    powerInput.value = '';
    powerInput.dispatchEvent({ type: 'change', target: powerInput });
    assert.equal(ctx.history.canUndo, false, 'Empty power must not add history');
    assert.equal(powerInput.value, String(initialPower));
    assert.match(ctx.notifications.at(-1), /bad-value/);

    // Try non-integer on power
    powerInput.value = '55.5';
    powerInput.dispatchEvent({ type: 'change', target: powerInput });
    assert.equal(ctx.history.canUndo, false);
    assert.equal(powerInput.value, String(initialPower));
    assert.match(ctx.notifications.at(-1), /bad-value/);

    // Try empty on cost (must not coerce to 0)
    costInput.value = '';
    costInput.dispatchEvent({ type: 'change', target: costInput });
    assert.equal(ctx.history.canUndo, false);
    assert.match(ctx.notifications.at(-1), /bad-value/);

    // Try non-finite on cost
    costInput.value = 'NaN';
    costInput.dispatchEvent({ type: 'change', target: costInput });
    assert.equal(ctx.history.canUndo, false);
    assert.match(ctx.notifications.at(-1), /bad-value/);
});

test('T3-13: Transform order and quick control data-path: appends new operation last so UI takes effect, preserves existing behavior operations, and quick controls have data-path transforms path', () => {
    const pack = smallRulesPack();
    const branchA = pack.content.rules[0].branches.find(b => b.slug === 's30-base-a');

    // Pre-populate branch with an earlier set-power, a behavior operation (add-effect), and a later set-power
    branchA.transforms = [
        { op: 'set-power', at: 0, value: 50 },
        {
            op: 'add-effect',
            value: {
                op: 'damage',
                target: 'all',
                power: 30,
                element: 'fire',
                damageType: 'physical',
            },
        },
        { op: 'set-power', at: 0, value: 70 },
    ];

    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30', 'a');

    const costInput = ctx.inspector.querySelector('#form-cost');
    const powerInput = ctx.inspector.querySelector('#form-power');
    const effectSelect = ctx.inspector.querySelector('#form-effect');
    assert.ok(costInput && powerInput && effectSelect);

    // Verify every quick control has data-path pointing to transforms
    const branchIdx = pack.content.rules[0].branches.findIndex(b => b.slug === 's30-base-a');
    const expectedDataPath = JSON.stringify(['content', 'rules', 0, 'branches', branchIdx, 'transforms']);

    assert.equal(costInput.getAttribute('data-path'), expectedDataPath, '#form-cost must have actual data-path for Go to');
    assert.equal(powerInput.getAttribute('data-path'), expectedDataPath, '#form-power must have actual data-path for Go to');
    assert.equal(effectSelect.getAttribute('data-path'), expectedDataPath, '#form-effect must have actual data-path for Go to');

    // Edit power to 300 via quick control
    powerInput.value = '300';
    powerInput.dispatchEvent({ type: 'change', target: powerInput });

    const updatedBranch = ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    const transforms = updatedBranch.transforms;

    // Operation must be LAST so its value takes effect over any earlier transform
    const lastTransform = transforms.at(-1);
    assert.equal(lastTransform.op, 'set-power');
    assert.equal(lastTransform.value, 300, 'Last transform must be the newly authored power 300');

    // Existing behavior operation (add-effect) must be preserved
    const addEffectTr = transforms.find(t => t.op === 'add-effect');
    assert.ok(addEffectTr, 'Existing behavior operation add-effect must be preserved');
    assert.equal(addEffectTr.value.element, 'fire');

    // Verify UI powerScore reflects the new power 300 (ceil(300/10)*1 = 30) + secondary 30 (ceil(30/10)*3 = 9) = 39
    const ratio = ctx.inspector.querySelector('.budget-ratio');
    assert.match(ratio.textContent, /^39\s*\/\s*60$/);

    // Edit effect to 'holy' via quick control
    const currentEffect = ctx.inspector.querySelector('#form-effect');
    currentEffect.value = 'holy';
    currentEffect.dispatchEvent({ type: 'change', target: currentEffect });

    const updatedBranch2 = ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    const lastTransform2 = updatedBranch2.transforms.at(-1);
    assert.equal(lastTransform2.op, 'set-element');
    assert.equal(lastTransform2.value, 'holy');

    // Prior set-power at 0 and add-effect must be preserved
    assert.ok(updatedBranch2.transforms.some(t => t.op === 'set-power' && t.value === 300));
    assert.ok(updatedBranch2.transforms.some(t => t.op === 'add-effect'));
});

test('T3-14: Per-form budgets include a small actual meter bar alongside text chip', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30');

    // All 13 nodes must have a small actual bar meter
    const nodeBars = ctx.main.querySelectorAll('.path-node .node-budget-track');
    assert.equal(nodeBars.length, 13, 'Every node must include a small actual bar');

    for (const bar of nodeBars) {
        assert.equal(bar.getAttribute('role'), 'meter');
        assert.ok(bar.getAttribute('aria-valuenow'));
        assert.ok(bar.getAttribute('aria-valuemax'));
        const innerFill = bar.querySelector('.node-budget-bar');
        assert.ok(innerFill, 'Track must contain inner budget-bar');
    }

    // Text chips must also still be present on all 13 nodes
    const textChips = ctx.main.querySelectorAll('.path-node .path-node-budget');
    assert.equal(textChips.length, 13, 'Text chips must accompany small actual bars');
});

test('T3-15: Default skill selection edits its original record after malformed entries', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].skills.unshift(null);
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills');
    const name = ctx.inspector.querySelector('#form-name');
    name.value = '[EDITED SKILL]';
    name.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.rules[0].skills[0], null);
    assert.equal(ctx.model.document.content.rules[0].skills[1].name, '[EDITED SKILL]');
    ctx.history.undo();
    assert.equal(ctx.model.document.content.rules[0].skills[1].name, 's00');
});

test('T3-16: Invalid type and stat values stay visible and can be repaired', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].skills[9].base.type = '<b>x</b>';
    pack.content.rules[0].skills[9].base.stat = 'unknown';
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30');
    assert.equal(ctx.inspector.querySelector('#form-type').value, '<b>x</b>');
    assert.equal(ctx.inspector.querySelector('#form-stat').value, 'unknown');
    assert.equal(ctx.inspector.querySelectorAll('b').length, 0);
    const stat = ctx.inspector.querySelector('#form-stat');
    stat.value = 'STR';
    stat.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.rules[0].skills[9].base.stat, 'STR');
    const type = ctx.inspector.querySelector('#form-type');
    type.value = 'physical';
    type.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.validation.ok, true);
});

test('T3-17: Malformed base effects show unavailable scores and remain repairable at every tier', () => {
    for (const slug of ['s00', 's30']) {
        const pack = smallRulesPack();
        const record = pack.content.rules[0].skills.find(s => s.slug === slug);
        const effects = record.base.effects;
        record.base.effects = [];
        const ctx = createTestContext(pack);
        ctx.onRender = () => renderScreen(ctx);
        ctx.select('skills', slug);
        assert.equal(ctx.inspector.querySelector('.budget-ratio').textContent, 'Preview unavailable');
        const control = ctx.inspector.querySelector('#form-effects');
        control.value = JSON.stringify(effects);
        control.dispatchEvent({ type: 'change' });
        assert.equal(ctx.model.validation.ok, true);
        assert.match(ctx.inspector.querySelector('.budget-ratio').textContent, /\d+ \/ \d+/);
    }
});

test('T3-18: Changing branch cost preserves other resource and cooldown in an invalid draft', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].skills[9].base.cost = { mp: 7, sp: 2, cooldown: 3 };
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's30', 'a');
    const cost = ctx.inspector.querySelector('#form-cost');
    cost.value = '5';
    cost.dispatchEvent({ type: 'change' });
    const branch = ctx.model.document.content.rules[0].branches.find(b => b.slug === 's30-base-a');
    assert.deepEqual(branch.transforms.at(-1).value, { mp: 7, sp: 5, cooldown: 3 });
    assert.equal(ctx.model.validation.ok, false);
});

test('T3-19: Missing written forms and their descendants have no fabricated preview', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].branches = pack.content.rules[0].branches.filter(b => b.slug !== 's30-base-a' && b.slug !== 's30-base-b-a');
    const nodes = resolveSkillForms(openPack(pack), 's30');
    for (const key of ['a', 'a-a', 'a-g', 'a-b', 'b-a']) {
        assert.equal(nodes.find(n => n.key === key).previewUnavailable, true, key);
    }
    assert.match(nodes.find(n => n.key === 'a').error, /not been authored/);
});

test('T3-20: Invalid transform indexes and effect counts cannot produce a good preview', () => {
    const base = smallRulesPack().content.rules[0].skills[9].base;
    for (const at of [-1, 0.5, 4]) {
        assert.throws(() => applyTransforms(base, [{ op: 'set-power', at, value: 2 }]), /index/);
    }
    assert.throws(() => applyTransforms(base, [{ op: 'remove-effect', at: 0 }]), /sole effect/);
    const full = { ...base, effects: Array(4).fill(base.effects[0]) };
    assert.throws(() => applyTransforms(full, [{ op: 'add-effect', value: base.effects[0] }]), /four effects/);
});

test('T3-21: Lower-tier list warns when the base score is unavailable', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].skills[0].base.effects = [];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('skills', 's00');
    const meta = ctx.main.querySelector('.lower-tier-card-meta');
    assert.match(meta.textContent, /Power: unavailable/);
    assert.equal(meta.classList.contains('warn'), true);
});
