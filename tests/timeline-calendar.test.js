import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packCalendar, dayText, dateText, partName, timeText, DAY, PARTS } from '../src/timeline/calendar.js';
import { gapOf } from '../src/timeline/event.js';
import { formatStoryTime } from '../vendor/story-block/src/v2/view/clock.js';

const ersveil = JSON.parse(readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8'));
const calendar = packCalendar(ersveil);
const at = (year, month, day, minutes = 0) => calendar.toAbs({ year, month: calendar.months.findIndex(entry => entry.name === month), day, minutes });

test('dates convert to the minutes the Ersveil events already use', () => {
    assert.equal(calendar.start, 316931440);
    assert.equal(at(611, 'Goldwane', 12, 6 * 60 + 40), 316931440);
    assert.equal(at(611, 'Goldwane', 12, 18 * 60 + 40), 316932160);
    assert.equal(at(611, 'Goldwane', 12, 20 * 60), 316932240);
    for (const [year, from, until] of [[611, 317116800, 317174399], [612, 317635200, 317692799], [613, 318153600, 318211199]]) {
        assert.equal(at(year, 'Frostfall', 21), from);
        assert.equal(at(year, 'Deepwinter', 30, DAY - 1), until);
    }
});

test('minutes convert back to the same dates and read as Story Block writes them', () => {
    for (const abs of [0, 1439, 1440, 316931440, 317174399, 318211199, 999999999]) {
        const date = calendar.fromAbs(abs);
        assert.equal(calendar.toAbs({ year: date.year, month: date.month, day: date.day, minutes: date.minutes }), abs);
        assert.equal(`${calendar.era} ${date.year}, ${calendar.months[date.month].name} ${date.day}`, formatStoryTime(abs, ersveil.calendar).replace(/, \d+:\d\d [ap]m$/, ''));
    }
    assert.equal(dayText(calendar, 316931440), 'Goldwane 12');
    assert.equal(dateText(calendar, 316931440), 'Goldwane 12, CY 611');
});

test('a day that the month does not have is not a date', () => {
    assert.equal(calendar.toAbs({ year: 611, month: 0, day: 31 }), null);
    assert.equal(calendar.toAbs({ year: 611, month: 0, day: 0 }), null);
    assert.equal(calendar.toAbs({ year: 611, month: 12, day: 1 }), null);
});

test('a pack without a calendar runs on the Gregorian one, with leap days in the second month', () => {
    const plain = packCalendar({});
    assert.equal(plain.hasCalendar, false);
    assert.equal(plain.start, null);
    // Day 1 of year 2000 counted from year 0 (a leap year): 730485 days.
    assert.equal(plain.toAbs({ year: 2000, month: 0, day: 1 }), 730485 * DAY);
    assert.equal(plain.toAbs({ year: 2000, month: 1, day: 29 }), (730485 + 31 + 28) * DAY);
    assert.equal(plain.toAbs({ year: 1999, month: 1, day: 29 }), null);
    assert.equal(plain.toAbs({ year: 2000, month: 2, day: 1 }), (730485 + 31 + 29) * DAY);
    for (const abs of [0, 730485 * DAY, (730485 + 59) * DAY + 77]) {
        const date = plain.fromAbs(abs);
        assert.equal(plain.toAbs(date), abs);
    }
    assert.equal(plain.monthDays, 30);
});

test('parts of the day are the Director\'s, and a delay reads in days or hours', () => {
    assert.deepEqual(PARTS, { midnight: 0, dawn: 360, noon: 720, dusk: 1140 });
    assert.equal(partName(720), 'noon');
    assert.equal(timeText(0), 'midnight');
    assert.equal(timeText(400), '6:40 am');
    assert.deepEqual(gapOf(86400), { n: 60, unit: 'days' });
    assert.deepEqual(gapOf(180), { n: 3, unit: 'hours' });
    assert.equal(gapOf(61), null);
    assert.equal(gapOf(0), null);
    assert.equal(calendar.monthDays, 30);
    assert.equal(packCalendar({ calendar: { months: [{ name: 'A', days: 20 }, { name: 'B', days: 41 }] } }).monthDays, 31);
});
