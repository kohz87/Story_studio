import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, withPortraits } from '../src/model.js';
import { namedPortraits } from '../src/cast/data.js';
import { worldInfo } from '../src/lorebook.js';
import { exportCardPng, readCardPng, pngChunks, crc32 } from '../src/card-png.js';
import { writeDraft, readDraft } from '../src/session.js';
import { emptyCard, buildCard, cardSizes, readCard, shrinkPortraits, sanitizeCard, settingRowValid, settingValues, PARTS, PORTRAIT_ENTRY_LIMITS, STATUS_BAR, SETTING_ROWS } from '../src/card.js';
import { pngBytes } from './helpers/images.js';
import { castPack } from './fixtures/cast.js';

const model = openPack(castPack({ cast: JSON.parse(readFileSync(new URL('./fixtures/ersveil-cast.json', import.meta.url), 'utf8')) }));
const names = namedPortraits(model);
const held = count => new Map(names.slice(0, count).map(name => [name, Object.freeze({ bytes: new Uint8Array(pngBytes(8, 8, 0)), type: 'png', width: 8, height: 8 })]));
const withHeld = count => withPortraits(model, held(count));
const small = async bytes => ({ bytes: new Uint8Array(bytes.slice(0, 30)), type: 'webp' });
const book = built => built.card.data.character_book?.entries ?? [];
const entryTagged = (built, tag) => book(built).filter(entry => entry.comment.startsWith(tag));

test('round trip: pick a card, download it, pick it again gives the same fields', () => {
    const card = emptyCard();
    Object.assign(card.fields, { name: 'Wren', first_mes: 'Hello “there”', creator: 'Me', character_version: '2' });
    card.greetings = ['One', 'Two'];
    card.tags = ['fantasy', 'rpg'];
    card.note = { prompt: 'Stay in voice', depth: 6, role: 'user' };
    card.talkativeness = '0.35';
    card.ownLore = [{ keys: ['moon'], content: 'The moon is cheese.', comment: 'Moon', enabled: true, insertion_order: 5, extensions: {} }];
    const first = buildCard(model, card);
    for (const bytes of [first.json, exportCardPng(first.json)]) {
        const read = readCard(typeof bytes === 'string' ? bytes : bytes);
        assert.deepEqual(read.card.fields, buildFields(first));
        assert.deepEqual(read.card.greetings, ['One', 'Two']);
        assert.deepEqual(read.card.tags, ['fantasy', 'rpg']);
        assert.deepEqual(read.card.note, { prompt: 'Stay in voice', depth: 6, role: 'user' });
        assert.equal(read.card.talkativeness, '0.35');
        assert.equal(read.card.ownLore.length, 1, 'Studio’s own entries do not come back as the card’s own lore');
        assert.equal(read.card.ownLore[0].content, 'The moon is cheese.');
        read.card.include = card.include;
        assert.equal(buildCard(model, read.card).json, first.json, 'the second download is the same card');
    }
});
function buildFields(built) {
    const data = built.card.data;
    return Object.fromEntries(['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version'].map(key => [key, data[key]]));
}

