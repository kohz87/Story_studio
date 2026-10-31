import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeCondition, readCondition, glanceCondition, chronicleNames } from '../src/timeline/condition.js';
import { parse, evaluateCondition } from '../vendor/story-block/src/v2/events/condition.js';

const ersveil = JSON.parse(readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8'));

test('every condition of the Ersveil events reads back and is written again byte for byte', () => {
    for (const event of ersveil.content.events) {
        const read = readCondition(event.when);
        assert.ok(read, event.id);
        assert.equal(writeCondition(read).when, event.when, event.id);
    }
});

test('a date window and a region list read as what the form shows', () => {
    const turning = readCondition(ersveil.content.events.find(event => event.id === 'the-turning-611').when);
    assert.equal(turning.from, 317116800);
    assert.equal(turning.until, 317174399);
    assert.equal(turning.since, null);
    assert.deepEqual(turning.where.map(place => place.kind), ['region', 'region', 'region', 'region', 'region']);
    assert.equal(turning.where[0].name, 'River Confederacy: Bluewatch');
    const ghost = readCondition(ersveil.content.events.find(event => event.id === 'ghost-fleet-waters').when);
    assert.deepEqual(ghost, { from: null, until: null, since: null, where: [{ kind: 'place', name: 'Sea of the Ghost Fleet' }] });
});

test('each shape the form writes parses in Story Block\'s condition language and reads back', () => {
    const where = [{ kind: 'region', name: 'Auvoth Compact' }, { kind: 'place', name: 'Bluewatch Village' }];
    const specs = [
        {},
        { where },
        { from: 1440 },
        { from: 1440, until: 2880, where },
        { dated: true },
        { dated: true, where },
        { until: 5000 },
        { until: 5000, where },
        { since: { name: 'Cracks in the seventh seal', minutes: 86400 } },
        { since: { name: 'Cracks in the seventh seal', minutes: 86400 }, where },
        { since: { name: 'Cracks', minutes: 120 }, until: 999999, where },
    ];
    for (const spec of specs) {
        const written = writeCondition(spec);
        assert.equal(written.ok, true, JSON.stringify(spec));
        assert.equal(parse(written.when).ok, true, written.when);
        assert.deepEqual(readCondition(written.when), { from: null, until: null, since: null, where: [], ...spec }, written.when);
    }
});

test('a delay is asked of the chronicle with the name and the minutes, and uses neither time() nor .since', () => {
    const { when } = writeCondition({ since: { name: 'Cracks in the seventh seal', minutes: 86400 }, where: [{ kind: 'region', name: 'Auvoth Compact' }] });
    assert.equal(when, "query('chronicle.passed', { name: 'Cracks in the seventh seal', minutes: 86400 }) && query('scene.place') != null && (query('scene.place').region == 'Auvoth Compact')");
    assert.doesNotMatch(when, /time\(\)|\.since/);
});

test('names with quotes, backslashes and the condition\'s own symbols survive', () => {
    const where = [{ kind: 'place', name: "Widow's Rest && Co. || (the \\ gate)" }];
    const { when } = writeCondition({ where, since: { name: "It's \"done\"", minutes: 60 } });
    assert.equal(parse(when).ok, true, when);
    assert.deepEqual(readCondition(when).where, where);
    assert.equal(readCondition(when).since.name, "It's \"done\"");
});

test('a condition Studio did not write is not read, so the form keeps it as it is', () => {
    for (const when of [
        "has('Rope')",
        "time() != null && time() >= 100 && has('Rope')",
        "time() >= 100",
        "time()  !=  null && time() >= 100",
        "time() != null && time() >= 0100",
        "query('scene.place') != null && (query('scene.place').kind == 'town')",
        "query('scene.place') != null && (query('scene.place').name == 'A' && query('scene.place').name == 'B')",
        "query('chronicle.passed', { minutes: 60, name: 'X' })",
        "time() != null && (time() >= 100 || time() < 5)",
        '',
    ]) assert.equal(readCondition(when), null, when);
    assert.equal(readCondition(undefined), null);
    assert.deepEqual(glanceCondition("time() >= 100 && has('x') && time() < 200 && query('scene.place').region == 'R'"), { from: 100, until: 200, where: [{ kind: 'region', name: 'R' }] });
});

test('a condition longer than a pack allows, or a moment before the story, is refused with a reason', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'region', name: `A fairly long region name number ${i}` }));
    const long = writeCondition({ where: many });
    assert.equal(long.ok, false);
    assert.match(long.reason, /500/);
    assert.equal(writeCondition({ from: -5 }).ok, false);
    assert.equal(writeCondition({ from: 5, since: { name: 'X', minutes: 60 } }).ok, false);
    assert.equal(writeCondition({ since: { name: 'X', minutes: 0 } }).ok, false);
});

test('an event others count days from waits until the story has a date, and reads back', () => {
    assert.equal(writeCondition({ dated: true }).when, 'time() != null');
    assert.equal(writeCondition({ dated: true, where: [{ kind: 'place', name: 'Auvoth' }] }).when, "time() != null && query('scene.place') != null && (query('scene.place').name == 'Auvoth')");
    // A date, a delay or an end already say it, so nothing is added.
    assert.equal(writeCondition({ dated: true, from: 60 }).when, 'time() != null && time() >= 60');
    assert.equal(writeCondition({ dated: true, until: 60 }).when, 'time() != null && time() < 60');
    assert.equal(writeCondition({ dated: true, since: { name: 'X', minutes: 5 } }).when, "query('chronicle.passed', { name: 'X', minutes: 5 })");
    assert.equal(readCondition('time() != null').dated, true);
    assert.equal(readCondition('time() != null && time() < 60').dated, undefined);
    assert.equal(readCondition('true').dated, undefined);
    assert.equal(readCondition('time() != null && time() != null'), null);
    assert.equal(readCondition('time() != null && has(\'Rope\')'), null);
    // Story Block reads it: false while the story has no clock, true once it has one.
    const state = minutes => ({ state: { domains: { director: { time: { minutes } } } } });
    assert.equal(evaluateCondition('time() != null', state(null)).met, false);
    assert.equal(evaluateCondition('time() != null', state(0)).met, true);
});

test('the names a condition asks the chronicle about are found, written by the form or by hand', () => {
    assert.deepEqual(chronicleNames("query('chronicle.passed', { name: 'It\\'s over', minutes: 5 }) && true"), ["It's over"]);
    assert.deepEqual(chronicleNames('query("chronicle.passed", { name: "Old news", minutes: 5 }) || query(\'chronicle.passed\', { name: \'B\', minutes: 1 })'), ['Old news', 'B']);
    assert.deepEqual(chronicleNames('true'), []);
    assert.deepEqual(chronicleNames(undefined), []);
});
