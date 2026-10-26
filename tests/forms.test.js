import test from 'node:test';
import assert from 'node:assert/strict';

import { makeValidExtendedPack } from './fixtures/builders.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { openPack } from '../src/model.js';
import { setField, add } from '../src/edits.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { schemaForKind, referenceTarget, resolveSchema } from '../src/form-schema.js';
import { renderForm, formOptions, parseIntegerInput, parseNumberInput, parseJsonInput } from '../src/forms.js';
function controls(ctx, tag, key, draft = false) {
    return ctx.inspector.querySelectorAll(tag).filter(node => {
        const raw = node.getAttribute(draft ? 'data-draft-path' : 'data-path');
        return raw && JSON.parse(raw).at(-1) === key;
    });
}


test('T4-1: schemaForKind resolves shared rules-v2 $defs and host descriptors without throwing', () => {
    const foeSchema = schemaForKind('creatures');
    assert.ok(foeSchema);
    assert.equal(foeSchema.type, 'object');
    assert.equal(foeSchema.properties.name.maxLength, 80);
    assert.ok(foeSchema.properties.skills);

    const questSchema = schemaForKind('quests');
    assert.ok(questSchema);
    for (const variant of questSchema.oneOf) assert.equal(variant.properties.name.maxLength, 80);

    const shopSchema = schemaForKind('shops');
    assert.ok(shopSchema);
    assert.ok(shopSchema.properties.stock);

    const recipeSchema = schemaForKind('recipes');
    assert.ok(recipeSchema);
    assert.ok(recipeSchema.properties.makes);

    const itemRuleSchema = schemaForKind('itemRules');
    assert.ok(itemRuleSchema);
    assert.ok(itemRuleSchema.properties.def);

    const branchSchema = schemaForKind('branches');
    assert.ok(branchSchema);
    assert.ok(branchSchema.properties.skill);

    const trainerSchema = schemaForKind('trainers');
    assert.ok(trainerSchema);
    assert.ok(trainerSchema.properties.place);

    for (const hostKind of ['items', 'places', 'events', 'routes', 'races', 'talents', 'presets', 'legacySkills']) {
        const s = schemaForKind(hostKind);
        assert.ok(s, `schemaForKind must provide descriptor for ${hostKind}`);
        assert.equal(s.type, 'object');
    }
});

test('T4-2: referenceTarget context mapping distinguishes preset legacySkills from rules skills and handles all targets', () => {
    assert.equal(referenceTarget('creatures', ['loot', 0, 'def']), 'items');
    assert.equal(referenceTarget('itemRules', ['def']), 'items');
    assert.equal(referenceTarget('recipes', ['makes']), 'items');
    assert.equal(referenceTarget('recipes', ['materials', 0, 'item']), 'items');
    assert.equal(referenceTarget('shops', ['stock', 0, 'item']), 'items');
    assert.equal(referenceTarget('quests', ['reward', 'items', 0, 'def']), 'items');
    assert.equal(referenceTarget('creatures', ['skills', 0]), 'skills');
    assert.equal(referenceTarget('trainers', ['skills', 0]), 'skills');
    assert.equal(referenceTarget('branches', ['skill']), 'skills');
    assert.equal(referenceTarget('trainers', ['eventTemplates', 0]), 'events');
    assert.equal(referenceTarget('events', ['after']), 'events');
    assert.equal(referenceTarget('trainers', ['place']), 'places');
    assert.equal(referenceTarget('shops', ['place']), 'places');
    assert.equal(referenceTarget('quests', ['turnInPlace']), 'places');
    assert.equal(referenceTarget('routes', ['from']), 'places');
    assert.equal(referenceTarget('routes', ['to']), 'places');
    assert.equal(referenceTarget('quests', ['requirements', 0, 'classes', 0]), 'classes');
    assert.equal(referenceTarget('quests', ['requirements', 0, 'template']), 'quests');
    assert.equal(referenceTarget('quests', ['chain', 'previous']), 'quests');
    assert.equal(referenceTarget('quests', ['objectives', 0, 'foe']), 'creatures');
    assert.equal(referenceTarget('presets', ['race']), 'races');
    assert.equal(referenceTarget('presets', ['talents', 0]), 'talents');
    assert.equal(referenceTarget('presets', ['skills', 0]), 'legacySkills');
    assert.equal(referenceTarget('branches', ['fromForm']), 'forms');
    assert.equal(referenceTarget('quests', ['giver']), 'npcs');
    assert.equal(referenceTarget('quests', ['requirements', 0, 'thread']), 'threads');
});

