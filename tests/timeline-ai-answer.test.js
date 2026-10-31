import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, withDrafts } from '../src/model.js';
import { readAnswer, readMoment, findEvents, MAX_EVENTS, PASTE_LIMIT } from '../src/timeline/ai-answer.js';
import { draftProblems, keepDraft, keepAll } from '../src/timeline/drafts.js';
import { packCalendar } from '../src/timeline/calendar.js';
import { writeCondition, readCondition } from '../src/timeline/condition.js';
import { readEvent } from '../src/timeline/event.js';
import { readLasting, LASTING_CAPABILITY } from '../src/timeline/lasting.js';
import { parse } from '../vendor/story-block/src/v2/events/condition.js';

const ersveil = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const pack = (events = []) => ({
    id: 'tl', version: '1.0.0', name: 'Timeline pack', requires: { storyBlock: '^2' },
    calendar: { era: 'CY', months: ['Dawnwane', 'Rainmoot', 'Greengale'].map(name => ({ name, days: 30 })), start: { year: 613, month: 'Rainmoot', day: 1 } },
    content: {
        places: [
            { slug: 'auvoth', name: 'Auvoth', aliases: ['The Seal City'], region: 'Auvoth Compact', x: 0, y: 0 },
            { slug: 'terrace', name: 'The Terrace', region: 'Shornmarch', x: 1, y: 0 },
        ],
        events,
    },
});
const model = (events, extra = {}) => openPack({ ...pack(events), ...extra });
const calendar = packCalendar(pack());
const abs = (year, month, day, minutes = 0) => calendar.toAbs({ year, month, day, minutes });
const json = value => JSON.stringify(value, null, 2);
const read = (answer, m = model()) => {
    const result = readAnswer(typeof answer === 'string' ? answer : json(answer), m);
    assert.ok(result.ok, result.error);
    return result;
};
const problemsOf = (result, m = model()) => {
    const drafts = result.items.map(item => item.draft);
    return drafts.map((_, at) => draftProblems(m, drafts, at));
};
const one = (event, m = model()) => {
    const result = read([event], m);
    return { item: result.items[0], record: result.items[0].draft.record, problems: problemsOf(result, m)[0], result };
};
const base = { name: 'The seal fails', news: 'The seal has failed.' };

test('the answer is found in a code fence, in prose, as one event, or inside { events }', () => {
    const list = [{ ...base, when: 'any time' }];
    for (const answer of [json(list), `\`\`\`json\n${json(list)}\n\`\`\``, `Here you are!\n\n\`\`\`\n${json(list)}\n\`\`\`\nAnything else?`, `Sure. ${json(list)} Hope that helps [1].`, json(list[0]), json({ events: list }), `Result: ${json(list[0])}`]) {
        const result = readAnswer(answer, model());
        assert.ok(result.ok, answer);
        assert.deepEqual(result.items.map(item => item.id), ['the-seal-fails']);
    }
    // Brackets in the news, and text with brackets around it, do not confuse it.
    const tricky = readAnswer(`Note [see below]: ${json([{ ...base, news: 'A "quoted" ] bracket } here [' }])}`, model());
    assert.equal(tricky.items[0].draft.record.cue, 'A "quoted" ] bracket } here [');
});

test('an answer that is no list says so in words, and a cut-off one is not half read', () => {
    const say = text => readAnswer(text, model());
    assert.match(say('').error, /Paste the AI/);
    assert.match(say('I am sorry, I cannot do that.').error, /could not find a JSON list/);
    assert.match(say('[]').error, /no events/);
    assert.match(say('{"foo": 1}').error, /could not find a JSON list/);
    assert.match(say(`${json([base, base]).slice(0, 60)}`).error, /cut off|could not read/);
    assert.match(say('[{ "name": "A", "news": "x", }]').error, /could not read it/);
    const odd = say(json([base, 7, { news: 'no name' }, { name: '!!!', news: 'x' }, null]));
    assert.deepEqual(odd.items.map(item => item.id), ['the-seal-fails']);
    assert.deepEqual(odd.skipped.map(item => item.index), [1, 2, 3, 4]);
    assert.match(odd.skipped[1].reason, /no name/);
    assert.match(odd.skipped[2].reason, /no letters or digits/);
    assert.ok(findEvents(json([base])).list.length === 1);
});

test('dates are read in any case, in the calendar\'s own months, and refused in words', () => {
    const read = (text, role) => readMoment(text, calendar, role);
    assert.equal(read('Rainmoot 4, CY 613, dawn').abs, abs(613, 1, 4, 360));
    assert.equal(read('rainmoot 4, cy 613, NOON').abs, abs(613, 1, 4, 720));
    assert.equal(read('4th of Greengale cy 614 18:30').abs, abs(614, 2, 4, 1110));
    assert.equal(read('Dawnwane 30, CY 613, midnight').abs, abs(613, 0, 30, 0));
    assert.equal(read('Dawnwane 30, 613, 6:05 pm').abs, abs(613, 0, 30, 1085));
    assert.equal(read('Dawnwane 30, CY 613').abs, abs(613, 0, 30, 360), 'a start with no time is at dawn');
    assert.equal(read('Dawnwane 30, CY 613', 'until').abs, abs(613, 1, 1, 0), 'an end with no time is the end of the day');
    assert.match(read('Frostmonth 4, CY 613').message, /“Frostmonth” is not a month of this calendar \(Dawnwane, Rainmoot, Greengale\)/);
    assert.match(read('4, CY 613').message, /names no month/);
    assert.match(read('Rainmoot, CY 613').message, /needs a day and a year/);
    assert.match(read('Rainmoot 31, CY 613').message, /Rainmoot has 30 days in 613, so day 31 is not one/);
    assert.match(read('Rainmoot 4, CY 613, 25:61').message, /not a time of day/);
    assert.match(read('').message, /empty/);
});

