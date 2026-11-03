// The gear fields of an item (`story-block.gear`): slot, rarity with its stat budget, and the stat picker.
// The names and numbers are Story Block's (domains/gear.js GEAR): the same seven stats, the budget a rarity gives,
// at most two stats. A piece that is none of those is left as it is; Studio only refuses what it would write.
import { el, button, field, safeLabel } from './dom.js';
import { RARITIES } from '../vendor/story-block/src/v2/packs/limits.js';
import { GEAR } from '../vendor/story-block/src/v2/domains/gear.js';

export const GEAR_SLOTS = Object.freeze([
    ['head', 'Head'], ['body', 'Body'], ['cloak', 'Cloak'], ['feet', 'Feet'], ['weapon', 'Weapon'], ['off-hand', 'Off-hand'], ['accessory', 'Accessory'],
]);
// The slot list above is only the order and labels of the menu; the words must be Story Block's (tests/gear-form.test.js).
export const GEAR_STATS = GEAR.stats;
export const GEAR_BUDGET = GEAR.budget;
export const GEAR_MAX_STATS = GEAR.maxStats;
export const GEAR_KEYS = Object.freeze(['slot', 'rarity', 'stats']);

const isStats = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const total = stats => Object.values(stats).reduce((sum, n) => sum + n, 0);
/** The stat points a rarity gives (0 for a word Story Block does not know). */
export const budgetOf = rarity => (Object.hasOwn(GEAR_BUDGET, rarity) ? GEAR_BUDGET[rarity] : 0);

/** The reason a stats map is not one Story Block holds to the rarity's budget, or '' when it is fine.
 *  `edited` (`{ stat, points }`) is the picker edit that was refused; the budget reason then names that edit. */
export function statsProblem(stats, rarity, edited = null) {
    const entries = Object.entries(stats);
    if (entries.length > GEAR_MAX_STATS) return `A piece raises at most ${GEAR_MAX_STATS} stats.`;
    if (entries.some(([name, n]) => !GEAR_STATS.includes(name) || !Number.isSafeInteger(n) || n < 1)) return 'Stats are whole points of 1 or more on STR, VIT, AGI, DEX, INT, LUK or CHA.';
    const budget = budgetOf(rarity);
    const used = total(stats);
    if (used > budget && edited) return `${edited.stat} ${edited.points} would use ${used} ${used === 1 ? 'point' : 'points'}; ${safeLabel(rarity)} gives ${budget}.`;
    if (used > budget) return `The points add up to ${used}; ${safeLabel(rarity)} gives ${budget}.`;
    return '';
}

// Whether the picker can show this stats value; anything else (other names, text) stays in the JSON box below it.
const pickable = stats => !stats || (isStats(stats) && Object.entries(stats).every(([name, n]) => GEAR_STATS.includes(name) && Number.isSafeInteger(n) && n >= 1) && Object.keys(stats).length <= GEAR_MAX_STATS);

function renderSlot(doc, row, record, commit, attrs) {
    const current = record.slot ?? null;
    const known = GEAR_SLOTS.some(([word]) => word === current);
    const select = el(doc, 'select', '', attrs);
    const none = el(doc, 'option', 'none', { value: '' });
    none.selected = current === null; select.append(none);
    for (const [word, label] of GEAR_SLOTS) {
        const option = el(doc, 'option', label, { value: word });
        option.selected = word === current; select.append(option);
    }
    if (current !== null && !known) {
        const other = el(doc, 'option', `other: ${safeLabel(current)}`, { value: '__current__' });
        other.selected = true; select.append(other);
    }
    select.addEventListener('change', () => {
        if (select.value === '__current__' || (select.value === '' && current === null)) return;
        const next = { ...record };
        if (select.value === '') delete next.slot; else next.slot = select.value;
        if (!commit(next)) select.value = current === null ? '' : known ? current : '__current__';
    });
    row.append(field(doc, 'slot', select), el(doc, 'p', 'Worn gear gives its stats in fights. A bag is no slot: leave it on none and give it a carry.', { class: 'muted' }));
}

