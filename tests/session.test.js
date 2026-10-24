import test from 'node:test';
import assert from 'node:assert/strict';
import { MockDocument } from './helpers/dom.js';
import { mountStudio } from '../src/studio.js';
import { DRAFT_KEY } from '../src/session.js';
import { setField } from '../src/edits.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';

function createFakeWindow() {
    const storage = new Map();
    const listeners = new Map();
    return {
        localStorage: {
            getItem(k) { return storage.has(k) ? storage.get(k) : null; },
            setItem(k, v) { storage.set(k, String(v)); },
            removeItem(k) { storage.delete(k); },
            clear() { storage.clear(); },
        },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type);
            if (list) {
                const idx = list.indexOf(fn);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) || [];
            for (const fn of list) fn(event);
            return !event.defaultPrevented;
        },
        Blob: class FakeBlob {
            constructor(parts, opts) { this.parts = parts; this.opts = opts; }
        },
        URL: {
            createObjectURL: () => 'blob:fake-url-123',
            revokeObjectURL: () => {},
        },
        setTimeout: (fn, ms) => setTimeout(fn, ms ?? 0),
    };
}

function setupStudio(initialStorage = {}) {
    const doc = new MockDocument();
    const win = createFakeWindow();
    for (const [k, v] of Object.entries(initialStorage)) {
        win.localStorage.setItem(k, v);
    }
    doc.defaultView = win;
    const root = doc.createElement('div');
    doc.body.append(root);
    const ctx = mountStudio(root);
    return { doc, win, root, ctx };
}

function createMockFile(name, content, size = undefined) {
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    return {
        name,
        size: size !== undefined ? size : Buffer.byteLength(str, 'utf8'),
        async text() {
            if (content instanceof Error) throw content;
            return str;
        },
    };
}

