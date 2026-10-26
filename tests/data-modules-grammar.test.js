import test from 'node:test';
import assert from 'node:assert/strict';
import { factions, survival } from './fixtures/data-modules/index.js';
import { grammarPreview, grammarText, domainText, effectText, pickedValue } from '../src/data-modules/grammar.js';
import * as adapter from '../src/data-modules/sb-adapter.js';
import { noRuntimeBackend } from './helpers/dm-backends.js';
import { shortRef, moduleId, expressionText, v11Findings } from '../src/data-modules/dm-model.js';

test('example A: one line per kind with the short slug form and typed label domains', () => {
    const doc = factions();
    const preview = grammarPreview(doc, doc.content.dataModules[0]);
    assert.equal(preview.ref, 'reputation');
    assert.equal(preview.short, true);
    // Story Block's runtime generates the grammar text for the pinned definition; Studio's preview adds examples around it.
    assert.equal(preview.source, 'story-block');
    assert.equal(preview.storyBlockText, '+ dm reputation \u2014 reason | kind: gain | faction: guild|watch|compact; - dm reputation \u2014 reason | kind: loss | faction: guild|watch|compact');
    for (const kind of preview.kinds) assert.ok(preview.storyBlockText.includes(`${kind.op} dm ${preview.ref} \u2014 reason | kind: ${kind.name}`), kind.name);
    assert.deepEqual(preview.kinds.map(kind => kind.name), ['gain', 'loss']);
    assert.equal(preview.kinds[0].line, '+ dm reputation — <what happened> | kind: gain | faction: guild|watch|compact');
    assert.equal(preview.kinds[1].line, '- dm reputation — <what happened> | kind: loss | faction: guild|watch|compact');
    assert.deepEqual(preview.kinds[0].labels, [{ name: 'faction', type: 'enum', domain: 'guild|watch|compact' }]);
    assert.match(preview.kinds[0].onceText, /Once per reply for each faction.*CLAIMED/);
});

test('example A: representative valid and refused example lines', () => {
    const doc = factions();
    const gain = grammarPreview(doc, doc.content.dataModules[0]).kinds[0];
    assert.deepEqual(gain.examples.valid, ['+ dm reputation — what happened | kind: gain | faction: guild']);
    const refused = gain.examples.refused.map(item => [item.line, item.code]);
    assert.deepEqual(refused, [
        ['+ dm reputation — what happened | kind: gain | faction: not-listed', 'DM_LABEL'],
        ['+ dm reputation — what happened | kind: gain', 'DM_LABEL'],
        ['+ dm reputation — what happened | kind: gain | faction: guild | faction: guild', 'DM_LABEL'],
    ]);
});

test('example B: who is named for character scope, ints show their range, conditions and refusal text', () => {
    const doc = survival();
    const preview = grammarPreview(doc, doc.content.dataModules[0], { actor: 'Wessel' });
    const rest = preview.kinds.find(kind => kind.name === 'rest');
    assert.equal(rest.line, '! dm survival — <what happened> | kind: rest | who: <attached character> | hours: 1 to 8');
    assert.deepEqual(rest.examples.valid, ['! dm survival — what happened | kind: rest | who: Wessel | hours: 4']);
    assert.ok(rest.examples.refused.some(item => item.line.endsWith('hours: 9') && item.code === 'DM_BOUNDS'));
    assert.deepEqual(rest.conditions, [{ code: 'DM_CONDITION', when: '(label hours >= 1)', message: 'Rest needs 1 to 8 hours already narrated.' }]);
    const meal = preview.kinds.find(kind => kind.name === 'meal');
    assert.equal(meal.line, '! dm survival — <what happened> | kind: meal | who: <attached character>');
    assert.deepEqual(meal.examples.refused, []);
    assert.match(meal.onceText, /Once per reply for this kind/);
});

