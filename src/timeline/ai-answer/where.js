// Places an answer names, matched to the pack's regions, places and aliases; and an event's "where" list read against them.
import { records } from '../../records.js';
import { isRecord, text, fold, clip, size, describe, NAME_READ } from './values.js';

const MAX_WHERE = 30;

export function placeFinder(model) {
    const places = records(model, 'places').filter(isRecord);
    const byKey = (pick, kind) => {
        const map = new Map();
        for (const place of places) for (const name of pick(place)) if (typeof name === 'string' && name.trim() && !map.has(fold(name))) map.set(fold(name), { kind, name: kind === 'region' ? name : place.name });
        return map;
    };
    const regions = byKey(place => [place.region], 'region');
    const names = byKey(place => [place.name], 'place');
    const aliases = byKey(place => (Array.isArray(place.aliases) ? place.aliases : []), 'place');
    // A name that is both a region and a place is the region. Anything the pack lacks is kept as it was written, as a place.
    return name => regions.get(fold(name)) ?? names.get(fold(name)) ?? aliases.get(fold(name)) ?? { kind: 'place', name };
}

// The places an event is limited to: `{ list, note, cut }`; `note` says in words what could not be read, `cut` how many names
// were shortened. The answer's own limit on how many are read, and a Set for the duplicates, keep a hostile list cheap.
export function readWhere(raw, find) {
    if (raw === undefined) return { list: [] };
    const asked = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : null;
    if (!asked) return { list: [], note: `“where” should be “anywhere” or a list of region and place names, not ${describe(raw)}: choose the places in the form.` };
    const out = [];
    const seen = new Set();
    let unread = 0, cut = 0;
    for (const item of asked.slice(0, MAX_WHERE)) {
        if (typeof item !== 'string') { unread++; continue; }
        const name = clip(text(item), NAME_READ);
        if (size(item.trim()) > NAME_READ) cut++;
        if (!name || ['anywhere', 'any', 'everywhere'].includes(fold(name))) continue;
        const place = find(name);
        const key = `${place.kind}:${place.name}`;
        if (!seen.has(key)) { seen.add(key); out.push(place); }
    }
    const rest = Math.max(0, asked.length - MAX_WHERE);
    const said = [];
    if (unread) said.push(`${unread === 1 ? 'a place' : `${unread} places`} that ${unread === 1 ? 'is' : 'are'} not a name`);
    if (rest) said.push(`${rest} more than the ${MAX_WHERE} that are read`);
    return { list: out, cut, ...said.length ? { note: `Left out of “where”: ${said.join(' and ')}. Check the places in the form.` } : {} };
}
