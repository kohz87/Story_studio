// renderTemplate (docs/PART5B_SPEC.md §3.5): the unknown names it refuses, a block that is not alone on its line, and a
// value that is never scanned for placeholders again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate } from '../src/code-module/render.js';

test('an inline placeholder with no value throws, and names it', () => {
    assert.throws(() => renderTemplate('a {{x}} b', {}, {}), /Unknown placeholder "x"/);
});

test('a block line with no snippet throws, and names it', () => {
    assert.throws(() => renderTemplate('{{@b}}\n', {}, {}), /Unknown block "b"/);
});

test('a block that is not alone on its line is not a block: it is left unfilled and throws', () => {
    assert.throws(() => renderTemplate('x {{@b}}\n', {}, { b: 'Y\n' }), /A placeholder was left unfilled/);
    assert.throws(() => renderTemplate('{{@b}} tail\n', {}, { b: 'Y\n' }), /A placeholder was left unfilled/);
});

test('a block line is replaced by its snippet, which is then filled like the rest of the template', () => {
    assert.equal(renderTemplate('one\n{{@b}}\ntwo {{v}}\n', { v: 'V' }, { b: 'snippet {{v}}\n' }), 'one\nsnippet V\ntwo V\n');
    assert.equal(renderTemplate('one\n{{@b}}\ntwo\n', {}, { b: '' }), 'one\ntwo\n');
});

test('a value is inserted once and never scanned for placeholders again', () => {
    // A value with spaces inside its braces is not a placeholder, so it comes out as it went in.
    assert.equal(renderTemplate('{{a}}', { a: '{{ b }} and $& and $1' }, {}), '{{ b }} and $& and $1');
    // A value with a real placeholder shape is not filled again. The unfilled check then refuses the text, as §3.5 says.
    assert.throws(() => renderTemplate('{{a}}', { a: '{{b}}', b: 'no' }, {}), /A placeholder was left unfilled/);
});