test('a date event is written as the form writes it, and reads back in the form', () => {
    const { record, problems, item } = one({ ...base, when: { on: 'rainmoot 4, cy 613, dusk' }, until: 'Rainmoot 9, CY 613', where: ['AUVOTH COMPACT', 'the terrace', 'the seal city'], news: '  The seal has failed.  ' });
    const from = abs(613, 1, 4, 1140), until = abs(613, 1, 10, 0);
    const expected = writeCondition({ from, until, where: [{ kind: 'region', name: 'Auvoth Compact' }, { kind: 'place', name: 'The Terrace' }, { kind: 'place', name: 'Auvoth' }] });
    assert.ok(expected.ok);
    assert.deepEqual(record, { id: 'the-seal-fails', when: expected.when, cue: 'The seal has failed.' });
    assert.deepEqual(problems, []);
    assert.deepEqual(item.draft.notes, []);
    const info = readEvent(record);
    assert.equal(info.mode, 'date');
    assert.equal(info.hand, false);
    assert.deepEqual([info.from, info.until], [from, until]);
    assert.deepEqual(info.where, [{ kind: 'region', name: 'Auvoth Compact' }, { kind: 'place', name: 'The Terrace' }, { kind: 'place', name: 'Auvoth' }]);
    assert.deepEqual(readCondition(record.when).where.map(place => place.name), ['Auvoth Compact', 'The Terrace', 'Auvoth']);
});

test('once, any time and anywhere: the defaults the form leaves out are left out', () => {
    for (const when of ['any time', 'Any Time', undefined, { }]) {
        const { record, problems } = one({ ...base, when, where: 'anywhere' });
        assert.deepEqual(record, { id: 'the-seal-fails', when: 'true', cue: 'The seal has failed.' });
        assert.deepEqual(problems, []);
    }
    const { record } = one({ ...base, once: false, where: ['Auvoth'] });
    assert.equal(record.once, false);
    assert.equal(record.when, "query('scene.place') != null && (query('scene.place').name == 'Auvoth')");
    assert.equal(one({ ...base, once: true }).record.once, undefined);
});

test('an "after" event counts from its earlier event\'s lasting change, in days, hours or months, and the earlier one is guarded', () => {
    const answer = [
        { name: 'Cracks in the seal', when: 'any time', news: 'Cracks.', lasting: { name: 'Seal cracks', state: 'Looming', keep: true } },
        { name: 'Seal fails', when: { after: 'cracks in the SEAL', days: 14 }, where: ['Auvoth'], news: 'Fails.' },
        { name: 'Guards arrive', when: { after: 'Seal fails', hours: '6' }, news: 'Guards.' },
        { name: 'Wardens mourn', when: { after: 'Cracks in the seal', months: 2 }, news: 'Mourn.' },
    ];
    const result = read(answer);
    const [cracks, fails, guards, mourn] = result.items.map(item => item.draft.record);
    assert.equal(cracks.when, 'time() != null', 'the event others count from waits until the story has a date');
    assert.equal(fails.after, 'cracks-in-the-seal');
    assert.equal(fails.when, writeCondition({ since: { name: 'Seal cracks', minutes: 14 * 1440 }, where: [{ kind: 'place', name: 'Auvoth' }] }).when);
    assert.equal(guards.after, 'seal-fails');
    assert.equal(guards.when, 'true', 'the earlier event has no lasting change, so there is nothing to count from');
    assert.equal(mourn.when, writeCondition({ since: { name: 'Seal cracks', minutes: 2 * 30 * 1440 } }).when);
    assert.deepEqual(problemsOf(result).map(list => list.length), [0, 0, 1, 0]);
    assert.match(problemsOf(result)[2][0], /“Seal fails” has no lasting change, and a delay counts from when one happens/);
    assert.deepEqual(readLasting(cracks), { name: 'Seal cracks', state: 'looming', keep: true });
    for (const record of [fails, mourn]) {
        const info = readEvent(record);
        assert.equal(info.mode, 'after');
        assert.equal(info.hand, false);
    }
    assert.equal(readEvent(fails).gap, 14 * 1440);
    assert.equal(readEvent(mourn).gap, 60 * 1440);
});

test('an "after" event can name an event of the pack, whose lasting change it counts from', () => {
    const m = model([{ id: 'omen', when: 'time() != null', cue: 'An omen.', then: [{ command: 'chronicle.lasting', payload: { name: 'The omen', state: 'ongoing' } }] }, { id: 'plain', when: 'true', cue: 'Plain.' }]);
    const result = read([{ name: 'Omen grows', when: { after: 'Omen', days: 3 }, news: 'Grows.' }, { name: 'After plain', when: { after: 'plain', days: 3 }, news: 'x' }, { name: 'Right after', when: { after: 'plain' }, news: 'x' }], m);
    const [grows, plain, right] = result.items.map(item => item.draft.record);
    assert.equal(grows.after, 'omen');
    assert.equal(grows.when, writeCondition({ since: { name: 'The omen', minutes: 3 * 1440 } }).when);
    assert.deepEqual(problemsOf(result, m)[0], []);
    assert.equal(plain.when, 'true');
    assert.match(problemsOf(result, m)[1][0], /“Plain” has no lasting change/);
    assert.deepEqual([right.after, right.when], ['plain', 'true']);
    assert.deepEqual(problemsOf(result, m)[2], []);
    // The pack's own parent is not touched by reading; its guard is settled when the draft is kept.
    assert.equal(m.document.content.events[0].when, 'time() != null');
});

