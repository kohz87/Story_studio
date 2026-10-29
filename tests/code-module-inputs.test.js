// The code module form's rules (docs/PART5B_SPEC.md §5, §6.1, §3.4, §8): every bound on both sides, the exact error
// list of each case the spec names, the order of the errors, and the two escapers on hostile text.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_INPUTS, INPUT_KEYS, RESERVED_FIELDS, RESERVED_KINDS, RESERVED_MODULE_IDS, RESERVED_NAMES, jsString, mdText, validateInputs } from '../src/code-module/inputs.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/code-module/golden-inputs.json', import.meta.url)), 'utf8'));
const withValue = (key, value) => ({ ...EXAMPLE_INPUTS, [key]: value });
const errorsOf = raw => {
    const result = validateInputs(raw);
    assert.equal(result.ok, false, String(JSON.stringify(raw)).slice(0, 80));
    return result.errors;
};
const passes = raw => {
    const result = validateInputs(raw);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.inputs;
};
const one = (code, field, message) => [{ code, field, message }];

test('the golden inputs pass, and EXAMPLE_INPUTS is the golden inputs file', () => {
    assert.deepEqual(EXAMPLE_INPUTS, golden);
    assert.equal(validateInputs(EXAMPLE_INPUTS).ok, true);
    assert.deepEqual(validateInputs(EXAMPLE_INPUTS).errors, undefined);
});

test('a valid result is a frozen copy with exactly the 18 keys, in order', () => {
    const { inputs } = validateInputs({ ...EXAMPLE_INPUTS });
    assert.deepEqual(Object.keys(inputs), [...INPUT_KEYS]);
    assert.equal(Object.isFrozen(inputs), true);
    assert.deepEqual(inputs, EXAMPLE_INPUTS);
});

test('a raw value that is not a plain object is refused with one error and no field', () => {
    for (const raw of [undefined, null, 'lantern', 7, [], ['moduleId']]) {
        assert.deepEqual(errorsOf(raw), one('bad-type', '', 'The code module form is not an object.'), String(raw));
    }
});

test('an extra key is refused with unknown-field, and comes before the field errors', () => {
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, extra: 1 }), one('unknown-field', 'extra', '"extra" is not a code module field.'));
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, name: '', extra: 1, zeta: 2 }).map(error => error.field), ['extra', 'zeta', 'name']);
});

test('the error list comes in form order, one error per field, unknown keys first', () => {
    const errors = errorsOf({ ...EXAMPLE_INPUTS, name: '', domain: 'a', min: '5', extra: 1 });
    assert.deepEqual(errors, [
        { code: 'unknown-field', field: 'extra', message: '"extra" is not a code module field.' },
        { code: 'required', field: 'name', message: 'Name is needed.' },
        { code: 'bad-name', field: 'domain', message: 'State name must be a lowercase letter, then 1 to 23 lowercase letters or digits.' },
        { code: 'bad-number', field: 'min', message: 'Minimum must be a whole number from -1000000 to 1000000.' },
    ]);
});

test('text bounds: one value just inside and one just outside each (code points, not units)', () => {
    const cases = [
        ['name', 40, 41], ['description', 160, 161], ['author', 60, 61], ['label', 24, 25], ['action', 32, 33],
    ];
    for (const [key, max, over] of cases) {
        const label = { name: 'Name', description: 'Description', author: 'Author', label: 'Field label', action: 'Button label' }[key];
        passes(withValue(key, 'x'.repeat(max)));
        passes(withValue(key, '𝒜'.repeat(max)));
        assert.deepEqual(errorsOf(withValue(key, 'x'.repeat(over))), one('too-long', key, `${label} is longer than ${max} characters.`), key);
        assert.deepEqual(errorsOf(withValue(key, '𝒜'.repeat(over))), one('too-long', key, `${label} is longer than ${max} characters.`), key);
    }
    passes(withValue('author', ''));
    for (const key of ['name', 'description', 'label', 'action']) {
        assert.deepEqual(errorsOf(withValue(key, '')).map(error => error.code), ['required'], key);
    }
});

