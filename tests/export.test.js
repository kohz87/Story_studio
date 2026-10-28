import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack } from '../src/model.js';
import { downloadPack } from '../src/export.js';
import { worldPack } from './fixtures/world.js';
import { MockDocument } from './helpers/dom.js';

function context(pack = worldPack()) {
    const doc = new MockDocument();
    const blobs = [];
    const revoked = [];
    const timers = [];
    const messages = [];
    let exported = false;
    const ctx = {
        doc, root: doc.body, model: openPack(pack),
        win: { Blob, URL: {
            createObjectURL(blob) { blobs.push(blob); return 'blob:pack'; },
            revokeObjectURL(url) { revoked.push(url); },
        }, setTimeout(callback) { timers.push(callback); } },
        markExported() { exported = true; }, notify(message) { messages.push(message); },
    };
    return { ctx, blobs, revoked, timers, messages, get exported() { return exported; } };
}

test('download bytes exactly equal the pack export and reopen successfully', async () => {
    const state = context();
    assert.equal(downloadPack(state.ctx, 'golden.json'), true);
    const bytes = new Uint8Array(await state.blobs[0].arrayBuffer());
    assert.deepEqual(bytes, new TextEncoder().encode(exportPack(state.ctx.model)));
    const reopened = openPack(new TextDecoder().decode(bytes));
    assert.equal(reopened.validation.ok, true);
    assert.deepEqual(reopened.document, state.ctx.model.document);
    assert.equal(state.exported, true);
    assert.equal(state.ctx.root.querySelector('a'), null);
    assert.equal(state.revoked.length, 0);
    state.timers.forEach(callback => callback());
    assert.deepEqual(state.revoked, ['blob:pack']);
});

test('invalid draft cannot download or clear its dirty state', () => {
    const pack = worldPack();
    pack.content.places[0].x = 'invalid';
    const state = context(pack);
    assert.equal(downloadPack(state.ctx, 'draft.json'), false);
    assert.equal(state.blobs.length, 0);
    assert.equal(state.exported, false);
    assert.match(state.messages[0], /^export-error:/);
});

test('failed download cleans its object URL and preserves dirty state', () => {
    const state = context();
    const makeElement = state.ctx.doc.createElement.bind(state.ctx.doc);
    state.ctx.doc.createElement = tag => {
        const element = makeElement(tag);
        if (tag === 'a') element.click = () => { throw new Error('download unavailable'); };
        return element;
    };
    assert.equal(downloadPack(state.ctx, 'pack.json'), false);
    assert.equal(state.exported, false);
    assert.equal(state.ctx.root.querySelector('a'), null);
    state.timers.forEach(callback => callback());
    assert.deepEqual(state.revoked, ['blob:pack']);
    assert.match(state.messages[0], /export-error: download unavailable/);
});
