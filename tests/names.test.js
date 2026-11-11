// The Names screen: its pure helpers, and edit round trips on Ersveil (add and remove a culture, a name, a region, never-use
// names) through the real controls: each edit passes the vendored checker and one undo puts the pack back byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { renderScreen } from '../src/screens/index.js';
import { goToProblem } from '../src/screens/problems.js';
import { namesOf, cultureIds, cultureIdProblem, placeMatches, castNameOverlap, isBanned, pickSuggestions, cultureForPlace, prettyId, matchedPlaceNames, placeOptions, NAMES_LIMITS } from '../src/screens/names.js';
import { NAMES_LIMITS as SB } from '../vendor/story-block/src/v2/packs/limits.js';
import { createTestContext } from './helpers/dom.js';

const read = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
function ersveil() {
    const pack = read('ersveil-pack.json');
    const extra = read('ersveil-names-ripples.json');
    pack.content.names = extra.names;
    pack.ripples = extra.ripples;
    return JSON.stringify(pack);
}
function open(select = ['names']) {
    const ctx = createTestContext(openPack(ersveil()));
    ctx.onRender = renderScreen;
    ctx.select(...select);
    return ctx;
}
const buttons = (root, label) => root.querySelectorAll('button').filter(node => node.textContent === label || node.getAttribute('aria-label') === label);
const press = (root, label) => { const [node] = buttons(root, label); assert.ok(node, `no button ${label}`); node.click(); };
const input = (root, label) => { const [node] = root.querySelectorAll('input').filter(item => item.getAttribute('aria-label') === label); assert.ok(node, `no input ${label}`); return node; };
const type = (root, label, value) => { const box = input(root, label); box.value = value; buttons(box.parentElement, 'Add')[0].click(); };
const ok = ctx => { assert.deepEqual(ctx.model.validation.errors, []); assert.equal(ctx.model.validation.ok, true); };

test('the limits are Story Block’s own', () => {
    assert.equal(NAMES_LIMITS.given, SB.given);
    assert.equal(NAMES_LIMITS.regions, SB.regions);
    assert.equal(NAMES_LIMITS.regionChars, SB.region);
    assert.equal(NAMES_LIMITS.givenChars, SB.name);
    assert.equal(NAMES_LIMITS.bannedChars, SB.bannedName);
});

test('the culture id rules: a slug, not the reserved word, not taken', () => {
    const names = { river: { regions: ['River'], given: ['Wenna'] } };
    assert.equal(cultureIdProblem('flame', names), '');
    assert.match(cultureIdProblem('banned', names), /reserved/);
    assert.match(cultureIdProblem('Bad Id', names), /lower-case/);
    assert.match(cultureIdProblem('', names), /id/);
    assert.match(cultureIdProblem('river', names), /already/);
    assert.equal(cultureIdProblem('river', names, 'river'), '');
    // Story Block's own slug: no trailing or doubled hyphen, up to 64 characters; "names" is reserved too.
    for (const bad of ['river-', 'a--b', '-river', 'names']) assert.notEqual(cultureIdProblem(bad, names), '', bad);
    assert.equal(cultureIdProblem('a'.repeat(64), names), '');
    assert.notEqual(cultureIdProblem('a'.repeat(65), names), '');
});

test('the culture id field refuses river- with a word and puts the old id back; the pack is untouched', () => {
    const ctx = open();
    const id = cultureIds(namesOf(ctx.model))[1];
    const before = exportPack(ctx.model);
    ctx.select('names', id);
    const field = input(ctx.inspector, 'Culture id');
    field.value = 'river-';
    field.dispatchEvent({ type: 'change' });
    assert.equal(ctx.notifications.length, 1);
    assert.equal(field.value, id);
    assert.equal(exportPack(ctx.model), before);
});

test('a title word does not hide a cast name: "Sir Lothar" flags the given name Lothar and keeps it out of the preview', () => {
    const model = { document: { content: { cast: [{ name: 'Sir Lothar' }, { name: 'Sister Temiwa' }], names: {} } } };
    assert.deepEqual(castNameOverlap(model, ['Lothar', 'Temiwa', 'Sir Lothar', 'Wenna']), ['Lothar', 'Temiwa', 'Sir Lothar']);
    assert.deepEqual(pickSuggestions(model, { given: ['Lothar', 'Wenna'] }, 'x'), ['Wenna']);
});

