// Dev page tests: DOM mounting, error rendering, edits with history, and limits (SPEC §5).

import test from 'node:test';
import assert from 'node:assert/strict';

import { smallRulesPack } from './fixtures/smallRulesPack.js';

import { mountDev } from '../src/dev.js';
import { exportPack } from '../src/model.js';

/** Creates a minimal DOM fake sufficient to exercise mountDev. */
function createFakeDOM() {
    function createNode(tag) {
        const listeners = new Map();
        const children = [];
        const dataset = {};
        const attrs = new Map();

        const node = {
            tag,
            id: '',
            className: '',
            type: '',
            accept: '',
            _value: '',
            get value() {
                return this._value;
            },
            set value(val) {
                this._value = String(val);
            },
            disabled: false,
            download: '',
            href: '',
            dataset,
            children,
            files: [],
            parentNode: null,
            _text: '',
            get textContent() {
                if (children.length > 0) {
                    return children.map(c => c.textContent).join('');
                }
                return this._text;
            },
            set textContent(val) {
                this._text = String(val);
                children.length = 0;
            },
            get firstChild() {
                return children[0] ?? null;
            },
            appendChild(child) {
                if (child.parentNode) {
                    child.parentNode.removeChild(child);
                }
                child.parentNode = this;
                children.push(child);
                return child;
            },
            removeChild(child) {
                const idx = children.indexOf(child);
                if (idx >= 0) {
                    children.splice(idx, 1);
                    child.parentNode = null;
                }
                return child;
            },
            setAttribute(name, val) {
                attrs.set(name, String(val));
                if (name.startsWith('data-')) {
                    dataset[name.slice(5)] = String(val);
                }
            },
            getAttribute(name) {
                if (name.startsWith('data-')) {
                    return dataset[name.slice(5)] ?? null;
                }
                return attrs.get(name) ?? null;
            },
            addEventListener(event, fn) {
                if (!listeners.has(event)) listeners.set(event, []);
                listeners.get(event).push(fn);
            },
            removeEventListener(event, fn) {
                const list = listeners.get(event);
                if (list) {
                    const idx = list.indexOf(fn);
                    if (idx >= 0) list.splice(idx, 1);
                }
            },
            dispatchEvent(event) {
                const list = listeners.get(event.type);
                if (list) {
                    for (const fn of [...list]) {
                        fn(event);
                    }
                }
            },
            click() {
                this.dispatchEvent({ type: 'click', target: this });
            },
            querySelector(sel) {
                return find(this, sel);
            },
            querySelectorAll(sel) {
                const results = [];
                findAll(this, sel, results);
                return results;
            },
        };
        return node;
    }

    function find(node, sel) {
        if (sel.startsWith('#') && node.id === sel.slice(1)) return node;
        for (const child of node.children) {
            const found = find(child, sel);
            if (found) return found;
        }
        return null;
    }

    function findAll(node, sel, results) {
        if (sel.startsWith('#') && node.id === sel.slice(1)) results.push(node);
        else if (node.tag === sel) results.push(node);
        for (const child of node.children) {
            findAll(child, sel, results);
        }
    }

    const doc = {
        createElement(tag) {
            const el = createNode(tag);
            el.ownerDocument = doc;
            return el;
        },
    };

    const root = createNode('div');
    root.id = 'studio-dev';
    root.ownerDocument = doc;

    return { root, doc, byId: id => find(root, `#${id}`) };
}

test('mountDev renders required elements with stable IDs', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    assert.ok(byId('pack-file'), '#pack-file exists');
    assert.ok(byId('pack-name'), '#pack-name exists');
    assert.ok(byId('apply-name'), '#apply-name exists');
    assert.ok(byId('undo'), '#undo exists');
    assert.ok(byId('redo'), '#redo exists');
    assert.ok(byId('export-pack'), '#export-pack exists');
    assert.ok(byId('errors'), '#errors exists');
    assert.ok(byId('contents'), '#contents exists');

    assert.equal(byId('undo').disabled, true);
    assert.equal(byId('redo').disabled, true);
    assert.equal(byId('export-pack').disabled, true);

    dev.destroy();
});