test('identifier bounds: one value just inside and one just outside each length', () => {
    const slug = n => `a${'b'.repeat(n - 1)}`;
    passes(withValue('moduleId', slug(64)));
    assert.deepEqual(errorsOf(withValue('moduleId', slug(65))), one('bad-slug', 'moduleId', 'Module id must be lowercase words joined by "-", like "lantern-oil", at most 64 characters.'));
    passes(withValue('capability', slug(64)));
    assert.deepEqual(errorsOf(withValue('capability', slug(65))), one('bad-slug', 'capability', 'Capability must be lowercase words joined by "-", like "lantern-oil", at most 64 characters.'));
    passes(withValue('domain', 'ab'));
    passes(withValue('domain', slug(24).replace(/-/g, '')));
    assert.deepEqual(errorsOf(withValue('domain', 'a')).map(error => error.code), ['bad-name']);
    assert.deepEqual(errorsOf(withValue('domain', slug(25).replace(/-/g, ''))).map(error => error.code), ['bad-name']);
    passes(withValue('field', slug(24).replace(/-/g, '')));
    passes(withValue('field', 'a'));
    assert.deepEqual(errorsOf(withValue('field', slug(25).replace(/-/g, ''))).map(error => error.code), ['bad-name']);
    passes(withValue('kind', 'ab'));
    passes(withValue('kind', slug(24).replace(/-/g, '')));
    assert.deepEqual(errorsOf(withValue('kind', 'a')).map(error => error.code), ['bad-name']);
    assert.deepEqual(errorsOf(withValue('kind', slug(25).replace(/-/g, ''))).map(error => error.code), ['bad-name']);
    passes(withValue('kindLabel', 'a'.repeat(16)));
    assert.deepEqual(errorsOf(withValue('kindLabel', 'a'.repeat(17))), one('bad-name', 'kindLabel', 'Line label must be 1 to 16 lowercase letters.'));
    assert.deepEqual(errorsOf(withValue('kindLabel', '')).map(error => error.code), ['required']);
    passes(withValue('command', 'a'));
    passes(withValue('command', slug(32).replace(/-/g, '')));
    assert.deepEqual(errorsOf(withValue('command', slug(33).replace(/-/g, ''))), one('bad-name', 'command', 'Command must be a lowercase letter, then up to 31 letters or digits.'));
    passes(withValue('query', slug(32).replace(/-/g, '')));
    assert.deepEqual(errorsOf(withValue('query', slug(33).replace(/-/g, ''))), one('bad-name', 'query', 'Query must be a lowercase letter, then up to 31 letters or digits.'));
});

test('numbers: whole, safe, from -1000000 to 1000000, both sides', () => {
    passes({ ...EXAMPLE_INPUTS, min: -1000000, max: 20, initial: 10, step: 5 });
    passes({ ...EXAMPLE_INPUTS, min: 0, max: 1000000, initial: 10, step: 5 });
    passes({ ...EXAMPLE_INPUTS, min: 0, max: 20, initial: 10, step: 5 });
    passes({ ...EXAMPLE_INPUTS, min: -1000000, max: 1000000, initial: 0, step: 1000000 });
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, min: -1000001 }).map(error => error.code), ['bad-number']);
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, max: 1000001 }).map(error => error.code), ['bad-number']);
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, initial: 1000001 }).map(error => error.code), ['bad-number']);
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, step: 1000001 }).map(error => error.code), ['bad-number']);
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, step: 1.5 }).map(error => error.code), ['bad-number']);
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, min: '5' }), one('bad-number', 'min', 'Minimum must be a whole number from -1000000 to 1000000.'));
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, min: Number.NaN }).map(error => error.code), ['bad-number']);
});

test('range rules: max above min, start in range, step from 1 to max minus min', () => {
    // With max not above min, the start value and the step are also out of range, and each reports its own sentence.
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, min: 5, max: 5, initial: 5, step: 1 }), [
        { code: 'bad-range', field: 'max', message: 'Maximum must be above Minimum.' },
        { code: 'bad-range', field: 'step', message: 'Most a line may change it must be from 1 to Maximum minus Minimum.' },
    ]);
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, max: 0 }).map(error => error.field), ['max', 'initial', 'step']);
    passes({ ...EXAMPLE_INPUTS, initial: 0 });
    passes({ ...EXAMPLE_INPUTS, initial: 20 });
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, initial: -1 }), one('bad-range', 'initial', 'Start value must be from Minimum to Maximum.'));
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, initial: 21 }), one('bad-range', 'initial', 'Start value must be from Minimum to Maximum.'));
    passes({ ...EXAMPLE_INPUTS, step: 1 });
    passes({ ...EXAMPLE_INPUTS, step: 20 });
    const stepMessage = 'Most a line may change it must be from 1 to Maximum minus Minimum.';
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, step: 0 }), one('bad-range', 'step', stepMessage));
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, step: 21 }), one('bad-range', 'step', stepMessage));
});