test('V1, V2 and V3 JSON are read, and a refused file says why', () => {
    assert.equal(readCard(JSON.stringify({ name: 'Old', description: 'd' })).card.fields.name, 'Old');
    const v3 = readCard(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Three', extensions: { talkativeness: '0.5', depth_prompt: { prompt: 'n', depth: 2, role: 'assistant' } } } }));
    assert.equal(v3.card.talkativeness, '0.5');
    assert.deepEqual(v3.card.note, { prompt: 'n', depth: 2, role: 'assistant' });
    assert.throws(() => readCard('{"spec":"other","data":{}}'), /not one Studio reads/);
    assert.throws(() => readCard('nope'), /not readable JSON/);
    assert.throws(() => readCard(exportCardPng('x').slice(0, 30)), /no card|PNG|JSON/);
});

test('the PNG carries the card as a chara chunk, deterministically, with the chosen picture', () => {
    const { json } = buildCard(model, emptyCard());
    const a = exportCardPng(json), b = exportCardPng(json);
    assert.deepEqual(a, b);
    const chara = pngChunks(a).filter(chunk => chunk.type === 'tEXt');
    assert.equal(chara.length, 1);
    assert.equal(Buffer.from(chara[0].data.subarray(6)).toString(), Buffer.from(json).toString('base64'));
    assert.equal(readCardPng(a), json);
    const picture = new Uint8Array(pngBytes(40, 60, 4));
    const withPicture = exportCardPng(json, picture);
    assert.deepEqual(withPicture, exportCardPng(json, picture));
    assert.equal(readCardPng(exportCardPng('{"name":"x"}', withPicture)), '{"name":"x"}', 'a card already in the picture is replaced, not doubled');
    assert.equal(pngChunks(exportCardPng('{}', withPicture)).filter(chunk => chunk.type === 'tEXt').length, 1);
    assert.ok(withPicture.length > pngBytes(40, 60, 4).length);
});

test('character_book entries: the three storysuite entries are disabled and tagged, the lore is enabled', async () => {
    const portraits = await shrinkPortraits(withHeld(2), small);
    const card = emptyCard();
    const built = buildCard(withHeld(2), card, { portraits });
    for (const tag of ['[storysuite:pack]', '[storysuite:portraits]', '[storysuite:settings]']) {
        const found = entryTagged(built, tag);
        assert.equal(found.length, 1, tag);
        assert.equal(found[0].enabled, false, `${tag} is disabled`);
    }
    const pack = JSON.parse(entryTagged(built, '[storysuite:pack]')[0].content);
    assert.equal(pack.id, model.document.id);
    const lore = book(built).filter(entry => !entry.comment.startsWith('[storysuite:'));
    const expected = Object.values(worldInfo(model.document).entries);
    assert.equal(lore.length, expected.length);
    assert.ok(lore.every(entry => entry.enabled === true));
    assert.deepEqual(lore.map(entry => [entry.keys, entry.comment, entry.content]), expected.map(entry => [entry.key, entry.comment, entry.content]));
    assert.deepEqual(book(built).map(entry => entry.id), book(built).map((_, at) => at));
});

test('the portraits entry: keyed by file name, with its limits', async () => {
    const held2 = withHeld(2);
    const portraits = await shrinkPortraits(held2, small);
    const entry = JSON.parse(entryTagged(buildCard(held2, emptyCard(), { portraits }), '[storysuite:portraits]')[0].content);
    assert.deepEqual(Object.keys(entry), ['v', 'pack', 'version', 'files']);
    assert.equal(entry.v, 1);
    assert.deepEqual(Object.keys(entry.files), names.slice(0, 2));
    assert.ok(Object.values(entry.files).every(uri => uri.startsWith('data:image/webp;base64,')));
    assert.deepEqual([PORTRAIT_ENTRY_LIMITS.files, PORTRAIT_ENTRY_LIMITS.fileBytes, PORTRAIT_ENTRY_LIMITS.totalBytes], [24, 200 * 1024, 3 * 1024 * 1024]);
    const big = size => async () => ({ bytes: new Uint8Array(size), type: 'webp' });
    const tooBig = await shrinkPortraits(held2, big(201 * 1024));
    assert.equal(tooBig.files.length, 0);
    assert.match(tooBig.lines[0], /over 200 KB/);
    const few = await shrinkPortraits(held2, small, { ...PORTRAIT_ENTRY_LIMITS, files: 1 });
    assert.equal(few.files.length, 1);
    assert.match(few.lines[0], /at most 1 portraits/);
    const together = await shrinkPortraits(held2, big(150 * 1024), { ...PORTRAIT_ENTRY_LIMITS, totalBytes: 200 * 1024 });
    assert.equal(together.files.length, 1);
    assert.match(together.lines[0], /together/);
    const refused = await shrinkPortraits(held2, async () => { throw new Error('cannot'); });
    assert.match(refused.lines[0], /cannot/);
    assert.equal(entryTagged(buildCard(held2, emptyCard(), { portraits: refused }), '[storysuite:portraits]').length, 0);
});

test('the shrink is injectable and is given each held picture', async () => {
    const seen = [];
    await shrinkPortraits(withHeld(3), async (bytes, name) => { seen.push(name); return { bytes: bytes.slice(0, 10), type: 'png' }; });
    assert.deepEqual(seen, names.slice(0, 3));
});

test('only ticked settings are written', () => {
    const card = emptyCard();
    for (const row of SETTING_ROWS) card.settings[row.id].on = false;
    assert.deepEqual(settingValues(card), {});
    assert.equal(entryTagged(buildCard(model, card), '[storysuite:settings]').length, 0, 'no ticked row, no entry');
    card.settings.xp = { on: true, value: 150 };
    card.settings.portraits = { on: true, value: 'hybrid' };
    const entry = JSON.parse(entryTagged(buildCard(model, card), '[storysuite:settings]')[0].content);
    assert.deepEqual(entry, { v: 1, settings: { 'story-block.rpgXpRate': 150, 'npc-state-delta.portraitPromptFormat': 'hybrid' } });
    card.settings.xp = { on: true, value: 301 };
    assert.deepEqual(settingValues(card), { 'npc-state-delta.portraitPromptFormat': 'hybrid' }, 'a value outside 50 to 300 is not written');
    card.include.settings = false;
    assert.equal(entryTagged(buildCard(model, card), '[storysuite:settings]').length, 0);
});

test('a picked card’s settings entry and status bar come back as ticks', () => {
    const card = emptyCard();
    card.include.statusBar = true;
    for (const row of SETTING_ROWS) card.settings[row.id].on = false;
    card.settings.scan = { on: true, value: 8 };
    const read = readCard(buildCard(model, card).json);
    assert.equal(read.card.include.statusBar, true);
    assert.deepEqual(settingValues(read.card), { 'npc-state-delta.scanEvery': 8 });
    assert.deepEqual(buildCard(model, card).card.data.extensions.regex_scripts, [STATUS_BAR]);
    assert.equal(buildCard(model, emptyCard()).card.data.extensions.regex_scripts, undefined);
});

test('sizes add up: the base and each part make the total, and the PNG holds the base64 and the picture', async () => {
    const portraits = await shrinkPortraits(withHeld(2), small);
    const card = emptyCard();
    card.include.statusBar = true;
    card.ownLore = [{ keys: ['a'], content: 'b', comment: 'c', enabled: true }];
    const picture = new Uint8Array(pngBytes(30, 30, 2));
    const sizes = cardSizes(withHeld(2), card, { portraits, image: picture });
    assert.deepEqual(sizes.parts, PARTS);
    assert.equal(sizes.base + Object.values(sizes.rows).reduce((a, b) => a + b, 0), sizes.total);
    assert.equal(sizes.total, Buffer.byteLength(buildCard(withHeld(2), card, { portraits }).json));
    assert.ok(Object.values(sizes.rows).every(bytes => bytes > 0));
    const built = buildCard(withHeld(2), card, { portraits });
    assert.equal(sizes.rows.lore, built.entries.lore.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)) + 1, 0), 'a row is its entries as they sit in the card');
    assert.equal(sizes.rows.portraits, Buffer.byteLength(JSON.stringify(built.entries.portraits[0])) + 1);
    assert.equal(sizes.png, exportCardPng(buildCard(withHeld(2), card, { portraits }).json, picture).length);
    assert.ok(sizes.png > Math.ceil(sizes.total / 3) * 4 + picture.length);
});

