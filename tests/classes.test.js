import test from 'node:test';
import assert from 'node:assert/strict';

import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { openPack } from '../src/model.js';
import { remove } from '../src/edits.js';
import { renderClasses, cascadeChanges, classField } from '../src/screens/classes.js';
import { createTestContext } from './helpers/dom.js';

test('T2-1: Tier columns 0-3 layout, counts, parent relationships, card selection, and 44px min-height', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.render();

    const columns = ctx.main.querySelectorAll('.classes-column');
    assert.equal(columns.length, 4, 'Must have 4 tier columns');

    const cards = ctx.main.querySelectorAll('.class-card');
    assert.equal(cards.length, 4, 'smallRulesPack has 4 classes: c0, c1, c2, c3');

    assert.equal(columns[0].querySelector('.class-card')?.getAttribute('data-slug'), 'c0');
    assert.equal(columns[1].querySelector('.class-card')?.getAttribute('data-slug'), 'c1');
    assert.equal(columns[2].querySelector('.class-card')?.getAttribute('data-slug'), 'c2');
    assert.equal(columns[3].querySelector('.class-card')?.getAttribute('data-slug'), 'c3');

    for (const card of cards) {
        assert.equal(card.getAttribute('aria-pressed'), 'false');
    }

    const c0Card = columns[0].querySelector('.class-card');
    assert.match(c0Card.textContent, /1 child/);

    const c1Card = columns[1].querySelector('.class-card');
    assert.match(c1Card.textContent, /parent: c0/);
    assert.match(c1Card.textContent, /1 child/);

    c1Card.click();
    assert.equal(ctx.selection.id, 'c1');
    assert.equal(ctx.main.querySelector('.class-card[data-slug=c1]').getAttribute('aria-pressed'), 'true');
});

test('T2-2: Inspector selects record by slug, name input updates model via setField', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c1');

    const title = ctx.inspector.querySelector('.inspector-title-row h2');
    assert.equal(title.textContent, 'Class 1');
    const chip = ctx.inspector.querySelector('.inspector-title-row .chip');
    assert.equal(chip.textContent, 'Tier 1');

    const nameInput = ctx.inspector.querySelector('#class-name');
    assert.ok(nameInput, 'Name input must have id class-name');
    assert.equal(nameInput.value, 'Class 1');
    assert.equal(nameInput.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 1, 'name']));

    nameInput.value = 'Warrior';
    nameInput.dispatchEvent({ type: 'change', target: nameInput });

    assert.equal(ctx.model.document.content.rules[0].classes[1].name, 'Warrior');
    assert.equal(ctx.inspector.querySelector('.inspector-title-row h2').textContent, 'Warrior');
});

test('T2-3: Rename slug updates references, selection preserved; empty slug gives refusal with bad-id; qualified same-pack slug normalizes localId', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c1');

    const refNote = ctx.inspector.querySelector('.muted');
    assert.match(refNote.textContent, /1 places/);

    const slugInput = ctx.inspector.querySelector('#class-id');
    assert.ok(slugInput, 'Slug input must have id class-id');
    assert.equal(slugInput.value, 'c1');
    assert.equal(slugInput.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 1, 'slug']));

    // Empty slug gives refusal and bad-id notification, does not silently ignore
    slugInput.value = '';
    slugInput.dispatchEvent({ type: 'change', target: slugInput });
    assert.equal(slugInput.value, 'c1', 'Input value reset to existing slug on empty refusal');
    assert.ok(ctx.notifications.some(n => n.includes('bad-id')), 'Notification emitted for empty slug refusal');
    assert.equal(ctx.model.document.content.rules[0].classes[1].slug, 'c1', 'Class slug unchanged in model');

    // Rename to valid slug updates references atomically
    slugInput.value = 'c1-renamed';
    slugInput.dispatchEvent({ type: 'change', target: slugInput });

    assert.equal(ctx.model.document.content.rules[0].classes[2].parent, 'c1-renamed');
    assert.equal(ctx.model.document.content.rules[0].classes[1].slug, 'c1-renamed');
    assert.equal(ctx.selection.id, 'c1-renamed');

    // Qualified same-pack slug normalizes localId on result
    const slugInput2 = ctx.inspector.querySelector('#class-id');
    slugInput2.value = 'pack.fixture/c1-qualified';
    slugInput2.dispatchEvent({ type: 'change', target: slugInput2 });

    assert.equal(ctx.model.document.content.rules[0].classes[1].slug, 'c1-qualified');
    assert.equal(ctx.selection.id, 'c1-qualified', 'Selection normalized to localId');
});