test('each problem is said in plain words', () => {
    const say = (event, m) => one({ ...base, ...event }, m).problems;
    assert.deepEqual(say({ where: ['Highmark Capital'] }), ['“Highmark Capital” is not a place in this pack: pick one in the form.']);
    assert.match(say({ when: { on: 'Rainmoot 4, CY 612, dawn' } })[0], /set before the story starts \(Rainmoot 1, CY 613\)/);
    assert.match(say({ when: { on: 'Frostmonth 4, CY 613, dawn' } })[0], /The date “Frostmonth 4, CY 613, dawn” could not be read: “Frostmonth” is not a month of this calendar/);
    assert.match(say({ when: { on: 'sometime soon' } })[0], /could not be read/);
    assert.match(say({ when: { after: 'Nothing at all', days: 2 } })[0], /comes after “Nothing at all”, which is not an event in the pack or in this answer/);
    assert.match(say({ news: 'x'.repeat(501) })[0], /The news is 501 characters and an event allows 500/);
    assert.match(say({ news: '' })[0], /no news yet/);
    assert.match(say({ news: undefined })[0], /no news yet/);
    assert.match(say({ lasting: { name: 'x'.repeat(81), state: 'ongoing' } })[0], /Lasting change: name must be 1 to 80 characters/);
    assert.match(say({ lasting: { name: 'Change', state: 'finished' } })[0], /Lasting change: state must be looming, ongoing or resolved/);
    assert.match(say({ lasting: { name: 'Change' } })[0], /state must be/);
    assert.match(say({ lasting: { name: 'Change', state: 'ongoing', factions: ['a', 'b', 'c', 'd', 'e'] } })[0], /factions must be a list of at most 4/);
    assert.match(say({ lasting: { name: 'Change', state: 'ongoing', summary: 'x'.repeat(241) } })[0], /summary/);
    assert.match(say({ lasting: { name: 'Change', state: 'ongoing', keep: 'yes' } })[0], /keep must be true or false/);
    assert.match(say({ when: 'any time', until: 'Greengale 1, CY 613' })[0], /end date but no date or earlier event/);
    assert.match(say({ when: { on: 'Greengale 1, CY 613, dawn' }, until: 'Rainmoot 2, CY 613' })[0], /Its end is not after its start/);
    assert.match(say({ when: { on: 'Greengale 1, CY 613, dawn' }, until: 'tomorrow' })[0], /The date “tomorrow” could not be read/);
    assert.match(say({ when: { after: 'Cracks', days: 0 } }, model([{ id: 'cracks', when: 'true', cue: 'c', then: [{ command: 'chronicle.lasting', payload: { name: 'C', state: 'ongoing' } }] }]))[0], /not a whole number of at least 1/);
    assert.match(say({ when: { after: 'Once only', days: 2 } }, model([{ id: 'once-only', when: 'true', cue: 'c', once: false }]))[0], /happens again and again, so nothing can come after it/);
    assert.match(say({ where: ['Auvoth', 'Nowhere Land', 'Shornmarch'] })[0], /“Nowhere Land” is not a place/);
    assert.deepEqual(say({ where: ['Auvoth', 'The Terrace', 'shornmarch', 'AUVOTH'] }), []);
});

test('unknown places are kept as written, so the form can show them, and no replacement is invented', () => {
    const { record, problems } = one({ ...base, where: ['Highmark Capital', 'Shornmarch'] });
    assert.match(record.when, /query\('scene.place'\).name == 'Highmark Capital'/);
    assert.match(record.when, /query\('scene.place'\).region == 'Shornmarch'/);
    assert.equal(problems.length, 1);
    assert.ok(!/Auvoth|Terrace|try|did you mean/i.test(problems[0]));
});

test('a condition longer than a pack allows is not written: the places are left out and it says so', () => {
    const where = Array.from({ length: 30 }, (_, i) => `A long invented place name number ${i}`);
    const { record, problems } = one({ ...base, where });
    assert.equal(record.when, 'true');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /That condition would be \d+ characters, and a pack allows 500\. Choose fewer places or regions\. The places were left out/);
});

test('a name that is taken gets an ID of its own, said in words; so do two alike in the answer', () => {
    const m = model([{ id: 'the-seal-fails', when: 'true', cue: 'Already here.' }]);
    const result = read([{ ...base }, { ...base }, { name: 'The Seal Fails!', news: 'x' }], m);
    assert.deepEqual(result.items.map(item => item.id), ['the-seal-fails-2', 'the-seal-fails-3', 'the-seal-fails-4']);
    assert.deepEqual(result.items.map(item => item.draft.record.id), ['the-seal-fails-2', 'the-seal-fails-3', 'the-seal-fails-4']);
    assert.match(result.items[0].info[0], /There is already an event called “The seal fails”, so this one is saved as the-seal-fails-2\./);
    assert.deepEqual(problemsOf(result, m), [[], [], []], 'a new ID is no problem');
    // Drafts already on the Timeline count as taken too.
    const again = read([{ ...base }], withDrafts(m, result.items.map(item => item.draft)));
    assert.equal(again.items[0].id, 'the-seal-fails-5');
    // An ID that would be too long is shortened to make room for its number.
    const long = read([{ name: 'a'.repeat(70), news: 'x' }, { name: 'a'.repeat(70), news: 'x' }]);
    assert.ok(long.items.every(item => item.id.length <= 64));
    assert.notEqual(long.items[0].id, long.items[1].id);
});

test('the answer can follow an event that is later in the list, but not itself or a loop', () => {
    const result = read([
        { name: 'Second', when: { after: 'First' }, news: 'x' },
        { name: 'First', when: 'any time', news: 'x', lasting: { name: 'First change', state: 'ongoing' } },
        { name: 'Loop A', when: { after: 'Loop B' }, news: 'x' },
        { name: 'Loop B', when: { after: 'Loop A' }, news: 'x' },
        { name: 'Self', when: { after: 'Self' }, news: 'x' },
    ]);
    const records = result.items.map(item => item.draft.record);
    assert.equal(records[0].after, 'first');
    // Of two that follow each other, the first read gives up its "after"; the other follows it.
    assert.equal(records[2].after, undefined);
    assert.equal(records[3].after, 'loop-a');
    assert.equal(records[4].after, undefined);
    const problems = problemsOf(result);
    assert.deepEqual(problems[0], []);
    assert.match(problems[2][0], /comes after an event that comes after it/);
    assert.deepEqual(problems[3], []);
    assert.match(problems[4][0], /cannot come after itself/);
});