test('T4-3: String and multiline note renderer types with textContent safety against hostile text literals', () => {
    const pack = smallRulesPack();
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

    const pack = smallRulesPack();
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

test('T4-5: Boolean and Enum renderer types retain numeric and boolean types on change', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].itemRules = [{
        def: 'iron-sword',
        allowedSlots: ['weapon'],
        hands: 1,
        requires: [],
        weight: 10,
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('itemRules', 'iron-sword');

    const selects = ctx.inspector.querySelectorAll('select');
    const handsSelect = selects.find(s => s.getAttribute('data-path')?.includes('hands'));
    assert.ok(handsSelect);
    assert.equal(handsSelect.value, '1');

    handsSelect.value = '2';
    handsSelect.dispatchEvent({ type: 'change', target: handsSelect });
    assert.equal(ctx.model.document.content.rules[0].itemRules[0].hands, 2);
    assert.equal(typeof ctx.model.document.content.rules[0].itemRules[0].hands, 'number');
    const body = ctx.doc.createElement('div');
    renderForm(ctx, body, { type: 'boolean' }, false, ['content', 'places', 0, 'hidden']);
    const check = body.querySelector('input');
    assert.equal(check.parentElement.tagName, 'LABEL');
    check.checked = true;
    check.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.places[0].hidden, true);
});

test('T4-6: Readonly const fields and itemRules.def identity is readonly on existing records', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].itemRules = [{
        def: 'iron-sword',
        allowedSlots: ['weapon'],
        hands: 1,
        requires: [],
        weight: 10,
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('itemRules', 'iron-sword');

    const defInput = controls(ctx, 'input', 'def')[0];
    assert.ok(defInput);
    assert.ok(defInput.readOnly, 'itemRules.def must be readonly on existing records');
    const body = ctx.doc.createElement('div');
    renderForm(ctx, body, { const: 'Fixed' }, 's00', ['content', 'rules', 0, 'skills', 0, 'name']);
    assert.equal(body.querySelector('input').value, 's00');
    assert.equal(body.querySelector('input').readOnly, true);
    body.querySelector('button').click();
    assert.equal(ctx.model.document.content.rules[0].skills[0].name, 'Fixed');
});

test('T4-7: Null and optional field clear removes key via identity-preserving setField and undo restores it', () => {
    const pack = smallRulesPack();
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
    const pack = smallRulesPack();
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

test('T4-9: oneOf unions with kind/op discriminator switch variant and update structure', () => {
    const pack = makeValidExtendedPack();
    pack.content.quests = [{
        slug: 'hunt',
        name: 'Hunt',
        category: 'bounty',
        giver: null,
        turnInPlace: null,
        requirements: [],
        objectives: [{
            id: 'pack.fixture/objective',
            kind: 'visit',
            place: 'pack.fixture/haven',
        }],
        reward: { coin: 50, xp: 100, items: [] },
        durationMinutes: null,
        repeat: null,
        chain: null,
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('quests', 'hunt');

    const unionSelect = ctx.inspector.querySelectorAll('select').find(n => JSON.parse(n.getAttribute('data-path')).includes('objectives'));
    assert.ok(unionSelect);
    assert.equal(unionSelect.value, '2');

    unionSelect.value = '0';
    unionSelect.dispatchEvent({ type: 'change', target: unionSelect });
    assert.equal(ctx.model.document.content.quests[0].objectives[0].kind, 'kill');
});

test('T4-10: Bounded JSON textarea refuses malformed syntax with bad-value and preserves valid data', () => {
    assert.equal(parseJsonInput('{ invalid }').ok, false);
    assert.equal(parseJsonInput('{"heal": 25}').ok, true);
    assert.deepEqual(parseJsonInput('{"heal": 25}').value, { heal: 25 });

    const pack = smallRulesPack();
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

test('T4-11: Reference pickers list existing records and label missing current values without offering them', () => {
    const pack = smallRulesPack();
    pack.content.shops = [{
        slug: 'haven-shop',
        name: 'Haven Shop',
        place: 'ghost-town',
        kind: 'general',
        stock: [],
    }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('shops', 'haven-shop');

    const placeSelect = controls(ctx, 'input', 'place')[0];
    assert.ok(placeSelect);
    const options = ctx.inspector.querySelector('datalist').querySelectorAll('option');
    const optionValues = options.map(o => o.value);
    assert.ok(optionValues.includes('pack.fixture/haven'));
    assert.ok(optionValues.includes('pack.fixture/mill'));
    assert.equal(optionValues.includes('ghost-town'), false);

    assert.match(ctx.inspector.textContent, /ghost-town \(missing\)/);
    assert.equal(placeSelect.value, 'ghost-town');
});

test('T4-12: Complete screen flow: list left, form right, + Add blank form, renameId, remove without cascade and with cascade dialog', () => {
    const pack = smallRulesPack();
    pack.content.items = [
        { slug: 'bread', name: 'Bread', kind: 'consumable', rarity: 'common' },
        { slug: 'shield', name: 'Shield', kind: 'equipment', rarity: 'common' },
    ];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items');

    const cards = ctx.main.querySelectorAll('.record-card');
    assert.equal(cards.length, 2);

    const addBtn = ctx.main.querySelector('.records-header button');
    assert.ok(addBtn.textContent.includes('+ Add'));
    addBtn.click();
    assert.equal(ctx.selection.id, '__new__');

    const slugInput = controls(ctx, 'input', 'slug', true)[0];
    const nameInput = controls(ctx, 'input', 'name', true)[0];
    assert.ok(slugInput);
    assert.ok(nameInput);
    slugInput.value = 'cheese';
    slugInput.dispatchEvent({ type: 'change', target: slugInput });
    nameInput.value = 'Cheese';
    nameInput.dispatchEvent({ type: 'change', target: nameInput });

    const createBtn = ctx.inspector.querySelector('button.primary');
    createBtn.click();
    assert.equal(ctx.model.document.content.items.length, 3);
    assert.equal(ctx.selection.id, 'cheese');

    const renameField = controls(ctx, 'input', 'slug')[0];
    renameField.value = 'aged-cheese';
    renameField.dispatchEvent({ type: 'change', target: renameField });
    assert.equal(ctx.model.document.content.items[2].slug, 'aged-cheese');
    assert.equal(ctx.selection.id, 'aged-cheese');

    const removeBtn = ctx.inspector.querySelector('button.danger');
    removeBtn.click();
    assert.equal(ctx.model.document.content.items.length, 2);
    ctx.history.undo(); ctx.changed();
    ctx.apply(add(ctx.model, 'shops', { slug: 'store', name: 'Store', place: 'haven', stock: [{ item: 'aged-cheese', qty: 1, price: 1 }] }));
    ctx.select('items', 'aged-cheese');
    const invoker = ctx.inspector.querySelector('button.danger');
    invoker.click();
    let dialog = ctx.overlays.querySelector('dialog');
    assert.ok(dialog);
    assert.match(dialog.textContent, /Store/);
    dialog.querySelector('button').click();
    assert.equal(ctx.doc.activeElement, invoker);
    invoker.click();
    dialog = ctx.overlays.querySelector('dialog');
    dialog.querySelector('button.primary').click();
    assert.equal(ctx.model.document.content.items.length, 2);
    assert.equal(ctx.model.document.content.shops.length, 0);
    ctx.history.undo(); ctx.changed();
    assert.equal(ctx.model.document.content.items.length, 3);
    assert.equal(ctx.model.document.content.shops.length, 1);
});

test('T4-13: Handling empty collections and corrupted safe drafts without throwing', () => {
    const pack = smallRulesPack();
    pack.content.items = [null, 'invalid', { slug: 'valid-item', name: 'Valid' }];
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    assert.doesNotThrow(() => ctx.select('items'));

    const cards = ctx.main.querySelectorAll('.record-card');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].getAttribute('data-id'), 'valid-item');
});

test('T4-14: New record retains nested draft edits and uses draft paths until Add', () => {
    const ctx = createTestContext(smallRulesPack());
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

test('T4-15: Reference arrays and shop quantities edit leaves without replacing containers', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].trainers = [{ slug: 'teacher', name: '[TRAINER]', place: 'haven', skills: ['s00', 's01'], eventTemplates: ['dawn'] }];
    pack.content.events = [{ id: 'dawn', when: 'day 1', cue: '[CUE]' }];
    pack.content.items = [{ slug: 'bread', name: '[ITEM]' }];
    pack.content.shops = [{ slug: 'store', name: '[SHOP]', place: 'haven', stock: [{ item: 'bread', qty: 5, price: 2 }] }];
    const ctx = createTestContext(pack); ctx.onRender = () => renderScreen(ctx);
    ctx.select('trainers', 'teacher');
    const skill = ctx.inspector.querySelectorAll('select').find(n => {
        const path = JSON.parse(n.getAttribute('data-path')); return path.at(-2) === 'skills' && path.at(-1) === 0;
    });
    assert.ok(skill); skill.value = 's02'; skill.dispatchEvent({ type: 'change' });
    assert.deepEqual(ctx.model.document.content.rules[0].trainers[0].skills, ['s02', 's01']);
    assert.deepEqual(ctx.model.document.content.rules[0].trainers[0].eventTemplates, ['dawn']);
    ctx.select('shops', 'store');
    const qty = controls(ctx, 'input', 'qty')[0];
    assert.equal(qty.getAttribute('type'), 'number');
    qty.value = '9'; qty.dispatchEvent({ type: 'change' });
    assert.deepEqual(ctx.model.document.content.shops[0].stock, [{ item: 'bread', qty: 9, price: 2 }]);
});

test('T4-16: Primitive unions, null, and invalid enums stay visible and can be repaired', () => {
    const pack = smallRulesPack(); pack.content.items = [{ slug: 'gear', name: '[ITEM]', kind: 'unknown', rarity: 'common', slot: 'custom-slot' }];
    const ctx = createTestContext(pack); ctx.onRender = () => renderScreen(ctx); ctx.select('items', 'gear');
    const slot = controls(ctx, 'input', 'slot')[0];
    assert.equal(slot.value, 'custom-slot');
    slot.value = 'offhand'; slot.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.items[0].slot, 'offhand');
    const variant = controls(ctx, 'select', 'slot')[0]; variant.value = '0'; variant.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.items[0].slot, null);
    const kind = controls(ctx, 'select', 'kind')[0];
    assert.match(kind.querySelectorAll('option').find(o => o.selected).textContent, /unknown.*invalid/);
    kind.value = 'goods'; kind.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.items[0].kind, 'goods');
    ctx.inspector.querySelector('button[aria-label="Clear slot"]').click();
    assert.equal(Object.hasOwn(ctx.model.document.content.items[0], 'slot'), false);
});

test('T4-17: Missing required containers initialize before nested typed edits', () => {
    const pack = smallRulesPack(); pack.content.items = [{ slug: 'entry', name: '[ITEM]' }];
    const ctx = createTestContext(pack);
    const schema = { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } } } } };
    ctx.onRender = () => renderForm(ctx, ctx.inspector, schema, ctx.model.document.content.items[0], ['content', 'items', 0], { kind: 'items' });
    ctx.render();
    const initialize = ctx.inspector.querySelector('button'); assert.equal(initialize.textContent, 'Initialize data'); initialize.click();
    const amount = controls(ctx, 'input', 'amount')[0]; amount.value = '12'; amount.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.items[0].data.amount, 12);
    assert.equal(ctx.model.document.content.items[0].slug, 'entry');
});

