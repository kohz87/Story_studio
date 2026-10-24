import test from 'node:test';
import assert from 'node:assert/strict';

import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { openPack } from '../src/model.js';
import { remove } from '../src/edits.js';
import { renderClasses, cascadeChanges, classField } from '../src/screens/classes.js';
import { createTestContext } from './helpers/dom.js';

test('T2-1: Tier columns 0-3 layout, counts, parent relationships, and card selection', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.render();

    // 4 tier columns
    const columns = ctx.main.querySelectorAll('.classes-column');
    assert.equal(columns.length, 4, 'Must have 4 tier columns');

    const cards = ctx.main.querySelectorAll('.class-card');
    assert.equal(cards.length, 4, 'smallRulesPack has 4 classes: c0, c1, c2, c3');

    // c0 in tier 0, c1 in tier 1, c2 in tier 2, c3 in tier 3
    assert.equal(columns[0].querySelector('.class-card')?.getAttribute('data-slug'), 'c0');
    assert.equal(columns[1].querySelector('.class-card')?.getAttribute('data-slug'), 'c1');
    assert.equal(columns[2].querySelector('.class-card')?.getAttribute('data-slug'), 'c2');
    assert.equal(columns[3].querySelector('.class-card')?.getAttribute('data-slug'), 'c3');

    // aria-pressed is false initially
    for (const card of cards) {
        assert.equal(card.getAttribute('aria-pressed'), 'false');
    }

    // Parent/child relationship text
    // c0 is tier 0, has 1 child (c1)
    const c0Card = columns[0].querySelector('.class-card');
    assert.match(c0Card.textContent, /1 child/);

    // c1 is tier 1, has parent c0 and 1 child (c2)
    const c1Card = columns[1].querySelector('.class-card');
    assert.match(c1Card.textContent, /parent: c0/);
    assert.match(c1Card.textContent, /1 child/);

    // Clicking c1 selects it
    c1Card.click();
    assert.equal(ctx.selection.id, 'c1');
    assert.equal(c1Card.getAttribute('aria-pressed'), 'true');
});

test('T2-2: Inspector selects record by slug, name input => setField', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c1');

    // Inspector title and chip
    const title = ctx.inspector.querySelector('.inspector-title-row h2');
    assert.equal(title.textContent, 'Class 1');
    const chip = ctx.inspector.querySelector('.inspector-title-row .chip');
    assert.equal(chip.textContent, 'Tier 1');

    // Name input has id class-name and stable data-path
    const nameInput = ctx.inspector.querySelector('#class-name');
    assert.ok(nameInput, 'Name input must have id class-name');
    assert.equal(nameInput.value, 'Class 1');
    assert.equal(nameInput.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 1, 'name']));

    // Changing name input updates model via setField
    nameInput.value = 'Warrior';
    nameInput.dispatchEvent({ type: 'change', target: nameInput });

    assert.equal(ctx.model.document.content.rules[0].classes[1].name, 'Warrior');
    // Re-render reflects updated name
    assert.equal(ctx.inspector.querySelector('.inspector-title-row h2').textContent, 'Warrior');
});

test('T2-3: Slug input => renameId updates references and preserves selection', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c1');

    // Inbound reference count note: c2 has parent: c1
    const refNote = ctx.inspector.querySelector('.muted');
    assert.match(refNote.textContent, /1 places/);

    // Slug input has id class-id and stable data-path
    const slugInput = ctx.inspector.querySelector('#class-id');
    assert.ok(slugInput, 'Slug input must have id class-id');
    assert.equal(slugInput.value, 'c1');
    assert.equal(slugInput.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 1, 'slug']));

    // Rename c1 to c1-renamed
    slugInput.value = 'c1-renamed';
    slugInput.dispatchEvent({ type: 'change', target: slugInput });

    // Inbound reference on c2 parent is updated atomically
    assert.equal(ctx.model.document.content.rules[0].classes[2].parent, 'c1-renamed');
    assert.equal(ctx.model.document.content.rules[0].classes[1].slug, 'c1-renamed');

    // Selection preserved
    assert.equal(ctx.selection.id, 'c1-renamed');
    const selectedCard = ctx.main.querySelector('.class-card[aria-pressed=true]');
    assert.equal(selectedCard?.getAttribute('data-slug'), 'c1-renamed');
});

test('T2-4: Parent select => moveClass with root option and valid parent candidates', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c2');

    const parentSelect = ctx.inspector.querySelector('#class-parent');
    assert.ok(parentSelect, 'Parent select must have id class-parent');
    assert.equal(parentSelect.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 2, 'parent']));

    // Candidate options: root (none), c0, c1. c3 is a descendant and must NOT be an option.
    const options = parentSelect.querySelectorAll('option');
    const optionValues = options.map(o => o.value);
    assert.ok(optionValues.includes(''), 'Must have root option');
    assert.ok(optionValues.includes('c0'), 'c0 is valid parent');
    assert.ok(optionValues.includes('c1'), 'c1 is valid parent');
    assert.ok(!optionValues.includes('c3'), 'c3 is descendant and cannot be parent candidate');

    // Move c2 to root
    parentSelect.value = '';
    parentSelect.dispatchEvent({ type: 'change', target: parentSelect });

    // c2 is now root: tier 0, parent null; descendant c3 tier becomes 1
    const movedC2 = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'c2');
    const movedC3 = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'c3');
    assert.equal(movedC2.parent, null);
    assert.equal(movedC2.tier, 0);
    assert.equal(movedC3.tier, 1);
});