test('blank names and a bad talkativeness refuse the card', () => {
    const card = emptyCard();
    card.fields.name = '  ';
    assert.throws(() => buildCard(model, card), /Card name must not be empty/);
    card.fields.name = 'Ok';
    card.talkativeness = '2';
    assert.throws(() => buildCard(model, card), /Talkativeness/);
});

test('the project save no longer holds the card draft, so its size can never stop the pack from saving', () => {
    const store = new Map();
    const win = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) } };
    assert.equal(writeDraft(win, model, false), true);
    assert.equal(readDraft(win).model.document.id, model.document.id);
    assert.equal(store.get('story-studio-draft').includes('"card"'), false);
    assert.deepEqual(sanitizeCard({ fields: { name: 5 }, talkativeness: 3, settings: { xp: { on: 'x', value: 'y' } } }), emptyCard());
});

test('a picked card’s linked world and favourite mark are not carried; a built card with a book has no linked world', () => {
    const read = readCard(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Old', extensions: { world: 'Old World', fav: true, keep: 1 } } }));
    assert.deepEqual(read.card.extras, { keep: 1 });
    const card = emptyCard();
    card.extras = { world: 'Linked', fav: true, keep: 1 };
    assert.equal(buildCard(model, card).card.data.extensions.world, undefined, 'the embedded book wins');
    assert.equal(buildCard(model, card).card.data.extensions.keep, 1);
    assert.deepEqual(sanitizeCard({ extras: { world: 'x', fav: true, a: 1 } }).extras, { a: 1 });
});

test('a ccv3 chunk that will not decode falls back to the chara chunk', () => {
    const png = exportCardPng('{"name":"Fallback"}');
    const text = new TextEncoder().encode('ccv3\0@@not base64@@');
    const withBad = insertText(png, text);
    assert.equal(readCardPng(withBad), '{"name":"Fallback"}');
});
function insertText(png, data) {
    const out = [];
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let at = 8;
    out.push(png.subarray(0, 8));
    while (at < png.length) {
        const length = view.getUint32(at);
        const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
        if (type === 'IEND') {
            const body = new Uint8Array(4 + data.length);
            body.set(new TextEncoder().encode('tEXt')); body.set(data, 4);
            const head = new Uint8Array(4); new DataView(head.buffer).setUint32(0, data.length);
            const tail = new Uint8Array(4); new DataView(tail.buffer).setUint32(0, crc32(body));
            out.push(head, body, tail);
        }
        out.push(png.subarray(at, at + 12 + length));
        at += 12 + length;
    }
    return Uint8Array.from(out.flatMap(part => [...part]));
}

test('the XP rate is a step of 25 from 50 to 300, and a picked card’s other value is named, not dropped silently', () => {
    const row = SETTING_ROWS.find(item => item.id === 'xp');
    assert.equal(row.step, 25);
    for (const value of [50, 125, 300]) assert.equal(settingRowValid(row, value), true, String(value));
    for (const value of [49, 120, 301, 100.5, '100']) assert.equal(settingRowValid(row, value), false, String(value));
    const entry = value => JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'X', character_book: { entries: [
        { keys: [], comment: '[storysuite:settings] X', enabled: false, content: JSON.stringify({ v: 1, settings: { 'story-block.rpgXpRate': value, 'story-block.rpg': true } }) }] } } });
    const read = readCard(entry(120));
    assert.deepEqual(read.notes, ['XP rate 120% is not a step of 25; left out']);
    assert.deepEqual(settingValues(read.card), { 'story-block.rpg': true });
    assert.deepEqual(readCard(entry(150)).notes, []);
});

