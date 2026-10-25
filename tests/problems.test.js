import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './helpers/dom.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { renderClasses } from '../src/screens/classes.js';
import { renderSkills } from '../src/screens/skills.js';
import { setField } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import {
    problemGroups,
    diagnosticPath,
    goToProblem,
    renderProblemGroups,
    renderCheck,
} from '../src/screens/problems.js';

test('exact grouping and literal hostile message with no b nodes', () => {
    const hostileMsg = 'Invalid class <b id="hostile">test</b> definition';
    const model = {
        document: { id: 'test' },
        validation: {
            ok: false,
            errors: [
                { code: 'class-skills', message: 'First class needs 3 skills', path: 'classes[0].skills' },
                { code: 'bad-ref', message: hostileMsg, path: 'creatures[0].loot[0]' },
                { code: 'class-skills', message: 'Second class needs 3 skills', path: 'classes[1].skills' },
            ],
        },
    };

    const groups = problemGroups(model);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].code, 'class-skills');
    assert.equal(groups[0].rows.length, 2);
    assert.equal(groups[1].code, 'bad-ref');
    assert.equal(groups[1].rows.length, 1);
    assert.equal(groups[1].rows[0].text, hostileMsg);

    const ctx = { ...createTestContext(smallRulesPack()), model };
    const container = ctx.doc.createElement('div');
    renderProblemGroups(ctx, container);

    assert.equal(container.querySelectorAll('b').length, 0);
    assert.ok(container.textContent.includes(hostileMsg));
});

test('class skills Go to selects and focuses actual group/input and opens inspector', () => {
    const ctx = createTestContext(smallRulesPack());
    ctx.root = ctx.app;
    ctx.onRender = () => renderClasses(ctx);

    const issue = {
        code: 'class-skills',
        path: 'content.rules[0].classes[0].skills',
        message: 'Must have 3 skills',
    };

    goToProblem(ctx, issue);

    assert.equal(ctx.selection.kind, 'classes');
    assert.ok(ctx.app.classList.contains('inspector-open'));
    assert.equal(ctx.doc.activeElement?.getAttribute('id'), 'class-skills');
});

test('branch diagnostic navigates owning skill, written form and opens details', () => {
    const ctx = createTestContext(smallRulesPack());
    ctx.root = ctx.app;
    ctx.onRender = () => renderSkills(ctx);

    const issue = {
        code: 'budget-closure',
        path: 'branches[0].power',
        message: 'Power exceeds budget',
    };

    goToProblem(ctx, issue);

    assert.equal(ctx.selection.kind, 'skills');
    assert.equal(ctx.selection.id, 's30');
    assert.equal(ctx.selection.form, 's30-base-a');
    assert.equal(ctx.doc.activeElement?.getAttribute('id'), 'form-power');
    goToProblem(ctx, { code: 'bad-transform', path: 'branches[0].transforms[0].value' });
    assert.equal(ctx.doc.activeElement?.getAttribute('id'), 'form-transforms');
    let parent = ctx.doc.activeElement.parentElement;
    while (parent && parent.tagName !== 'DETAILS') parent = parent.parentElement;
    assert.equal(parent.open, true);
});

test('check screen displays golden hashes, counts, filename, and controls export enablement', () => {
    const ctx = createTestContext(smallRulesPack());
    ctx.root = ctx.app;
    ctx.selection.kind = 'check';
    let downloaded = null;
    ctx.download = (fn) => { downloaded = fn; };

    renderCheck(ctx);

    const text = ctx.main.textContent;
    assert.ok(text.includes(ctx.model.rulesHash));
    assert.ok(text.includes(ctx.model.packHash));
    assert.ok(text.includes('12'));
    assert.ok(text.includes('48'));
    assert.ok(text.includes('4'));

    const fnInput = ctx.main.querySelector('#filename');
    assert.ok(fnInput);
    assert.ok(fnInput.value.endsWith('.json'));

    const expBtn = ctx.main.querySelector('#export-btn');
    assert.equal(expBtn.disabled, false);
    assert.equal(expBtn.getAttribute('aria-disabled'), 'false');
    expBtn.click();
    assert.equal(downloaded, fnInput.value);

    ctx.apply(setField(ctx.model, ['content', 'rules', 0, 'classes', 0, 'skills'], ['s00', 's01']));
    renderCheck(ctx);
    const expBtnDisabled = ctx.main.querySelector('#export-btn');
    assert.equal(expBtnDisabled.disabled, true);
    assert.equal(expBtnDisabled.getAttribute('aria-disabled'), 'true');
});

