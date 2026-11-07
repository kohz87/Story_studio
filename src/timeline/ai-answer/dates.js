// Dates in an answer's words ("Icewane 4, CY 612, dawn") read as story minutes in the pack's calendar. Pure.
import { DAY, PARTS } from '../calendar.js';
import { text, quoted } from './values.js';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


const TIME = /\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?(?!\d)/i;

/**
 * A date from the answer's words ("Icewane 4, CY 612, dawn", "4 icewane 612 18:30") as story minutes: `{ abs }`, or
 * `{ message }` in words. `role` 'until' reads a date with no time of day as that whole day (its end).
 */
export function readMoment(source, calendar, role = 'from') {
    let rest = ` ${text(source).replace(/,/g, ' ')} `;
    if (!text(source)) return { message: 'it is empty' };
    rest = rest.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1').replace(/\s(?:at|on)(?=\s)/gi, ' ');
    let minutes = null;
    const clock = TIME.exec(rest);
    if (clock) {
        let hours = Number(clock[1]);
        const suffix = clock[3]?.toLowerCase();
        if (suffix) hours = hours % 12 + (suffix === 'p' ? 12 : 0);
        if (hours > 23 || Number(clock[2]) > 59) return { message: `${quoted(clock[0])} is not a time of day` };
        minutes = hours * 60 + Number(clock[2]);
        rest = rest.replace(clock[0], ' ');
    } else {
        const part = /\b(dawn|noon|dusk|midnight)\b/i.exec(rest);
        if (part) { minutes = PARTS[part[1].toLowerCase()]; rest = rest.replace(part[0], ' '); }
    }
    if (calendar.era) rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(calendar.era)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
    const lower = rest.toLowerCase();
    let month = -1;
    [...calendar.months.keys()].sort((a, b) => calendar.months[b].name.length - calendar.months[a].name.length).some(index => {
        const named = new RegExp(`(?<![\\p{L}\\p{N}])${escape(calendar.months[index].name.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').exec(lower);
        if (!named) return false;
        month = index;
        rest = `${rest.slice(0, named.index)} ${rest.slice(named.index + named[0].length)}`;
        return true;
    });
    const words = rest.replace(/-?\d+/g, ' ').replace(/\s+/g, ' ').trim();
    if (month < 0) {
        return { message: words ? `${quoted(words)} is not a month of this calendar (${calendar.months.map(item => item.name).join(', ')})` : `it names no month (${calendar.months.map(item => item.name).join(', ')})` };
    }
    let numbers = rest.match(/-?\d+/g) ?? [];
    if (numbers.length !== 2) return { message: 'it needs a day and a year, like “Icewane 4, CY 612”' };
    if (numbers[0].length >= 3 && numbers[1].length <= 2) numbers = [numbers[1], numbers[0]];
    const [day, year] = numbers.map(Number);
    if (!Number.isSafeInteger(year) || year < 0) return { message: `${quoted(numbers[1])} is not a year` };
    const length = calendar.daysIn(year, month);
    if (!Number.isInteger(day) || day < 1 || day > length) return { message: `${calendar.months[month].name} has ${length} days in ${year}, so day ${numbers[0]} is not one` };
    const abs = calendar.toAbs({ year, month, day, minutes: minutes ?? (role === 'until' ? DAY : PARTS.dawn) });
    return abs === null ? { message: 'it is outside the calendar' } : { abs };
}
