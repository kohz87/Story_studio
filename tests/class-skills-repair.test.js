import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack } from '../src/model.js';
import * as edits from '../src/edits.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';

for (const damaged of [{}, null, 'broken']) {
    test(`repair resets non-array class skills ${JSON.stringify(damaged)} through an undoable edit`, () => {
        const pack = smallRulesPack();
        pack.content.rules[0].classes[1].skills = damaged;
        const model = openPack(pack);
        const result = edits.resetClassSkills(model, 'pack.fixture/c1');
        assert.equal(result.ok, true);
        assert.deepEqual(result.model.document.content.rules[0].classes[1].skills, []);
        assert.deepEqual(model.document.content.rules[0].classes[1].skills, damaged);
        assert.equal(result.undo(), model);
        assert.deepEqual(result.model.document.content.rules[0].skills, model.document.content.rules[0].skills);
        assert.deepEqual(result.model.document.content.rules[0].classes[0], model.document.content.rules[0].classes[0]);
        assert.equal(edits.addClassSkill(result.model, 'c1').ok, true);
    });
}

test('repair refuses an existing array or missing class without changing the model', () => {
    const model = openPack(smallRulesPack());
    for (const [id, code] of [['c1', 'bad-value'], ['missing', 'not-found']]) {
        const result = edits.resetClassSkills(model, id);
        assert.equal(result.ok, false);
        assert.equal(result.model, model);
        assert.equal(result.errors[0].code, code);
    }
});

test('inspector repairs a damaged skills list, enables Skill creation, and undoes both independently', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[1].skills = {};
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('classes', 'c1');
    const before = ctx.model;
    const repair = () => ctx.inspector.querySelectorAll('button').find(button => button.textContent === 'Repair: reset skills list');
    assert.ok(repair());
    repair().click();
    const repaired = ctx.model;
    assert.deepEqual(repaired.document.content.rules[0].classes[1].skills, []);
    assert.equal(repair(), undefined);
    const add = ctx.inspector.querySelectorAll('button').find(button => button.textContent === '+ Skill');
    assert.equal(add.disabled, false);
    add.click();
    assert.equal(ctx.model.document.content.rules[0].classes[1].skills.length, 1);
    assert.equal(ctx.model.document.content.rules[0].skills.length, before.document.content.rules[0].skills.length + 1);
    ctx.history.undo(); ctx.changed();
    assert.equal(ctx.model, repaired);
    ctx.history.undo(); ctx.changed();
    assert.equal(ctx.model, before);
    assert.deepEqual(ctx.model.document.content.rules[0].classes[1].skills, {});
    assert.ok(repair());
    ctx.history.redo(); ctx.changed();
    assert.equal(ctx.model, repaired);
    assert.deepEqual(ctx.notifications, []);
});