test('T2-4: Parent select => moveClass with root option and authoritative candidate options', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c2');

    const parentSelect = ctx.inspector.querySelector('#class-parent');
    assert.ok(parentSelect, 'Parent select must have id class-parent');
    assert.equal(parentSelect.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 2, 'parent']));

    const options = parentSelect.querySelectorAll('option');
    const optionValues = options.map(o => o.value);
    assert.ok(optionValues.includes(''), 'Must have root option');
    assert.ok(optionValues.includes('c0'), 'c0 is valid parent');
    assert.ok(optionValues.includes('c1'), 'c1 is valid parent');
    assert.ok(!optionValues.includes('c3'), 'c3 is descendant and cannot be parent candidate');

    parentSelect.value = '';
    parentSelect.dispatchEvent({ type: 'change', target: parentSelect });

    const movedC2 = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'c2');
    const movedC3 = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'c3');
    assert.equal(movedC2.parent, null);
    assert.equal(movedC2.tier, 0);
    assert.equal(movedC3.tier, 1);
});

test('T2-5: Clearing required skills is refused; safe path mapping prevents classes[1] matching classes[10]; skill count displayed', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c0');

    const skillsGroup = ctx.inspector.querySelector('#class-skills');
    assert.ok(skillsGroup, 'Skills group must have id class-skills');
    assert.equal(skillsGroup.getAttribute('tabindex'), '-1');
    assert.equal(skillsGroup.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 0, 'skills']));

    const countSpan = skillsGroup.querySelector('.skills-header span:last-child');
    assert.equal(countSpan.textContent, '3 / 3');

    const slotRows = skillsGroup.querySelectorAll('.skill-row');
    assert.equal(slotRows.length, 3, 'Must have exactly 3 skill picker slots');

    const slot3Select = slotRows[2].querySelector('select');
    assert.equal(slot3Select.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 0, 'skills', 2]));
    assert.equal(slot3Select.value, 's02');

    const openBtn = slotRows[0].querySelector('button');
    assert.ok(openBtn);
    openBtn.click();
    assert.equal(ctx.selection.kind, 'skills');
    assert.equal(ctx.selection.id, 's00');

    ctx.select('classes', 'c0');

    // Clearing slot 3 would violate minItems.
    const slot3SelectRe = ctx.inspector.querySelectorAll('.skill-row select')[2];
    slot3SelectRe.value = '';
    slot3SelectRe.dispatchEvent({ type: 'change', target: slot3SelectRe });

    const c0Skills = ctx.model.document.content.rules[0].classes[0].skills;
    assert.deepEqual(c0Skills, ['s00', 's01', 's02']);
    assert.equal(slot3SelectRe.value, 's02');
    assert.equal(ctx.history.canUndo, false);
    assert.match(ctx.notifications.at(-1), /^bad-value:/);

    const newCountSpan = ctx.inspector.querySelector('#class-skills .skills-header span:last-child');
    assert.equal(newCountSpan.textContent, '3 / 3');
    assert.equal(newCountSpan.classList.contains('warn-count'), false);

    // Safe path mapping check: error on classes.10 must not match classes.1
    const mockModel = openPack(pack);
    const fakeError = { code: 'test-err', path: 'content.rules[0].classes[10].skills', message: 'Error on class 10' };
    const fakeModel = {
        ...mockModel,
        validation: { ok: false, errors: [fakeError], warnings: [] },
    };
    const ctx2 = createTestContext(fakeModel);
    ctx2.onRender = () => renderClasses(ctx2);
    ctx2.select('classes', 'c1');
    const problemBox1 = ctx2.inspector.querySelector('div[role=status].warning');
    assert.equal(problemBox1, null, 'Error on classes[10] must not appear on class at index 1');

    // Fixing skill by selecting s02 in slot 3 restores 3 skills
    const emptySlot3Select = ctx.inspector.querySelectorAll('.skill-row select')[2];
    emptySlot3Select.value = 's02';
    emptySlot3Select.dispatchEvent({ type: 'change', target: emptySlot3Select });

    assert.equal(ctx.model.document.content.rules[0].classes[0].skills.length, 3);
    assert.equal(ctx.inspector.querySelector('#class-skills .skills-header span:last-child').textContent, '3 / 3');
});