test('the range rules do not run when a number is not valid', () => {
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, min: '5', max: 0 }).map(error => error.code), ['bad-number']);
});

test('Name refusals: markup, braces, quotes, a line break, decomposed text, leading space, too long', () => {
    const unsafe = "Name may use only letters, digits, spaces and the marks ' ’ , . ! ? : ; ( ) - – —.";
    assert.deepEqual(errorsOf(withValue('name', 'Oil <b>')), one('unsafe-text', 'name', unsafe));
    assert.deepEqual(errorsOf(withValue('name', 'Oil{{ x }}')), one('unsafe-text', 'name', unsafe));
    assert.deepEqual(errorsOf(withValue('name', 'a"b')), one('unsafe-text', 'name', unsafe));
    assert.deepEqual(errorsOf(withValue('name', 'a\nb')), one('unsafe-text', 'name', unsafe));
    assert.deepEqual(errorsOf(withValue('name', 'Cafe\u0301')), one('unsafe-text', 'name', 'Name has a character in decomposed form; type it again.'));
    assert.deepEqual(errorsOf(withValue('name', ' Lantern')), one('unsafe-text', 'name', unsafe));
    assert.deepEqual(errorsOf(withValue('name', 'x'.repeat(41))), one('too-long', 'name', 'Name is longer than 40 characters.'));
});

test('Module id refusals: a reserved id, uppercase, a leading dash, a double dash, 65 characters', () => {
    const rule = 'Module id must be lowercase words joined by "-", like "lantern-oil", at most 64 characters.';
    assert.deepEqual(errorsOf(withValue('moduleId', 'story-block')), one('reserved', 'moduleId', 'Module id "story-block" is taken by Story Block or another Story Suite module.'));
    assert.deepEqual(errorsOf(withValue('moduleId', 'Lantern')), one('bad-slug', 'moduleId', rule));
    assert.deepEqual(errorsOf(withValue('moduleId', '-a')), one('bad-slug', 'moduleId', rule));
    assert.deepEqual(errorsOf(withValue('moduleId', 'a--b')), one('bad-slug', 'moduleId', rule));
    assert.deepEqual(errorsOf(withValue('moduleId', `a${'b'.repeat(64)}`)), one('bad-slug', 'moduleId', rule));
});

test('Field refusals: a record id, an id suffix, an Object.prototype name, an uppercase start', () => {
    const idMessage = field => `Field "${field}" would have to hold a record id; choose another name.`;
    const protoMessage = field => `Field "${field}" is a name every JavaScript object already has; choose another.`;
    assert.deepEqual(errorsOf(withValue('field', 'id')), one('reserved', 'field', idMessage('id')));
    assert.deepEqual(errorsOf(withValue('field', 'ownerId')), one('reserved', 'field', idMessage('ownerId')));
    assert.deepEqual(errorsOf(withValue('field', 'toString')), one('reserved', 'field', protoMessage('toString')));
    assert.deepEqual(errorsOf(withValue('field', 'Oil')), one('bad-name', 'field', 'Field must be a lowercase letter, then up to 23 letters or digits.'));
});

test('Line kind and Line label refusals', () => {
    assert.deepEqual(errorsOf(withValue('kind', 'item')), one('reserved', 'kind', 'Line kind "item" is taken by Story Block or another Story Suite module.'));
    assert.deepEqual(errorsOf(withValue('kindLabel', 'Change')), one('bad-name', 'kindLabel', 'Line label must be 1 to 16 lowercase letters.'));
});

test('a Query equal to the Command is refused, and only when both pass their own rules', () => {
    assert.deepEqual(errorsOf(withValue('query', 'pour')), one('clash', 'query', 'Query must not be the same as Command.'));
    assert.deepEqual(errorsOf({ ...EXAMPLE_INPUTS, command: 'Pour', query: 'Pour' }).map(error => error.code), ['bad-name', 'bad-name']);
});

test('the reserved domain, capability and module ids are refused with the same sentence', () => {
    assert.deepEqual(errorsOf(withValue('domain', 'inventory')), one('reserved', 'domain', 'State name "inventory" is taken by Story Block or another Story Suite module.'));
    assert.deepEqual(errorsOf(withValue('capability', 'data-modules-v1')), one('reserved', 'capability', 'Capability "data-modules-v1" is taken by Story Block or another Story Suite module.'));
    assert.deepEqual(errorsOf(withValue('capability', 'data-modules-v1')), one('reserved', 'capability', 'Capability "data-modules-v1" is taken by Story Block or another Story Suite module.'));
});