test('loadText renders broken JSON error without crashing and disables export', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    const model = dev.loadText('{ broken json');
    assert.equal(model.document, null);
    assert.equal(model.validation.ok, false);

    const errorsList = byId('errors');
    assert.equal(errorsList.children.length, 1);

    const errItem = errorsList.children[0];
    assert.equal(errItem.dataset.code, 'bad-schema');
    assert.match(errItem.textContent, /bad-schema/);
    assert.match(errItem.textContent, /Invalid JSON/);

    assert.equal(byId('export-pack').disabled, true);
    assert.equal(byId('contents').children.length, 0);

    dev.destroy();
});

test('loadText renders checker errors with path, code, and message', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    const broken = smallRulesPack();
    broken.content.rules[0].classes[0].skills = ['s00']; // Class requires exactly 3 skills

    const model = dev.loadText(JSON.stringify(broken));
    assert.equal(model.validation.ok, false);

    const errorsList = byId('errors');
    assert.ok(errorsList.children.length >= 1);

    const classSkillError = errorsList.children.find(c => c.dataset.code === 'class-skills');
    assert.ok(classSkillError, 'class-skills error must be present');
    assert.equal(classSkillError.dataset.path, 'content.rules[0].classes[0].skills');
    assert.match(classSkillError.textContent, /class-skills/);
    assert.match(classSkillError.textContent, /content\.rules\[0\]\.classes\[0\]\.skills/);

    assert.equal(byId('export-pack').disabled, true);

    dev.destroy();
});

test('successful load replaces previous errors and lists contents', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    // First load broken JSON
    dev.loadText('{ bad json');
    assert.equal(byId('errors').children.length, 1);
    assert.equal(byId('export-pack').disabled, true);

    // Now load valid golden seed
    const valid = smallRulesPack();
    const model = dev.loadText(JSON.stringify(valid));

    assert.equal(model.validation.ok, true);
    assert.equal(byId('errors').children.length, 0, 'Previous errors must clear on next success');
    assert.equal(byId('export-pack').disabled, false, 'Export must be enabled for valid pack');
    assert.equal(byId('pack-name').value, 'Fixture');

    const contentsList = byId('contents');
    assert.ok(contentsList.children.length > 0, 'Contents list should contain records');

    const kinds = new Set(contentsList.children.map(c => c.dataset.kind));
    assert.ok(kinds.has('classes'));
    assert.ok(kinds.has('skills'));
    assert.ok(kinds.has('branches'));
    assert.ok(kinds.has('places'));

    dev.destroy();
});

test('valid apply updates export/name and history undo/redo', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    dev.loadText(JSON.stringify(smallRulesPack()));
    assert.equal(byId('pack-name').value, 'Fixture');
    assert.equal(byId('undo').disabled, true);
    assert.equal(byId('redo').disabled, true);

    // Apply name edit
    byId('pack-name').value = 'Renamed Pack';
    byId('apply-name').click();

    assert.equal(byId('pack-name').value, 'Renamed Pack');
    assert.equal(byId('undo').disabled, false);
    assert.equal(byId('redo').disabled, true);

    // Undo edit
    byId('undo').click();
    assert.equal(byId('pack-name').value, 'Fixture');
    assert.equal(byId('undo').disabled, true);
    assert.equal(byId('redo').disabled, false);

    // Redo edit
    byId('redo').click();
    assert.equal(byId('pack-name').value, 'Renamed Pack');
    assert.equal(byId('undo').disabled, false);
    assert.equal(byId('redo').disabled, true);

    dev.destroy();
});

test('invalid edit preserves export and history and displays a refusal code', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    dev.loadText(JSON.stringify(smallRulesPack()));
    assert.equal(byId('export-pack').disabled, false);
    assert.equal(byId('errors').children.length, 0);

    // Names outside the schema bounds are refused before committing.
    byId('pack-name').value = 'x'.repeat(81);
    byId('apply-name').click();

    assert.equal(byId('export-pack').disabled, false, 'Refusal keeps the valid pack exportable');
    assert.ok(byId('errors').children.length > 0, 'Validation errors must be displayed');

    const err = byId('errors').children[0];
    assert.equal(err.dataset.code, 'bad-value');
    assert.equal(err.dataset.path, 'name');

    assert.equal(byId('pack-name').value, 'Fixture');
    assert.equal(byId('undo').disabled, true);
    assert.equal(byId('export-pack').disabled, false);

    dev.destroy();
});

