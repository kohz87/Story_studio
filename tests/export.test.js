import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack } from '../src/model.js';
import { downloadPack } from '../src/export.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { MockDocument } from './helpers/dom.js';

function context(pack = smallRulesPack()) {
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

test('download bytes exactly equal the canonical golden export and retain the engine fingerprints', async () => {
    const state = context();
    assert.equal(downloadPack(state.ctx, 'golden.json'), true);
    const bytes = new Uint8Array(await state.blobs[0].arrayBuffer());
    assert.deepEqual(bytes, new TextEncoder().encode(exportPack(state.ctx.model)));
    const reopened = openPack(new TextDecoder().decode(bytes));
    assert.equal(reopened.rulesHash, '73a9544b564fd03883162089690350a914c550c455b10ddfaf962c1d4e6b3d35');
    assert.equal(reopened.packHash, '0e156cdbcfd8c02db87c44166582bee3071f8bc6d8fde51af66f31a63214cf63');
    assert.equal(state.exported, true);
    assert.equal(state.ctx.root.querySelector('a'), null);
    assert.equal(state.revoked.length, 0);
    state.timers.forEach(callback => callback());
    assert.deepEqual(state.revoked, ['blob:pack']);
});

test('invalid draft cannot download or clear its dirty state', () => {
    const pack = smallRulesPack();
    pack.content.rules[0].classes[0].skills.pop();
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