test('more than MAX_EVENTS entries are cut, and what was left out is counted', () => {
    const entries = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ({ name: `Event ${i}`, news: 'x' }));
    const result = read(entries);
    assert.equal(result.items.length, MAX_EVENTS);
    assert.equal(result.extra, 5);
});

test('kept drafts are the pack\'s events: the guard of a pack event another counts from, and the capability, follow', () => {
    const m = model([{ id: 'omen', when: 'true', cue: 'An omen.', then: [{ command: 'chronicle.lasting', payload: { name: 'The omen', state: 'ongoing' } }] }], { requires: { storyBlock: '^2' } });
    assert.ok(!m.document.requires.capabilities);
    const result = read([{ name: 'Omen grows', when: { after: 'Omen', days: 3 }, news: 'Grows.' }], m);
    const held = withDrafts(m, result.items.map(item => item.draft));
    const kept = keepDraft(held, 'omen-grows');
    assert.ok(kept.ok, JSON.stringify(kept.errors));
    const events = kept.model.document.content.events;
    assert.deepEqual(events.map(event => event.id), ['omen', 'omen-grows']);
    assert.equal(events[0].when, 'time() != null', 'the pack event gets the guard when its counter is kept');
    assert.deepEqual(events[1], result.items[0].draft.record);
    assert.ok(kept.model.document.requires.capabilities.includes(LASTING_CAPABILITY));
    assert.equal(kept.model.validation.ok, true, JSON.stringify(kept.model.validation.errors));
    // And the same on Ersveil's own calendar, through keepAll.
    const big = openPack(ersveil);
    const drafts = read([{ name: 'Seal cracks', when: { on: 'Icewane 4, CY 612, dawn' }, where: ['Auvoth Compact'], news: 'Cracks.', lasting: { name: 'Seal cracking', state: 'looming' } }, { name: 'Seal fails', when: { after: 'Seal cracks', days: 14 }, news: 'Fails.' }], big).items.map(item => item.draft);
    const all = keepAll(withDrafts(big, drafts));
    assert.equal(all.kept, 2);
    assert.equal(all.result.model.validation.ok, true, JSON.stringify(all.result.model.validation.errors));
    assert.equal(all.result.model.document.content.events.length, 9);
});

// ------------------------------------------------------------ review 159

test('review 2: a field of the wrong kind is a problem in words, never a quiet "any time", "anywhere" or once', () => {
    const say = event => one({ ...base, news: 'It happened', ...event });
    const expect = (event, pattern, label) => {
        const { problems, record } = say(event);
        assert.ok(problems.some(text => pattern.test(text)), `${label}: ${JSON.stringify(problems)}`);
        return record;
    };
    // The review's repro: a number for the date and an object for the place.
    const { problems, record } = say({ name: 'Report', when: { on: 12345 }, where: { name: 'Restricted City' } });
    assert.equal(problems.length, 2, JSON.stringify(problems));
    assert.match(problems[0], /The date should be words like .*not 12345/);
    assert.match(problems[1], /“where” should be “anywhere” or a list of region and place names, not an object/);
    assert.equal(record.when, 'true');
    expect({ when: 12345 }, /“when” should be .*not 12345/, 'when a number');
    expect({ when: ['Icewane 4, CY 612'] }, /“when” should be .*not a list/, 'when a list');
    expect({ when: true }, /“when” should be .*not true/, 'when a boolean');
    expect({ when: { at: 'noon' } }, /“when” should be .*not an object/, 'when with no known key');
    expect({ when: { on: ['x'] } }, /The date should be words .*not a list/, 'on a list');
    expect({ when: { on: '' } }, /could not be read: it is empty/, 'on empty');
    expect({ when: { after: 12 } }, /“after” should be the name of an event, not 12/, 'after a number');
    expect({ when: { after: '' } }, /“after” is empty/, 'after empty');
    expect({ when: 'any time', until: 20 }, /The end date should be words .*not 20/, 'until a number');
    expect({ when: 'any time', until: { y: 1 } }, /The end date should be words .*not an object/, 'until an object');
    expect({ where: 3 }, /“where” should be .*not 3/, 'where a number');
    expect({ where: ['Auvoth', 7] }, /Left out of “where”: a place that is not a name/, 'where holding a number');
    expect({ once: 'false' }, /“once” should be true or false, not “false”/, 'once a string');
    expect({ once: 0 }, /“once” should be true or false, not 0/, 'once a number');
    expect({ lasting: 'Seal broken' }, /“lasting” should be an object like .*not “Seal broken”/, 'lasting a string');
    expect({ lasting: 4 }, /“lasting” should be an object/, 'lasting a number');
    expect({ lasting: { name: 7, state: 'ongoing' } }, /Lasting change: name must be 1 to 80/, 'lasting name a number');
    expect({ lasting: { name: 'N', state: 'ongoing', place: 5 } }, /Lasting change: place must be text/, 'lasting place a number');
    expect({ lasting: { name: 'N', state: 'ongoing', summary: {} } }, /Lasting change: summary/, 'lasting summary an object');
    expect({ lasting: { name: 'N', state: 'ongoing', factions: 'x'.repeat(9) .length } }, /factions must be a list/, 'factions a number');
    const parent = [{ name: 'Parent', news: 'P', lasting: { name: 'Parent change', state: 'ongoing' } }];
    for (const [value, shown] of [[{}, '{}'], [null, 'null'], [-3, '-3'], [1.5, '1.5'], ['soon', '“soon”'], [[3], 'a list'], [{ n: 3 }, 'an object'], [true, 'true']]) {
        const result = read([...parent, { name: 'Child', when: { after: 'Parent', days: value }, news: 'C' }]);
        const issues = problemsOf(result)[1];
        assert.ok(issues.some(text => /not a whole number of at least 1/.test(text)), `${shown}: ${JSON.stringify(issues)}`);
    }
    // What is plainly meant stays quiet: a field left out, "any time", anywhere, once true or false. (Review 161: a field that is
    // there as null is not left out; see the test for it below.)
    for (const quiet of [{}, { when: 'any time' }, { when: {} }, { where: 'anywhere' }, { where: [] }, { once: true }, { once: false }, { lasting: false }]) {
        assert.deepEqual(say(quiet).problems, [], JSON.stringify(quiet));
    }
    assert.equal(say({ once: 'false' }).record.once, undefined, 'a malformed once is not guessed at');
});

