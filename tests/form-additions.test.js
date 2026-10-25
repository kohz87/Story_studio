import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefault, renderForm } from '../src/forms.js';
import { schemaForKind, validateField, referenceTarget } from '../src/form-schema.js';
import { KINDS, kindPath, records, identity, localId } from '../src/records.js';
import { openPack } from '../src/model.js';
import { makeEveryKindPack } from './fixtures/everyKindPack.js';
import { makeValidExtendedPack } from './fixtures/builders.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { renderRecords } from '../src/screens/records.js';

function* fields(schema, path = []) {
    yield { schema, path };
    for (const variant of schema.oneOf || []) yield* fields(variant, path);
    for (const [key, child] of Object.entries(schema.properties || {})) yield* fields(child, [...path, key]);
    if (schema.items) yield* fields(schema.items, [...path, 0]);
}
function read(document, path) { return path.reduce((value, key) => value?.[key], document); }
function seed(document, path, value) {
    let parent = document;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!parent[key] || typeof parent[key] !== 'object') parent[key] = typeof path[i + 1] === 'number' ? [] : {};
        parent = parent[key];
    }
    parent[path.at(-1)] = value;
}

test('schema traversal: every array Add commits a valid resulting list or opens a picker', async t => {
    const pack = makeEveryKindPack();
    const model = openPack(pack);
    let actions = 0;
    for (const kind of KINDS) {
        const root = schemaForKind(kind);
        const defaults = createDefault(root, { model, kind, path: [...kindPath(kind), 'draft'] });
        if (defaults !== undefined) assert.equal(validateField(root, defaults).ok, true, `${kind}: required defaults`);
        for (const { schema, path: relative } of fields(root)) {
            if (schema.type !== 'array') continue;
            actions++;
            await t.test(`${kind}.${relative.join('.')}`, () => {
                const path = [...kindPath(kind), 0, ...relative];
                const initial = createDefault(schema, { model, kind, path });
                assert.equal(validateField(schema, initial).ok, true);
                const fixture = structuredClone(pack);
                seed(fixture, path, initial);
                const ctx = createTestContext(fixture);
                ctx.onRender = () => renderForm(ctx, ctx.inspector, schema, read(ctx.model.document, path), path, { kind });
                ctx.render();
                const before = ctx.model;
                const add = ctx.inspector.querySelector('.array-add-btn');
                assert.ok(add);
                if (initial.length === schema.maxItems) {
                    assert.equal(add.disabled, true);
                    return;
                }
                add.click();
                if (ctx.overlays.querySelector('dialog')) {
                    assert.equal(ctx.model, before, 'A picker never commits an incomplete value');
                } else {
                    assert.notEqual(ctx.model, before, ctx.notifications.join('\n'));
                    const next = read(ctx.model.document, path);
                    assert.equal(next.length, initial.length + 1);
                    assert.equal(validateField(schema, next).ok, true, JSON.stringify(next));
                    const entryPath = [...path, next.length - 1];
                    const target = referenceTarget(kind, entryPath);
                    if (target && target !== 'forms') assert.ok(records(ctx.model, target).some(record => localId(ctx.model, identity(record)) === localId(ctx.model, next.at(-1))), 'Reference additions use existing IDs');
                    assert.equal(ctx.history.canUndo, true);
                    ctx.history.undo(); assert.equal(ctx.model, before);
                }
            });
        }
    }
    assert.ok(actions >= 25, `Traversed ${actions} schema Add actions`);
});

test('class requirements are authored with an existing class and undo exactly', () => {
    const ctx = createTestContext(makeValidExtendedPack()); ctx.onRender = () => renderScreen(ctx);
    ctx.select('quests', 'scout-threat');
    ctx.inspector.querySelector('button[aria-label="Add requirements item"]').click();
    const before = ctx.model;
    const select = ctx.inspector.querySelectorAll('select').find(node => node.querySelectorAll('option').some(option => option.textContent === 'class'));
    select.value = select.querySelectorAll('option').find(option => option.textContent === 'class').value;
    select.dispatchEvent({ type: 'change' });
    assert.deepEqual(ctx.model.document.content.quests[0].requirements, [{ kind: 'class', classes: ['c0'] }]);
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    const picker = ctx.inspector.querySelectorAll('select').find(node => JSON.parse(node.getAttribute('data-path')).at(-2) === 'classes');
    assert.equal(picker.value, 'c0');
    ctx.history.undo(); assert.equal(ctx.model, before);
});