test('T4-18: Unknown fields remain visible through safe JSON repair without losing identity or order', () => {
    const pack = smallRulesPack(); pack.content.items = [{ slug: 'entry', name: '[ITEM]', kind: 'goods', rarity: 'common', aliases: ['second', 'first'], extra: { value: 1 } }];
    const ctx = createTestContext(pack); ctx.onRender = () => renderScreen(ctx); ctx.select('items', 'entry');
    const json = ctx.inspector.querySelector('textarea.json-textarea');
    const current = JSON.parse(json.value); assert.deepEqual(current.extra, { value: 1 });
    delete current.extra; current.name = '[REPAIRED]';
    json.value = JSON.stringify(current); json.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.items[0].slug, 'entry');
    assert.deepEqual(ctx.model.document.content.items[0].aliases, ['second', 'first']);
    assert.equal(Object.hasOwn(ctx.model.document.content.items[0], 'extra'), false);
    assert.equal(ctx.model.document.content.items[0].name, '[REPAIRED]');
});

test('T4-19: Form reference choices match shared forms and preserve pathway shape for invalid drafts', () => {
    const pack = smallRulesPack();
    const valid = formOptions(openPack(pack)); assert.equal(valid.length, 48);
    assert.ok(valid.includes('s30-base-g-a'));
    pack.content.rules[0].classes[0].skills.pop();
    const invalid = openPack(pack);
    assert.equal(invalid.validation.ok, false);
    const draft = formOptions(invalid);
    assert.deepEqual([...draft].sort(), [...valid].sort());
    assert.equal(draft.includes('s00-base-a'), false);
});

