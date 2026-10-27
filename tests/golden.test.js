// Golden values: the small rules pack's hashes, and parity with Story Block on a byte order mark.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { openPack, exportPack } from '../src/model.js';
import { validateRulesPack } from '../vendor/story-block/src/v2/packs/rules-v2.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';

const RULES_HASH = '4350400203831b86069c7e1230894db0524645c2671289cfe251072254d6cd74';
const PACK_HASH = '378883318fde8ee731404fb2fbecb9bb54b09e9d7898078a5f8c1da1ab422fec';

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
    assert.equal(initial.rulesHash, '754b258b60cf97fe5ca230c00c1edf51748b5a126b0e02e46e394baf0714771b');
    assert.equal(initial.packHash, 'f40e28c9dc8bdd12704b320f7551a23dc7949941957e6b8b8d0cdf23a89b85ee');
    const bytes = Buffer.from(bundledText);
    assert.equal(bytes.length, 247239);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), 'a5fb1a515a4dfabd824cf7a8d165099fdcf366c1eeebb7c94c999989e90f2934');
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

test('host collections and manifest options survive editing, export and byte-identical undo', async t => {
    const initial = openPack(bundledText);
    const cases = [
        [['economy'], { scale: 0.001, note: 'Small coins' }],
        [['content', 'terms'], [{ name: 'Growth', levelName: 'Circle', xpName: 'Growth', tiers: { size: 5, numerals: 'arabic', enabled: false } }]],
        [['content', 'ranks'], [{ id: 'F', title: 'First', levels: [1, 10], reward: [5, 50] }]],
        [['content', 'crafts', 0, 'stations'], ['forge', 'salt-yard']],
        [['content', 'meterPresets'], [{ id: 'companion', title: 'Companion', meters: [
            { id: 'loyalty', name: 'Loyalty', min: -100, max: 100, start: 0, describe: 'Trust',
                bands: [{ at: -100, word: 'doubtful' }, { at: 10, word: 'trusted' }], drift: { toward: 0, perDay: 1 } },
        ], stages: [{ id: 'friend', name: 'Friend', needs: [{ meter: 'loyalty', at: 10 }], milestone: 'They trust you.' }] }]],
        [['content', 'markets'], [{ type: 'lock-town', buy: 1.05, sell: 0.95, stock: [4, 6], note: 'River tolls' }, { tag: 'coastal', prices: { fish: 0.7, all: 1.1 } }]],
        [['content', 'recipes', 0, 'station'], 'salt-yard'],
        [['content', 'recipes', 0, 'known'], false],
        [['content', 'recipes', 0, 'teaches'], 'Hollis at the forge'],
        [['content', 'items', 0, 'carry'], 1000],
        [['content', 'places', 0, 'secret'], true],
        [['content', 'rules', 0, 'name'], 'Bluewatch rules'],
        [['content', 'rules', 0, 'memory'], 'full'],
        [['content', 'rules', 0, 'statLabels'], { STR: 'Might', CHA: 'Presence' }],
    ];
    for (const [path, value] of cases) await t.test(path.join('.'), () => {
        const edited = setField(initial, path, value);
        assert.equal(edited.ok, true, JSON.stringify(edited.errors));
        assert.equal(edited.model.validation.ok, true, JSON.stringify(edited.model.validation.errors));
        const reopened = parity(exportPack(edited.model), true);
        assert.equal(reopened.rulesHash, edited.model.rulesHash);
        assert.equal(reopened.packHash, edited.model.packHash);
        assert.deepEqual(path.reduce((record, key) => record[key], reopened.document), value);
        assert.equal(exportPack(edited.undo()), bundledText);
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
        ['bad term separators', p => { p.content.terms[0].levelName = 'Level|Rank'; }],
        ['bad rank range', p => { p.content.ranks[0].levels = [10, 1]; }],
        ['bad craft stats', p => { p.content.crafts[0].stats = ['INT', 'INT']; }],
        ['bad meter stage reference', p => { p.content.meterPresets[0].stages = [{ id: 'friend', name: 'Friend', needs: [{ meter: 'unknown', at: 10 }] }]; }],
        ['bad market factor', p => { p.content.markets[0].buy = 4.01; }],
        ['bad item carry', p => { p.content.items[0].carry = 0; }],
        ['bad rules memory', p => { p.content.rules[0].memory = 'invalid'; }],
        ['bad stat label', p => { p.content.rules[0].statLabels = { UNKNOWN: 'Might' }; }],
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