test('file open via input, drop, BOM, and size/read error handling', async () => {
    const { doc, win, root, ctx } = setupStudio();
    const pack = smallRulesPack();
    const packJson = JSON.stringify(pack);

    // 1. Direct openFile
    const model1 = await ctx.openFile(createMockFile('pack.json', packJson));
    assert.equal(model1?.document?.name, pack.name);
    assert.equal(ctx.dirty, false);

    // 2. Input change event
    const fileInput = ctx.file;
    const pack2 = { ...pack, name: 'Via Input' };
    fileInput.files = [createMockFile('input.json', JSON.stringify(pack2))];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ctx.model.document.name, 'Via Input');
    assert.equal(fileInput.value, '');

    // 3. A file drop reaches the window listener.
    const pack3 = { ...pack, name: 'Via Drop' };
    let prevented = false;
    win.dispatchEvent({
        type: 'drop',
        dataTransfer: { files: [createMockFile('drop.json', JSON.stringify(pack3))] },
        preventDefault() { prevented = true; },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(prevented, true);
    assert.equal(ctx.model.document.name, 'Via Drop');

    // 4. BOM accepted
    const bomJson = '\uFEFF' + JSON.stringify({ ...pack, name: 'With BOM' });
    await ctx.openFile(createMockFile('bom.json', bomJson));
    assert.equal(ctx.model.document.name, 'With BOM');

    // 5. Oversize pack rejected
    const hugeFile = createMockFile('huge.json', packJson, 10 * 1024 * 1024);
    const oversizeRes = await ctx.openFile(hugeFile);
    assert.equal(oversizeRes, false);
    assert.equal(ctx.model.document.name, 'With BOM');
    const notice = root.querySelector('.notice');
    assert.match(notice.textContent, /too-large/);

    // 6. Read failure rejected
    const badFile = createMockFile('bad.json', new Error('disk read failed'));
    const readRes = await ctx.openFile(badFile);
    assert.equal(readRes, false);
    assert.equal(ctx.model.document.name, 'With BOM');
    assert.match(notice.textContent, /file-read-error/);

    ctx.destroy();
});

test('sequence tokens ensure stale reads lose to newer open, edits, and destroy', async () => {
    const { doc, win, root, ctx } = setupStudio();
    const pack = smallRulesPack();
    ctx.loadText(pack);

    // Stale read loses to newer explicit open
    let resolveSlow;
    const slowPromise = new Promise(r => { resolveSlow = r; });
    const slowFile = {
        name: 'slow.json',
        size: 100,
        text() { return slowPromise; },
    };

    const pendingOpen = ctx.openFile(slowFile);
    const newerPack = { ...pack, name: 'Newer Pack' };
    ctx.loadText(newerPack);
    assert.equal(ctx.model.document.name, 'Newer Pack');

    resolveSlow(JSON.stringify({ ...pack, name: 'Stale Pack' }));
    await pendingOpen;
    assert.equal(ctx.model.document.name, 'Newer Pack');

    // Stale read loses to edits
    let resolveSlow2;
    const slowPromise2 = new Promise(r => { resolveSlow2 = r; });
    const slowFile2 = {
        name: 'slow2.json',
        size: 100,
        text() { return slowPromise2; },
    };
    const pendingOpen2 = ctx.openFile(slowFile2);
    ctx.apply(setField(ctx.model, ['name'], 'Edited Name'));
    assert.equal(ctx.model.document.name, 'Edited Name');

    resolveSlow2(JSON.stringify({ ...pack, name: 'Stale Pack 2' }));
    await pendingOpen2;
    assert.equal(ctx.model.document.name, 'Edited Name');

    let rejectOld;
    const failed = ctx.openFile({ size: 100, text: () => new Promise((_, reject) => { rejectOld = reject; }) });
    ctx.loadText({ ...pack, name: 'Fresh' });
    rejectOld(new Error('obsolete failure'));
    await failed;
    assert.equal(root.querySelector('.notice').textContent, '');

    // Stale read loses to destroy
    let resolveSlow3;
    const slowPromise3 = new Promise(r => { resolveSlow3 = r; });
    const slowFile3 = {
        name: 'slow3.json',
        size: 100,
        text() { return slowPromise3; },
    };
    const pendingOpen3 = ctx.openFile(slowFile3);
    let rejectAfterDestroy;
    const lateFailure = ctx.openFile({ size: 100, text: () => new Promise((_, reject) => { rejectAfterDestroy = reject; }) });
    const oldNotice = root.querySelector('.notice');
    ctx.destroy();
    rejectAfterDestroy(new Error('after destroy'));
    await lateFailure;
    assert.equal(oldNotice.textContent, '');

    resolveSlow3(JSON.stringify({ ...pack, name: 'Stale Pack 3' }));
    const destroyRes = await pendingOpen3;
    assert.equal(destroyRes, false);
    assert.equal(ctx.loadText(pack), null);
});

test('dirty tracking, undo/redo baseline, export baseline, and beforeunload guard', () => {
    const { doc, win, root, ctx } = setupStudio();
    const pack = smallRulesPack();
    ctx.loadText(pack);

    assert.equal(ctx.dirty, false);
    let beforeUnloadPrevented = false;
    win.dispatchEvent({
        type: 'beforeunload',
        preventDefault() { beforeUnloadPrevented = true; },
    });
    assert.equal(beforeUnloadPrevented, false);

    ctx.apply(setField(ctx.model, ['name'], 'Modified Name'));
    assert.equal(ctx.dirty, true);

    const event = { type: 'beforeunload', defaultPrevented: false, returnValue: 'x', preventDefault() { this.defaultPrevented = true; } };
    win.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.returnValue, '');

    ctx.history.undo();
    ctx.changed();
    assert.equal(ctx.dirty, false);
    assert.equal(JSON.parse(win.localStorage.getItem(DRAFT_KEY)).document.name, pack.name);
    assert.equal(JSON.parse(win.localStorage.getItem(DRAFT_KEY)).dirty, false);

    ctx.history.redo();
    ctx.changed();
    assert.equal(ctx.dirty, true);

    const exported = ctx.download('test-pack.json');
    assert.equal(exported, true);
    assert.equal(ctx.dirty, false);

    ctx.history.undo();
    ctx.changed();
    assert.equal(ctx.dirty, true);

    ctx.destroy();
    const eventAfterDestroy = { type: 'beforeunload', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    win.dispatchEvent(eventAfterDestroy);
    assert.equal(eventAfterDestroy.defaultPrevented, false);
});

test('autosave invalid draft and restore with dirty flag preserved', () => {
    const { doc, win, root, ctx } = setupStudio();
    const pack = smallRulesPack();
    ctx.loadText(pack);

    const brokenDoc = smallRulesPack();
    brokenDoc.name = 'Broken Draft';
    brokenDoc.content.rules[0].classes[0].skills.pop();
    ctx.loadText(brokenDoc);
    ctx.apply(setField(ctx.model, ['name'], 'Broken Draft Edited'));
    assert.equal(ctx.model.validation.ok, false);
    assert.equal(ctx.dirty, true);

    const savedRaw = win.localStorage.getItem(DRAFT_KEY);
    assert.ok(savedRaw);
    const saved = JSON.parse(savedRaw);
    assert.equal(saved.dirty, true);
    assert.equal(saved.document.name, 'Broken Draft Edited');

    ctx.destroy();

    const doc2 = new MockDocument();
    doc2.defaultView = win;
    const root2 = doc2.createElement('div');
    doc2.body.append(root2);
    const ctx2 = mountStudio(root2);

    assert.equal(ctx2.model.document.name, 'Broken Draft Edited');
    assert.equal(ctx2.model.validation.ok, false);
    assert.equal(ctx2.dirty, true);

    assert.equal(ctx2.download(), false);
    assert.equal(ctx2.dirty, true);
    ctx2.apply(setField(ctx2.model, ['content', 'rules', 0, 'classes', 0, 'skills'], ['s00', 's01', 's02']));
    assert.equal(ctx2.model.validation.ok, true);
    assert.equal(ctx2.download(), true);
    assert.equal(ctx2.dirty, false);
    const updatedRaw = win.localStorage.getItem(DRAFT_KEY);
    assert.equal(JSON.parse(updatedRaw).dirty, false);

    ctx2.destroy();
});

test('denied, corrupt, oversize, and docnull storage are safely ignored', () => {
    // 1. Corrupt JSON
    const win1 = createFakeWindow();
    win1.localStorage.setItem(DRAFT_KEY, '{corrupt: json}');
    const doc1 = new MockDocument(); doc1.defaultView = win1;
    const root1 = doc1.createElement('div'); doc1.body.append(root1);
    const ctx1 = mountStudio(root1);
    assert.equal(ctx1.model, null);
    ctx1.destroy();

    // 2. Oversize storage payload
    const win2 = createFakeWindow();
    win2.localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, document: 'a'.repeat(7 * 1024 * 1024), dirty: true }));
    const doc2 = new MockDocument(); doc2.defaultView = win2;
    const root2 = doc2.createElement('div'); doc2.body.append(root2);
    const ctx2 = mountStudio(root2);
    assert.equal(ctx2.model, null);
    ctx2.destroy();

    // 3. docnull storage payload
    const win3 = createFakeWindow();
    win3.localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, document: null, dirty: true }));
    const doc3 = new MockDocument(); doc3.defaultView = win3;
    const root3 = doc3.createElement('div'); doc3.body.append(root3);
    const ctx3 = mountStudio(root3);
    assert.equal(ctx3.model, null);
    ctx3.destroy();

    // 4. Storage access throws
    const win4 = createFakeWindow();
    win4.localStorage.getItem = () => { throw new Error('QuotaExceeded'); };
    win4.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
    const doc4 = new MockDocument(); doc4.defaultView = win4;
    const root4 = doc4.createElement('div'); doc4.body.append(root4);
    const ctx4 = mountStudio(root4);
    assert.equal(ctx4.model, null);
    const pack = smallRulesPack();
    ctx4.loadText(pack);
    const editOk = ctx4.apply(setField(ctx4.model, ['name'], 'Quota Works'));
    assert.equal(editOk, true);
    assert.equal(ctx4.model.document.name, 'Quota Works');
    ctx4.destroy();
    const win5 = createFakeWindow();
    Object.defineProperty(win5, 'localStorage', { get() { throw new Error('Storage denied'); } });
    const doc5 = new MockDocument(); doc5.defaultView = win5;
    const root5 = doc5.createElement('div'); doc5.body.append(root5);
    const ctx5 = mountStudio(root5);
    assert.equal(ctx5.loadText(smallRulesPack()).validation.ok, true);
    assert.equal(ctx5.apply(setField(ctx5.model, ['name'], '[PRIVATE]')), true);
    assert.equal(ctx5.dirty, true);
    ctx5.destroy();
});

