// Golden values: the small rules pack's hashes, and parity with Story Block on a byte order mark.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { openPack, exportPack } from '../src/model.js';
import { validateRulesPack } from '../vendor/story-block/src/v2/packs/rules-v2.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';

const RULES_HASH = 'bbcf96a8f04da8e007c2fb3840a3939a1d30e3820ddcb48c3e4632186e816f5b';
const PACK_HASH = '19d91d55a09d3d21bf9ea865e1cadc63561a44be65745d61530046c39b718625';

test('the small rules pack opens with the golden hashes', () => {
    const model = openPack(smallRulesPack());
    assert.equal(model.validation.ok, true);
    assert.equal(model.rulesHash, RULES_HASH);
    assert.equal(model.packHash, PACK_HASH);
});

test('pack text with a leading byte order mark opens as Story Block accepts it', () => {
    const text = '﻿' + JSON.stringify(smallRulesPack());
    assert.equal(validateRulesPack(text).ok, true);
    const model = openPack(text);
    assert.equal(model.validation.ok, true);
    assert.equal(model.rulesHash, RULES_HASH);
    assert.equal(model.packHash, PACK_HASH);
});

function parity(input, expected) {
    const sb = validatePack(input);
    const model = openPack(input);
    assert.equal(sb.ok, expected, JSON.stringify(sb.errors));
    assert.equal(model.validation.ok, sb.ok);
    assert.deepEqual(model.validation.errors, sb.errors ?? []);
    assert.equal(model.rulesHash, sb.ok ? sb.rulesHash ?? null : null);
    assert.equal(model.packHash, sb.ok ? sb.packHash ?? null : null);
    if (sb.ok) {
        const output = exportPack(model);
        const reopened = validatePack(output);
        assert.equal(reopened.ok, true, JSON.stringify(reopened.errors));
        assert.equal(reopened.rulesHash, sb.rulesHash);
        assert.equal(reopened.packHash, sb.packHash);
    } else assert.throws(() => exportPack(model));
    return model;
}

const bundledText = readFileSync(new URL('./fixtures/ersveil-bluewatch.json', import.meta.url), 'utf8');
const bundled = () => JSON.parse(bundledText);

test('SB 2.0.0 bundled Ersveil: original bytes and both hashes survive open/export and edit/undo', () => {
    const initial = parity(bundledText, true);
    assert.equal(initial.rulesHash, '664ac61f6d3b874d8821a6eb6f3caf32263b8077f96dfa2d727a274a8c3bffc8');
    assert.equal(initial.packHash, '080b94031135599cee5ff42f48e5e027a317a9cd5b4fc6a5fdea86c97680781a');
    const bytes = Buffer.from(bundledText);
    assert.equal(bytes.length, 247239);
    assert.ok(Buffer.from(exportPack(initial)).equals(bytes));
    const edit = setField(initial, ['name'], 'Edited Bluewatch');
    assert.equal(edit.ok, true);
    assert.equal(edit.model.validation.ok, true);
    assert.equal(edit.model.rulesHash, initial.rulesHash);
    assert.notEqual(edit.model.packHash, initial.packHash);
    assert.notEqual(exportPack(edit.model), bundledText);
    const history = createHistory(initial);
    assert.equal(history.commit(edit), true);
    for (const restored of [edit.undo(), history.undo()]) {
        assert.equal(restored, initial);
        assert.ok(Buffer.from(exportPack(restored)).equals(bytes));
        assert.equal(restored.rulesHash, initial.rulesHash);
        assert.equal(restored.packHash, initial.packHash);
    }
});