test('titles, matched places and the preview picker: pretty ids, the first places by name, one option per place name', () => {
    assert.equal(prettyId('highmark'), 'Highmark');
    assert.equal(prettyId('river-folk'), 'River folk');
    const model = { document: { content: { places: [
        { name: 'A', region: 'North Reach' }, { name: 'B', region: 'North Reach' }, { name: 'a', region: 'North Reach' }, { name: 'C', region: 'North Reach' }, { name: 'D', region: 'South' }, { name: 'E' },
    ] } } };
    assert.deepEqual(matchedPlaceNames(model, ['north'], 3), ['A', 'B', 'a']);
    assert.deepEqual(placeOptions(model), [{ label: 'A', value: 'North Reach' }, { label: 'B', value: 'North Reach' }, { label: 'C', value: 'North Reach' }, { label: 'D', value: 'South' }]);
    const ctx = open(['names', cultureIds(namesOf(open().model))[1]]);
    const select = ctx.inspector.querySelectorAll('select')[0];
    const labels = select.querySelectorAll('option').map(node => node.textContent);
    assert.equal(new Set(labels.map(text => text.toLowerCase())).size, labels.length);
});

test('the culture editor shows the checker’s words for its own culture; the Delete button is named Delete', () => {
    const pack = JSON.parse(ersveil());
    pack.content.names['bad-'] = { regions: ['X'], given: ['Y'] };
    const ctx = createTestContext(openPack(JSON.stringify(pack)));
    ctx.onRender = renderScreen;
    ctx.select('names', 'bad-');
    assert.ok(ctx.model.validation.errors.some(err => String(err.path).startsWith('content.names.bad-')));
    assert.ok(ctx.inspector.querySelectorAll('.warning').length >= 1);
    assert.equal(buttons(ctx.inspector, 'Delete').length, 1);
    assert.equal(buttons(ctx.inspector, 'Remove culture').length, 0);
});

test('the Names inspector has a back button that returns to the list', () => {
    const ctx = open(['names', cultureIds(namesOf(open().model))[1]]);
    press(ctx.inspector, '‹ Back to the list');
    assert.equal(ctx.selection.id, null);
});

test('places matched by a culture: a region is a case-insensitive substring of the place’s region text', () => {
    const model = openPack(JSON.stringify({ id: 'p', version: '1.0.0', name: 'P', content: { places: [{ name: 'A', region: 'The River Confederacy' }, { name: 'B', region: 'barrens' }, { name: 'C' }] } }));
    assert.equal(placeMatches(model, ['river confederacy']), 1);
    assert.equal(placeMatches(model, ['River', 'BARRENS']), 2);
    assert.equal(placeMatches(model, []), 0);
});

test('cast names are found by full name or first word, ignoring case; banned entries match whole', () => {
    const model = open().model;
    const cast = model.document.content.cast.map(person => person.name);
    assert.ok(cast.length > 0);
    const first = cast[0].split(/\s+/)[0];
    assert.deepEqual(castNameOverlap(model, [first.toUpperCase(), 'Zzzyx']), [first.toUpperCase()]);
    assert.equal(isBanned(['Elara', ' Vane '], 'elara'), true);
    assert.equal(isBanned(['Elara'], 'Elar'), false);
});

test('the preview is deterministic, leaves out cast and banned names, and is the whole pool when small', () => {
    const model = open().model;
    const names = namesOf(model);
    const id = cultureIds(names)[0];
    const a = pickSuggestions(model, names[id], 'Marrowbridge');
    assert.deepEqual(a, pickSuggestions(model, names[id], 'Marrowbridge'));
    assert.equal(a.length, 3);
    assert.deepEqual(castNameOverlap(model, a), []);
    assert.equal(a.some(name => isBanned(names.banned, name)), false);
    assert.deepEqual(pickSuggestions(model, { given: ['Ada', 'Bo'] }, 'x'), ['Ada', 'Bo']);
    assert.equal(cultureForPlace({ a: { regions: ['Fen'], given: ['x'] } }, 'The fen road'), 'a');
    assert.equal(cultureForPlace({ a: { regions: ['Fen'], given: ['x'] } }, 'Hills'), null);
});