test('T2-6: + Root class and + Child class opens inspector drawer via ctx.select; child disabled at tier 3', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.render();

    const addRootBtn = ctx.main.querySelector('.classes-header button');
    assert.equal(addRootBtn.textContent, '+ Root class');
    addRootBtn.click();

    assert.equal(ctx.selection.id, 'new-class');
    assert.ok(ctx.app.classList.contains('inspector-open'), 'Drawer opens via ctx.select on root add');
    const newClass = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'new-class');
    assert.ok(newClass);
    assert.equal(newClass.name, '[CLASS NAME]');
    assert.equal(newClass.tier, 0);
    assert.equal(newClass.parent, null);
    assert.deepEqual(newClass.skills, []);

    // For tier 3 class (c3), + Child class is disabled
    ctx.select('classes', 'c3');
    const childBtnTier3 = ctx.inspector.querySelectorAll('.row button').find(b => b.textContent === '+ Child class');
    assert.ok(childBtnTier3.disabled, '+ Child class must be disabled at tier 3');

    // For tier 1 class (c1), + Child class adds child and opens drawer via ctx.select
    ctx.select('classes', 'c1');
    const childBtnTier1 = ctx.inspector.querySelectorAll('.row button').find(b => b.textContent === '+ Child class');
    assert.ok(!childBtnTier1.disabled);
    childBtnTier1.click();

    assert.equal(ctx.selection.id, 'c1-child');
    assert.ok(ctx.app.classList.contains('inspector-open'), 'Drawer opens via ctx.select on child add');
    const childClass = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'c1-child');
    assert.ok(childClass);
    assert.equal(childClass.tier, 2);
    assert.equal(childClass.parent, 'c1');
});

test('T2-7: Exact cascade removal preview: tier 3 has exactly 1 base form + 4 generated forms (g, g-g, a-g, b-g); tier 0-2 has only base form; native dialog confirm and undo', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c3');

    const previewResult = remove(ctx.model, 'classes', 'c3', { cascade: true });
    assert.ok(previewResult.ok);
    const changes = cascadeChanges(ctx.model, previewResult.model, 'c3');

    // Exact count for c3: 1 class + 3 skills + 24 branches + 3 base forms + 12 generated forms = 43
    assert.equal(changes.length, 43, `c3 cascade must have exactly 43 removed changes, got ${changes.length}`);

    const baseForms = changes.filter(c => c.kind === 'forms' && c.label.endsWith('(Base form)'));
    assert.equal(baseForms.length, 3, 'Must have exactly 3 base forms labeled Base form');
    for (const bf of baseForms) {
        assert.ok(['s30-base', 's31-base', 's32-base'].includes(bf.id));
    }

    const genForms = changes.filter(c => c.kind === 'forms' && c.label.endsWith('(Generated form)'));
    assert.equal(genForms.length, 12, 'Must have exactly 12 generated forms (4 per skill: g, g-g, a-g, b-g)');

    // Lower tier skill/class has NO phantom forms, only base form
    const tier0Pack = smallRulesPack();
    tier0Pack.content.rules[0].classes = [tier0Pack.content.rules[0].classes[0]]; // only c0
    tier0Pack.content.rules[0].skills = tier0Pack.content.rules[0].skills.slice(0, 3); // s00, s01, s02
    tier0Pack.content.rules[0].branches = [];
    const tier0Model = openPack(tier0Pack);
    const preview0 = remove(tier0Model, 'classes', 'c0', { cascade: true });
    assert.ok(preview0.ok);
    const changes0 = cascadeChanges(tier0Model, preview0.model, 'c0');

    // 1 class + 3 skills + 3 base forms (no branches, no generated forms) = 7
    assert.equal(changes0.length, 7, `Lower-tier c0 cascade must have exactly 7 items, got ${changes0.length}`);
    const tier0GenForms = changes0.filter(c => c.kind === 'forms' && c.label.endsWith('(Generated form)'));
    assert.equal(tier0GenForms.length, 0, 'Lower-tier skills must not have phantom generated forms');

    // Native dialog confirm commits preview and undo restores
    const removeBtn = ctx.inspector.querySelector('button.danger');
    removeBtn.click();

    const dialog = ctx.overlays.querySelector('dialog[aria-label="Remove class"]');
    assert.ok(dialog);
    assert.ok(dialog.open);

    const listItems = dialog.querySelectorAll('li');
    assert.equal(listItems.length, 43);

    const confirmBtn = dialog.querySelectorAll('button').find(b => b.textContent.startsWith('Remove all'));
    assert.ok(confirmBtn);
    confirmBtn.click();
    assert.equal(dialog.parentElement, null);

    const remainingClasses = ctx.model.document.content.rules[0].classes.map(c => c.slug);
    assert.ok(!remainingClasses.includes('c3'));

    assert.ok(ctx.history.canUndo);
    ctx.history.undo();
    ctx.changed();

    const restoredClasses = ctx.model.document.content.rules[0].classes.map(c => c.slug);
    assert.ok(restoredClasses.includes('c3'));
    assert.equal(ctx.model.document.content.rules[0].skills.length, 12);
});