test('every SB 2.0.0 host field and rules option is retained and editable', async t => {
    const cases = [
        ['currency.display and empty coins', p => { p.currency = { name: 'mark', coins: [], display: 'base' }; }],
        ['calendar.holidays', p => { p.calendar.holidays = [{ name: 'Lantern Night', month: 1, day: 2 }]; }],
        ['weather.seasons and tables', p => { p.weather = { seasons: [{ name: 'winter', months: [p.calendar.months[0].name] }], tables: [{ season: 'winter', region: 'Bluewatch', weather: ['cold rain'] }] }; }],
        ['rules.memory and statLabels', p => { p.content.rules[0].memory = 'full'; p.content.rules[0].statLabels = { STR: 'Might' }; }],
        ['screens template/css/layout/theme/data/steps and layouts/theme', p => {
            p.screens = [{ id: 'camp', title: 'Camp', icon: 'fa-tent', mounts: ['tab'],
                template: '<p>Camp</p>' + ' '.repeat(5000), css: '/*' + 'x'.repeat(5000) + '*/',
                layout: { root: { type: 'text', text: 'Camp' } }, theme: { '--ss-accent': '#123456' },
                data: { pc: { query: 'party.pc' } }, steps: [{ id: 'first', title: 'First', template: '<p>First</p>' }] }];
            p.layouts = [{ id: 'camp', root: { type: 'text', text: 'Camp' } }]; p.theme = { '--ss-accent': '#123456' };
        }],
        ['host entities, controls, and field names', p => { p.description = 'a &#60; b\u0001'; p.layouts = [{ 'a<b': 1, 'line\nkey': 2 }]; }],
        ['large host layout and Unicode-distinct keys', p => { p.layouts = Array.from({ length: 110 }, () => ({ d: Array(1000).fill(0) })); p.layouts.push({ 'café': 1, 'café': 2 }); }],
        ['ordinary packs without rules', p => { delete p.content.rules; p.content.creatures = []; p.content.quests = []; p.content.shops = []; p.content.recipes = []; }],
    ];
    for (const [name, change] of cases) await t.test(name, () => {
        const pack = bundled(); change(pack);
        // Text and object inputs must take the same importer path; string export also preserves bytes.
        parity(pack, true);
        const text = JSON.stringify(pack);
        const model = parity(text, true);
        assert.equal(exportPack(model), text);
    });
});

test('Studio refuses the same invalid fields as SB, including pin transport and runtime-only data', async t => {
    const cases = [
        ['unknown envelope', p => { p.unrecognized = true; }],
        ['unknown content kind', p => { p.content.unrecognized = []; }],
        ['unknown item field', p => { p.content.items[0].unrecognized = 1; }],
        ['unknown rules field', p => { p.content.rules[0].unrecognized = 1; }],
        ['missing rules capability', p => { p.requires.capabilities = []; }],
        ['bad currency display', p => { p.currency.display = 'invalid'; }],
        ['bad calendar holiday', p => { p.calendar.holidays = [{ name: 'Oops', month: 1, day: 401 }]; }],
        ['bad weather', p => { p.weather = { tables: [] }; }],
        ['bad recipe crafting reference', p => { p.content.recipes[0].craft = 'unknown-craft'; }],
        ['rules unsafe markup', p => { p.content.rules[0].skills[0].note = 'a < b'; }],
        ['host unsafe markup', p => { p.description = '<script>bad</script>'; }],
        ['screen over code limit', p => { p.screens = [{ id: 'camp', template: 'x'.repeat(LIMITS.code + 1) }]; }],
        ...['resolved', 'rulesHash', 'packHash', 'packKey', 'packVersion', 'progression', 'constantsHash', 'defs'].map(key =>
            [`pin transport ${key}`, p => { p[key] = {}; }]),
        ['runtime form metadata', p => { p.content.rules[0].skills[0].base.origin = 'generated'; }],
        ['runtime item provenance', p => { p.content.items[0].provenance = {}; }],
    ];
    for (const [name, change] of cases) await t.test(name, () => {
        const pack = bundled(); change(pack);
        parity(pack, false); parity(JSON.stringify(pack), false);
    });
});

test('duplicate JSON keys follow SB last-key-wins semantics, while unsafe shapes still fail', () => {
    parity(JSON.stringify(smallRulesPack()).replace('"id":"fixture"', '"id":"wrong","id":"fixture"'), true);
    for (const input of [null, [], '{', '{"__proto__":{}}', { id: 'x', get content() { throw new Error('getter'); } }]) parity(input, false);
});