test('T2-5: Exactly 3 skill slots, clearing slot => array of 2 keeps draft, checker problem marker', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c0');

    const skillsGroup = ctx.inspector.querySelector('#class-skills');
    assert.ok(skillsGroup, 'Skills group must have id class-skills');
    assert.equal(skillsGroup.getAttribute('tabindex'), '-1', 'Skills group must have tabindex=-1 for Go to');
    assert.equal(skillsGroup.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 0, 'skills']));

    const countSpan = skillsGroup.querySelector('.skills-header span:last-child');
    assert.equal(countSpan.textContent, '3 / 3');

    // Exactly 3 skill slot rows
    const slotRows = skillsGroup.querySelectorAll('.skill-row');
    assert.equal(slotRows.length, 3, 'Must have exactly 3 skill picker slots');

    // Slot 3 has select with data-path
    const slot3Select = slotRows[2].querySelector('select');
    assert.equal(slot3Select.getAttribute('data-path'), JSON.stringify(['content', 'rules', 0, 'classes', 0, 'skills', 2]));
    assert.equal(slot3Select.value, 's02');

    // Each non-empty row has Open button navigating to skills
    const openBtn = slotRows[0].querySelector('button');
    assert.ok(openBtn, 'Skill row should have Open button');
    openBtn.click();
    assert.equal(ctx.selection.kind, 'skills');
    assert.equal(ctx.selection.id, 's00');

    // Return to classes c0
    ctx.select('classes', 'c0');

    // Clear slot 3 => array of 2 via setField
    const slot3SelectRe = ctx.inspector.querySelectorAll('.skill-row select')[2];
    slot3SelectRe.value = '';
    slot3SelectRe.dispatchEvent({ type: 'change', target: slot3SelectRe });

    // Model now has array of 2 skills
    const c0Skills = ctx.model.document.content.rules[0].classes[0].skills;
    assert.equal(c0Skills.length, 2, 'Skills array reduced to 2');
    assert.deepEqual(c0Skills, ['s00', 's01']);

    // Re-render shows 2 / 3 in count, and class card has problem marker
    const newCountSpan = ctx.inspector.querySelector('#class-skills .skills-header span:last-child');
    assert.equal(newCountSpan.textContent, '2 / 3');
    assert.ok(newCountSpan.classList.contains('warn-count'));

    const c0Card = ctx.main.querySelector('.class-card[data-slug=c0]');
    assert.equal(c0Card.getAttribute('data-has-problem'), 'true');
    assert.ok(c0Card.querySelector('.problem-dot'));

    // Inspector displays warning status box
    const problemBox = ctx.inspector.querySelector('div[role=status].warning');
    assert.ok(problemBox, 'Warning status box displayed');
    assert.match(problemBox.textContent, /2 skills/);

    // Fixing skill by selecting s02 in slot 3 restores 3 skills
    const emptySlot3Select = ctx.inspector.querySelectorAll('.skill-row select')[2];
    emptySlot3Select.value = 's02';
    emptySlot3Select.dispatchEvent({ type: 'change', target: emptySlot3Select });

    assert.equal(ctx.model.document.content.rules[0].classes[0].skills.length, 3);
    assert.equal(ctx.inspector.querySelector('#class-skills .skills-header span:last-child').textContent, '3 / 3');
});

test('T2-6: + Root class and + Child class via add(), unique placeholder slug, child disabled at tier3', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.render();

    // Click + Root class button
    const addRootBtn = ctx.main.querySelector('.classes-header button');
    assert.equal(addRootBtn.textContent, '+ Root class');
    addRootBtn.click();

    // Newly added class selected
    assert.equal(ctx.selection.id, 'new-class');
    const newClass = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'new-class');
    assert.ok(newClass, 'Root class was added');
    assert.equal(newClass.name, '[CLASS NAME]');
    assert.equal(newClass.tier, 0);
    assert.equal(newClass.parent, null);
    assert.deepEqual(newClass.skills, []);

    // For a tier 3 class (c3), + Child class is disabled
    ctx.select('classes', 'c3');
    const childBtnTier3 = ctx.inspector.querySelectorAll('.row button').find(b => b.textContent === '+ Child class');
    assert.ok(childBtnTier3.disabled, '+ Child class must be disabled at tier 3');

    // For a tier 1 class (c1), + Child class is enabled and adds child
    ctx.select('classes', 'c1');
    const childBtnTier1 = ctx.inspector.querySelectorAll('.row button').find(b => b.textContent === '+ Child class');
    assert.ok(!childBtnTier1.disabled, '+ Child class enabled at tier 1');
    childBtnTier1.click();

    assert.equal(ctx.selection.id, 'c1-child');
    const childClass = ctx.model.document.content.rules[0].classes.find(c => c.slug === 'c1-child');
    assert.ok(childClass, 'Child class was added');
    assert.equal(childClass.name, '[CLASS NAME]');
    assert.equal(childClass.tier, 2);
    assert.equal(childClass.parent, 'c1');
    assert.deepEqual(childClass.skills, []);
});

