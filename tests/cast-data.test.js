import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack } from '../src/model.js';
import { add } from '../src/edits.js';
import { withPortraits } from '../src/model.js';
import {
    CAST_LIMITS, cardTags, castCheck, freshId, idForName, knownPlace, metersOf, newPerson, opensAtStart, playerView, portraitSignature,
    presetChoices, problemsAt, zipListing, zipPortraits,
} from '../src/cast/data.js';
import { fitPortrait, imageSize, kb, pictureUrl, portraitFileName } from '../src/cast/portrait.js';
import { castEntries, castPack } from './fixtures/cast.js';
import { pngBytes, webpBytes } from './helpers/images.js';

const picture = (bytes = webpBytes(), type = 'webp') => Object.freeze({ bytes, type, width: 48, height: 60 });
const held = (model, ...names) => withPortraits(model, names.map(name => [name, picture()]));

test('the fixture cast is accepted by Story Block’s checker, and a new person is too', () => {
    const model = openPack(castPack());
    assert.deepEqual(model.validation.errors, []);
    const made = add(model, 'cast', newPerson(model));
    assert.equal(made.ok, true, JSON.stringify(made.errors));
    assert.deepEqual(made.model.validation.errors, []);
});

test('a new person has an ID no one has, and a name gives an ID only when it is free', () => {
    const model = openPack(castPack());
    const one = add(model, 'cast', newPerson(model)).model;
    const two = add(one, 'cast', newPerson(one)).model;
    assert.deepEqual(two.document.content.cast.slice(2).map(person => person.id), ['new-person', 'new-person-2']);
    assert.equal(freshId(two), 'new-person-3');
    assert.equal(idForName(model, 'Old Marta', 'new-person'), 'old-marta');
    assert.equal(idForName(model, 'Fenna', 'new-person'), '');
    assert.equal(idForName(model, 'Fenna', 'fenna'), 'fenna');
    assert.equal(idForName(model, '???', 'x'), '');
});

test('a new person starts at the pack’s first place, or at a placeholder when it has none', () => {
    assert.equal(newPerson(openPack(castPack())).start.place, 'Haven');
    assert.equal(newPerson(openPack(castPack({ places: [] }))).start.place, '[PLACE]');
});

test('the problems under a path are Story Block’s own messages, found by the path they name', () => {
    const cast = castEntries();
    cast[0].look = 'a <b>tag</b>';
    cast[1].secrets = [{ title: 'x', text: 'y' }];
    const model = openPack(castPack({ cast }));
    assert.equal(model.validation.ok, false);
    assert.match(problemsAt(model, ['content', 'cast', 0, 'look']).join(' '), /plain text/);
    assert.match(problemsAt(model, ['content', 'cast', 1, 'secrets', 0]).join(' '), /meter.*or by a story event/);
    assert.deepEqual(problemsAt(model, ['content', 'cast', 0, 'voice']), []);
    assert.ok(problemsAt(model, ['content', 'cast', 0]).length >= 1);
});

test('the meters a person has: Delta’s four, a pack preset’s, a built-in preset’s, and any other id the entry already uses', () => {
    const cast = castEntries();
    cast[0].meters = { preset: 'regard', trust: 10 };
    const pack = castPack({ cast });
    pack.content.meterPresets = [{ id: 'regard', title: 'Regard', meters: [{ id: 'esteem', name: 'Esteem', min: 0, max: 100, start: 0 }] }];
    const model = openPack(pack);
    assert.deepEqual(metersOf(model, model.document.content.cast[0]).map(meter => meter.id), ['trust', 'affection', 'desire', 'tension', 'esteem']);
    assert.deepEqual(presetChoices(model).map(choice => [choice.id, choice.own]), [['regard', true], ['companion', false], ['rival', false], ['mentor', false]]);
    const plain = openPack(castPack());
    assert.deepEqual(metersOf(plain, plain.document.content.cast[0]).map(meter => meter.id), ['trust', 'affection', 'desire', 'tension', 'loyalty']);
    assert.deepEqual(metersOf(plain, { }, true).map(meter => meter.id), ['trust', 'affection', 'desire', 'tension', 'loyalty', 'respect', 'rivalry', 'approval']);
    const odd = { meters: { grit: 5 }, stages: [{ id: 's', name: 'S', needs: [{ meter: 'nerve', at: 1 }] }], secrets: [{ title: 'a', text: 'b', meter: 'wit', at: 3 }] };
    assert.deepEqual(metersOf(plain, odd).slice(4).map(meter => meter.id), ['grit', 'nerve', 'wit']);
});