test('review 2: a delay with nothing to count from, or beside a date, is a problem too', () => {
    const result = read([{ name: 'Dated', when: { on: 'Rainmoot 4, CY 613, dawn', after: 'Anchor', days: 3 }, news: 'D' }, { name: 'Anchor', news: 'A', lasting: { name: 'Anchor change', state: 'ongoing' } }, { name: 'Lone', when: { on: 'Rainmoot 9, CY 613, dawn', days: 3 }, news: 'L' }]);
    const [dated, , lone] = problemsOf(result);
    assert.match(dated[0], /A date and a delay after another event cannot both be written/);
    assert.match(lone[0], /a delay of 3 days but no earlier event to count from/);
});

test('review 3: a pasted lasting name with a carriage return cannot give a condition Story Block cannot parse', () => {
    const text = '[{"name":"Parent","when":"any time","news":"P","lasting":{"name":"Before\\rafter","state":"ongoing"}},{"name":"Child","when":{"after":"Parent","days":1},"news":"C"}]';
    const result = read(text);
    const [parent, child] = problemsOf(result);
    assert.match(parent.join(' '), /Lasting change: name must be one line of text/);
    assert.ok(child.length > 0, 'the child is not ready either');
    assert.match(child.join(' '), /cannot hold a carriage return/);
    for (const item of result.items) assert.doesNotThrow(() => parse(item.draft.record.when), item.draft.record.when);
    // Not keepable, so Keep all keeps nothing and writes nothing unparseable.
    const kept = keepAll(withDrafts(model(), result.items.map(item => item.draft)));
    assert.equal(kept.kept, 0);
    // Every other control character in a name is refused the same way; a clean name is not.
    for (const code of [0, 9, 10, 11, 12, 127, 133]) {
        const odd = read([{ name: 'P', news: 'P', lasting: { name: `A${String.fromCharCode(code)}B`, state: 'ongoing' } }, { name: 'C', when: { after: 'P', days: 1 }, news: 'C' }]);
        assert.ok(problemsOf(odd)[0].some(line => /one line of text/.test(line)), `U+${code.toString(16)}`);
        for (const item of odd.items) assert.doesNotThrow(() => parse(item.draft.record.when));
    }
});

