// Value readers for an answer: the limits the parts read by, what counts as a record, text and folded names, a text's length in
// characters and its cut (never through a character), and the words an unknown value is described by. Pure.

export const NAME_READ = 200;

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const text = value => (typeof value === 'string' ? value.trim() : '');
export const fold = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// The name of an event as the answer used it: case and spacing only (a superscript two is not a two, a hyphen is not a space).
export const nameKey = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
export const quoted = value => `“${value}”`;
// The length of a text in characters, and the text cut to `max` characters (never in the middle of a character).
export const size = value => (value.length <= 1 ? value.length : [...value].length);
export const clip = (value, max) => (value.length <= max || size(value) <= max ? value : [...value].slice(0, max).join(''));
// An unknown value in words, without ever turning it into text (an object with a broken toString would throw).
export const describe = value => {
    if (typeof value === 'string') return quoted(clip(value.trim(), 40) + (size(value.trim()) > 40 ? '…' : ''));
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return Array.isArray(value) ? 'a list' : isRecord(value) ? 'an object' : value === null ? 'null' : 'nothing';
};
// Whether `value` is no deeper than `depth` levels and holds at most 1000 values: counted without recursion.
function shallow(value, depth) {
    const stack = [[value, 0]];
    for (let seen = 0; stack.length; seen++) {
        const [item, level] = stack.pop();
        if (item === null || typeof item !== 'object') continue;
        if (level >= depth || seen > 1000) return false;
        const children = Array.isArray(item) ? item : Object.values(item);
        if (children.length > 1000) return false;
        for (const child of children) stack.push([child, level + 1]);
    }
    return true;
}
// A value that is kept as it came only when it is small: else null, which every check of a lasting change refuses.
export const bounded = value => (shallow(value, NESTING) ? value : null);
const NESTING = 4;

export const wholeNumber = value => {
    const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
};
