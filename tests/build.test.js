import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scannable, firstReference, NETWORK, LOADERS } from '../scripts/dist-scan.mjs';

const html = readFileSync(new URL('../dist/story-studio.html', import.meta.url), 'utf8');
test('distribution has one classic inline script, inline styles, credits, and no runtime network or HTML injection', () => {
    assert.equal((html.match(/<script>/g) || []).length, 1);
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('Copyright (c) 2023 Phosphor Icons'));
    assert.ok(html.includes('THE SOFTWARE IS PROVIDED'));
    assert.doesNotMatch(scannable(html), NETWORK);
    assert.doesNotMatch(scannable(html), LOADERS);
    assert.ok(html.includes("connect-src 'none'"));
});

test('the static scan allows only Story Block\u2019s two inert injected defaults, by shape, and flags anything else', () => {
    assert.equal(firstReference('x=(...a)=>globalThis.fetch(...a);y=n=>import(n);'), null);
    for (const bad of ['fetch(url)', 'globalThis.fetch(url)', 'import("./x.js")', 'q=n=>import(m)', 'new WebSocket(u)', 'a="https://example.com"', 'el.innerHTML=x', 'eval(code)']) {
        assert.notEqual(firstReference(bad), null, bad);
    }
    // The committed page carries exactly the defaults Story Block's chat-file and branch helpers declare, nothing more.
    const fetches = (html.match(/\(\.\.\.(\w+)\)=>globalThis\.fetch\(\.\.\.\1\)/g) || []).length;
    const importers = (html.match(/\b(\w+)=>import\(\1\)/g) || []).length;
    assert.equal(fetches, 1);
    assert.ok(importers >= 1 && importers <= 2, String(importers));
    assert.equal(firstReference(html), null);
});
