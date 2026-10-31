import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, withDrafts } from '../src/model.js';
import { readAnswer, readMoment, findEvents, MAX_EVENTS } from '../src/timeline/ai-answer.js';
import { draftProblems, keepDraft, keepAll } from '../src/timeline/drafts.js';
import { packCalendar } from '../src/timeline/calendar.js';
import { writeCondition, readCondition } from '../src/timeline/condition.js';
import { readEvent } from '../src/timeline/event.js';
import { readLasting, LASTING_CAPABILITY } from '../src/timeline/lasting.js';

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