test('unavailable defaults open a picker without history changes, and refused variants restore the selector', () => {
    const fixture = makeValidExtendedPack();
    fixture.content.rules[0].classes = [];
    const ctx = createTestContext(fixture); ctx.onRender = () => renderScreen(ctx);
    ctx.select('quests', 'scout-threat');
    ctx.inspector.querySelector('button[aria-label="Add requirements item"]').click();
    const before = ctx.model;
    const select = ctx.inspector.querySelectorAll('select').find(node => node.querySelectorAll('option').some(option => option.textContent === 'class'));
    const previous = select.value;
    select.value = select.querySelectorAll('option').find(option => option.textContent === 'class').value;
    select.dispatchEvent({ type: 'change' });
    assert.equal(select.value, previous);
    assert.equal(ctx.model, before);
    const dialog = ctx.overlays.querySelector('dialog');
    assert.ok(dialog?.open);
    assert.match(dialog.textContent, /Choose the required values/);
    dialog.querySelector('button.primary').click();
    assert.equal(ctx.model, before);
    assert.match(ctx.notifications.at(-1), /^bad-value:/);
    dialog.querySelectorAll('button').find(node => node.textContent === 'Cancel').click();
    assert.equal(ctx.overlays.querySelector('dialog'), null);

    const body = ctx.doc.createElement('div');
    const schema = { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['a', 'b'] } };
    renderForm(ctx, body, schema, ['a', 'b'], ['list'], { isNew: true, onChange() { assert.fail('Duplicate choice committed'); } });
    const choice = body.querySelectorAll('select')[1];
    choice.value = 'a'; choice.dispatchEvent({ type: 'change' });
    assert.equal(choice.value, 'b');
});

test('a picker can complete an external reference before committing a variant', () => {
    const ctx = createTestContext(makeValidExtendedPack()); ctx.onRender = () => renderScreen(ctx);
    ctx.select('quests', 'scout-threat');
    ctx.inspector.querySelector('button[aria-label="Add requirements item"]').click();
    const select = ctx.inspector.querySelectorAll('select').find(node => node.querySelectorAll('option').some(option => option.textContent === 'thread'));
    const before = ctx.model;
    select.value = select.querySelectorAll('option').find(option => option.textContent === 'thread').value;
    select.dispatchEvent({ type: 'change' });
    assert.equal(ctx.model, before);
    const dialog = ctx.overlays.querySelector('dialog');
    const reference = dialog.querySelector('input[list]');
    reference.value = 'th_00000001'; reference.dispatchEvent({ type: 'change' });
    dialog.querySelector('button.primary').click();
    assert.equal(ctx.overlays.querySelector('dialog'), null);
    assert.deepEqual(ctx.model.document.content.quests[0].requirements, [{ kind: 'thread', thread: 'th_00000001' }]);
    assert.equal(ctx.model.validation.ok, true);
});


test('schema traversal: record Add forms commit a schema-valid default for every kind', async t => {
    for (const kind of KINDS) await t.test(kind, () => {
        const fixture = makeEveryKindPack();
        seed(fixture, kindPath(kind), []);
        const ctx = createTestContext(fixture);
        ctx.onRender = () => renderRecords(ctx);
        ctx.select(kind, '__new__');
        const before = ctx.model;
        const add = ctx.inspector.querySelector('button.primary');
        assert.ok(add);
        add.click();
        assert.notEqual(ctx.model, before, ctx.notifications.join('\n'));
        const record = records(ctx.model, kind).at(-1);
        assert.equal(validateField(schemaForKind(kind), record).ok, true, JSON.stringify(record));
        assert.equal(ctx.history.canUndo, true);
        ctx.history.undo(); assert.equal(ctx.model, before);
    });
});