test('refused edit shows useful error text and leaves document unchanged', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    dev.loadText(JSON.stringify(smallRulesPack()));
    assert.equal(byId('errors').children.length, 0);

    // Attempting to set name exceeding MAX_STRING limit (4000)
    byId('pack-name').value = 'a'.repeat(5000);
    byId('apply-name').click();

    assert.ok(byId('errors').children.length > 0);
    const err = byId('errors').children[0];
    assert.equal(err.dataset.code, 'bad-value');
    assert.match(err.textContent, /bad-value/);

    dev.destroy();
});

test('adversarial markup is rendered strictly as text', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    const malicious = smallRulesPack();
    malicious.name = '<script>alert("xss")</script>';

    dev.loadText(JSON.stringify(malicious));

    const errorsList = byId('errors');
    assert.ok(errorsList.children.length > 0);

    const xssError = errorsList.children.find(c => c.dataset.code === 'unsafe-markup');
    assert.ok(xssError, 'unsafe-markup error must be present');
    assert.equal(xssError.dataset.path, 'name');
    assert.match(xssError.textContent, /^unsafe-markup name: Text has an HTML tag that can run code/);
    assert.equal(xssError.children.length, 0, 'Error node must contain no HTML element children');

    // Input pack name retains literal string in input.value
    assert.equal(byId('pack-name').value, '<script>alert("xss")</script>');

    // Assert no unexpected created script or img element
    assert.equal(root.querySelectorAll('script').length, 0, 'No script elements created');
    assert.equal(root.querySelectorAll('img').length, 0, 'No img elements created');

    // Also verify content records render markup strictly via textContent
    const validWithMarkup = smallRulesPack();
    validWithMarkup.content.places[0].name = '<b>Haven</b>';
    dev.loadText(JSON.stringify(validWithMarkup));

    const contentsList = byId('contents');
    const placeItem = contentsList.children.find(c => c.dataset.slug === 'haven');
    assert.ok(placeItem);
    assert.match(placeItem.textContent, /<b>Haven<\/b>/);
    assert.equal(placeItem.children.length, 0, 'Content record must have no HTML element children');

    dev.destroy();
});

test('file-size limit is enforced before reading huge files', async () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    let textCalled = false;
    const hugeFile = {
        name: 'huge.json',
        size: 600 * 1024, // 600 KiB > 512 KiB limit
        text() {
            textCalled = true;
            return Promise.resolve('{}');
        },
    };

    const fileInput = byId('pack-file');
    fileInput.files = [hugeFile];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    assert.equal(textCalled, false, 'File.text() must not be called when size exceeds limit');

    const errorsList = byId('errors');
    assert.equal(errorsList.children.length, 1);
    assert.equal(errorsList.children[0].dataset.code, 'too-large');
    assert.equal(byId('export-pack').disabled, true);

    dev.destroy();
});

test('failed file read renders useful error text', async () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    const brokenFile = {
        name: 'broken.json',
        size: 100,
        text() {
            return Promise.reject(new Error('Permission denied on read'));
        },
    };

    const fileInput = byId('pack-file');
    fileInput.files = [brokenFile];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Allow promise rejection microtasks to run
    await Promise.resolve();
    await Promise.resolve();

    const errorsList = byId('errors');
    assert.equal(errorsList.children.length, 1);
    assert.equal(errorsList.children[0].dataset.code, 'file-read-error');
    assert.match(errorsList.children[0].textContent, /Permission denied on read/);
    assert.equal(byId('export-pack').disabled, true);

    dev.destroy();
});

test('destroy removes listeners and children, guarding late async file read', async () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    let resolveRead;
    const readPromise = new Promise(resolve => {
        resolveRead = resolve;
    });

    const pendingFile = {
        name: 'pending.json',
        size: 100,
        text: () => readPromise,
    };

    const fileInput = byId('pack-file');
    fileInput.files = [pendingFile];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Destroy before async read completes
    dev.destroy();
    assert.equal(root.children.length, 0, 'destroy must remove all root children');

    // Complete late read
    resolveRead(JSON.stringify(smallRulesPack()));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(root.children.length, 0, 'late async read must not mutate destroyed DOM');
});

