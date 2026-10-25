import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/story-studio.html', import.meta.url), 'utf8');
test('distribution has one classic inline script, inline styles, credits, and no runtime network or HTML injection', () => {
    assert.equal((html.match(/<script>/g) || []).length, 1);
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('Copyright (c) 2023 Phosphor Icons'));
    assert.ok(html.includes('THE SOFTWARE IS PROVIDED'));
    assert.doesNotMatch(html.replaceAll('http://www.w3.org/2000/svg', ''), /fetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//);
    assert.doesNotMatch(html, /<script[^>]+src=|<link|type="module"|\bimport\s*\(|innerHTML|insertAdjacentHTML|outerHTML|DOMParser|\beval\s*\(|new Function/);
    assert.ok(html.includes("connect-src 'none'"));
});
