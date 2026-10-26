import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { openPack, exportPack } from '../src/model.js';
import { narratorCard, narratorFields, exportNarrator, CHANGE_GRAMMAR } from '../src/narrator.js';
import { exportCardPng } from '../src/card-png.js';
import { worldInfo, exportWorldInfo, importWorldInfo, acceptLoreDraft, MAX_LORE_BYTES } from '../src/lorebook.js';

const fixture = readFileSync(new URL('./fixtures/ersveil-bluewatch.json', import.meta.url), 'utf8');
const model = openPack(fixture);
const pack = model.document;
const golden = name => readFileSync(new URL(`./golden/${name}.json`, import.meta.url), 'utf8');
const ordinary = () => openPack({ id: 'local', version: '1.0.0', name: 'Local', requires: { storyBlock: '^2' }, content: {} });
const source = entries => JSON.stringify({ entries });
const draft = (changes = {}) => ({ kind: 'places', name: 'New Port', slug: 'new-port', aliases: ['Port'], region: 'Coast', content: 'A quiet port.', ...changes });

test('Ersveil narrator is the golden V2 JSON with every mandatory field', () => {
    const output = exportNarrator(pack);
    assert.equal(output, golden('ersveil-narrator'));
    assert.equal(exportNarrator(pack), output);
    const card = JSON.parse(output);
    assert.equal(card.spec, 'chara_card_v2');
    assert.equal(card.spec_version, '2.0');
    for (const key of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version']) assert.equal(typeof card.data[key], 'string', key);
    assert.deepEqual(card.data.alternate_greetings, []);
    assert.deepEqual(card.data.tags, []);
    assert.deepEqual(card.data.extensions, {});
    assert.match(card.data.first_mes, /^You are at Bluewatch Village, River Confederacy\./);
    assert.match(card.data.first_mes, /611 Goldwane 12 06:40 CY/);
    assert.ok(card.data.description.includes(CHANGE_GRAMMAR));
});

test('narrator overrides are explicit, empty text survives, and metadata is never mutated', () => {
    const card = narratorCard(pack, { name: 'My narrator', first_mes: 'At Bluewatch Village.', personality: 'Quiet tension', creator_notes: '', extensions: { ignored: true } });
    assert.equal(card.data.name, 'My narrator');
    assert.equal(card.data.personality, 'Quiet tension');
    assert.equal(card.data.creator_notes, '');
    assert.deepEqual(card.data.extensions, {});
    assert.equal(exportPack(model), fixture);
    assert.throws(() => narratorCard(pack, { name: 42 }), /must be text/);
    assert.throws(() => narratorCard(null), /Open a pack/);
});

test('narrator supports missing metadata without inventing a place, clock or tone', () => {
    const fields = narratorFields({ name: 'Empty' });
    assert.equal(fields.personality, '');
    assert.equal(fields.scenario, '');
    assert.match(fields.first_mes, /Choose a starting place/);
    assert.equal(narratorFields({ toneNotes: 'A measured pace' }).personality, 'A measured pace');
});

for (const format of ['JSON', 'PNG']) {
    test(`narrator ${format} export refuses empty and whitespace-only names`, () => {
        const output = name => {
            const json = exportNarrator(pack, { name });
            return format === 'PNG' ? exportCardPng(json) : json;
        };
        for (const name of ['', ' ', '\t\r\n', '\u00a0\u2003']) {
            assert.throws(() => output(name), /Card name must not be empty/);
        }
        assert.ok(output('Narrator'));
        assert.equal(narratorCard(pack, { name: '  Narrator  ' }).data.name, '  Narrator  ');
        assert.equal(exportPack(model), fixture);
    });
}

function crc32(data) {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunks(png) {
    const buffer = Buffer.from(png);
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = [];
    let at = 8;
    while (at < buffer.length) {
        const length = buffer.readUInt32BE(at);
        const body = buffer.subarray(at + 4, at + 8 + length);
        assert.equal(crc32(body), buffer.readUInt32BE(at + 8 + length), 'valid chunk CRC');
        chunks.push({ type: body.subarray(0, 4).toString('ascii'), data: body.subarray(4) });
        at += length + 12;
    }
    assert.equal(at, buffer.length);
    return chunks;
}

test('card PNG is deterministic, decodable RGB with exactly one chara tEXt chunk', () => {
    const json = exportNarrator(pack);
    const png = exportCardPng(json);
    assert.deepEqual(exportCardPng(json), png);
    const chunks = pngChunks(png);
    assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'tEXt', 'IEND']);
    const header = chunks[0].data;
    assert.equal(header.readUInt32BE(0), 128);
    assert.equal(header.readUInt32BE(4), 192);
    assert.deepEqual([...header.subarray(8)], [8, 2, 0, 0, 0]);
    const pixels = inflateSync(chunks[1].data);
    assert.equal(pixels.length, 192 * (1 + 128 * 3));
    for (let row = 0; row < 192; row++) assert.equal(pixels[row * 385], 0, 'unfiltered scanline');
    assert.equal(chunks[2].data.subarray(0, 6).toString(), 'chara\0');
    assert.equal(Buffer.from(chunks[2].data.subarray(6).toString(), 'base64').toString('utf8'), json);
});