function renderRarity(doc, row, record, commit, attrs) {
    const current = record.rarity;
    const select = el(doc, 'select', '', attrs);
    for (const word of RARITIES) {
        const option = el(doc, 'option', `${word} (+${budgetOf(word)})`, { value: word });
        option.selected = word === current; select.append(option);
    }
    if (!RARITIES.includes(current)) {
        const bad = el(doc, 'option', `${safeLabel(current)} (invalid)`, { value: '__current__', disabled: '' });
        bad.selected = true; select.append(bad);
    }
    select.addEventListener('change', () => {
        if (select.value !== '__current__' && !commit({ ...record, rarity: select.value })) select.value = RARITIES.includes(current) ? current : '__current__';
    });
    row.append(field(doc, 'rarity', select));
}

function renderStats(doc, row, record, commit, attrs, renderJson) {
    const stats = record.stats;
    if (!pickable(stats)) { renderJson(); return; }
    const given = stats ?? {};
    const budget = budgetOf(record.rarity);
    const group = el(doc, 'fieldset', '', { class: 'form-fieldset gear-stats', ...attrs });
    group.append(el(doc, 'legend', 'stats'));
    const note = el(doc, 'p', `Budget ${budget} from ${safeLabel(record.rarity)}; used ${total(given)}. Up to ${GEAR_MAX_STATS} stats.`, { class: 'muted' });
    const error = el(doc, 'p', '', { class: 'warning', role: 'alert' });
    const show = text => { error.textContent = text; };
    show(statsProblem(given, record.rarity));
    // `entries` is what the picker rows say; a change is written only when it passes, else the error stays and nothing is stored.
    // `edited` names the picker edit, so a refused one says what was tried; the caller then puts the stored values back.
    const write = (entries, edited = null) => {
        const next = Object.fromEntries(entries);
        const reason = entries.length !== Object.keys(next).length ? 'A stat can be chosen once.' : statsProblem(next, record.rarity, edited);
        if (reason) { show(reason); return false; }
        show('');
        const copy = { ...record };
        if (entries.length) copy.stats = next; else delete copy.stats;
        return commit(copy);
    };
    const rows = Object.entries(given);
    rows.forEach(([name, points], index) => {
        const line = el(doc, 'div', '', { class: 'gear-stat-row' });
        const body = el(doc, 'div', '', { class: 'gear-stat-pair' });
        const pick = el(doc, 'select', '', { 'data-gear-stat': String(index), 'aria-label': `stat ${index + 1}` });
        for (const stat of GEAR_STATS) {
            const option = el(doc, 'option', stat, { value: stat });
            option.selected = stat === name; pick.append(option);
        }
        const amount = el(doc, 'input', '', { type: 'number', step: '1', min: '1', 'data-gear-points': String(index), 'aria-label': `points ${index + 1}` });
        amount.value = String(points);
        pick.addEventListener('change', () => { if (!write(rows.map((entry, i) => (i === index ? [pick.value, entry[1]] : entry)), { stat: pick.value, points })) pick.value = name; });
        amount.addEventListener('change', () => {
            const n = Number(amount.value);
            if (!/^\d+$/.test(amount.value.trim()) || !Number.isSafeInteger(n) || n < 1) { show('Points are a whole number of 1 or more.'); amount.value = String(points); return; }
            if (!write(rows.map((entry, i) => (i === index ? [entry[0], n] : entry)), { stat: name, points: n })) amount.value = String(points);
        });
        body.append(field(doc, `stat ${index + 1}`, pick), field(doc, 'points', amount));
        line.append(body, button(doc, 'Remove', () => write(rows.filter((_, i) => i !== index)), { class: 'danger', 'aria-label': `Remove stat ${index + 1}` }));
        group.append(line);
    });
    const add = button(doc, '+ Add stat', () => {
        if (rows.length >= GEAR_MAX_STATS) { show(`A piece raises at most ${GEAR_MAX_STATS} stats.`); return; }
        if (total(given) + 1 > budget) { show(budget === 0 ? 'Common gear gives no stat points.' : `All ${budget} points are used.`); return; }
        const free = GEAR_STATS.find(stat => !Object.hasOwn(given, stat));
        write([...rows, [free, 1]]);
    }, { class: 'gear-add-btn', 'aria-label': 'Add stat' });
    group.append(add, note, error);
    row.append(group);
}

/** Draws one of the gear fields (`GEAR_KEYS`) of an item in place of the generic control; `commit` stores a whole new record. */
export function renderGearField(ctx, row, key, record, commit, attrs, renderJson) {
    const doc = ctx.doc;
    if (key === 'slot') renderSlot(doc, row, record, commit, attrs);
    else if (key === 'rarity') renderRarity(doc, row, record, commit, attrs);
    else renderStats(doc, row, record, commit, attrs, renderJson);
}
