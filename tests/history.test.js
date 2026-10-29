// Pack history controller tests: bounded undo/redo stack (SPEC §4).

import test from 'node:test';
import assert from 'node:assert/strict';

const smallWorld = ({ places = [] } = {}) => ({ id: 'fixture', version: '1.0.0', name: 'World', requires: { storyBlock: '^2' }, content: { places } });

import { openPack } from '../src/model.js';
import { add, setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';

test('initial history state has current model and empty undo/redo stacks', () => {
    const pack = smallWorld();
    const model = openPack(pack);
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));
    assert.equal(model.packHash, null);
    assert.equal(Object.hasOwn(model.document.content, 'rules'), false);

    const history = createHistory(model);

    assert.equal(history.current, model);
    assert.equal(history.canUndo, false);
    assert.equal(history.canRedo, false);

    // Calling undo/redo when unavailable returns current snapshot unchanged
    assert.equal(history.undo(), model);
    assert.equal(history.redo(), model);
});

test('successful commit updates current model, records undo, and clears redo', () => {
    const pack = smallWorld({ statLabels: {}, places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] });
    const model0 = openPack(pack);
    assert.equal(model0.validation.ok, true, JSON.stringify(model0.validation.errors));
    assert.equal(model0.packHash, null);

    const history = createHistory(model0);

    const edit1 = add(model0, 'places', { slug: 'mill', name: 'Mill', x: 1, y: 0 });
    assert.equal(edit1.ok, true);

    const committed = history.commit(edit1);
    assert.equal(committed, true);
    assert.equal(history.current, edit1.model);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, false);

    // Failed edit commit does not change history
    const failedEdit = add(history.current, 'places', { slug: 'haven', name: 'Duplicate' });
    assert.equal(failedEdit.ok, false);

    const failCommit = history.commit(failedEdit);
    assert.equal(failCommit, false);
    assert.equal(history.current, edit1.model);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, false);
});

test('undo and redo restore exact model snapshots across multiple edits', () => {
    const pack = smallWorld({ statLabels: {}, places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] });
    const m0 = openPack(pack);
    assert.equal(m0.validation.ok, true, JSON.stringify(m0.validation.errors));
    assert.equal(m0.packHash, null);
    assert.equal(m0.document.name, 'World');

    const history = createHistory(m0);

    // Edit 1: add place mill
    const e1 = add(m0, 'places', { slug: 'mill', name: 'Mill', x: 1, y: 0 });
    assert.equal(e1.ok, true);
    history.commit(e1);
    const m1 = history.current;

    // Edit 2: add place cave
    const e2 = add(m1, 'places', { slug: 'cave', name: 'Cave', x: 2, y: 0 });
    assert.equal(e2.ok, true);
    history.commit(e2);
    const m2 = history.current;

    // Edit 3: rename the pack
    const e3 = setField(m2, ['name'], 'New World');
    assert.equal(e3.ok, true);
    history.commit(e3);
    const m3 = history.current;

    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, false);

    // Undo step 1 (back to m2)
    assert.equal(history.undo(), m2);
    assert.equal(history.current, m2);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, true);

    // Undo step 2 (back to m1)
    assert.equal(history.undo(), m1);
    assert.equal(history.current, m1);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, true);

    // Undo step 3 (back to m0)
    assert.equal(history.undo(), m0);
    assert.equal(history.current, m0);
    assert.equal(history.canUndo, false);
    assert.equal(history.canRedo, true);

    // Undo when unavailable returns m0 unchanged
    assert.equal(history.undo(), m0);

    // Redo step 1 (forward to m1)
    assert.equal(history.redo(), m1);
    assert.equal(history.current, m1);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, true);

    // Redo step 2 (forward to m2)
    assert.equal(history.redo(), m2);
    assert.equal(history.current, m2);

    // Redo step 3 (forward to m3)
    assert.equal(history.redo(), m3);
    assert.equal(history.current, m3);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, false);

    // Redo when unavailable returns m3 unchanged
    assert.equal(history.redo(), m3);
});

test('new commit after undo invalidates and clears redo stack', () => {
    const pack = smallWorld();
    const m0 = openPack(pack);
    const history = createHistory(m0);

    const e1 = add(m0, 'places', { slug: 'mill', name: 'Mill', x: 1, y: 0 });
    history.commit(e1);

    const e2 = add(history.current, 'places', { slug: 'cave', name: 'Cave', x: 2, y: 0 });
    history.commit(e2);

    // Undo back to e1
    history.undo();
    assert.equal(history.canRedo, true);

    // Commit a divergent edit (adding forest instead of cave)
    const e3 = add(history.current, 'places', { slug: 'forest', name: 'Forest', x: 3, y: 0 });
    history.commit(e3);

    // Redo stack is now completely cleared
    assert.equal(history.canRedo, false);
    assert.equal(history.current, e3.model);
    assert.equal(history.redo(), e3.model);

    // Undo takes us back to e1
    assert.equal(history.undo(), e1.model);
});

test('history respects positive integer limit and discards oldest snapshots', () => {
    const pack = smallWorld();
    const m0 = openPack(pack);
    const history = createHistory(m0, { limit: 3 });

    // Make 5 edits
    let currentModel = m0;
    const snapshots = [m0];
    for (let i = 1; i <= 5; i++) {
        const edit = add(currentModel, 'places', { slug: `place-${i}`, name: `Place ${i}`, x: i, y: 0 });
        history.commit(edit);
        currentModel = edit.model;
        snapshots.push(currentModel);
    }

    assert.equal(history.current, snapshots[5]);
    assert.equal(history.canUndo, true);

    // Because limit is 3, we can only undo 3 times (snapshots 4, 3, 2).
    // Snapshots 0 and 1 were discarded.
    assert.equal(history.undo(), snapshots[4]);
    assert.equal(history.undo(), snapshots[3]);
    assert.equal(history.undo(), snapshots[2]);

    // 4th undo is unavailable
    assert.equal(history.canUndo, false);
    assert.equal(history.undo(), snapshots[2]);
});

test('createHistory throws RangeError on non-positive or invalid limit', () => {
    const pack = smallWorld();
    const model = openPack(pack);

    for (const badLimit of [0, -1, -100, 1.5, NaN, Infinity, '100', null, undefined]) {
        if (badLimit === undefined) continue; // undefined uses default 100
        assert.throws(
            () => createHistory(model, { limit: badLimit }),
            RangeError
        );
    }
});