test('a value of the wrong type is refused with bad-type, and screen must be a boolean', () => {
    assert.deepEqual(errorsOf(withValue('name', 7)), one('bad-type', 'name', 'Name has the wrong type.'));
    assert.deepEqual(errorsOf(withValue('screen', 'yes')), one('bad-type', 'screen', 'Add a tab screen has the wrong type.'));
    passes(withValue('screen', false));
});

test('the empty optional fields are allowed, and the other required fields are not', () => {
    passes({ ...EXAMPLE_INPUTS, author: '', capability: '' });
    assert.deepEqual(errorsOf(withValue('moduleId', '')), one('required', 'moduleId', 'Module id is needed.'));
    assert.deepEqual(errorsOf(withValue('domain', '')), one('required', 'domain', 'State name is needed.'));
});

test('an object that is not a plain object gives the one bad-type error', () => {
    class Form {
        constructor() { this.moduleId = 'lantern-oil'; }
    }
    for (const raw of [new Date(), new Map(), Object.create(EXAMPLE_INPUTS), new Form()]) {
        assert.deepEqual(errorsOf(raw), one('bad-type', '', 'The code module form is not an object.'), Object.prototype.toString.call(raw));
    }
    assert.equal(validateInputs(Object.assign(Object.create(null), EXAMPLE_INPUTS)).ok, true);
});

test('every reserved name is refused with its own sentence, in each list', () => {
    for (const name of RESERVED_MODULE_IDS) {
        assert.deepEqual(errorsOf(withValue('moduleId', name)), one('reserved', 'moduleId', `Module id "${name}" is taken by Story Block or another Story Suite module.`), name);
    }
    for (const name of RESERVED_NAMES) {
        assert.deepEqual(errorsOf(withValue('domain', name)), one('reserved', 'domain', `State name "${name}" is taken by Story Block or another Story Suite module.`), name);
        assert.deepEqual(errorsOf(withValue('capability', name)), one('reserved', 'capability', `Capability "${name}" is taken by Story Block or another Story Suite module.`), name);
    }
    for (const name of RESERVED_KINDS) {
        assert.deepEqual(errorsOf(withValue('kind', name)), one('reserved', 'kind', `Line kind "${name}" is taken by Story Block or another Story Suite module.`), name);
    }
    for (const name of RESERVED_FIELDS) {
        assert.deepEqual(errorsOf(withValue('field', name)), one('reserved', 'field', `Field "${name}" is a name every JavaScript object already has; choose another.`), name);
    }
});

test('a Name with each forbidden character is refused as unsafe text', () => {
    const forbidden = [String.fromCharCode(9), String.fromCharCode(0xa0), String.fromCharCode(0x200b), String.fromCharCode(0x202e), '`', String.fromCharCode(92), '|', '#', '*', '_', '[', ']', '&', '<', '>', '{', '}'];
    const unsafe = "Name may use only letters, digits, spaces and the marks ' ’ , . ! ? : ; ( ) - – —.";
    for (const character of forbidden) {
        assert.deepEqual(errorsOf(withValue('name', `Oil${character}`)), one('unsafe-text', 'name', unsafe), JSON.stringify(character));
    }
});

test('jsString makes a JS string literal that evaluates back to the same text', () => {
    assert.equal(jsString("Counts the oil left in the party's lantern."), "'Counts the oil left in the party\\'s lantern.'");
    const hostile = ['back\\slash \'apostrophe" ', String.fromCharCode(10), ' line', String.fromCharCode(0x2028), 'sep </script> ', String.fromCharCode(0x2029), String.fromCharCode(13), String.fromCharCode(7), String.fromCharCode(0x7f), String.fromCharCode(0)].join('');
    const literal = jsString(hostile);
    for (const code of [10, 13, 0x2028, 0x2029, 0x7f, 0, 7]) assert.equal(literal.includes(String.fromCharCode(code)), false, `U+${code.toString(16)} is escaped, not raw`);
    assert.equal(vm.runInNewContext(`(${literal})`), hostile);
});

test('mdText escapes Markdown and HTML characters, and leaves valid display text as it is', () => {
    assert.equal(mdText('a*b_c<d>'), 'a\\*b\\_c\\<d\\>');
    assert.equal(mdText('`x` #1 | [y] {z} & \\'), '\\`x\\` \\#1 \\| \\[y\\] \\{z\\} \\& \\\\');
    for (const key of ['name', 'description', 'author', 'label', 'action']) assert.equal(mdText(EXAMPLE_INPUTS[key]), EXAMPLE_INPUTS[key], key);
});
