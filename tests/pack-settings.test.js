import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack } from '../src/model.js';
import { setField } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { PACK_FIELDS, CONTENT_KINDS, LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { KINDS } from '../src/records.js';

test('Pack settings exposes every host envelope field, remaining content kind and rules option', () => {
    const ctx = createTestContext(openPack(smallRulesPack()));
    ctx.selection = { kind: 'settings' };
    renderScreen(ctx);
    const paths = ctx.main.querySelectorAll('textarea').map(node => JSON.parse(node.getAttribute('data-path')).join('.'));
    for (const key of PACK_FIELDS.filter(key => !['id', 'content'].includes(key))) assert.ok(paths.includes(key), key);
    for (const key of CONTENT_KINDS.filter(key => !['rules', 'skills'].includes(key) && !KINDS.includes(key))) assert.ok(paths.includes(`content.${key}`), key);
    assert.ok(paths.includes('content.rules.0.memory'));
    assert.ok(paths.includes('content.rules.0.statLabels'));
    assert.ok(paths.includes('content.rules.0.name'));
});

test('screen code edits use SB code limits and retain reference indexing and undo', () => {
    const pack = smallRulesPack();
    pack.screens = [{ id: 'camp', template: '<p>Camp</p>' }];
    const model = openPack(pack);
    const template = '<p>Camp</p>' + ' '.repeat(LIMITS.code - 11);
    const edited = setField(model, ['screens', 0, 'template'], template);
    assert.equal(edited.ok, true);
    assert.equal(edited.model.validation.ok, true);
    assert.ok(edited.model.references.length > 0);
    assert.equal(openPack(exportPack(edited.model)).document.screens[0].template, template.trim());
    assert.equal(edited.undo(), model);
    assert.equal(setField(model, ['screens', 0, 'template'], 'x'.repeat(LIMITS.code + 1)).ok, false);
});