test('PNG metadata preserves non-ASCII and large edited descriptions without argument limits', () => {
    const json = exportNarrator(pack, { name: '港 ✨', description: 'é'.repeat(80000) });
    const chunk = pngChunks(exportCardPng(json)).find(chunk => chunk.type === 'tEXt');
    assert.equal(Buffer.from(chunk.data.subarray(6).toString(), 'base64').toString('utf8'), json);
});

test('Ersveil World Info is golden, one entry per local record, in authored order', () => {
    const output = exportWorldInfo(pack);
    assert.equal(output, golden('ersveil-world-info'));
    assert.equal(exportWorldInfo(pack), output);
    const entries = Object.values(JSON.parse(output).entries);
    assert.equal(entries.length, pack.content.places.length + pack.content.creatures.length + pack.content.items.length);
    assert.equal(entries[0].comment, pack.content.places[0].name);
    assert.match(entries[0].content, /region: River Confederacy: core cities/);
    const cane = entries.find(entry => entry.comment === 'Cane-Blade');
    assert.deepEqual(cane.key, [pack.content.items[0].name, ...pack.content.items[0].aliases]);
    for (const entry of entries) {
        assert.equal(entry.order, 100);
        assert.equal(entry.position, 0);
        assert.equal(entry.probability, 100);
        assert.equal(entry.constant, false);
        assert.equal(entry.disable, false);
        assert.equal(entry.preventRecursion, true);
    }
});

test('lore includes factions, NPCs, nested text and aliases only from the supplied draft', () => {
    const book = worldInfo({ content: {
        places: [{ name: 'Pier', aliases: ['Dock', 'Pier', 'Dock'], region: 'Coast', note: 'Wet wood', x: 7 }],
        factions: [{ name: 'Watch', description: 'Keepers', goals: ['Guard'] }],
        npcs: [{ name: 'Fenna', aliases: ['Clerk'], biography: { appearance: 'Ink-stained' } }],
        creatures: [{ name: 'Rat', loreTags: ['vermin'], stats: { STR: 3 } }],
        items: [{ name: 'Key', note: 'Opens a door', effect: { note: 'Turns once' } }],
        quests: [{ name: 'Outside this export', giver: 'np_external' }],
    } });
    const entries = Object.values(book.entries);
    assert.deepEqual(entries.map(entry => entry.comment), ['Pier', 'Watch', 'Fenna', 'Rat', 'Key']);
    assert.deepEqual(entries[0].key, ['Pier', 'Dock']);
    assert.match(entries[0].content, /region: Coast/);
    assert.match(entries[1].content, /description: Keepers/);
    assert.match(entries[2].content, /biography.appearance: Ink-stained/);
    assert.match(entries[4].content, /effect.note: Turns once/);
    assert.doesNotMatch(JSON.stringify(book), /np_external|Outside this export|"x"|STR/);
});

test('lore export refuses malformed records visibly rather than silently dropping them', () => {
    assert.throws(() => worldInfo({ content: { items: {} } }), /collection must be an array/);
    assert.throws(() => worldInfo({ content: { items: [null] } }), /record must be an object/);
    assert.throws(() => worldInfo({ content: { places: [{}] } }), /record needs a name/);
    assert.deepEqual(worldInfo({}), { entries: {} });
});

test('World Info import creates pending drafts without changing any pack', () => {
    const original = exportPack(model);
    const queue = importWorldInfo('\uFEFF' + source({ 7: { key: ['New Port', 'Port'], comment: 'A place', content: 'region: Coast\nWet docks.' } }));
    assert.equal(queue.length, 1);
    assert.equal(queue[0].status, 'pending');
    assert.deepEqual(queue[0].draft, draft({ content: 'region: Coast\nWet docks.' }));
    assert.equal(exportPack(model), original);
});

test('entry arrays and exported source kinds propose place, NPC and item drafts', () => {
    const queue = importWorldInfo(source(['places', 'npcs', 'creatures', 'items', 'factions'].map(kind => ({ key: [kind], content: 'Text', extensions: { story_studio: { kind } } }))));
    assert.deepEqual(queue.map(entry => entry.draft.kind), ['places', 'creatures', 'creatures', 'items', 'places']);
    assert.deepEqual(queue.map(entry => entry.status), Array(5).fill('pending'));
});

test('malformed entries each retain a visible refusal, and valid neighbors remain reviewable', () => {
    const queue = importWorldInfo(source({ 0: null, 1: { key: [8], content: false }, 2: { key: ['OK'], content: 'Text' } }));
    assert.deepEqual(queue.map(entry => entry.status), ['refused', 'refused', 'pending']);
    assert.match(queue[0].errors.join(' '), /object/);
    assert.match(queue[1].errors.join(' '), /array of text/);
    assert.deepEqual(queue[2].errors, []);
});