test('the player view opens a secret the starting value already reaches and hides the rest, never showing an event’s words', () => {
    const model = openPack(castPack());
    const fenna = model.document.content.cast[0];
    const view = playerView(model, fenna);
    assert.deepEqual(view, [{ open: false, rule: 'Opens at Trust 20' }, { open: false, rule: 'Opens at Trust 60' }, { open: false, rule: 'Opens with the story' }]);
    assert.doesNotMatch(JSON.stringify(view), /ledger/);
    const open = playerView(model, { ...fenna, meters: { trust: 25 } });
    assert.deepEqual(open[0], { open: true, title: 'Her husband’s debt', rule: 'Opened · Trust 20', text: 'He owed the smugglers.' });
    assert.equal(open[1].open, false);
    assert.equal(opensAtStart({ meters: { trust: -30 } }, { meter: 'trust', at: -20 }), true);
    assert.equal(opensAtStart({}, { when: 'x' }), false);
    assert.equal(opensAtStart({}, { meter: 'trust', at: 0 }), true);
});

test('the list tags say secrets, drawn to and the portrait’s size', () => {
    const model = held(openPack(castPack()), 'fenna.webp');
    const [fenna, sera] = model.document.content.cast;
    assert.deepEqual(cardTags(model, fenna), ['3 secrets', 'drawn to 2', `portrait ${kb(webpBytes().length)} KB`]);
    assert.deepEqual(cardTags(model, sera), []);
    assert.deepEqual(cardTags(openPack(castPack()), fenna), ['3 secrets', 'drawn to 2', 'portrait missing']);
});

test('a place is known by its name, slug or alias, in any case', () => {
    const model = openPack(castPack({ places: [{ slug: 'haven', name: 'Haven', aliases: ['The Quay'], x: 0, y: 0 }] }));
    for (const text of ['Haven', 'haven', 'HAVEN', 'the quay']) assert.equal(knownPlace(model, text), true, text);
    assert.equal(knownPlace(model, 'Mill'), false);
});

test('the cast check says what is fine, and warns about what only the author can judge', () => {
    assert.deepEqual(castCheck(openPack(castPack({ cast: [] }))), []);
    const lines = castCheck(openPack(castPack()));
    assert.deepEqual(lines.filter(line => line.level === 'ok').map(line => line.text), [
        'Cast: 2 people, all fields within limits.', 'Starting places exist in this pack.', 'Secrets: 3, each opens at a meter or on a story event.',
    ]);
    const warns = lines.filter(line => line.level === 'warn').map(line => line.text);
    assert.equal(warns.length, 2);
    assert.match(warns[0], /Fenna names the portrait fenna\.webp, but no picture is held/);
    assert.equal(warns[1], 'Sera has no voice written — the narrator will invent one at the first meeting.');
});

test('the cast check reports portraits held, pictures nobody names, a missing place and Story Block’s problems', () => {
    const cast = castEntries();
    cast[1].start.place = 'Nowhere';
    cast[0].look = '<';
    const model = held(openPack(castPack({ cast })), 'fenna.webp', 'stray.webp');
    const lines = castCheck(model);
    assert.equal(lines[0].level, 'bad');
    assert.match(lines[0].text, /^Cast: 1 problem in 2 people/);
    assert.ok(lines.some(line => line.level === 'ok' && /^Portraits: 1 file, \d+ KB together \(each under 64 KB\)\.$/.test(line.text)));
    assert.ok(lines.some(line => line.level === 'warn' && /A picture is held that no one names \(stray\.webp\)/.test(line.text)));
    assert.ok(lines.some(line => line.level === 'warn' && /Sera starts at "Nowhere"/.test(line.text)));
    const none = castCheck(openPack(castPack({ places: [], cast: [castEntries()[1]] })));
    assert.ok(none.some(line => /no places/.test(line.text)));
});

test('a picture over 64 KB, or more files than a pack may name, is a problem in the check', () => {
    const big = withPortraits(openPack(castPack()), [['fenna.webp', picture(new Uint8Array(70 * 1024).fill(1))]]);
    assert.ok(castCheck(big).some(line => line.level === 'bad' && /fenna\.webp is over 64 KB/.test(line.text)));
    const cast = Array.from({ length: 33 }, (_, n) => ({ ...castEntries()[1], id: `p${n}`, name: `P${n}`, portrait: `p${n}.webp` }));
    const many = openPack(castPack({ cast }));
    assert.ok(castCheck(many).some(line => line.level === 'bad' && /33 files named; a pack may name at most 32/.test(line.text)));
});

