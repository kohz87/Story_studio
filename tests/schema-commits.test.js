import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateChange, validateField } from '../src/form-schema.js';

function sources(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = `${dir}/${entry.name}`;
        return entry.isDirectory() ? sources(path) : path.endsWith('.js') ? [path] : [];
    });
}

test('every UI field commit imports the guarded edit and cannot bypass schema validation', () => {
    let consumers = 0;
    for (const path of sources('src').filter(path => path !== 'src/edits.js')) {
        const source = readFileSync(path, 'utf8');
        if (!/\bsetField\s*\(/.test(source)) continue;
        consumers++;
        assert.match(source, /import \{[^}]*setSchemaField as setField[^}]*\} from ['"][^'"]*edits\.js['"]/, path);
        assert.doesNotMatch(source, /import \*/, `${path}: no namespace edit import`);
    }
    assert.ok(consumers >= 5);
    const edits = readFileSync('src/edits.js', 'utf8').split('export function setSchemaField')[1];
    assert.match(edits, /validateChange\([\s\S]*if \(!checked.ok\) return[\s\S]*return setField\(/);
    const forms = readFileSync('src/forms.js', 'utf8');
    assert.match(forms, /validateChange\(options.rootSchema, options.rootValue[\s\S]*if \(!checked.ok\)[\s\S]*if \(options.isNew\)/);
    const records = readFileSync('src/screens/records.js', 'utf8');
    assert.match(records, /validateField\(schema, draft\)[\s\S]*if \(!checked.ok\)[\s\S]*add\(ctx.model, kind, draft\)/);
});

test('replacement validation enforces enclosing list bounds, uniqueness and nested variants', () => {
    const schema = { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 10 } };
    for (const [path, value] of [[[], [1]], [[], [1, 2, 3]], [[1], 1], [[1], 11]]) {
        assert.equal(validateChange(schema, [1, 2], path, value).ok, false);
    }
    assert.equal(validateChange(schema, [1, 2], [1], 3).ok, true);
    assert.equal(validateField({ type: 'integer', multipleOf: 10 }, 95).ok, false);
    assert.equal(validateField({ type: 'integer', not: { const: 0 } }, 0).ok, false);
});