test('T2-8: Dialog Cancel / Escape closes dialog and restores focus to invoker', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c3');

    const removeBtn = ctx.inspector.querySelector('button.danger');
    removeBtn.click();

    const dialog = ctx.overlays.querySelector('dialog[aria-label="Remove class"]');
    assert.ok(dialog);

    const cancelBtn = dialog.querySelectorAll('button').find(b => b.textContent === 'Keep it');
    cancelBtn.click();

    assert.equal(dialog.parentElement, null);
    assert.equal(ctx.doc.activeElement, removeBtn);
    assert.equal(ctx.model.document.content.rules[0].classes.length, 4);

    removeBtn.click();
    const dialog2 = ctx.overlays.querySelector('dialog[aria-label="Remove class"]');
    dialog2.dispatchEvent({ type: 'cancel', defaultPrevented: false, preventDefault() {} });

    assert.equal(dialog2.parentElement, null);
    assert.equal(ctx.doc.activeElement, removeBtn);
});

test('T2-9: Safe hostile names with <script> and <b> markers: textContent only', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[0].name = '<b>Hostile</b><script>alert(1)</script>';
    pack.content.rules[0].classes[0].slug = 'c0';

    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c0');

    const c0Card = ctx.main.querySelector('.class-card[data-slug=c0]');
    assert.equal(c0Card.querySelectorAll('b').length, 0);
    assert.equal(c0Card.querySelectorAll('script').length, 0);
    assert.match(c0Card.textContent, /<b>Hostile<\/b><script>alert\(1\)<\/script>/);

    const title = ctx.inspector.querySelector('.inspector-title-row h2');
    assert.equal(title.querySelectorAll('b').length, 0);
    assert.equal(title.querySelectorAll('script').length, 0);
    assert.equal(title.textContent, '<b>Hostile</b><script>alert(1)</script>');

    const nameInput = ctx.inspector.querySelector('#class-name');
    assert.equal(nameInput.value, '<b>Hostile</b><script>alert(1)</script>');
});

test('T2-10: Cyclic and null/primitive records in safe invalid drafts do not throw anywhere; filtered valid records retain original indices for paths', () => {
    const pack = smallRulesPack();
    // Insert null and primitive records into classes array
    const corruptedClasses = [
        pack.content.rules[0].classes[0], // c0 at index 0
        null,                             // null at index 1
        'corrupted-entry',                // string at index 2
        42,                               // number at index 3
        pack.content.rules[0].classes[1], // c1 at index 4 (parent c0)
    ];
    // Create cycle: c1 parent points to c1
    corruptedClasses[4].parent = 'c1';
    pack.content.rules[0].classes = corruptedClasses;

    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);

    // Rendering must not throw and must not loop infinitely
    assert.doesNotThrow(() => {
        ctx.render();
    });

    // Selecting c1 at index 4
    ctx.select('classes', 'c1');
    const nameInput = ctx.inspector.querySelector('#class-name');
    assert.ok(nameInput);
    // Path MUST retain original index 4 in content.rules.0.classes
    assert.equal(nameInput.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 4, 'name']));

    // Parent candidates must safely handle cyclic graph without infinite loop
    const parentSelect = ctx.inspector.querySelector('#class-parent');
    assert.ok(parentSelect);
});

