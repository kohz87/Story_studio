import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack } from '../src/model.js';
import { buildPrompt, wordCount, cutNote, PROMPT_LIMIT, IDEA_LIMIT } from '../src/timeline/ai-prompt.js';

const ersveil = JSON.parse(readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8'));
const idea = 'The Emperor of Highmark dies in early winter CY 612. The news reaches the north about two weeks later. Then the succession splits the Diet and the borders get tense.';
const lines = text => text.split('\n');

test('the prompt for Ersveil is the one in the golden file, and the same every time', () => {
    const { text, words, characters, counts, cut } = buildPrompt(ersveil, { idea });
    assert.equal(`${text}\n`, readFileSync(new URL('./golden/ersveil-timeline-prompt.txt', import.meta.url), 'utf8'));
    assert.equal(buildPrompt(ersveil, { idea }).text, text);
    assert.equal(buildPrompt(openPack(JSON.stringify(ersveil)).document, { idea }).text, text);
    assert.deepEqual(counts, { regions: 30, places: 320, names: 0, events: 7 });
    assert.equal(cut, null);
    assert.equal(characters, text.length);
    assert.equal(words, text.split(/\s+/).length);
    assert.ok(text.length < PROMPT_LIMIT);
});

test('it holds, in order: what the events are, the calendar, regions, existing events, the format, the rules, the idea, the places', () => {
    const { text } = buildPrompt(ersveil, { idea });
    const at = needle => { const found = text.indexOf(needle); assert.ok(found >= 0, needle); return found; };
    const order = ['You are helping a writer plan hidden world events', 'CALENDAR: 12 months of 30 days: Dawnwane', 'The story starts Goldwane 12, CY 611, 6:40.', 'REGIONS (30): Highmark Empire', 'PLACES (320): listed at the end.', 'EVENTS ALREADY IN THE PACK (7): Bluewatch guild board (Goldwane 12, CY 611; Bluewatch Village / Guild Office, Bluewatch Village)', 'ANSWER with a JSON list only', '"when": { "on": "Icewane 4, CY 612, dawn" }', 'RULES:', "THE WRITER'S IDEA:", idea, '\n\nPLACES: Abyssal Throat'];
    const positions = order.map(at);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.match(text, /Bluewatch signal braziers \(Goldwane 12, CY 611; Bluewatch Village/);
    assert.match(text, /The turning 612 \(Frostfall 21, CY 612, until Deepwinter 30, CY 612; River Confederacy: Bluewatch, Shornmarch, Auvoth Compact, \+2 more\)/);
    assert.match(text, /Ghost fleet waters \(any time; Sea of the Ghost Fleet\)/);
    assert.ok(text.endsWith(', Wrecktithe'));
});

test('each include switch takes its part out, and the rest stays', () => {
    const full = buildPrompt(ersveil, { idea }).text;
    const without = include => buildPrompt(ersveil, { idea, include }).text;
    const noCalendar = without({ calendar: false });
    assert.ok(!/CALENDAR:/.test(noCalendar) && /REGIONS \(30\)/.test(noCalendar));
    assert.match(noCalendar, /Use the pack's own month names/);
    const noPlaces = without({ places: false });
    assert.ok(!/REGIONS \(|PLACES/.test(noPlaces) && /CALENDAR:/.test(noPlaces) && /EVENTS ALREADY/.test(noPlaces));
    assert.ok(!/regions and places listed/.test(noPlaces));
    const noEvents = without({ events: false });
    assert.ok(!/EVENTS ALREADY/.test(noEvents) && /PLACES \(320\)/.test(noEvents));
    assert.ok(full.length > noCalendar.length && full.length > noPlaces.length && full.length > noEvents.length);
    const nothing = without({ calendar: false, places: false, names: false, events: false });
    assert.ok(/ANSWER with a JSON list only/.test(nothing) && nothing.includes(idea));
    assert.ok(!/CALENDAR|REGIONS|PLACES|EVENTS ALREADY|FACTIONS/.test(nothing));
});

test('factions and lore names come from the pack\'s lorebook entries: their names and keys, never the places', () => {
    const pack = { ...ersveil, content: { ...ersveil.content, creatures: [{ slug: 'veyr', name: 'Veyr the Unbound', aliases: ['the Unbound'] }, { slug: 'guard', name: 'Sealwarden' }], items: [{ slug: 'seal-key', name: 'Seal key' }] } };
    const { text, counts } = buildPrompt(pack, { idea });
    assert.match(text, /FACTIONS AND NAMES: Veyr the Unbound, the Unbound, Sealwarden, Seal key\n/);
    assert.equal(counts.names, 4);
    assert.ok(!/FACTIONS AND NAMES: .*Highmark Capital/.test(text));
    assert.ok(!/FACTIONS AND NAMES/.test(buildPrompt(pack, { idea, include: { names: false } }).text));
    assert.ok(!/FACTIONS AND NAMES/.test(buildPrompt(ersveil, { idea }).text));
});

test('the calendar line says what the pack has: uneven months, no era, no start, or no calendar at all', () => {
    const calendar = { era: '', months: [{ name: 'Spring', days: 40 }, { name: 'Autumn', days: 50 }], start: { year: 3, month: 'Autumn', day: 2, hour: 18, minute: 5 } };
    const text = buildPrompt({ id: 'x', name: 'Odd', calendar, content: {} }, { idea }).text;
    assert.match(text, /CALENDAR: 2 months: Spring \(40 days\), Autumn \(50 days\)\. Years are plain numbers\. The story starts Autumn 2, 3, 18:05\./);
    assert.match(text, /"on": "Autumn 4, 4, dawn"/);
    const none = buildPrompt({ id: 'x', name: 'Plain', content: {} }, { idea }).text;
    assert.match(none, /CALENDAR: the Gregorian calendar/);
    assert.match(none, /"on": "November 4, 1, dawn"/);
    assert.ok(!/Dates are on or after the story start/.test(none));
    const unstarted = buildPrompt({ id: 'x', name: 'Plain', calendar: { months: [{ name: 'One', days: 10 }] }, content: {} }, { idea }).text;
    assert.match(unstarted, /The pack does not say when the story starts\./);
});

test('the idea is cut at its limit, and a missing one says so', () => {
    const long = 'word '.repeat(1000);
    const { text } = buildPrompt(ersveil, { idea: long });
    const written = text.slice(text.indexOf("THE WRITER'S IDEA:\n") + "THE WRITER'S IDEA:\n".length, text.indexOf('\n\nPLACES: '));
    assert.equal([...written].length, IDEA_LIMIT);
    assert.match(buildPrompt(ersveil, {}).text, /\(The writer has not written an idea yet\.\)/);
    assert.equal(IDEA_LIMIT, 2000);
});

test('a very long place list is cut to the bound, sub-places first, and says how many were kept', () => {
    const places = Array.from({ length: 3000 }, (_, i) => ({ name: `Place number ${String(i).padStart(4, '0')} of the realm`, region: `Region ${i % 40}`, x: 0, y: 0 }));
    const subs = Array.from({ length: 500 }, (_, i) => ({ name: `Place number ${String(i).padStart(4, '0')} of the realm / Hall ${i}`, region: 'Region 1', x: 0, y: 0 }));
    const pack = { id: 'big', name: 'Big', content: { places: [...places, ...subs], events: [] } };
    const { text, cut, counts } = buildPrompt(pack, { idea });
    assert.ok(text.length <= PROMPT_LIMIT, String(text.length));
    assert.ok(cut && cut.total === 3500 && cut.shown > 0 && cut.shown < 3000);
    assert.equal(counts.places, 3500);
    const listed = lines(text).at(-1).replace(/^PLACES: /, '').replace(/, …$/, '').split(', ');
    assert.equal(listed.length, cut.shown);
    assert.ok(listed.every(name => !name.includes(' / ')));
    assert.match(text, /PLACES \(3500\): listed at the end\./);
    assert.match(cutNote(cut), new RegExp(`cut to ${cut.shown} of 3500 places`));
    assert.equal(cutNote(null), '');
    // A list that fits whole keeps its sub-places.
    const small = buildPrompt({ id: 's', name: 'S', content: { places: [{ name: 'A', x: 0, y: 0 }, { name: 'A / B', x: 0, y: 0 }], events: [] } }, { idea });
    assert.equal(small.cut, null);
    assert.ok(small.text.endsWith('PLACES: A, A / B'));
});

test('long lists elsewhere are bounded too, and the count is the pack\'s', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({ id: `event-${i}`, when: 'true', cue: 'x' }));
    const { text, counts } = buildPrompt({ id: 'e', name: 'E', content: { places: [], events } }, { idea });
    assert.equal(counts.events, 60);
    assert.match(text, /EVENTS ALREADY IN THE PACK \(60\): Event 0 \(any time\)/);
    assert.match(text, / · and 20 more\n/);
});

test('words are counted and said with thousands separators', () => {
    assert.equal(wordCount(2140), '2,140 words');
    assert.equal(wordCount(1), '1 word');
    assert.equal(wordCount(999), '999 words');
    assert.equal(wordCount(1234567), '1,234,567 words');
});

test('docs/AI_PROMPT.md holds the same answer format and rules, with blanks', () => {
    const doc = readFileSync(new URL('../docs/AI_PROMPT.md', import.meta.url), 'utf8');
    const { text } = buildPrompt(ersveil, { idea });
    const block = text.slice(text.indexOf('ANSWER with a JSON list only'), text.indexOf("THE WRITER'S IDEA:")).replace('Icewane 4, CY 612, dawn', '[MONTH] 4, [ERA] [YEAR], dawn');
    assert.ok(doc.includes(block), 'the answer format and rules differ from the prompt Studio builds');
    assert.ok(doc.includes(text.slice(0, text.indexOf('\n')).replace('Ersveil (open world)', '[YOUR PACK NAME]')));
    assert.match(doc, /\[WRITE YOUR IDEA HERE/);
    assert.match(doc, /pasted? .*Studio|paste the answer/i);
});
