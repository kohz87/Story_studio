import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MockDocument } from './helpers/dom.js';
import { worldPack } from './fixtures/world.js';
import { mountStudio } from '../src/studio.js';
import { DRAFT_KEY } from '../src/session.js';

function setup(pack = worldPack()) {
    const doc = new MockDocument();
    const storage = new Map();
    let saves = 0;
    doc.defaultView = {
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem(key, value) { saves++; storage.set(key, String(value)); },
        },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        addEventListener() {}, removeEventListener() {},
    };
    const root = doc.createElement('div');
    doc.body.append(root);
    const ctx = mountStudio(root);
    ctx.loadText(pack);
    return { ctx, root, get saves() { return saves; }, get draft() { return storage.get(DRAFT_KEY); } };
}

function change(control, value) {
    assert.ok(control);
    control.value = value;
    control.dispatchEvent({ type: 'change' });
}

function snapshot(state) {
    const { ctx } = state;
    return {
        model: ctx.model, selection: { ...ctx.selection },
        undo: ctx.history.canUndo, redo: ctx.history.canRedo, dirty: ctx.dirty,
        saves: state.saves, draft: state.draft,
    };
}

function unchanged(state, before) {
    const after = snapshot(state);
    assert.equal(after.model, before.model);
    assert.deepEqual(after, before);
}

test('all controls call ctx.apply only through the shared refusal helper', () => {
    const src = new URL('../src/', import.meta.url);
    const calls = /\bctx\s*(?:\.\s*apply|\[\s*['"]apply['"]\s*\])\s*\(/g;
    for (const file of readdirSync(src, { recursive: true }).filter(file => file.endsWith('.js'))) {
        const matches = readFileSync(new URL(file, src), 'utf8').match(calls) || [];
        assert.equal(matches.length, file === 'apply-edit.js' ? 1 : 0, file);
    }
});

const cases = [
    {
        kind: 'place name', select: ctx => ctx.select('places', 'haven'),
        control: ctx => ctx.inspector.querySelectorAll('input').find(input => input.getAttribute('data-path') === '["content","places",0,"name"]'),
        next: 'Changed place', stored: ctx => ctx.model.document.content.places[0].name,
    },
    {
        kind: 'pack name', select: ctx => ctx.select('places', 'haven'),
        control: (ctx, root) => root.querySelector('#pack-name'), next: 'Changed pack',
        stored: ctx => ctx.model.document.name,
    },
];

for (const entry of cases) {
    for (const outcome of ['false', 'throw']) {
        test(`${entry.kind}: apply ${outcome} restores the displayed value and shows its code`, () => {
            const state = setup(entry.pack?.());
            const { ctx, root } = state;
            entry.select(ctx, root);
            const before = snapshot(state);
            let calls = 0;
            ctx.apply = result => {
                calls++;
                assert.equal(result.ok, true, 'The edit reaches the commit boundary');
                if (outcome === 'throw') throw Object.assign(new Error('Edit refused'), { code: 'blocked-edit' });
                return false;
            };
            change(entry.control(ctx, root), entry.next);
            assert.equal(calls, 1);
            unchanged(state, before);
            assert.equal(entry.control(ctx, root).value, String(entry.stored(ctx)));
            assert.match(root.querySelector('.notice').textContent, outcome === 'throw' ? /^blocked-edit:/ : /^refused-edit:/);
            ctx.destroy();
        });
    }
}