test('superseded async file reads are discarded', async () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    let resolveFirst;
    const firstPromise = new Promise(resolve => {
        resolveFirst = resolve;
    });

    const fileInput = byId('pack-file');

    // Start slow read 1
    fileInput.files = [{
        name: 'slow.json',
        size: 100,
        text: () => firstPromise,
    }];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Start fast read 2
    const fastPack = smallRulesPack({ name: 'Fast Pack' });
    fileInput.files = [{
        name: 'fast.json',
        size: 100,
        text: () => Promise.resolve(JSON.stringify(fastPack)),
    }];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    await Promise.resolve();
    await Promise.resolve();
    assert.equal(byId('pack-name').value, 'Fast Pack');

    // Slow read 1 finishes later with old pack
    const slowPack = smallRulesPack({ name: 'Slow Pack' });
    resolveFirst(JSON.stringify(slowPack));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(byId('pack-name').value, 'Fast Pack', 'Stale read must not overwrite newer read');

    dev.destroy();
});

test('apply button shows error when no document is loaded', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    byId('apply-name').click();

    const errorsList = byId('errors');
    assert.equal(errorsList.children.length, 1);
    assert.equal(errorsList.children[0].dataset.code, 'no-document');

    dev.destroy();
});

test('malformed document with non-string identity fields or name does not throw', () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    // 1. Malformed class slug with non-callable toString
    const badSlugPack = smallRulesPack();
    badSlugPack.content.rules[0].classes[0].slug = { toString: 'invalid' };
    let model1;
    assert.doesNotThrow(() => {
        model1 = dev.loadText(JSON.stringify(badSlugPack));
    }, 'Malformed slug must not throw during loadText');
    assert.equal(model1.validation.ok, false);
    assert.equal(byId('export-pack').disabled, true);
    assert.ok(byId('errors').children.length > 0);

    // 2. Malformed place id with non-callable toString
    const badIdPack = smallRulesPack();
    badIdPack.content.places[0].id = { toString: 'invalid' };
    let model2;
    assert.doesNotThrow(() => {
        model2 = dev.loadText(JSON.stringify(badIdPack));
    }, 'Malformed id must not throw during loadText');
    assert.equal(model2.validation.ok, false);
    assert.equal(byId('export-pack').disabled, true);
    assert.ok(byId('errors').children.length > 0);

    // 3. Malformed itemRule def with non-callable toString
    const badDefPack = smallRulesPack();
    badDefPack.content.rules[0].itemRules = [{ def: { toString: 'invalid' } }];
    let model3;
    assert.doesNotThrow(() => {
        model3 = dev.loadText(JSON.stringify(badDefPack));
    }, 'Malformed def must not throw during loadText');
    assert.equal(model3.validation.ok, false);
    assert.equal(byId('export-pack').disabled, true);
    assert.ok(byId('errors').children.length > 0);

    // 4. Malformed top-level name with non-callable toString
    const badNamePack = smallRulesPack();
    badNamePack.name = { toString: 'invalid' };
    let model4;
    assert.doesNotThrow(() => {
        model4 = dev.loadText(JSON.stringify(badNamePack));
    }, 'Malformed name must not throw during loadText');
    assert.equal(model4.validation.ok, false);
    assert.equal(byId('export-pack').disabled, true);
    assert.ok(byId('errors').children.length > 0);
    assert.equal(byId('pack-name').value, '');

    dev.destroy();
});

test('loadText supersedes pending async file read success and rejection', async () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    // Case 1: Direct load superseding pending read success
    let resolveRead1;
    const readPromise1 = new Promise(resolve => {
        resolveRead1 = resolve;
    });

    const fileInput = byId('pack-file');
    fileInput.files = [{
        name: 'stale.json',
        size: 100,
        text: () => readPromise1,
    }];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Explicit loadText called while file read is still pending
    const newerPack = smallRulesPack({ name: 'Newer explicit load' });
    dev.loadText(JSON.stringify(newerPack));
    assert.equal(byId('pack-name').value, 'Newer explicit load');
    assert.equal(byId('export-pack').disabled, false);

    // Now resolve old pending read with stale pack
    const stalePack = smallRulesPack({ name: 'Stale file' });
    resolveRead1(JSON.stringify(stalePack));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(byId('pack-name').value, 'Newer explicit load', 'Stale file read resolution must not overwrite newer direct load');
    assert.equal(byId('export-pack').disabled, false);

    // Case 2: Direct load superseding pending read rejection
    let rejectRead2;
    const readPromise2 = new Promise((_, reject) => {
        rejectRead2 = reject;
    });

    fileInput.files = [{
        name: 'failing.json',
        size: 100,
        text: () => readPromise2,
    }];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Another direct loadText called while second read is pending
    const newerPack2 = smallRulesPack({ name: 'Newer explicit load 2' });
    dev.loadText(JSON.stringify(newerPack2));
    assert.equal(byId('pack-name').value, 'Newer explicit load 2');
    assert.equal(byId('errors').children.length, 0);

    // Now reject the pending read
    rejectRead2(new Error('Delayed disk read error'));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(byId('pack-name').value, 'Newer explicit load 2', 'Superseded rejection must not alter loaded document name');
    assert.equal(byId('errors').children.length, 0, 'Superseded rejection must not display file-read-error');
    assert.equal(byId('export-pack').disabled, false, 'Superseded rejection must not disable export of valid loaded document');

    dev.destroy();
});