test('problems drawer toggling, closeProblems focus behaviour, and Escape key', () => {
    const { doc, win, root, ctx } = setupStudio();
    const pack = smallRulesPack();
    ctx.loadText(pack);

    const allButtons = root.querySelectorAll('button');
    const probBtn = allButtons.find(b => b.textContent.startsWith('Problems'));

    const host = root.querySelector('.problems-drawer-host');
    const append = host.append.bind(host);
    host.append = (...nodes) => { append(...nodes); host.childNodes.includes = undefined; };
    ctx.showProblems();
    assert.ok(host.childNodes.length > 0);

    ctx.showProblems();
    assert.equal(host.childNodes.length, 0);

    ctx.showProblems();
    assert.ok(host.childNodes.length > 0);
    win.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(host.childNodes.length, 0);
    assert.equal(doc.activeElement, probBtn);

    ctx.showProblems();
    assert.ok(host.childNodes.length > 0);
    doc.activeElement = null;
    ctx.closeProblems(false);
    assert.equal(host.childNodes.length, 0);
    assert.notEqual(doc.activeElement, probBtn);

    ctx.destroy();
});

test('unsafe opens preserve the current draft and its saved backup', () => {
    const { root, win, ctx } = setupStudio();
    ctx.loadText(smallRulesPack());
    ctx.apply(setField(ctx.model, ['name'], '[EDITED]'));
    const snapshot = ctx.model;
    const saved = win.localStorage.getItem(DRAFT_KEY);
    const rejected = ctx.loadText('{"__proto__":{"polluted":true}}');
    assert.equal(rejected.document, null);
    assert.equal(ctx.model, snapshot);
    assert.equal(ctx.dirty, true);
    assert.equal(win.localStorage.getItem(DRAFT_KEY), saved);
    assert.match(root.querySelector('.notice').textContent, /unsafe-key/);
    ctx.destroy();
});

test('a bubbling drop opens its file exactly once', async () => {
    const { root, win, ctx } = setupStudio();
    const original = ctx.openFile;
    const reads = [];
    ctx.openFile = file => { const pending = original(file); reads.push(pending); return pending; };
    const event = { type: 'drop', dataTransfer: { files: [createMockFile('pack.json', smallRulesPack())] }, preventDefault() {} };
    root.dispatchEvent(event);
    win.dispatchEvent(event);
    await Promise.all(reads);
    assert.equal(reads.length, 1);
    assert.equal(ctx.model.validation.ok, true);
    ctx.destroy();
});