test('the screen lists the never-use card and a card per culture, and opens the editor on a click', () => {
    const ctx = open();
    const ids = cultureIds(namesOf(ctx.model));
    assert.equal(ctx.main.querySelector('h1').textContent, 'Names');
    assert.equal(ctx.main.querySelectorAll('button.names-card').length, ids.length + 1);
    ctx.select('names', ids[1]);
    assert.equal(ctx.inspector.querySelector('h2').textContent, prettyId(ids[1]));
    assert.equal(input(ctx.inspector, 'Culture id').value, ids[1]);
    ctx.select('names', '__banned');
    assert.equal(ctx.inspector.querySelector('h2').textContent, 'Never use');
});

test('add a culture, then a region and a name to it, remove them again: every step passes the checker, one undo per step', () => {
    const ctx = open();
    const before = exportPack(ctx.model);
    const count = cultureIds(namesOf(ctx.model)).length;
    press(ctx.main, '+ Culture');
    ok(ctx);
    const id = ctx.selection.id;
    assert.equal(cultureIds(namesOf(ctx.model)).length, count + 1);
    type(ctx.inspector, 'Add region', 'Saltmarsh');
    type(ctx.inspector, 'Add given names', 'Odo, Brann , odo');
    ok(ctx);
    assert.deepEqual(namesOf(ctx.model)[id], { regions: ['New region', 'Saltmarsh'], given: ['Name', 'Odo', 'Brann'] });
    press(ctx.inspector, 'Remove Name');
    press(ctx.inspector, 'Remove New region');
    ok(ctx);
    assert.deepEqual(namesOf(ctx.model)[id], { regions: ['Saltmarsh'], given: ['Odo', 'Brann'] });
    press(ctx.inspector, 'Delete');
    ok(ctx);
    assert.equal(cultureIds(namesOf(ctx.model)).length, count);
    for (let i = 0; i < 6; i++) { ctx.history.undo(); }
    ctx.render();
    assert.equal(exportPack(ctx.model), before);
});

test('the last region and the last given name of a culture cannot be removed (the checker wants one of each)', () => {
    const ctx = open();
    press(ctx.main, '+ Culture');
    press(ctx.inspector, 'Remove New region');
    press(ctx.inspector, 'Remove Name');
    assert.equal(ctx.notifications.length, 2);
    ok(ctx);
});

test('never-use names: add several at once, refuse one that is too long, remove one', () => {
    const ctx = open(['names', '__banned']);
    const n = namesOf(ctx.model).banned.length;
    type(ctx.inspector, 'Names never to use', 'Zed, Quill');
    ok(ctx);
    assert.equal(namesOf(ctx.model).banned.length, n + 2);
    type(ctx.inspector, 'Names never to use', 'x'.repeat(SB.bannedName + 1));
    assert.equal(namesOf(ctx.model).banned.length, n + 2);
    assert.equal(ctx.notifications.length, 1);
    press(ctx.inspector, 'Remove Zed');
    ok(ctx);
    assert.equal(namesOf(ctx.model).banned.includes('Zed'), false);
});

test('renaming a culture id keeps its place in the order; a taken id is refused', () => {
    const ctx = open();
    const ids = cultureIds(namesOf(ctx.model));
    ctx.select('names', ids[1]);
    const field = input(ctx.inspector, 'Culture id');
    field.value = ids[0];
    field.dispatchEvent({ type: 'change' });
    assert.equal(ctx.notifications.length, 1);
    field.value = 'renamed';
    field.dispatchEvent({ type: 'change' });
    ok(ctx);
    const after = cultureIds(namesOf(ctx.model));
    assert.equal(after[1], 'renamed');
    assert.equal(after.length, ids.length);
});

test('a names problem from the checker is shown in the drawer path and leads to the culture', () => {
    const ctx = open();
    const id = cultureIds(namesOf(ctx.model))[2];
    goToProblem(ctx, { path: `content.names.${id}.given`, message: 'x' });
    assert.equal(ctx.selection.kind, 'names');
    assert.equal(ctx.selection.id, id);
    goToProblem(ctx, { path: 'content.names.banned', message: 'x' });
    assert.equal(ctx.selection.id, '__banned');
});

test('Ersveil’s names export unchanged after an edit and its undo', () => {
    const ctx = open();
    const text = exportPack(ctx.model);
    ctx.select('names', cultureIds(namesOf(ctx.model))[0]);
    type(ctx.inspector, 'Add given names', 'Newname');
    ok(ctx);
    ctx.history.undo();
    ctx.render();
    assert.equal(exportPack(ctx.model), text);
});
