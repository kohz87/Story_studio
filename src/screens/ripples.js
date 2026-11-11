// The Ripples part: the powers a player's deeds can favour (the pack's `ripples` table, read by Story Director), the
// "where a new chat starts" bar of their base sway, one card per power with its sway bar, and the power editor.
//
// The pack shape and every limit are Story Block's (its ripples checker); the form only shows them where the writer types.
// Every edit replaces the whole `ripples` table in one undoable edit, so a rename of a power's ID also moves the world
// directions that favour it; a rename or a delete that events read asks first (events quote a power's ID and are not rewritten),
// and deleting the last power removes the table. Pure helpers (shares, leader, the events that read ripples, standing keys) are exported.

import { applyEdit } from '../apply-edit.js';
import { el, button, field } from '../dom.js';
import { records } from '../records.js';
import { setSchemaField as setField } from '../edits.js';
import { commitSnapshot } from '../edits/commit.js';
import { RIPPLES_LIMITS, SLUG } from '../../vendor/story-block/src/v2/packs/limits.js';

const LIMITS = RIPPLES_LIMITS;
const READS_RIPPLES = /query\(\s*'ripples\./;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));

/** The pack's powers with their index in the table (the index is what an edit writes to), skipping anything that is not an object. */
export function powersOf(model) {
    const powers = Array.isArray(model?.document?.ripples?.powers) ? model.document.ripples.powers : [];
    return powers.map((power, idx) => ({ power, idx })).filter(({ power }) => isRecord(power));
}

/** Each power's share of the new-chat sway: its base over the bases of all the powers, as a percentage (0 when none has base). */
export function baseShares(powers) {
    const bases = powers.map(power => (Number.isFinite(power?.base) ? power.base : 0));
    const total = bases.reduce((sum, base) => sum + base, 0);
    return powers.map((power, i) => ({ id: power?.id ?? '', name: power?.name || power?.id || '', base: bases[i], share: total > 0 ? (bases[i] / total) * 100 : 0 }));
}

/** The power that leads at the start of a chat: the highest base, the first in the table on a tie; null for no powers. */
export function leaderAtStart(powers) {
    let leader = null;
    for (const power of powers) if (isRecord(power) && Number.isFinite(power.base) && (!leader || power.base > leader.base)) leader = power;
    return leader;
}

/** How many of the pack's events have a condition that reads a ripples query (`query('ripples.…')`). */
export function countRippleEvents(events) {
    return (Array.isArray(events) ? events : []).filter(event => isRecord(event) && typeof event.when === 'string' && READS_RIPPLES.test(event.when)).length;
}

/**
 * The standing keys a power may follow: the keys of the map fields of the data module the table names (`standingModule`,
 * matched by name or slug), or of every data module when that module is not in the pack. Each key once, in pack order.
 */
export function standingKeys(model) {
    const modules = (Array.isArray(model?.document?.content?.dataModules) ? model.document.content.dataModules : []).filter(isRecord);
    const wanted = model?.document?.ripples?.standingModule;
    const named = typeof wanted === 'string' && wanted ? modules.filter(mod => mod.name === wanted || mod.slug === wanted) : [];
    const keys = [];
    for (const mod of named.length ? named : modules) {
        for (const field of Object.values(isRecord(mod.state) ? mod.state : {})) {
            if (!isRecord(field) || field.type !== 'map' || !Array.isArray(field.keys)) continue;
            for (const key of field.keys) if (typeof key === 'string' && !keys.includes(key)) keys.push(key);
        }
    }
    return keys;
}

/** The events whose condition quotes the ID (`'corvin'` or `"corvin"`), by name: a rename or delete leaves these reading nothing. */
export function eventsQuoting(events, id) {
    return (Array.isArray(events) ? events : []).filter(event => isRecord(event) && typeof event.when === 'string' && (event.when.includes(`'${id}'`) || event.when.includes(`"${id}"`)));
}

/** Why a power ID cannot be used, or '': Story Block's slug (up to its 40 characters) and not another power's ID. */
export function powerIdProblem(id, powers, current = null) {
    if (!id) return 'ID: a power needs an ID.';
    if (!SLUG.test(id) || id.length > LIMITS.id) return `ID: use lower-case letters and digits with single hyphens between them (up to ${LIMITS.id}).`;
    if (id !== current && powers.some(power => power?.id === id)) return `ID: another power already uses “${id}”.`;
    return '';
}

/** A power ID no other power uses: `new-power`, then `new-power-2`, `new-power-3`… */
export function freshPowerId(powers) {
    const taken = new Set(powers.map(power => power?.id));
    let id = 'new-power';
    for (let n = 2; taken.has(id); n++) id = `new-power-${n}`;
    return id;
}

// --- edits -----------------------------------------------------------------------------------------------------------

/** Writes a new ripples table in one edit: `mutate` changes a copy of the current table. */
function commit(ctx, mutate, selection) {
    const next = copy(ctx.model?.document?.ripples ?? {});
    mutate(next);
    return applyEdit(ctx, setField(ctx.model, ['ripples'], next), selection);
}

function keepList(power, key, list) {
    if (list.length) power[key] = list;
    else delete power[key];
}

function addPower(ctx) {
    const powers = powersOf(ctx.model).map(({ power }) => power);
    if (powers.length >= LIMITS.powers) { ctx.notify(`A pack has at most ${LIMITS.powers} powers.`); return; }
    const id = freshPowerId(powers);
    const fresh = { id, name: 'New power', base: 20 };
    commit(ctx, next => { next.powers = [...(Array.isArray(next.powers) ? next.powers : []), fresh]; }, { id });
    ctx.select('ripples', id);
}

function removePower(ctx, idx) {
    const left = (ctx.model.document.ripples.powers || []).length - 1;
    if (left > 0) {
        const gone = ctx.model.document.ripples.powers[idx]?.id;
        // A world direction that favours the removed power would point at nothing (the checker refuses it): it goes with the power.
        commit(ctx, next => {
            next.powers.splice(idx, 1);
            if (Array.isArray(next.worldDirections)) {
                next.worldDirections = next.worldDirections.filter(direction => direction?.favours !== gone);
                if (!next.worldDirections.length) delete next.worldDirections;
            }
        }, { id: null });
        return;
    }
    // The last power: the table goes (an empty one is not valid, and a chat with no table follows the pack's default road).
    const doc = copy(ctx.model.document);
    delete doc.ripples;
    applyEdit(ctx, commitSnapshot(doc, ctx.model), { id: null });
}

/** What a delete would change beyond the power itself, as sentences for the confirmation. */
function deleteNotes(model, power, reads) {
    const notes = [];
    if (reads > 0) notes.push(`${reads} ${reads === 1 ? 'event reads' : 'events read'} these powers, and the powers they read by position move up`);
    const directions = (Array.isArray(model?.document?.ripples?.worldDirections) ? model.document.ripples.worldDirections : []).filter(direction => direction?.favours === power.id).length;
    if (directions) notes.push(`${directions} world ${directions === 1 ? 'direction favours' : 'directions favour'} it and will be removed`);
    if (powersOf(model).length === 1) notes.push('this is the last power, so the whole Ripples table is removed');
    return notes;
}

/** A confirmation under `host`: the message, a button that goes ahead and one that backs out (which also runs `onNo`). */
function askInline(doc, host, message, yesLabel, onYes, onNo) {
    const box = el(doc, 'div', '', { class: 'ripples-ask', role: 'alert' });
    box.append(el(doc, 'p', message),
        button(doc, yesLabel, onYes, { class: 'danger' }),
        button(doc, 'Cancel', () => { box.remove(); onNo?.(); }));
    host.append(box);
}

// --- the screen --------------------------------------------------------------------------------------------------------

/** The Ripples screen: the bar and the power cards in the middle, the selected power's editor in the inspector. */
export function renderRipples(ctx) {
    const { doc, model } = ctx;
    const powers = powersOf(model);
    const shares = baseShares(powers.map(({ power }) => power));
    const leader = leaderAtStart(powers.map(({ power }) => power));
    const reads = countRippleEvents(records(model, 'events'));
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    header.append(el(doc, 'h1', 'Ripples'),
        el(doc, 'div', 'Powers your deeds can favour. Each deed for their people, factions or quest givers adds sway; the pack\'s events read who leads.', { class: 'records-subtitle' }),
        button(doc, '+ Power', () => addPower(ctx)));
    screen.append(header);

    if (!powers.length) screen.append(el(doc, 'p', 'No powers yet. A power is a claimant or a faction your deeds can favour.', { class: 'muted' }));
    if (powers.length) screen.append(startBar(doc, shares, leader));

    const cards = el(doc, 'div', '', { class: 'records-list' });
    for (const { power, idx } of powers) cards.append(powerCard(ctx, power, idx, shares[powers.findIndex(item => item.idx === idx)]));
    screen.append(cards);
    screen.append(el(doc, 'p', `Read by ${reads} ${reads === 1 ? 'event' : 'events'}: the pack's conditions that query ripples. A chat with no Ripples table follows the pack's default road.`, { class: 'records-note muted' }));
    ctx.main.append(screen);

    const inspector = ctx.inspector || screen;
    const selected = powers.find(({ power }) => power.id === ctx.selection.id);
    if (!selected) { inspector.append(el(doc, 'p', 'Select a power from the list to read and edit it.', { class: 'muted' })); return; }
    inspector.append(button(doc, '‹ Back to the list', () => ctx.select('ripples', null), { class: 'back-to-list' }));
    renderPower(ctx, inspector, selected);
}

function startBar(doc, shares, leader) {
    const bar = el(doc, 'div', '', { class: 'records-note ripples-start', 'aria-label': 'Where a new chat starts' });
    const track = el(doc, 'div', '', { class: 'cf-bar', role: 'img', 'aria-label': shares.map(item => `${item.name} ${item.base}`).join(', ') });
    for (const item of shares) {
        const part = el(doc, 'span', '', { class: `cf-bar-part cf-bar-${shares.indexOf(item) % 3}` });
        part.style?.setProperty('flex', String(item.base));
        track.append(part);
    }
    const legend = el(doc, 'div', '', { class: 'ripples-legend' });
    shares.forEach((item, i) => legend.append(el(doc, 'span', `● ${item.name} ${item.base}`, { class: `ripples-dot ripples-dot-${i % 3}` })));
    if (leader) legend.append(el(doc, 'span', `Leader at start: ${leader.name || leader.id}`, { class: 'muted ripples-leader' }));
    bar.append(el(doc, 'span', 'Where a new chat starts', { class: 'cf-label' }), el(doc, 'span', 'from each power\'s base sway', { class: 'cf-hint' }), track, legend);
    return bar;
}

function powerCard(ctx, power, idx, share) {
    const { doc } = ctx;
    const id = typeof power.id === 'string' ? power.id : '';
    const card = button(doc, '', () => ctx.select('ripples', id), { class: 'record-card ripple-card', 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
    if (!id) card.disabled = true;
    const head = el(doc, 'span', '', { class: 'record-card-header' });
    head.append(el(doc, 'span', power.name || id || `Power ${idx + 1}`, { class: 'record-card-name' }), el(doc, 'span', String(Number.isFinite(power.base) ? power.base : '?'), { class: 'record-card-meta' }));
    const track = el(doc, 'span', '', { class: 'cf-bar' });
    const fill = el(doc, 'span', '', { class: 'cf-bar-part' });
    fill.style?.setProperty('width', `${Math.max(0, Math.min(100, Number.isFinite(power.base) ? power.base : 0))}%`);
    track.append(fill);
    const counts = [['names', power.aliases], ['factions', power.factions], ['givers', power.givers], ['people', power.npcs]]
        .map(([label, list]) => `${Array.isArray(list) ? list.length : 0} ${label}`).join(' · ');
    card.append(head, track, el(doc, 'span', `${counts}${share ? ` · ${Math.round(share.share)}% of a new chat` : ''}`, { class: 'record-card-meta' }));
    if (!id) card.setAttribute('data-has-problem', 'true');
    return card;
}

// --- the power editor --------------------------------------------------------------------------------------------------

function powerProblems(model, idx) {
    const prefix = `ripples.powers.${idx}`;
    return (model?.validation?.errors ?? []).filter(err => {
        const path = String(err.path ?? '').replace(/\[(\d+)\]/g, '.$1');
        return path === prefix || path.startsWith(`${prefix}.`) || path === 'ripples' || path === 'ripples.powers';
    }).map(err => err.message).filter(Boolean);
}

function renderPower(ctx, inspector, { power, idx }) {
    const { doc, model } = ctx;
    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    const ask = el(doc, 'div', '');
    const reads = countRippleEvents(records(model, 'events'));
    const del = button(doc, 'Delete', () => {
        const notes = deleteNotes(model, power, reads);
        if (!notes.length) { removePower(ctx, idx); return; }
        del.disabled = true;
        askInline(doc, ask, `Delete “${power.name || power.id}”? ${notes.join('; ')}.`, 'Delete anyway', () => removePower(ctx, idx), () => { del.disabled = false; });
    }, { class: 'danger' });
    titleRow.append(el(doc, 'h2', power.name || power.id), del);
    inspector.append(titleRow, ask);
    const problems = powerProblems(model, idx);
    if (problems.length) inspector.append(el(doc, 'div', problems.join('\n'), { role: 'status', class: 'warning' }));

    const form = el(doc, 'div', '', { class: 'inspector-form-body cf-form' });
    form.append(
        nameFields(ctx, power, idx),
        listGroup(ctx, 'Also called', power, idx, 'aliases', 'Name'),
        baseField(ctx, power, idx),
        listGroup(ctx, 'Factions that count for them', power, idx, 'factions', 'Faction'),
        listGroup(ctx, 'Quest givers', power, idx, 'givers', 'Giver'),
        peopleGroup(ctx, power, idx),
        standingField(ctx, power, idx),
    );
    inspector.append(form);
}

function textField(doc, title, value, onCommit, maxlength = LIMITS.name) {
    const input = el(doc, 'input', '', { type: 'text', maxlength: String(maxlength) });
    input.value = typeof value === 'string' ? value : '';
    input.addEventListener('change', () => onCommit(input.value.trim(), input));
    return field(doc, title, input);
}

function nameFields(ctx, power, idx) {
    const { doc } = ctx;
    const row = el(doc, 'div', '', { class: 'cf-grid' });
    row.append(
        textField(doc, 'Name', power.name, value => {
            if (!value) { ctx.notify('name: a power needs a name.'); return; }
            commit(ctx, next => { next.powers[idx].name = value; });
        }),
        textField(doc, 'ID', power.id, (value, input) => {
            if (value === power.id) return;
            const problem = powerIdProblem(value, powersOf(ctx.model).map(item => item.power), power.id);
            if (problem) { ctx.notify(problem); input.value = power.id; return; }
            const rename = () => commit(ctx, next => {
                next.powers[idx].id = value;
                for (const direction of Array.isArray(next.worldDirections) ? next.worldDirections : []) if (direction?.favours === power.id) direction.favours = value;
            }, { id: value });
            const quoting = eventsQuoting(records(ctx.model, 'events'), power.id);
            if (!quoting.length) { rename(); return; }
            // Events that quote the old ID would never match the new one, and Studio does not rewrite a condition: ask first.
            const names = quoting.slice(0, 3).map(event => event.name || event.id || 'an event').join(', ');
            askInline(doc, row, `${quoting.length} ${quoting.length === 1 ? 'event compares' : 'events compare'} against “${power.id}” (${names}${quoting.length > 3 ? '…' : ''}) and would stop matching. Rename anyway?`, 'Rename anyway', rename, () => { input.value = power.id; });
        }, LIMITS.id),
    );
    return row;
}

function baseField(ctx, power, idx) {
    const { doc } = ctx;
    const shown = el(doc, 'span', String(power.base), { class: 'cf-label' });
    const range = el(doc, 'input', '', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Base sway' });
    range.value = String(power.base);
    range.addEventListener('input', () => { shown.textContent = range.value; });
    range.addEventListener('change', () => commit(ctx, next => { next.powers[idx].base = Number(range.value); }));
    const wrap = el(doc, 'div', '', { class: 'field' });
    wrap.append(el(doc, 'span', 'Base sway', { class: 'cf-label' }), shown, range);
    return wrap;
}

function listGroup(ctx, title, power, idx, key, placeholder) {
    const { doc } = ctx;
    const list = Array.isArray(power[key]) ? power[key] : [];
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset cf' });
    set.append(el(doc, 'legend', title));
    const chips = el(doc, 'div', '', { class: 'names-chips' });
    list.forEach((item, i) => {
        const chip = el(doc, 'span', '', { class: 'chip' });
        chip.append(el(doc, 'span', item), button(doc, '✕', () => commit(ctx, next => keepList(next.powers[idx], key, next.powers[idx][key].filter((_, j) => j !== i))), { class: 'x', 'aria-label': `Remove ${item}` }));
        chips.append(chip);
    });
    const input = el(doc, 'input', '', { type: 'text', placeholder, maxlength: String(LIMITS.name), 'aria-label': `${title}: new` });
    const submit = () => {
        const value = input.value.trim();
        if (!value) return;
        if (value.length > LIMITS.name) { ctx.notify(`${key}: at most ${LIMITS.name} characters.`); return; }
        if (list.length >= LIMITS.list) { ctx.notify(`${key}: at most ${LIMITS.list} entries.`); return; }
        if (list.includes(value)) { ctx.notify(`${key}: "${value}" is already here.`); return; }
        commit(ctx, next => { next.powers[idx][key] = [...(Array.isArray(next.powers[idx][key]) ? next.powers[idx][key] : []), value]; });
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    set.append(chips, input, button(doc, `+ ${placeholder}`, submit, { class: 'cf-add' }));
    return set;
}

function weightPicker(doc, weight, onPick) {
    const group = el(doc, 'span', '', { class: 'cf-seg', role: 'group', 'aria-label': 'Weight' });
    for (const value of [1, 2, 3]) group.append(button(doc, String(value), () => onPick(value), { class: value === weight ? 'on' : '', 'aria-pressed': String(value === weight) }));
    return group;
}

function peopleGroup(ctx, power, idx) {
    const { doc } = ctx;
    const people = Array.isArray(power.npcs) ? power.npcs : [];
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset cf' });
    set.append(el(doc, 'legend', 'People who count, and how much'));
    people.forEach((npc, i) => {
        const row = el(doc, 'div', '', { class: 'cf-list-rows ripples-person' });
        row.append(el(doc, 'span', npc.name),
            weightPicker(doc, npc.weight ?? 1, value => commit(ctx, next => { next.powers[idx].npcs[i].weight = value; })),
            button(doc, '✕', () => commit(ctx, next => keepList(next.powers[idx], 'npcs', next.powers[idx].npcs.filter((_, j) => j !== i))), { class: 'x', 'aria-label': `Remove ${npc.name}` }));
        set.append(row);
    });
    const input = el(doc, 'input', '', { type: 'text', placeholder: 'Name', maxlength: String(LIMITS.name), 'aria-label': 'Person: new' });
    const submit = () => {
        const value = input.value.trim();
        if (!value) return;
        if (value.length > LIMITS.name) { ctx.notify(`npcs: a name is at most ${LIMITS.name} characters.`); return; }
        if (people.length >= LIMITS.list) { ctx.notify(`npcs: at most ${LIMITS.list} people.`); return; }
        commit(ctx, next => { next.powers[idx].npcs = [...(Array.isArray(next.powers[idx].npcs) ? next.powers[idx].npcs : []), { name: value, weight: 1 }]; });
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    set.append(input, button(doc, '+ Person', submit, { class: 'cf-add' }));
    return set;
}

function standingField(ctx, power, idx) {
    const { doc, model } = ctx;
    const select = el(doc, 'select', '', { 'aria-label': 'Reputation it follows (optional)' });
    select.append(el(doc, 'option', '(none)', { value: '' }));
    const keys = standingKeys(model);
    if (power.standing && !keys.includes(power.standing)) keys.push(power.standing);
    for (const key of keys) select.append(el(doc, 'option', key, { value: key }));
    select.value = power.standing ?? '';
    select.addEventListener('change', () => commit(ctx, next => {
        if (select.value) next.powers[idx].standing = select.value;
        else delete next.powers[idx].standing;
    }));
    return field(doc, 'Reputation it follows (optional)', select);
}