test('hostile path cannot cause selector injection and falls back safely', () => {
    assert.deepEqual(diagnosticPath('__proto__.polluted'), []);
    assert.deepEqual(diagnosticPath('content.rules[0]["prototype"]'), []);
    assert.deepEqual(diagnosticPath('constructor[0]'), []);

    const ctx = createTestContext(smallRulesPack());
    ctx.root = ctx.app;
    ctx.onRender = () => renderClasses(ctx);
    renderScreen(ctx);

    const maliciousIssue = {
        code: 'evil-code',
        path: '"]["evil"], input[type="text"] { background: red; }',
        message: 'Malicious payload',
    };

    assert.doesNotThrow(() => { goToProblem(ctx, maliciousIssue); });
    assert.equal(ctx.doc.activeElement, ctx.main);
});

test('legacy skill and envelope diagnostics focus their own fields', () => {
    const pack = smallRulesPack();
    pack.content.skills = [{ slug: 'legacy', name: '[LEGACY]', type: 'physical', stat: 'STR', target: 'one' }];
    const ctx = createTestContext(pack); ctx.root = ctx.app; ctx.onRender = () => renderScreen(ctx);
    const name = ctx.doc.createElement('input'); name.id = 'pack-name'; ctx.app.prepend(name);
    goToProblem(ctx, { code: 'BAD_FIELD', path: 'content.skills[0].name' });
    assert.equal(ctx.selection.kind, 'legacySkills');
    assert.equal(ctx.selection.id, 'legacy');
    assert.deepEqual(JSON.parse(ctx.doc.activeElement.getAttribute('data-path')), ['content', 'skills', 0, 'name']);
    goToProblem(ctx, { code: 'bad-schema', path: 'name' });
    assert.equal(ctx.doc.activeElement, name);
    assert.deepEqual(diagnosticPath('$.content.skills[0].name'), ['content', 'skills', 0, 'name']);
});

test('Go to maps reparented derived tiers and damaged branch fields to their repair controls', () => {
    const ctx = createTestContext(smallRulesPack()); ctx.root = ctx.app;
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('classes', 'c3');
    const parent = ctx.inspector.querySelector('#class-parent');
    parent.value = 'c0'; parent.dispatchEvent({ type: 'change' });
    const issue = ctx.model.validation.errors.find(error => error.code === 'tier-chain' && error.path.endsWith('.tier'));
    assert.ok(issue, 'Ordinary reparenting produces the derived-tier diagnostic');
    goToProblem(ctx, issue);
    assert.equal(ctx.doc.activeElement.id, 'class-parent');
    assert.ok(ctx.app.classList.contains('inspector-open'));
    for (const [field, value] of [['choice', 'x'], ['step', 9], ['skill', 'missing'], ['fromForm', 'missing']]) {
        const pack = smallRulesPack(); pack.content.rules[0].branches[0][field] = value;
        const repair = createTestContext(pack); repair.root = repair.app;
        repair.onRender = () => renderScreen(repair);
        const diagnostic = repair.model.validation.errors.find(error => error.path === `content.rules[0].branches[0].${field}`);
        assert.ok(diagnostic, field);
        goToProblem(repair, diagnostic);
        assert.equal(repair.selection.kind, 'branches', field);
        assert.notEqual(repair.doc.activeElement, repair.main, field);
        assert.deepEqual(JSON.parse(repair.doc.activeElement.getAttribute('data-path')), ['content', 'rules', 0, 'branches', 0, field]);
        assert.ok(repair.app.classList.contains('inspector-open'));
    }
});