test('T4-20: Qualified current and external references are labelled and retained without a render-time edit', () => {
    const pack = smallRulesPack();
    pack.name = '<b>x</b>';
    pack.content.rules[0].trainers = [{ slug: 'teacher', name: '[TRAINER]', place: 'pack.other/garden', skills: ['pack.fixture/s00'], eventTemplates: [] }];
    const ctx = createTestContext(pack); ctx.onRender = () => renderScreen(ctx); ctx.select('trainers', 'teacher');
    const reference = ctx.inspector.querySelector('select');
    assert.equal(reference.value, 'pack.fixture/s00');
    const place = controls(ctx, 'input', 'place')[0];
    assert.equal(place.value, 'pack.other/garden');
    assert.equal(place.parentElement.tagName, 'LABEL');
    assert.ok(place.getAttribute('list'));
    assert.equal(ctx.history.canUndo, false);
    place.value = 'pl_00000001'; place.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.rules[0].trainers[0].place, 'pl_00000001');
    assert.deepEqual(ctx.model.document.content.rules[0].trainers[0].skills, ['pack.fixture/s00']);
});

test('T4-21: Nested objective identifiers are authored through their list while quest identity stays intact', () => {
    const pack = smallRulesPack();
    pack.content.quests = [{ slug: 'visit', name: '[QUEST]', objectives: [{ id: 'old', kind: 'visit', place: 'pack.fixture/haven' }] }];
    const ctx = createTestContext(pack); ctx.onRender = () => renderScreen(ctx); ctx.select('quests', 'visit');
    const id = controls(ctx, 'input', 'id')[0]; id.value = 'objective_00000001'; id.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.quests[0].objectives[0].id, 'objective_00000001');
    assert.equal(ctx.model.document.content.quests[0].slug, 'visit');
    ctx.history.undo();
    assert.equal(ctx.model.document.content.quests[0].objectives[0].id, 'old');
});