test('the card picture: a PNG is kept, JPEG and WebP go through the browser tool, anything else is refused', async () => {
    const { cardImageFrom } = await import('../src/card-image.js');
    const png = new Uint8Array(pngBytes(30, 40, 2));
    const calls = [];
    const tools = { toPng: async bytes => { calls.push(bytes.length); return png; } };
    assert.deepEqual(await cardImageFrom(png, tools), png);
    assert.deepEqual(calls, []);
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
    assert.deepEqual(await cardImageFrom(jpeg, tools), png);
    assert.deepEqual(calls, [jpeg.length]);
    await assert.rejects(() => cardImageFrom(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13), tools), /PNG, JPEG or WebP/);
    await assert.rejects(() => cardImageFrom(new Uint8Array(0), tools), /empty/);
});

test('the portraits entry carries the pack’s current version, not the one of an earlier build', async () => {
    const held2 = withHeld(2);
    const portraits = await shrinkPortraits(held2, small);
    const version = built => JSON.parse(entryTagged(built, '[storysuite:portraits]')[0].content).version;
    assert.equal(version(buildCard(held2, emptyCard(), { portraits })), model.document.version);
    const bumped = withPortraits(openPack({ ...structuredClone(model.document), version: '9.9.9' }), held(2));
    const after = buildCard(bumped, emptyCard(), { portraits });
    assert.equal(version(after), '9.9.9');
    const entry = JSON.parse(entryTagged(after, '[storysuite:portraits]')[0].content);
    assert.equal(entry.pack, model.document.id);
    assert.deepEqual(Object.keys(entry.files), names.slice(0, 2));
});