test('review 4: an "after" naming an event both the pack and the answer have follows the answer\'s own, and says so', () => {
    const lasting = name => ({ command: 'chronicle.lasting', payload: { name, state: 'ongoing' } });
    const m = model([{ id: 'the-king-dies', when: 'true', cue: 'Old.', then: [lasting('Old death')] }]);
    const result = read([
        { name: 'The king dies', when: 'any time', news: 'New.', lasting: { name: 'New death', state: 'ongoing' } },
        { name: 'News arrives', when: { after: 'The king dies', days: 3 }, news: 'Arrives.' },
    ], m);
    const [parent, child] = result.items.map(item => item.draft.record);
    assert.equal(parent.id, 'the-king-dies-2');
    assert.equal(child.after, 'the-king-dies-2', 'the parent just proposed, not the old event');
    assert.deepEqual(readCondition(child.when).since, { name: 'New death', minutes: 3 * 1440 });
    assert.match(child.when, /New death/);
    assert.ok(!/Old death/.test(child.when));
    assert.match(result.items[1].info.join(' '), /There is an event called “The king dies” in the pack and another in this answer\. This one comes after the one in this answer \(the-king-dies-2\), not the pack's \(the-king-dies\)\./);
    assert.deepEqual(problemsOf(result, m), [[], []]);
    // With only the pack's event of that name, the pack's is followed, with no such note.
    const only = read([{ name: 'News arrives', when: { after: 'The king dies', days: 3 }, news: 'Arrives.' }], m);
    assert.equal(only.items[0].draft.record.after, 'the-king-dies');
    assert.deepEqual(only.items[0].info, []);
});

test('review 6: a hostile value in a field is a plain problem, not an exception', () => {
    const parent = '{"name":"Parent","news":"P","lasting":{"name":"Parent","state":"ongoing"}}';
    const child = days => `{"name":"Child","when":{"after":"Parent","days":${days}},"news":"C"}`;
    for (const days of ['{"toString":null}', '{"valueOf":null,"toString":null}', `${'['.repeat(5000)}${']'.repeat(5000)}`, `{"a":${'{"a":'.repeat(3000)}1${'}'.repeat(3000)}}`, '{"__proto__":{"x":1}}', '1e999', '-0']) {
        let result;
        assert.doesNotThrow(() => { result = readAnswer(`[${parent},${child(days)}]`, model()); }, days.slice(0, 40));
        assert.ok(result.ok, days.slice(0, 40));
        const issues = problemsOf(result)[1];
        assert.ok(issues.some(line => /not a whole number of at least 1/.test(line)), `${days.slice(0, 40)}: ${JSON.stringify(issues)}`);
        assert.ok(issues.join(' ').length < 400, 'the problem is short, whatever the value was');
    }
    // Every field, hostile in the same ways, still reads.
    const hostile = [{ toString: null }, JSON.parse(`${'['.repeat(3000)}${']'.repeat(3000)}`), JSON.parse('{"__proto__":{"x":1}}')];
    for (const value of hostile) {
        const fields = { name: 'Odd', news: 'x' };
        for (const key of ['when', 'until', 'where', 'once', 'lasting', 'news']) {
            assert.doesNotThrow(() => readAnswer(JSON.stringify([{ ...fields, [key]: value }]), model()), key);
        }
        const deepLasting = { name: 'Odd', news: 'x', lasting: { name: value, state: value, place: value, summary: value, factions: value, keep: value } };
        let result;
        assert.doesNotThrow(() => { result = readAnswer(JSON.stringify([deepLasting]), model()); });
        assert.ok(problemsOf(result)[0].some(line => /Lasting change/.test(line)));
        assert.doesNotThrow(() => JSON.stringify(result.items[0].draft));
    }
    assert.equal(({}).x, undefined, 'nothing leaked onto Object.prototype');
});

test('review 7: a pasted answer, each field and each list are bounded before they are checked', () => {
    const huge = JSON.stringify([{ ...base, news: 'x'.repeat(3 * 1024 * 1024) }]);
    const refused = readAnswer(huge, model());
    assert.equal(refused.ok, false);
    assert.match(refused.error, /characters, and I read at most 200,000\. Paste only the JSON list/);
    assert.equal(PASTE_LIMIT, 200000);
    assert.equal(readAnswer(`[${' '.repeat(PASTE_LIMIT)}]`, model()).ok, false);
    // Many places: only the first are read, with a Set for duplicates, so it takes no time and says what was left.
    const names = Array.from({ length: 3000 }, (_, i) => `Unknown place ${i}`);
    const text = JSON.stringify([{ ...base, where: names }]);
    assert.ok(text.length < PASTE_LIMIT);
    const started = Date.now();
    const result = read(text);
    assert.ok(Date.now() - started < 1500, 'reading 3,000 places is quick');
    assert.ok(readEvent(result.items[0].draft.record).where.length <= 30);
    assert.match(problemsOf(result)[0].join(' '), /Left out of “where”: 2970 more than the 30 that are read/);
    const same = read(JSON.stringify([{ ...base, where: Array.from({ length: 5000 }, () => 'Auvoth') }]));
    assert.deepEqual(readEvent(same.items[0].draft.record).where, [{ kind: 'place', name: 'Auvoth' }]);
    // News is cut at the form's limit, and says so; so is every text of a lasting change, one past its limit.
    const long = one({ ...base, news: 'n'.repeat(50000), lasting: { name: 'N'.repeat(30000), state: 'ongoing', summary: 's'.repeat(30000), place: 'p'.repeat(30000), factions: ['f'.repeat(30000)] } });
    assert.equal(long.record.cue.length, 500);
    assert.ok(long.problems.some(line => /The news is 50,000 characters and an event allows 500: only the first 500 were kept/.test(line)));
    assert.ok(long.problems.some(line => /Lasting change: name must be 1 to 80/.test(line)));
    assert.ok(JSON.stringify(long.record).length < 2000, String(JSON.stringify(long.record).length));
    const name = one({ name: 'N'.repeat(5000), news: 'x' });
    assert.ok(name.record.id.length <= 64 && name.item.name.length <= 200);
});

test('review 9: a citation or other bracket before the JSON does not hide the answer', () => {
    const event = '[{"name":"First","when":"any time","news":"News"}]';
    for (const text of [
        `Here is your answer [1]: ${event}`,
        `Here is your answer [1] and [2] and [1, 2], {note}, [] ${event} [3]`,
        `[1]\n${event}`,
        `See [1].\n\`\`\`json\n${event}\n\`\`\``,
        `[1] \`\`\`\n[2]\n\`\`\` ${event}`,
        `Refs: [${Array.from({ length: 120 }, (_, i) => i).join('], [')}] then ${event}`,
        `Notes {"a":1} and [true] and [[1,2]] ${event}`,
    ]) {
        const result = readAnswer(text, model());
        assert.ok(result.ok, text.slice(0, 60));
        assert.deepEqual(result.items.map(item => item.name), ['First'], text.slice(0, 60));
        assert.deepEqual(result.skipped, [], text.slice(0, 60));
    }
    // The first list or object that holds events wins, not the first one.
    const two = findEvents(`[{"name":"A","news":"a"}] and [{"name":"B","news":"b"}]`);
    assert.deepEqual(two.list.map(item => item.name), ['A']);
    // With no event anywhere, the report is as it was.
    assert.deepEqual(readAnswer('[1]', model()).skipped, [{ index: 0, reason: 'It is not an event (an event is an object with a name).' }]);
});

// ------------------------------------------------------------ review 161

const lonely = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test('review 161-2: a field that is there as null is a problem, never a quiet default; only a field left out takes its default', () => {
    // The review's repro: a child whose delay, place and repeat setting are null.
    const text = '[{"name":"Parent","news":"P","lasting":{"name":"P changed","state":"ongoing"}},{"name":"Child","when":{"after":"Parent","days":null},"where":null,"once":null,"news":"C"}]';
    const result = read(text);
    const [parent, child] = problemsOf(result);
    assert.deepEqual(parent, []);
    assert.ok(child.some(line => /delay of null days is not a whole number of at least 1|not a whole number of at least 1/.test(line)), JSON.stringify(child));
    assert.ok(child.some(line => /“where” should be .*not null/.test(line)), JSON.stringify(child));
    assert.ok(child.some(line => /“once” should be true or false, not null/.test(line)), JSON.stringify(child));
    const kept = keepAll(withDrafts(model(), result.items.map(item => item.draft)));
    assert.equal(kept.kept, 1, 'only the parent can be kept');
    assert.deepEqual(kept.result.model.document.content.events.map(event => event.id), ['parent']);
    // Each field, present as null.
    const says = (event, pattern, label) => {
        const { problems } = one({ ...base, news: 'It happened', ...event });
        assert.ok(problems.some(line => pattern.test(line)), `${label}: ${JSON.stringify(problems)}`);
    };
    says({ when: null }, /“when” should be .*not null/, 'when');
    says({ when: { on: null } }, /The date should be words .*not null/, 'on');
    says({ when: { after: null } }, /“after” should be the name of an event, not null/, 'after');
    says({ when: 'any time', until: null }, /The end date should be words .*not null/, 'until');
    says({ where: null }, /“where” should be .*not null/, 'where');
    says({ once: null }, /“once” should be true or false, not null/, 'once');
    says({ lasting: null }, /“lasting” should be an object .*not null/, 'lasting');
    for (const unit of ['days', 'hours', 'months']) {
        const result = read([{ name: 'Parent', news: 'P', lasting: { name: 'P changed', state: 'ongoing' } }, { name: 'Child', when: { after: 'Parent', [unit]: null }, news: 'C' }]);
        assert.ok(problemsOf(result)[1].some(line => new RegExp(`${unit} is not a whole number of at least 1`).test(line)), unit);
    }
    const lone = read([{ name: 'Lone', when: { days: null }, news: 'C' }]);
    assert.ok(problemsOf(lone)[0].some(line => /no earlier event to count from/.test(line)));
    for (const field of ['name', 'state', 'place', 'summary', 'factions', 'keep']) {
        const { problems } = one({ ...base, lasting: { name: 'N', state: 'ongoing', [field]: null } });
        assert.ok(problems.some(line => new RegExp(`Lasting change: ${field} `).test(line)), `${field}: ${JSON.stringify(problems)}`);
    }
    // A field that is left out takes its default, quietly: the same event without the null fields is ready.
    assert.deepEqual(one({ ...base, news: 'It happened', lasting: { name: 'N', state: 'ongoing' } }).problems, []);
    assert.deepEqual(read(JSON.parse(text.replace(',"days":null', '').replace('"where":null,"once":null,', ''))).items.length, 2);
    assert.deepEqual(problemsOf(read(JSON.parse(text.replace(',"days":null', '').replace('"where":null,"once":null,', ''))))[1], []);
});

test('review 161-4: "after" resolves by the exact name the answer used, and two names that match it are not guessed between', () => {
    const fort = { name: 'Dawn-Watch Falls', news: 'The fort falls.', lasting: { name: 'Fort falls', state: 'ongoing' } };
    const guard = { name: 'Dawn Watch Falls', news: 'The guard falls.', lasting: { name: 'Guard falls', state: 'ongoing' } };
    const mourned = after => ({ name: 'The guard is mourned', when: { after, days: 2 }, news: 'The guard is mourned.' });
    // The review's repro: the name used is the second event's, so the child follows the second, whatever the IDs say.
    const result = read([fort, guard, mourned('Dawn Watch Falls')]);
    const [first, second, child] = result.items.map(item => item.draft.record);
    assert.deepEqual([first.id, second.id], ['dawn-watch-falls', 'dawn-watch-falls-2']);
    assert.equal(child.after, 'dawn-watch-falls-2');
    assert.deepEqual(readCondition(child.when).since, { name: 'Guard falls', minutes: 2 * 1440 });
    assert.deepEqual(problemsOf(result), [[], [], []]);
    const kept = keepAll(withDrafts(model(), result.items.map(item => item.draft)));
    assert.equal(kept.kept, 3);
    assert.equal(kept.result.model.document.content.events.find(event => event.id === 'the-guard-is-mourned').after, 'dawn-watch-falls-2');
    // And the other name follows the first.
    assert.equal(read([fort, guard, mourned('Dawn-Watch Falls')]).items[2].draft.record.after, 'dawn-watch-falls');
    // Case and spacing do not matter.
    assert.equal(read([fort, guard, mourned('  dawn   WATCH falls ')]).items[2].draft.record.after, 'dawn-watch-falls-2');
    // Two events whose names are the same but for case and spacing: the child is left with a note, and is not ready.
    const twin = { ...guard, name: 'dawn  watch FALLS' };
    const unsure = read([guard, twin, mourned('Dawn Watch Falls')]);
    const child2 = unsure.items[2].draft.record;
    assert.equal(child2.after, undefined, 'no guess');
    const issues = problemsOf(unsure)[2];
    assert.ok(issues.some(line => /could mean any of 2 events in this answer \(dawn-watch-falls, dawn-watch-falls-2\)/.test(line)), JSON.stringify(issues));
    assert.equal(keepAll(withDrafts(model(), unsure.items.map(item => item.draft))).kept, 2, 'the two are kept, the child is not');
    // No name matches exactly but two events make the same ID: not guessed either. One that makes it alone is followed.
    assert.ok(problemsOf(read([fort, guard, mourned('dawn_watch falls')]))[2].some(line => /could mean any of 2 events/.test(line)));
    assert.equal(read([fort, mourned('Dawn Watch Falls')]).items[1].draft.record.after, 'dawn-watch-falls');
    // The pack's event of that ID is followed over an event that only makes the same ID (the pack has no names).
    const lasting = { command: 'chronicle.lasting', payload: { name: 'Old fall', state: 'ongoing' } };
    const m = model([{ id: 'dawn-watch-falls', when: 'true', cue: 'Old.', then: [lasting] }]);
    const packed = read([fort, mourned('Dawn Watch Falls')], m);
    assert.equal(packed.items[1].draft.record.after, 'dawn-watch-falls', 'the pack\'s event, as no name in the answer is exactly that');
    const own = read([guard, mourned('Dawn Watch Falls')], m);
    assert.equal(own.items[1].draft.record.after, 'dawn-watch-falls-2', 'an exact name in the answer still wins over the pack\'s');
});

test('review 161-5: text bounds count characters, never split one, and say when a text was cut', () => {
    const dragons = n => '🐉'.repeat(n);
    // The review's repro: a summary of exactly 240 characters ends in seven dragons, and keeps all seven.
    const summary = `${'The southern road remains closed as the city prepares for winter. '.repeat(3)}The council has received warnings. ${dragons(7)}`;
    assert.equal([...summary].length, 240);
    const road = one({ name: 'Road closes', news: 'The road closes.', lasting: { name: 'Road closed', state: 'ongoing', summary } });
    assert.deepEqual(road.problems, []);
    assert.equal(readLasting(road.record).summary, summary);
    const kept = keepAll(withDrafts(model(), [road.item.draft]));
    assert.equal(kept.kept, 1);
    assert.equal(readLasting(kept.result.model.document.content.events[0]).summary, summary, 'kept whole');
    assert.equal(kept.result.model.validation.ok, true, JSON.stringify(kept.result.model.validation.errors));
    // Texts at their limit, counted in characters, are kept whole: name, place, faction, summary.
    const full = one({ ...base, lasting: { name: dragons(80), state: 'ongoing', place: dragons(80), factions: [dragons(80), dragons(80), dragons(80), dragons(80)], summary: dragons(240) } });
    assert.deepEqual(full.problems, []);
    assert.deepEqual(readLasting(full.record), { name: dragons(80), state: 'ongoing', place: dragons(80), factions: Array(4).fill(dragons(80)), summary: dragons(240) });
    // Over the limit: still said as too long (it is cut one character past it, never mid-character), and said as shortened.
    for (const [field, limit, long] of [['name', 80, 85], ['place', 80, 85], ['summary', 240, 300]]) {
        const over = one({ ...base, lasting: { name: 'N', state: 'ongoing', [field]: dragons(long) } });
        const stored = readLasting(over.record)[field];
        assert.equal([...stored].length, limit + 1, field);
        assert.ok(!lonely.test(stored), `${field}: no half character`);
        assert.ok(over.problems.some(line => new RegExp(`Lasting change: ${field} `).test(line)), `${field}: ${JSON.stringify(over.problems)}`);
        assert.ok(over.problems.some(line => new RegExp(`${long} characters and a lasting change allows ${limit}: it was shortened`).test(line)), `${field}: ${JSON.stringify(over.problems)}`);
    }
    // Only just over (one past the limit): nothing was cut, so only the limit is said.
    const just = one({ ...base, lasting: { name: dragons(81), state: 'ongoing' } });
    assert.equal([...readLasting(just.record).name].length, 81);
    assert.ok(just.problems.length === 1 && /name must be 1 to 80/.test(just.problems[0]), JSON.stringify(just.problems));
    // Too many factions, and a faction name too long.
    const crowd = one({ ...base, lasting: { name: 'N', state: 'ongoing', factions: Array.from({ length: 9 }, (_, i) => dragons(i + 1)) } });
    assert.equal(readLasting(crowd.record).factions.length, 5);
    assert.ok(crowd.problems.some(line => /The list has 9 factions and a lasting change allows 4: it was shortened/.test(line)));
    // The event's name stands in for a lasting change with none, cut to fit and said.
    const stand = one({ name: `${'e'.repeat(110)}${dragons(10)}`, news: 'x', lasting: { state: 'ongoing' } });
    assert.equal([...readLasting(stand.record).name].length, 80);
    assert.ok(stand.problems.some(line => /takes the event’s, which is 120 characters: only the first 80 were kept/.test(line)));
    // The news is counted as the pack checker counts it; a valid news is kept whole and a cut one never ends mid-character.
    const edge = `${'a'.repeat(498)}🐉`;
    assert.equal(edge.length, 500);
    const whole = one({ ...base, news: edge });
    assert.equal(whole.record.cue, edge);
    assert.deepEqual(whole.problems, []);
    const split = one({ ...base, news: `${'a'.repeat(499)}🐉 and more` });
    assert.ok(!lonely.test(split.record.cue));
    assert.equal(split.record.cue, 'a'.repeat(499));
    assert.ok(split.problems.some(line => /only the first 500 were kept/.test(line)));
    // Names: an event name, a place name, and a date are bounded in characters too, and a cut name is said.
    const name = one({ name: `${'e'.repeat(199)}${dragons(5)}`, news: 'x' });
    assert.ok(name.item.name === `${'e'.repeat(199)}🐉` && !lonely.test(name.item.name));
    assert.match(name.item.info.join(' '), /longer than 200 characters/);
    const where = one({ ...base, where: [`${'p'.repeat(199)}${dragons(5)}`, 'Auvoth'] });
    assert.ok(readEvent(where.record).where.every(place => !lonely.test(place.name)));
    assert.ok(where.problems.some(line => /A place name was longer than 200 characters and was shortened/.test(line)), JSON.stringify(where.problems));
    const date = one({ ...base, when: { on: `Rainmoot 4, CY 613, dawn${' '.repeat(300)}` } });
    assert.ok(!date.problems.some(line => /longer than 200/.test(line)), 'spaces around a date are no part of it');
    const longDate = one({ ...base, when: { on: `Rainmoot 4, CY 613, dawn ${dragons(300)}` } });
    assert.ok(longDate.problems.some(line => /could not be read: it is longer than 200 characters/.test(line)), JSON.stringify(longDate.problems));
});