test('reference suggestions and commits use the field schema ID format and keep export valid', () => {
    const ctx = createTestContext(makeValidExtendedPack());
    ctx.onRender = () => renderScreen(ctx);
    assert.equal(ctx.model.validation.ok, true);
    for (const [kind, id, key] of [['trainers', 'weapon-master', 'place'], ['shops', 'haven-armory', 'place'], ['quests', 'scout-threat', 'turnInPlace']]) {
        ctx.select(kind, id);
        const control = controls(ctx, 'input', key)[0];
        assert.ok(control, `${kind}.${key} picker`);
        const choices = ctx.inspector.querySelector(`[id="${control.getAttribute('list')}"]`).querySelectorAll('option');
        assert.ok(choices.some(option => option.value === 'pack.fixture/mill'));
        control.value = 'pack.fixture/mill'; control.dispatchEvent({ type: 'change' });
        const list = kind === 'trainers' ? ctx.model.document.content.rules[0].trainers : ctx.model.document.content[kind];
        assert.equal(list.find(record => record.slug === id)[key], 'pack.fixture/mill');
        assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
        ctx.history.undo(); ctx.changed();
        const local = controls(ctx, 'input', key)[0];
        local.value = 'mill'; local.dispatchEvent({ type: 'change' });
        assert.equal(ctx.model.validation.ok, true, 'Typed local IDs use the same formatter as suggestions');
    }
});

test('schema constraints refuse edits with a code before history changes and retain previous values', () => {
    const ctx = createTestContext(makeValidExtendedPack()); ctx.onRender = () => renderScreen(ctx);
    const before = ctx.model;
    for (const [kind, id, key, value] of [
        ['creatures', 'goblin-scout', 'level', '0'],
        ['creatures', 'goblin-scout', 'level', '101'],
        ['items', 'greatsword', 'value', '-999'],
        ['items', 'greatsword', 'name', ''],
        ['items', 'greatsword', 'name', 'x'.repeat(81)],
        ['items', 'greatsword', 'slug', 'bad_slug'],
    ]) {
        ctx.select(kind, id);
        const input = controls(ctx, 'input', key)[0];
        const previous = input.value;
        input.value = value; input.dispatchEvent({ type: 'change' });
        assert.equal(ctx.model, before, `${kind}.${key}=${value} must be refused`);
        assert.equal(input.value, previous);
        assert.match(ctx.notifications.at(-1), /^bad-value:/);
        assert.equal(ctx.history.canUndo, false);
    }
    ctx.select('creatures', 'goblin-scout');
    const level = controls(ctx, 'input', 'level')[0];
    level.value = '2'; level.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model.document.content.creatures[0].level, 2);
    assert.equal(ctx.model.validation.ok, true);
    assert.equal(ctx.history.canUndo, true);
    const damaged = makeValidExtendedPack(); damaged.content.items[0].extra = true;
    const repair = createTestContext(damaged); repair.onRender = () => renderScreen(repair);
    repair.select('items', 'greatsword');
    const json = repair.inspector.querySelectorAll('textarea.json-textarea').at(-1);
    const missing = JSON.parse(json.value); delete missing.extra; delete missing.name;
    const previous = repair.model;
    json.value = JSON.stringify(missing); json.dispatchEvent({ type: 'change' });
    assert.equal(repair.model, previous, 'JSON edits cannot delete required fields');
    assert.match(repair.notifications.at(-1), /^bad-value: Missing required field: name/);
});