test('T2-7: Cascade removal exact preview in native dialog, confirm, and undo', () => {
    const pack = smallRulesPack();
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c3');

    // Pure preview check
    const previewResult = remove(ctx.model, 'classes', 'c3', { cascade: true });
    assert.ok(previewResult.ok);
    const changes = cascadeChanges(ctx.model, previewResult.model, 'c3');

    // c3 + 3 skills (s30, s31, s32) + 24 branches + generated forms
    assert.ok(changes.length > 20, `Cascade changes should list all affected records, got ${changes.length}`);
    assert.ok(changes.some(c => c.kind === 'classes' && c.id === 'c3'));
    assert.ok(changes.some(c => c.kind === 'skills' && c.id === 's30'));
    assert.ok(changes.some(c => c.kind === 'branches'));

    // Open cascade dialog via Remove… button
    const removeBtn = ctx.inspector.querySelector('button.danger');
    removeBtn.click();

    const dialog = ctx.overlays.querySelector('dialog[aria-label="Remove class"]');
    assert.ok(dialog, 'Native dialog opened');
    assert.ok(dialog.open, 'Dialog is open');

    const listItems = dialog.querySelectorAll('li');
    assert.equal(listItems.length, changes.length, 'Dialog lists exact cascade changes count');

    const confirmBtn = dialog.querySelectorAll('button').find(b => b.textContent.startsWith('Remove all'));
    assert.ok(confirmBtn, 'Confirm button exists');

    // Confirm commits preview
    confirmBtn.click();
    assert.equal(dialog.parentElement, null, 'Dialog removed on confirm');

    // c3 and its skills are gone
    const remainingClasses = ctx.model.document.content.rules[0].classes.map(c => c.slug);
    assert.ok(!remainingClasses.includes('c3'));

    // Undo brings everything back
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

    assert.equal(dialog.parentElement, null, 'Dialog removed on cancel');
    assert.equal(ctx.doc.activeElement, removeBtn, 'Focus restored to invoker');
    // Model unchanged
    assert.equal(ctx.model.document.content.rules[0].classes.length, 4);

    // Test Escape / cancel event
    removeBtn.click();
    const dialog2 = ctx.overlays.querySelector('dialog[aria-label="Remove class"]');
    dialog2.dispatchEvent({ type: 'cancel', defaultPrevented: false, preventDefault() {} });

    assert.equal(dialog2.parentElement, null, 'Dialog removed on escape cancel event');
    assert.equal(ctx.doc.activeElement, removeBtn, 'Focus restored to invoker');
});

test('T2-9: Safe hostile names with <script> and <b> markers', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[0].name = '<b>Hostile</b><script>alert(1)</script>';
    pack.content.rules[0].classes[0].slug = 'c0';

    const ctx = createTestContext(pack);
    ctx.onRender = () => renderClasses(ctx);
    ctx.select('classes', 'c0');

    // Main card contains literal text
    const c0Card = ctx.main.querySelector('.class-card[data-slug=c0]');
    assert.equal(c0Card.querySelectorAll('b').length, 0, 'No injected <b> tag in card');
    assert.equal(c0Card.querySelectorAll('script').length, 0, 'No injected <script> tag in card');
    assert.match(c0Card.textContent, /<b>Hostile<\/b><script>alert\(1\)<\/script>/);

    // Inspector title contains literal text
    const title = ctx.inspector.querySelector('.inspector-title-row h2');
    assert.equal(title.querySelectorAll('b').length, 0, 'No injected <b> tag in title');
    assert.equal(title.querySelectorAll('script').length, 0, 'No injected <script> tag in title');
    assert.equal(title.textContent, '<b>Hostile</b><script>alert(1)</script>');

    // Name input value contains raw text
    const nameInput = ctx.inspector.querySelector('#class-name');
    assert.equal(nameInput.value, '<b>Hostile</b><script>alert(1)</script>');
});

test('T2-10: Pure helper classField directly edits class fields', () => {
    const pack = smallRulesPack();
    const model = openPack(pack);

    // Edit name
    const res1 = classField(model, 'c1', 'name', 'Updated Class');
    assert.ok(res1.ok);
    assert.equal(res1.model.document.content.rules[0].classes[1].name, 'Updated Class');

    // Edit skills to 2 skills (draft)
    const res2 = classField(res1.model, 'c1', 'skills', ['s10', 's11']);
    assert.ok(res2.ok);
    assert.deepEqual(res2.model.document.content.rules[0].classes[1].skills, ['s10', 's11']);

    // Non-existent class
    const res3 = classField(model, 'non-existent', 'name', 'X');
    assert.ok(!res3.ok);
    assert.equal(res3.errors[0].code, 'not-found');
});
