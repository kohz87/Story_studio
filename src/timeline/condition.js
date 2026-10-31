// The condition Studio writes for a pack event, and reading it back (pure).
//
// A form says: not before a date (`from`), not after one (`until`, exclusive), or at least so long after another
// event entered Story Director's chronicle (`since`, asked of its `chronicle.passed` query, which is false until then),
// and only in some places or regions (`where`). An event that other events count days from also waits until the story
// has a date (`dated`), or its chronicle entry would be stamped with no time and the days could never pass. This
// writes that as the condition language of pack events, in the one shape the pack's own events already use, and reads
// it back. A condition is read only when writing what was read gives the same text again, byte for byte; any other
// condition is the author's own and the form leaves it alone.
import { EVENT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';

const WORD_LIMIT = 200;
const ESCAPES = { '\\': '\\', '\'': '\'', '"': '"', n: '\n', t: '\t' };
const PASSED = 'query(\'chronicle.passed\', { name: ';
const PLACE = 'query(\'scene.place\')';
const STRING = '\'((?:[^\'\\\\]|\\\\.)*)\'';
const FROM = /^time\(\) >= (-?\d+)$/;
const UNTIL = /^time\(\) < (-?\d+)$/;
const SINCE = new RegExp(`^query\\('chronicle\\.passed', \\{ name: ${STRING}, minutes: (\\d+) \\}\\)$`);
const PLACE_ITEM = new RegExp(`^query\\('scene\\.place'\\)\\.(name|region) == ${STRING}$`);

const quote = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}'`;
const unquote = text => text.replace(/\\(.)/g, (_, char) => ESCAPES[char] ?? `\\${char}`);
const whole = value => Number.isSafeInteger(value);

/**
 * `{ from, until, since: { name, minutes }, dated, where: [{ kind: 'place' | 'region', name }] }` (every part optional) as a
 * condition: `{ ok: true, when }`, or `{ ok: false, reason }` in words for the author.
 */
export function writeCondition({ from = null, until = null, since = null, dated = false, where = [] } = {}) {
    if (from !== null && since) return { ok: false, reason: 'A date and a delay after another event cannot both be written.' };
    for (const value of [from, until]) if (value !== null && (!whole(value) || value < 0)) return { ok: false, reason: 'A date must be a moment of the story, not before its first day.' };
    if (since && (!whole(since.minutes) || since.minutes < 1 || typeof since.name !== 'string' || !since.name)) return { ok: false, reason: 'A delay needs a whole number of minutes and the earlier event\'s name.' };
    const words = [...since ? [since.name] : [], ...where.map(place => place.name)];
    if (words.some(word => typeof word !== 'string' || !word || [...word].length > WORD_LIMIT)) return { ok: false, reason: `A place or event name must be 1 to ${WORD_LIMIT} characters.` };
    const clauses = [];
    if (from !== null) clauses.push('time() != null', `time() >= ${from}`);
    else if (since) clauses.push(`${PASSED}${quote(since.name)}, minutes: ${since.minutes} })`);
    else if (dated && until === null) clauses.push('time() != null');
    if (until !== null) clauses.push(...from === null ? ['time() != null'] : [], `time() < ${until}`);
    if (where.length) {
        const items = where.map(place => `${PLACE}.${place.kind === 'region' ? 'region' : 'name'} == ${quote(place.name)}`);
        clauses.push(`${PLACE} != null`, `(${items.join(' || ')})`);
    }
    const when = clauses.length ? clauses.join(' && ') : 'true';
    if (when.length > EVENT_LIMITS.when) return { ok: false, reason: `That condition would be ${when.length} characters, and a pack allows ${EVENT_LIMITS.when}. Choose fewer places or regions.` };
    return { ok: true, when };
}

/** The top-level parts of a condition around `separator`, outside quotes and brackets; null when they do not balance. */
function split(source, separator) {
    const parts = [];
    let depth = 0, quoteMark = '', start = 0;
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (quoteMark) {
            if (char === '\\') i++;
            else if (char === quoteMark) quoteMark = '';
        } else if (char === '\'' || char === '"') quoteMark = char;
        else if (char === '(' || char === '{' || char === '[') depth++;
        else if (char === ')' || char === '}' || char === ']') { if (--depth < 0) return null; }
        else if (depth === 0 && source.startsWith(separator, i)) { parts.push(source.slice(start, i).trim()); i += separator.length - 1; start = i + 1; }
    }
    if (depth !== 0 || quoteMark) return null;
    parts.push(source.slice(start).trim());
    return parts;
}

/** What the form shows of a condition Studio wrote (the shape of `writeCondition`'s input), or null when it is not one. */
export function readCondition(source) {
    if (typeof source !== 'string') return null;
    const clauses = split(source, '&&');
    if (!clauses) return null;
    const out = { from: null, until: null, since: null, where: [] };
    let at = 0;
    const next = () => clauses[at];
    if (clauses.length === 1 && clauses[0] === 'true') at = 1;
    if (next() === 'time() != null') {
        at++;
        const from = FROM.exec(next() ?? '');
        if (from) { out.from = Number(from[1]); at++; }
        else if (!UNTIL.test(next() ?? '')) out.dated = true;
    } else {
        const age = SINCE.exec(next() ?? '');
        if (age) {
            out.since = { name: unquote(age[1]), minutes: Number(age[2]) };
            at++;
            if (next() === 'time() != null' && UNTIL.test(clauses[at + 1] ?? '')) at++;
        }
    }
    const until = UNTIL.exec(next() ?? '');
    if (until) { out.until = Number(until[1]); at++; }
    if (at < clauses.length) {
        if (next() !== `${PLACE} != null`) return null;
        const group = /^\((.*)\)$/s.exec(clauses[at + 1] ?? '');
        const items = group && split(group[1], '||');
        if (!items) return null;
        for (const item of items) {
            const found = PLACE_ITEM.exec(item);
            if (!found) return null;
            out.where.push({ kind: found[1] === 'region' ? 'region' : 'place', name: unquote(found[2]) });
        }
        at += 2;
    }
    if (at !== clauses.length) return null;
    const again = writeCondition(out);
    return again.ok && again.when === source && [out.from, out.until, out.since?.minutes].every(value => value === null || value === undefined || whole(value)) ? out : null;
}

/** The names of the world events a condition asks `chronicle.passed` about, written by the form or by hand. */
export function chronicleNames(source) {
    if (typeof source !== 'string') return [];
    const asked = /query\(\s*(['"])chronicle\.passed\1\s*,\s*\{\s*name\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
    return [...source.matchAll(asked)].map(found => unquote(found[2] ?? found[3]));
}

/**
 * What can be seen of any condition without reading it fully, for a list: its first `time() >=` and `time() <` moments
 * and the places and regions it names, in order. Never used to write.
 */
export function glanceCondition(source) {
    if (typeof source !== 'string') return { from: null, until: null, where: [] };
    const from = /time\(\) >= (\d+)/.exec(source);
    const until = /time\(\) < (\d+)/.exec(source);
    const where = [...source.matchAll(new RegExp(`${PLACE.replace(/[()]/g, '\\$&')}\\.(name|region) == ${STRING}`, 'g'))]
        .map(found => ({ kind: found[1] === 'region' ? 'region' : 'place', name: unquote(found[2]) }));
    return { from: from ? Number(from[1]) : null, until: until ? Number(until[1]) : null, where };
}
