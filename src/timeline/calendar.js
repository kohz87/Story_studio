// Story time for pack events (pure): the pack's calendar, dates to Story Block's `time()` minutes and back.
//
// Story Director keeps the clock as minutes since its calendar's epoch (year 0, the first month, day 1, 00:00).
// A pack calendar has no leap years; a pack without a calendar runs on the Gregorian one, with them (the extra day
// goes to the second month). Minutes to a date is Story Block's own `dateOf`; a date to minutes is written here the
// way the Director writes it, and tests hold the two against each other and against the Ersveil events.
import { calendarFrom, dateOf, clockText } from '../../vendor/story-block/src/v2/view/clock.js';

export const DAY = 1440;
/** The parts of the day a form offers, in story minutes after midnight (the Director's own words and numbers). */
export const PARTS = Object.freeze({ midnight: 0, dawn: 360, noon: 720, dusk: 1140 });

const GREGORIAN = Object.freeze({
    era: '',
    leapYears: true,
    months: [['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30],
        ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31]].map(([name, days]) => ({ name, days })),
});

const isLeap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
// Leap years in [0, year): year 0 is one (proleptic), as the Director counts them.
const leapsBefore = year => Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400) + 1;

/** The calendar a pack's events run on: `{ era, months, leapYears, hasCalendar, start, … }` (`start` in minutes, or null). */
export function packCalendar(document) {
    const given = calendarFrom(document?.calendar);
    const base = given ?? { era: GREGORIAN.era, months: GREGORIAN.months, leapYears: GREGORIAN.leapYears };
    const { months, leapYears, era } = base;
    const yearDays = months.reduce((sum, month) => sum + month.days, 0);
    const leapMonth = months.length > 1 ? 1 : 0;
    const leap = year => leapYears && isLeap(year);
    const daysBeforeYear = year => yearDays * year + (leapYears ? leapsBefore(year) : 0);
    const offsets = [];
    months.reduce((sum, month, index) => (offsets[index] = sum) + month.days, 0);
    const daysIn = (year, month) => months[month].days + (month === leapMonth && leap(year) ? 1 : 0);
    // A month in a delay: the common length, or the rounded average of an uneven calendar; 30 without a calendar.
    const lengths = new Set(months.map(month => month.days));
    const monthDays = !given ? 30 : lengths.size === 1 ? months[0].days : Math.max(1, Math.round(yearDays / months.length));
    const calendar = {
        era, months, leapYears, hasCalendar: Boolean(given), monthDays, daysIn,
        /** `{ year, month (0-based), day, minutes }` to story minutes, or null when it is not a date of this calendar. */
        toAbs({ year, month, day, minutes = 0 }) {
            if (!Number.isSafeInteger(year) || !Number.isInteger(month) || month < 0 || month >= months.length) return null;
            if (!Number.isInteger(day) || day < 1 || day > daysIn(year, month)) return null;
            const abs = (daysBeforeYear(year) + offsets[month] + (month > leapMonth && leap(year) ? 1 : 0) + day - 1) * DAY + minutes;
            return Number.isSafeInteger(abs) ? abs : null;
        },
        fromAbs: abs => dateOf(abs, base),
        start: null,
    };
    const start = document?.calendar?.start;
    if (given && start && typeof start === 'object') {
        const named = typeof start.month === 'string' ? months.findIndex(month => month.name.toLowerCase() === start.month.trim().toLowerCase()) : Number(start.month) - 1;
        const abs = calendar.toAbs({ year: start.year, month: named, day: start.day, minutes: (start.hour ?? 0) * 60 + (start.minute ?? 0) });
        if (abs !== null) calendar.start = abs;
    }
    return calendar;
}

/** "Goldwane 12" */
export function dayText(calendar, abs) {
    const date = calendar.fromAbs(abs);
    return `${calendar.months[date.month].name} ${date.day}`;
}

/** "Goldwane 12, CY 611" (no era: "Goldwane 12, 611"). */
export function dateText(calendar, abs) {
    return `${dayText(calendar, abs)}, ${yearText(calendar, calendar.fromAbs(abs).year)}`;
}

/** "CY 611", or "611" for a calendar without an era. */
export function yearText(calendar, year) {
    return calendar.era ? `${calendar.era} ${year}` : String(year);
}

/** A part of the day's word for these minutes after midnight, or '' when they are none of them. */
export function partName(minutes) {
    return Object.keys(PARTS).find(name => PARTS[name] === minutes) ?? '';
}

/** "6:40 am", or the part of the day's word ("dawn") when it is one. */
export function timeText(minutes) {
    return minutes > 0 ? partName(minutes) || clockText(minutes) : 'midnight';
}

export { clockText };
