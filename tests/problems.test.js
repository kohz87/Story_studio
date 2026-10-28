import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPack } from './fixtures/world.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { setField } from '../src/edits.js';
import { problemGroups, diagnosticPath, goToProblem, renderProblemGroups, renderCheck } from '../src/screens/problems.js';

test('diagnostics group codes and render hostile messages as text', () => {
    const ctx = createTestContext(worldPack());
    const message = 'Invalid <b id="hostile">place</b>';
    const model = { document: ctx.model.document, validation: { ok: false, errors: [
        { code: 'BAD_RECORD', path: 'content.places[0].x', message },
        { code: 'BAD_RECORD', path: 'content.places[1].x', message: 'Second' },
        { code: 'BAD_FIELD', path: 'name', message: 'Name' },
    ] } };
    const groups = problemGroups(model);
    assert.deepEqual(groups.map(group => group.rows.length), [2, 1]);
    const container = ctx.doc.createElement('div');
    renderProblemGroups({ ...ctx, model }, container);
    assert.ok(container.textContent.includes(message));
    assert.equal(container.querySelectorAll('b').length, 0);
});

test('a place diagnostic opens its record and focuses the field', () => {
    const ctx = createTestContext(worldPack());
    ctx.root = ctx.app; ctx.onRender = () => renderScreen(ctx);
    goToProblem(ctx, { code: 'BAD_RECORD', path: 'content.places[0].x' });
    assert.equal(ctx.selection.kind, 'places');
    assert.equal(ctx.selection.id, 'haven');
    assert.deepEqual(JSON.parse(ctx.doc.activeElement.getAttribute('data-path')), ['content', 'places', 0, 'x']);
});

test('hostile diagnostic paths fall back safely', () => {
    assert.deepEqual(diagnosticPath('__proto__.polluted'), []);
    assert.deepEqual(diagnosticPath('constructor[0]'), []);
    const ctx = createTestContext(worldPack());
    ctx.root = ctx.app; ctx.onRender = () => renderScreen(ctx);
    assert.doesNotThrow(() => goToProblem(ctx, { path: '"]["evil"], input[type="text"]' }));
    assert.equal(ctx.doc.activeElement, ctx.main);
});

test('check screen enables export only for a valid world', () => {
    const ctx = createTestContext(worldPack());
    renderCheck(ctx);
    assert.equal(ctx.main.querySelector('#export-btn').disabled, false);
    ctx.apply(setField(ctx.model, ['content', 'places', 0, 'x'], 'bad'));
    renderCheck(ctx);
    assert.equal(ctx.main.querySelector('#export-btn').disabled, true);
});
