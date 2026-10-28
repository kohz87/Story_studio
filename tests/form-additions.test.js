import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPack } from './fixtures/world.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { schemaForKind, validateField } from '../src/form-schema.js';
import { createDefault } from '../src/forms.js';

for (const kind of ['places', 'routes', 'events', 'items', 'creatures', 'races', 'talents', 'presets', 'legacySkills']) {
    test(`${kind} has a usable authoring schema`, () => {
        const schema = schemaForKind(kind);
        assert.equal(schema.type, 'object');
        const ctx = createTestContext(worldPack());
        const value = createDefault(schema, { model: ctx.model, kind, path: ['content', kind, 'draft'] });
        if (value !== undefined) assert.equal(validateField(schema, value).ok, true);
        ctx.onRender = () => renderScreen(ctx);
        assert.doesNotThrow(() => ctx.select(kind, '__new__'));
        assert.ok(ctx.inspector.querySelector('button.primary'));
    });
}

test('removed rules record kinds have no authoring schema', () => {
    for (const kind of ['classes', 'branches', 'trainers', 'itemRules']) assert.equal(schemaForKind(kind), null);
});