test('import refuses malformed, oversized and unsafe files before any edit', () => {
    for (const input of ['{', 'null', '[]', '{}', '{"entries":true}']) assert.throws(() => importWorldInfo(input));
    assert.throws(() => importWorldInfo(' '.repeat(MAX_LORE_BYTES + 1)), /2 MiB/);
    assert.throws(() => importWorldInfo('é'.repeat(MAX_LORE_BYTES / 2 + 1)), /2 MiB/);
    assert.throws(() => importWorldInfo(source(Array(1001).fill({ key: ['A'], content: '' }))), /1000 entries/);
    assert.throws(() => importWorldInfo('{"entries":{"__proto__":{}}}'), /Unsafe key/);
    assert.throws(() => importWorldInfo('{"entries":{"0":{"key":["A"],"content":"","extra":{"constructor":{}}}}}'), /Unsafe key/);
    assert.equal({}.polluted, undefined);
});

test('accept adds an undoable new place, preserving aliases, text and region', () => {
    const before = ordinary();
    const result = acceptLoreDraft(before, draft());
    assert.equal(result.ok, true);
    assert.equal(result.model.validation.ok, true, JSON.stringify(result.model.validation.errors));
    const record = result.model.document.content.places[0];
    assert.deepEqual(record, { name: 'New Port', slug: 'new-port', aliases: ['Port'], region: 'Coast', note: 'A quiet port.', x: 0, y: 0 });
    assert.equal(result.undo(), before);
    assert.equal(before.document.content.places, undefined);
});

test('accept never merges duplicate IDs and preserves the original snapshot on refusal', () => {
    const first = acceptLoreDraft(ordinary(), draft());
    const duplicate = acceptLoreDraft(first.model, draft({ content: 'Overwrite attempt' }));
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.model, first.model);
    assert.equal(duplicate.errors[0].code, 'dup-id');
    assert.equal(first.model.document.content.places[0].note, 'A quiet port.');
});

test('draft IDs use host slug spelling, including diacritics and records with omitted slugs', () => {
    const queue = importWorldInfo(source([{ key: ['Café Port'], content: 'Quiet docks.' }]));
    assert.equal(queue[0].draft.slug, 'cafe-port');
    const before = openPack({ id: 'local', version: '1.0.0', name: 'Local', requires: { storyBlock: '^2' }, content: {
        places: [{ name: 'Café Port', x: 0, y: 0 }],
    } });
    assert.equal(before.validation.ok, true);
    const result = acceptLoreDraft(before, queue[0].draft);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'dup-id');
    assert.equal(result.model, before);
});

test('accept item and NPC drafts without invented combat details', () => {
    const item = acceptLoreDraft(ordinary(), draft({ kind: 'items' }));
    assert.equal(item.ok, true);
    assert.equal(item.model.validation.ok, true);
    assert.equal(item.model.document.content.items[0].kind, 'goods');
    const npc = acceptLoreDraft(ordinary(), draft({ kind: 'creatures' }));
    assert.equal(npc.ok, true);
    assert.equal(npc.model.validation.ok, true);
    assert.equal(npc.model.document.content.creatures[0].note, 'A quiet port.');
    const rulesNpc = acceptLoreDraft(model, draft({ kind: 'creatures' }));
    assert.equal(rulesNpc.ok, true);
    assert.equal(rulesNpc.model.validation.ok, false, 'Narrative NPC remains a visible invalid combat draft in rules packs');
    assert.ok(rulesNpc.model.validation.errors.length);
});

test('draft refusal never truncates long lore, names, aliases or region silently', () => {
    const before = ordinary();
    for (const value of [draft({ content: 'x'.repeat(501) }), draft({ name: 'x'.repeat(81) }), draft({ slug: 'Bad ID' }), draft({ aliases: ['x'.repeat(81)] }), draft({ region: 'x'.repeat(81) }), draft({ kind: 'factions' })]) {
        const result = acceptLoreDraft(before, value);
        assert.equal(result.ok, false);
        assert.equal(result.model, before);
        assert.ok(result.errors.length);
    }
    const long = 'x'.repeat(501);
    const queue = importWorldInfo(source([{ key: ['Long lore'], content: long }]));
    assert.equal(queue[0].draft.content, long);
    assert.equal(acceptLoreDraft(before, queue[0].draft).ok, false);
});

test('HTML-like imported text stays literal in the draft and export', () => {
    const hostile = '<img src=x onerror="globalThis.injected=true"><script>globalThis.injected=true</script>';
    const queue = importWorldInfo(source([{ key: [hostile], content: hostile, comment: hostile }]));
    assert.equal(queue[0].draft.name, hostile);
    assert.equal(queue[0].draft.content, hostile);
    const json = exportWorldInfo({ content: { npcs: [{ name: hostile, note: hostile }] } });
    assert.equal(JSON.parse(json).entries[0].comment, hostile);
    assert.equal(globalThis.injected, undefined);
});