test('failed or oversize file read resets controls coherently and subsequent load clears error', async () => {
    const { root, byId } = createFakeDOM();
    const dev = mountDev(root);

    // Start from edited valid pack with undo enabled
    dev.loadText(JSON.stringify(smallRulesPack({ name: 'Initial Pack' })));
    byId('pack-name').value = 'Edited Pack';
    byId('apply-name').click();

    assert.equal(byId('pack-name').value, 'Edited Pack');
    assert.equal(byId('undo').disabled, false, 'Undo must be enabled after edit');
    assert.equal(byId('export-pack').disabled, false);
    assert.ok(byId('contents').children.length > 0);

    // Trigger oversize read error
    const fileInput = byId('pack-file');
    fileInput.files = [{
        name: 'huge.json',
        size: 600 * 1024,
        text: () => Promise.resolve('{}'),
    }];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });

    // Assert undo/redo/export disabled, name/contents cleared, error displayed
    assert.equal(byId('undo').disabled, true, 'Undo must be disabled on oversize rejection');
    assert.equal(byId('redo').disabled, true, 'Redo must be disabled on oversize rejection');
    assert.equal(byId('export-pack').disabled, true, 'Export must be disabled on oversize rejection');
    assert.equal(byId('pack-name').value, '', 'Pack name input must be cleared on oversize rejection');
    assert.equal(byId('contents').children.length, 0, 'Contents list must be cleared on oversize rejection');

    const errorsList = byId('errors');
    assert.equal(errorsList.children.length, 1);
    assert.equal(errorsList.children[0].dataset.code, 'too-large');

    // Next valid load clears error and re-enables controls
    const validPack = smallRulesPack({ name: 'Reloaded Valid Pack' });
    dev.loadText(JSON.stringify(validPack));

    assert.equal(byId('errors').children.length, 0, 'Next valid load must clear errors');
    assert.equal(byId('pack-name').value, 'Reloaded Valid Pack');
    assert.equal(byId('export-pack').disabled, false);
    assert.ok(byId('contents').children.length > 0);

    // Now edit again so undo is enabled
    byId('pack-name').value = 'Edited Again';
    byId('apply-name').click();
    assert.equal(byId('undo').disabled, false);

    // Trigger failed read error
    fileInput.files = [{
        name: 'broken.json',
        size: 100,
        text: () => Promise.reject(new Error('I/O failure')),
    }];
    fileInput.dispatchEvent({ type: 'change', target: fileInput });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(byId('undo').disabled, true, 'Undo must be disabled on read error');
    assert.equal(byId('redo').disabled, true, 'Redo must be disabled on read error');
    assert.equal(byId('export-pack').disabled, true, 'Export must be disabled on read error');
    assert.equal(byId('pack-name').value, '', 'Pack name must be cleared on read error');
    assert.equal(byId('contents').children.length, 0, 'Contents must be cleared on read error');
    assert.equal(byId('errors').children.length, 1);
    assert.equal(byId('errors').children[0].dataset.code, 'file-read-error');

    // Next valid load clears error
    dev.loadText(JSON.stringify(validPack));
    assert.equal(byId('errors').children.length, 0);
    assert.equal(byId('pack-name').value, 'Reloaded Valid Pack');
    assert.equal(byId('export-pack').disabled, false);

    dev.destroy();
});
