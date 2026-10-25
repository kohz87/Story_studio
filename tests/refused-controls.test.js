import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MockDocument } from './helpers/dom.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { mountStudio } from '../src/studio.js';
import { resolveSkillForms } from '../src/screens/skills.js';
import { DRAFT_KEY } from '../src/session.js';

function setup(pack = smallRulesPack()) {
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

for (const [controlId, transform, next, stored] of [
    ['form-power', { op: 'set-element', at: 0, value: 'fire' }, '2', form => form.effects[0].power],
    ['form-cost', { op: 'set-element', at: 0, value: 'fire' }, '2', form => form.cost.sp],
    ['form-effect', { op: 'set-stat', value: 'DEX' }, 'ice', form => form.effects[0].element],
]) {
    test(`skills: ninth transform refusal restores ${controlId} from the resolved model`, () => {
        const state = setup();
        const { ctx, root } = state;
        ctx.select('skills', 's30', 's30-base-a');
        change(ctx.inspector.querySelector('#form-transforms'), JSON.stringify(Array.from({ length: 8 }, () => ({ ...transform }))));
        assert.equal(ctx.model.validation.ok, true);
        const before = snapshot(state);
        change(ctx.inspector.querySelector(`#${controlId}`), next);
        unchanged(state, before);
        const form = resolveSkillForms(ctx.model, 's30').find(node => node.id === 'pack.fixture/s30-base-a').form;
        assert.equal(ctx.inspector.querySelector(`#${controlId}`).value, String(stored(form)));
        assert.match(root.querySelector('.notice').textContent, /^bad-value:/);
        ctx.history.undo();
        assert.equal(ctx.model.document.content.rules[0].branches[0].transforms.length, 1);
        ctx.destroy();
    });
}

const cases = [
    {
        kind: 'skills', select: ctx => ctx.select('skills', 's00', 's00-base'),
        control: ctx => ctx.inspector.querySelector('#form-type'), next: 'magic',
        stored: ctx => ctx.model.document.content.rules[0].skills[0].base.type,
    },
    {
        kind: 'classes', select: ctx => ctx.select('classes', 'c1'),
        control: ctx => ctx.inspector.querySelector('#class-parent'), next: '',
        stored: ctx => ctx.model.document.content.rules[0].classes[1].parent,
    },
    {
        kind: 'forms', select: ctx => ctx.select('places', 'haven'),
        control: ctx => ctx.inspector.querySelectorAll('input').find(input => input.getAttribute('data-path') === '["content","places",0,"name"]'),
        next: '[CHANGED NAME]', stored: ctx => ctx.model.document.content.places[0].name,
    },
    {
        kind: 'problems',
        pack() { const pack = smallRulesPack(); pack.content.rules[0].classes[0].skills.pop(); return pack; },
        select(ctx, root) {
            ctx.select('check');
            root.querySelectorAll('.problem-row').find(row => row.textContent.includes('classes[0].skills')).querySelector('button').click();
        },
        control: ctx => ctx.inspector.querySelectorAll('.skill-row select')[2], next: 's02',
        stored: ctx => ctx.model.document.content.rules[0].classes[0].skills[2] ?? '',
    },
    {
        kind: 'inspector', select: ctx => ctx.select('classes', 'c0'),
        control: ctx => ctx.inspector.querySelector('#class-id'), next: 'renamed-class',
        stored: ctx => ctx.model.document.content.rules[0].classes[0].slug,
    },
    {
        kind: 'pack name', select: ctx => ctx.select('classes', 'c0'),
        control: (ctx, root) => root.querySelector('#pack-name'), next: '[CHANGED PACK]',
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