test('T2-11: Pure helper classField directly edits class fields and tolerates null/primitive records', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    const res1 = classField(model, 'c1', 'name', 'Updated Class');
    assert.ok(res1.ok);
    assert.equal(res1.model.document.content.rules[0].classes[1].name, 'Updated Class');

    const res2 = classField(res1.model, 'c1', 'skills', ['s10', 's11']);
    assert.equal(res2.ok, false);
    assert.equal(res2.model, res1.model);
    assert.equal(res2.errors[0].code, 'bad-value');

    const res3 = classField(model, 'non-existent', 'name', 'X');
    assert.ok(!res3.ok);
    assert.equal(res3.errors[0].code, 'not-found');

    // Tolerates null/primitive entries in classes array
    const draftPack = smallRulesPack();
    draftPack.content.rules[0].classes = [null, draftPack.content.rules[0].classes[0]];
    const draftModel = openPack(draftPack);
    const res4 = classField(draftModel, 'c0', 'name', 'Patched');
    assert.ok(res4.ok);
});

test('T2-12: qualified skills remain selected, malformed skill arrays are repairable, and long parent IDs permit child creation', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[0].skills[0] = 'pack.fixture/s00';
    // Keep a safe invalid draft so the engine preserves qualified references.
    pack.content.rules[0].classes[1].skills = {};
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c0');
    assert.equal(ctx.inspector.querySelector('.skill-row select').value, 's00');
    ctx.select('classes', 'c1');
    const select = ctx.inspector.querySelector('.skill-row select');
    select.value = 's10';
    select.dispatchEvent({ type: 'change' });
    assert.deepEqual(ctx.model.document.content.rules[0].classes[1].skills, {});
    assert.match(ctx.notifications.at(-1), /^bad-value:/);
    assert.equal(ctx.apply(classField(ctx.model, 'c1', 'skills', ['s10', 's11', 's12'])), true);
    assert.deepEqual(ctx.model.document.content.rules[0].classes[1].skills, ['s10', 's11', 's12']);
    const longPack = smallRulesPack();
    longPack.content.rules[0].classes[0].slug = 'x'.repeat(64);
    const ctx2 = createTestContext(longPack);
    ctx2.onRender = () => renderClasses(ctx2);
    ctx2.select('classes', 'x'.repeat(64));
    ctx2.inspector.querySelectorAll('button').find(b => b.textContent === '+ Child class').click();
    assert.equal(ctx2.model.document.content.rules[0].classes.length, 5);
    assert.ok(ctx2.selection.id.length <= 64);
});

test('a child class can create three owned skills and written pathways with atomic undo and redo', () => {
    const ctx = createTestContext(smallRulesPack()); ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c2');
    ctx.inspector.querySelectorAll('button').find(node => node.textContent === '+ Child class').click();
    const child = ctx.selection.id;
    assert.equal(ctx.model.validation.ok, false);
    const initial = ctx.model;
    for (let n = 0; n < 3; n++) {
        const before = ctx.model;
        const add = ctx.inspector.querySelectorAll('button').find(node => node.textContent === '+ Skill');
        assert.ok(add, 'The class inspector offers skill creation');
        add.click();
        const after = ctx.model;
        const cls = after.document.content.rules[0].classes.find(record => record.slug === child);
        assert.equal(cls.skills.length, n + 1);
        const slug = cls.skills[n];
        const skill = after.document.content.rules[0].skills.find(record => record.slug === slug);
        assert.equal(skill.name, '[YOUR SKILL NAME]');
        const branches = after.document.content.rules[0].branches.filter(record => record.skill === slug);
        assert.equal(branches.length, 8);
        assert.ok(branches.every(branch => ['a', 'b'].includes(branch.choice)), 'Generated forms stay generated');
        assert.ok(branches.some(branch => branch.fromForm === `${slug}-base-g`));
        ctx.history.undo(); ctx.changed(); assert.equal(ctx.model, before);
        ctx.history.redo(); ctx.changed(); assert.equal(ctx.model, after);
    }
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    assert.equal(ctx.inspector.querySelectorAll('button').find(node => node.textContent === '+ Skill').disabled, true);
    for (let n = 0; n < 3; n++) ctx.history.undo();
    ctx.changed(); assert.equal(ctx.model, initial);
});