test('the full ID is used when the slug is not unique in the pack', () => {
    const doc = factions();
    const twin = JSON.parse(JSON.stringify(doc.content.dataModules[0]));
    doc.content.dataModules.push(twin);
    assert.equal(shortRef(doc, twin), 'pack.ersveil-factions/reputation');
    const preview = grammarPreview(doc, twin);
    assert.equal(preview.short, false);
    assert.ok(preview.kinds[0].line.includes('dm pack.ersveil-factions/reputation —'));
    assert.equal(moduleId(doc, twin), 'pack.ersveil-factions/reputation');
});

test('reward templates show their declared picker and the fixed value it picks', () => {
    const doc = factions();
    const { templates } = grammarPreview(doc, doc.content.dataModules[0]);
    assert.deepEqual(templates, [{
        name: 'favour',
        values: [{ name: 'amount', min: 1, max: 5, pick: 'midpoint', picked: 3 }],
        bindings: [{ name: 'faction', domain: 'guild|watch|compact' }],
    }]);
    assert.equal(pickedValue({ min: 2, max: 9, pick: 'min' }), 2);
    assert.equal(pickedValue({ min: 2, max: 9, pick: 'max' }), 9);
    assert.equal(pickedValue({ min: 2, max: 9, pick: 'midpoint' }), 5);
    assert.equal(pickedValue({ min: 2, max: 9, pick: 'dice' }), null);
    assert.equal(pickedValue(null), null);
});

test('previews tolerate unfinished and hostile records', () => {
    const doc = { id: 'x', content: { dataModules: [{ slug: 'a', kinds: { k: null, j: { op: 7, labels: { n: 5, t: { type: 'int' } }, effects: 'no' } } }] } };
    const preview = grammarPreview(doc, doc.content.dataModules[0]);
    assert.equal(preview.kinds.length, 2);
    assert.ok(grammarText(preview).includes('dm a'));
    assert.equal(domainText(null), '<value>');
    assert.equal(domainText({ type: 'int', min: 1 }), '<whole number>');
    assert.equal(domainText({ type: 'text' }), '<text>');
    assert.equal(effectText(5), '5');
});

test('effects and expressions read as plain text', () => {
    const doc = factions();
    const [module] = doc.content.dataModules;
    assert.equal(effectText(module.kinds.loss.effects[0]), 'add -5 to standing.{label faction} (clamped to its bounds)');
    assert.equal(effectText(module.rules[0].then[0]), 'set title to "Guild Friend"');
    assert.equal(expressionText(module.rules[0].when), '((standing.guild >= 6) and (title = "none"))');
    assert.equal(effectText({ op: 'clamp', path: ['a'], min: 0, max: ['get', ['b']] }), 'clamp a between 0 and b');
});

test('v1.1 features are found by position and described with the fixed message', () => {
    const doc = survival();
    const module = doc.content.dataModules[0];
    module.kinds.meal.check = { skill: 'survival', stat: 'wis', dc: 12 };
    module.kinds.rest.effects.push({ op: 'grantXp', amount: 5 }, { op: 'grantCoin', amount: 1 });
    module.rules = [{ id: 'r', when: ['ge', ['check', 'outcome'], 1], then: [{ op: 'grantItem', def: 'x', qty: 1 }] }];
    const found = v11Findings(module);
    assert.deepEqual(found.map(item => item.local.join('.')), ['kinds.meal.check', 'kinds.rest.effects.1', 'kinds.rest.effects.2', 'rules.0.then.0', 'rules.0.when.1']);
    assert.ok(found.every(item => item.code === 'NEEDS_V1_1' && item.message.endsWith('needs data-modules v1.1')));
    assert.deepEqual(v11Findings(survival().content.dataModules[0]), []);
});

test('without a runtime the preview is Studio\u2019s own reading of the declarations and says so', () => {
    adapter.useBackendForTests(noRuntimeBackend);
    try {
        const doc = factions();
        const preview = grammarPreview(doc, doc.content.dataModules[0]);
        assert.equal(preview.source, 'studio-preview');
        assert.equal(preview.storyBlockText, null);
        assert.equal(preview.kinds.length, 2);
    } finally { adapter.useBackendForTests(null); }
});
