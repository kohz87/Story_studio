import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPack } from './fixtures/world.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { parseIntegerInput, parseNumberInput, parseJsonInput } from '../src/forms.js';
function controls(ctx, tag, key, draft = false) {
    return ctx.inspector.querySelectorAll(tag).filter(node => {
        const raw = node.getAttribute(draft ? 'data-draft-path' : 'data-path');
        return raw && JSON.parse(raw).at(-1) === key;
    });
}

test('T4-3: String and multiline note renderer types with textContent safety against hostile text literals', () => {
    const pack = worldPack();
    pack.content.items = [{
        slug: 'potion',
        name: '<b>Hostile</b><script>alert(1)</script>',
        kind: 'consumable',
        rarity: 'common',
        note: '<script>alert("note")</script>',
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', 'potion');

    const inputs = ctx.inspector.querySelectorAll('input');
    const textareas = ctx.inspector.querySelectorAll('textarea');
    assert.ok(inputs.length > 0);
    assert.ok(textareas.length > 0);

    const nameInput = inputs.find(i => i.value.includes('Hostile'));
    assert.ok(nameInput);
    assert.equal(nameInput.value, '<b>Hostile</b><script>alert(1)</script>');
    assert.equal(ctx.inspector.querySelectorAll('b').length, 0);
    assert.equal(ctx.inspector.querySelectorAll('script').length, 0);

    nameInput.value = 'Safe Potion';
    nameInput.dispatchEvent({ type: 'change', target: nameInput });
    assert.equal(ctx.model.document.content.items[0].name, 'Safe Potion');

    ctx.history.undo();
    ctx.changed();
    assert.equal(ctx.model.document.content.items[0].name, '<b>Hostile</b><script>alert(1)</script>');
});


test('T4-4: Numeric renderer refusals for empty, NaN, and fractional integers with bad-value code; schema bounds enforced', () => {
    assert.equal(parseIntegerInput('').ok, false);
    assert.equal(parseIntegerInput('  ').ok, false);
    assert.equal(parseIntegerInput('xyz').ok, false);
    assert.equal(parseIntegerInput('3.14').ok, false);
    assert.equal(parseIntegerInput('42').value, 42);
    assert.equal(parseIntegerInput('-5').value, -5);

    assert.equal(parseNumberInput('').ok, false);
    assert.equal(parseNumberInput('not-a-number').ok, false);
    assert.equal(parseNumberInput('3.14').value, 3.14);

    const pack = worldPack();
    pack.content.items = [{
        slug: 'iron-sword',
        name: 'Iron Sword',
        kind: 'equipment',
        rarity: 'common',
        value: 100,
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', 'iron-sword');

    const valueInput = ctx.inspector.querySelector('input[type="number"]');
    assert.ok(valueInput);
    assert.equal(valueInput.value, '100');

    valueInput.value = '';
    valueInput.dispatchEvent({ type: 'change', target: valueInput });
    assert.equal(valueInput.value, '100');
    assert.ok(ctx.notifications.some(n => n.includes('bad-value')));
    assert.equal(ctx.history.canUndo, false);

    valueInput.value = '12.5';
    valueInput.dispatchEvent({ type: 'change', target: valueInput });
    assert.equal(valueInput.value, '100');
    assert.ok(ctx.notifications.some(n => n.includes('bad-value')));
    assert.equal(ctx.history.canUndo, false);

    valueInput.value = '-999';
    valueInput.dispatchEvent({ type: 'change', target: valueInput });
    assert.equal(ctx.model.document.content.items[0].value, 100);
    assert.equal(ctx.history.canUndo, false);
});


test('T4-7: Null and optional field clear removes key via identity-preserving setField and undo restores it', () => {
    const pack = worldPack();
    pack.content.items = [{
        slug: 'dagger',
        name: 'Dagger',
        kind: 'equipment',
        rarity: 'common',
        note: 'A sharp blade',
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', 'dagger');

    const clearNoteBtn = ctx.inspector.querySelector('button[aria-label="Clear note"]');
    assert.ok(clearNoteBtn);
    clearNoteBtn.click();

    assert.equal('note' in ctx.model.document.content.items[0], false);
    assert.ok(ctx.history.canUndo);

    ctx.history.undo();
    ctx.changed();
    assert.equal(ctx.model.document.content.items[0].note, 'A sharp blade');
});


test('T4-8: Array rows with add/remove preserve order and mutate via history', () => {
    const pack = worldPack();
    pack.content.items = [{
        slug: 'gem',
        name: 'Gem',
        kind: 'goods',
        rarity: 'rare',
        tags: ['shiny', 'valuable'],
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', 'gem');

    const removeBtns = ctx.inspector.querySelectorAll('.array-row button.danger');
    assert.equal(removeBtns.length, 2);
    removeBtns[0].click();

    assert.deepEqual(ctx.model.document.content.items[0].tags, ['valuable']);

    const addBtn = ctx.inspector.querySelector('.array-add-btn');
    assert.ok(addBtn);
    addBtn.click();
    assert.equal(ctx.model.document.content.items[0].tags.length, 2);
});


test('T4-10: Bounded JSON textarea refuses malformed syntax with bad-value and preserves valid data', () => {
    assert.equal(parseJsonInput('{ invalid }').ok, false);
    assert.equal(parseJsonInput('{"heal": 25}').ok, true);
    assert.deepEqual(parseJsonInput('{"heal": 25}').value, { heal: 25 });

    const pack = worldPack();
    pack.content.items = [{
        slug: 'herb',
        name: 'Herb',
        kind: 'consumable',
        rarity: 'common',
        effect: { heal: 10 },
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', 'herb');

    const jsonArea = ctx.inspector.querySelector('textarea.json-textarea');
    assert.ok(jsonArea);

    jsonArea.value = '{ bad json';
    jsonArea.dispatchEvent({ type: 'change', target: jsonArea });
    assert.ok(ctx.notifications.some(n => n.includes('bad-value')));
    assert.deepEqual(ctx.model.document.content.items[0].effect, { heal: 10 });

    jsonArea.value = '{"heal": 30}';
    jsonArea.dispatchEvent({ type: 'change', target: jsonArea });
    assert.deepEqual(ctx.model.document.content.items[0].effect, { heal: 30 });
});


test('T4-13: Handling empty collections and corrupted safe drafts without throwing', () => {
    const pack = worldPack();
    pack.content.items = [null, 'invalid', { slug: 'valid-item', name: 'Valid' }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    assert.doesNotThrow(() => ctx.select('items'));

    const cards = ctx.main.querySelectorAll('.record-card');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].getAttribute('data-id'), 'valid-item');
});


test('T4-14: New record retains nested draft edits and uses draft paths until Add', () => {
    const ctx = createTestContext(worldPack());
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', '__new__');
    const change = (key, value) => {
        const input = controls(ctx, 'input', key, true)[0];
        input.value = value; input.dispatchEvent({ type: 'change' });
    };
    change('slug', 'new-item'); change('name', '[NAME]');
    ctx.inspector.querySelector('button[aria-label="Enable tags"]').click();
    ctx.inspector.querySelector('.array-add-btn').click();
    change(0, 'tag-one');
    ctx.inspector.querySelector('button[aria-label="Enable carry"]').click();
    change('carry', '3');
    assert.equal(ctx.inspector.querySelectorAll('[data-path]').length, 0);
    for (const tag of ['input', 'select', 'textarea']) {
        for (const control of ctx.inspector.querySelectorAll(tag)) assert.equal(control.parentElement.tagName, 'LABEL');
    }
    assert.equal(ctx.history.canUndo, false);
    ctx.inspector.querySelector('button.primary').click();
    const item = ctx.model.document.content.items[0];
    assert.equal(item.slug, 'new-item'); assert.equal(item.name, '[NAME]');
    assert.deepEqual(item.tags, ['tag-one']); assert.equal(item.carry, 3);
    assert.equal(ctx.history.canUndo, true);
});