test('the zip holds the pictures the cast names that are held, in cast order; the rest are listed as missing or unused', () => {
    const model = held(openPack(castPack({ cast: [{ ...castEntries()[0], portrait: 'b.webp' }, { ...castEntries()[1], portrait: 'a.webp' }] })), 'a.webp', 'b.webp', 'c.webp');
    const { files, missing, unused } = zipPortraits(model);
    assert.deepEqual(files.map(file => file.name), ['b.webp', 'a.webp']);
    assert.deepEqual(unused, ['c.webp']);
    assert.deepEqual(missing, []);
    const listing = zipListing(model, 2048, 'fixture-2.0.0');
    assert.equal(listing.name, 'fixture-2.0.0.zip');
    assert.deepEqual(listing.rows.map(row => row[0]), ['pack.json', 'portraits/b.webp', 'portraits/a.webp']);
});

test('the signature of the held pictures changes with a name, a picture or a removal', () => {
    const base = openPack(castPack());
    assert.equal(portraitSignature(base), '');
    const one = withPortraits(base, [['a.webp', picture(webpBytes(48, 60, 40))]]);
    const same = withPortraits(base, [['a.webp', picture(webpBytes(48, 60, 40))]]);
    const other = withPortraits(base, [['a.webp', picture(webpBytes(48, 60, 41))]]);
    assert.equal(portraitSignature(one), portraitSignature(same));
    assert.notEqual(portraitSignature(one), portraitSignature(other));
    assert.notEqual(portraitSignature(one), portraitSignature(withPortraits(base, [['b.webp', picture(webpBytes(48, 60, 40))]])));
});

test('portrait file names follow Story Block’s rule and never collide', () => {
    assert.equal(portraitFileName('fenna', 'webp'), 'fenna.webp');
    assert.equal(portraitFileName('fenna', 'jpg'), 'fenna.jpg');
    assert.equal(portraitFileName('fenna', 'webp', new Set(['fenna.webp'])), 'fenna-2.webp');
    assert.match(portraitFileName('x'.repeat(200), 'png'), /^x{50}\.png$/);
    assert.equal(portraitFileName('', 'webp'), 'portrait.webp');
    assert.equal(portraitFileName('-élan vital', 'webp'), 'lan-vital.webp');
});

test('a picture that already fits is kept as it is; a big one is tried at fewer bytes, then fewer pixels, until it fits', async () => {
    const small = webpBytes(300, 400, 2000);
    const kept = await fitPortrait(small, { size: async () => ({ width: 300, height: 400 }), encode: async () => { throw new Error('not called'); } });
    assert.equal(kept.changed, false);
    assert.equal(kept.bytes, small);
    const calls = [];
    const big = pngBytes(8, 8, 0);
    const io = {
        size: async () => ({ width: 1200, height: 1500 }),
        encode: async (side, quality) => { calls.push([side, quality]); return { bytes: new Uint8Array(side * 500 * quality), type: 'webp', width: side, height: side }; },
    };
    const fit = await fitPortrait(big, io, { maxBytes: 64 * 1024 });
    assert.equal(fit.changed, true);
    assert.ok(fit.bytes.length <= 64 * 1024);
    assert.deepEqual(calls[0], [600, 0.85]);
    assert.ok(calls.length > 5);
    assert.ok(calls.every(([side]) => side <= 600));
    // Qualities come down before the pixels do.
    assert.deepEqual(calls.slice(0, 5).map(call => call[1]), [0.85, 0.7, 0.55, 0.4, 0.3]);
});

test('a picture too large at any size is refused in plain words, and so is an empty file', async () => {
    const io = { size: async () => ({ width: 1000, height: 1000 }), encode: async side => ({ bytes: new Uint8Array(1e6), type: 'webp', width: side, height: side }) };
    await assert.rejects(fitPortrait(pngBytes(8, 8, 0), io), /cannot be made small enough: portraits are at most 64 KB/);
    await assert.rejects(fitPortrait(new Uint8Array(0), io), /empty/);
});

test('picture sizes are read from the headers of PNG, WebP (lossy) and JPEG', () => {
    assert.deepEqual(imageSize(pngBytes(12, 34, 0)), { width: 12, height: 34 });
    assert.deepEqual(imageSize(webpBytes(48, 60)), { width: 48, height: 60 });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 70, 0, 50, 3, 1, 0x22, 0, 0xff, 0xd9]);
    assert.deepEqual(imageSize(jpeg), { width: 50, height: 70 });
    assert.equal(imageSize(new Uint8Array(40)), null);
});

test('a held picture is shown by a data: address of its type', () => {
    assert.match(pictureUrl(picture(webpBytes(), 'webp')), /^data:image\/webp;base64,UklGR/);
    assert.match(pictureUrl(picture(pngBytes(4, 4, 0), 'png')), /^data:image\/png;base64,iVBOR/);
    assert.equal(pictureUrl(null), '');
});

test('every limit the form shows is Story Block’s', () => {
    assert.equal(CAST_LIMITS.secrets, 8);
    assert.equal(CAST_LIMITS.look, 600);
});
