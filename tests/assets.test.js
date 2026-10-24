// Asset tests: every SVG under src/assets is well-formed, hand-written minimal markup (no style, script, links or
// stray colours), has the right viewBox, and matches the string exported by src/assets/index.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ASSETS, SB_ICONS } from '../src/assets/index.js';
import { ICON_SET } from '../vendor/story-block/src/v2/view/icons/set.js';

const ROOT = new URL('../src/assets/', import.meta.url).pathname;
const ACCENT = '#7b6cf0';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(['svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const ATTRIBUTES = new Set([
    'xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'fill-rule', 'aria-hidden', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points',
]);
const COLOUR_ATTRIBUTES = new Set(['fill', 'stroke']);
// The 64x64 app mark and the empty-state illustrations may carry the accent; every other file is theme-coloured.
const SIZES = { icons: '0 0 24 24', empty: '0 0 160 120' };
const OWN_SIZE = { 'app-mark': '0 0 64 64' };

const files = [];
for (const dir of ['icons', 'empty']) {
    for (const file of readdirSync(join(ROOT, dir)).sort()) {
        const name = file.replace(/\.svg$/, '');
        files.push({ dir, file, name, text: readFileSync(join(ROOT, dir, file), 'utf8') });
    }
}

/** Parses the small SVG subset the assets use; throws on anything malformed. Returns the root element. */
function parseSvg(text) {
    const root = { tag: '#root', attrs: {}, children: [] };
    const stack = [root];
    let at = 0;
    const tag = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/y;
    const body = text.trim();
    while (at < body.length) {
        tag.lastIndex = at;
        const m = tag.exec(body);
        if (!m) throw new Error(`not well-formed at offset ${at}: ${body.slice(at, at + 30)}`);
        at = tag.lastIndex;
        const [, closing, name, rawAttrs, selfClosing] = m;
        if (closing) {
            const open = stack.pop();
            if (stack.length === 0 || open.tag !== name) throw new Error(`mismatched </${name}>`);
            continue;
        }
        const attrs = {};
        for (const a of rawAttrs.matchAll(/\s+([\w:-]+)="([^"]*)"/g)) {
            if (Object.hasOwn(attrs, a[1])) throw new Error(`duplicate attribute ${a[1]}`);
            attrs[a[1]] = a[2];
        }
        const node = { tag: name, attrs, children: [] };
        stack.at(-1).children.push(node);
        if (!selfClosing) stack.push(node);
    }
    if (stack.length !== 1) throw new Error('unclosed element');
    if (root.children.length !== 1 || root.children[0].tag !== 'svg') throw new Error('root must be a single <svg>');
    return root.children[0];
}

function* walk(node) {
    yield node;
    for (const child of node.children) yield* walk(child);
}

test('there are assets, and the file names are kebab-case', () => {
    assert.ok(files.length >= 20);
    for (const { file } of files) assert.match(file, /^[a-z0-9]+(-[a-z0-9]+)*\.svg$/);
    const names = files.map(f => f.name);
    assert.equal(new Set(names).size, names.length, 'names must be unique across icons/ and empty/');
});

for (const { dir, file, name, text } of files) {
    test(`${dir}/${file}: parses as SVG with the right viewBox`, () => {
        const svg = parseSvg(text);
        assert.equal(svg.attrs.xmlns, SVG_NS);
        const box = OWN_SIZE[name] ?? SIZES[dir];
        assert.equal(svg.attrs.viewBox, box);
        const [, , w, h] = box.split(' ');
        assert.equal(svg.attrs.width, w);
        assert.equal(svg.attrs.height, h);
        assert.equal(svg.attrs['aria-hidden'], 'true');
        for (const node of walk(svg)) {
            assert.ok(ELEMENTS.has(node.tag), `element <${node.tag}> is not allowed`);
            for (const attr of Object.keys(node.attrs)) assert.ok(ATTRIBUTES.has(attr), `attribute ${attr} is not allowed`);
        }
        assert.ok([...walk(svg)].some(n => n.tag === 'path' || n.tag === 'circle' || n.tag === 'rect'), 'draws something');
    });

    test(`${dir}/${file}: no style, script, foreignObject, links, external references or title`, () => {
        const bare = text.replace(` xmlns="${SVG_NS}"`, '');
        assert.ok(!/<\s*(style|script|foreignObject|image|use|title|desc|metadata|defs)\b/i.test(bare));
        assert.ok(!/href|xlink|url\(|https?:|\/\/|data:|@import|\bon[a-z]+\s*=|<!|<\?/i.test(bare));
        assert.ok(!/\sid=|\sclass=|\sstyle=/.test(bare), 'no id, class or style attributes');
    });

    test(`${dir}/${file}: the only literal colours are ${ACCENT} (app mark and empty states) or none`, () => {
        const svg = parseSvg(text);
        const mayUseAccent = name === 'app-mark' || dir === 'empty';
        const literal = new Set();
        for (const node of walk(svg)) {
            for (const [attr, value] of Object.entries(node.attrs)) {
                if (COLOUR_ATTRIBUTES.has(attr)) {
                    if (value === 'none' || value === 'currentColor') continue;
                    literal.add(value);
                }
            }
        }
        for (const value of literal) assert.equal(value, ACCENT);
        if (!mayUseAccent) assert.equal(literal.size, 0, 'line icons take their colour from the theme');
        assert.ok(!/#[0-9a-f]{3,8}\b/i.test(text.replaceAll(ACCENT, '')), 'no other hex colour anywhere');
        assert.ok(!/rgba?\(|hsla?\(/i.test(text));
    });

    test(`${dir}/${file}: coordinates are rounded to one decimal place`, () => {
        const svg = parseSvg(text);
        for (const node of walk(svg)) {
            for (const [attr, value] of Object.entries(node.attrs)) {
                if (!['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points'].includes(attr)) continue;
                assert.ok(!/\d\.\d{2,}/.test(value), `${attr}="${value}" has more than one decimal`);
            }
        }
    });

    test(`${dir}/${file}: line icons use the Studio line style (stroke currentColor, 1.8, round caps and joins)`, () => {
        if (dir !== 'icons' || name === 'app-mark') return;
        const { attrs } = parseSvg(text);
        assert.equal(attrs.fill, 'none');
        assert.equal(attrs.stroke, 'currentColor');
        assert.equal(attrs['stroke-width'], '1.8');
        assert.equal(attrs['stroke-linecap'], 'round');
        assert.equal(attrs['stroke-linejoin'], 'round');
    });

    test(`${dir}/${file}: the exported string in index.js is the file`, () => {
        assert.equal(ASSETS[name], text.trimEnd());
    });
}

test('index.js exports a frozen map of exactly the files', () => {
    assert.ok(Object.isFrozen(ASSETS));
    assert.deepEqual(Object.keys(ASSETS).sort(), files.map(f => f.name).sort());
    assert.ok(Object.isFrozen(SB_ICONS));
});

test('the tier badges 0 to 3 exist and differ from each other', () => {
    const tiers = [0, 1, 2, 3].map(n => ASSETS[`tier-${n}`]);
    assert.ok(tiers.every(Boolean));
    assert.equal(new Set(tiers).size, 4);
});

test('every Story Block icon Studio reuses exists in the vendored set and is not also drawn here', () => {
    for (const [name, id] of Object.entries(SB_ICONS)) {
        assert.ok(Object.hasOwn(ICON_SET, id), `${name} -> ${id} is not in the vendored icon set`);
        assert.ok(!Object.hasOwn(ASSETS, name), `${name} is both reused and drawn`);
    }
});
