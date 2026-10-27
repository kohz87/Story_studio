// The trainer template editor (docs/v2/OPEN_TRAINERS_SPEC.md §13.3, mockups docs/v2/mockups/open-trainers): a template is a trainer with
// `open: true`, a pack rank, a fee range and no place. Fixed trainers keep the generic form. Every edit goes through src/edits.js and
// apply-edit.js like any other record, so undo, Problems and export work unchanged. DOM through createElement and textContent only.

import { applyEdit } from '../apply-edit.js';
import { safeLabel, el, button, icon } from '../dom.js';
import { records, identity, localId, kindPath } from '../records.js';
import { add, renameId, setSchemaField as setField } from '../edits.js';
import { schemaForKind, schemaForRecord, validateField } from '../form-schema.js';
import { parseIntegerInput, referenceId } from '../forms.js';
import { baseUnit, coinsOf } from '../../vendor/story-block/src/v2/domains/money.js';

export const NO_RANKS = 'Add a rank in Pack settings first.';
const FEE_CHECK_MESSAGE = 'Lowest fee must not be above the highest.';
const WHOLE = new Intl.NumberFormat('en-US');
const number = n => WHOLE.format(n);

const ranksOf = model => (Array.isArray(model?.document?.content?.ranks) ? model.document.content.ranks : []).filter(row => row && typeof row === 'object' && typeof row.id === 'string');
const rankRow = (model, id) => ranksOf(model).find(row => row.id === id);
const rewardOf = row => (Array.isArray(row?.reward) && row.reward.length === 2 && row.reward.every(Number.isFinite) ? row.reward : null);
const isCount = value => Number.isSafeInteger(value);

/** Why a fixed trainer cannot become a template (or an empty string): a template names a pack rank. */
export function canConvertToTemplate(model) {
    return ranksOf(model).length ? '' : NO_RANKS;
}

/** The card line of a template: `open-blade-drills · rank F · fee 40–90`. */
export function templateMeta(id, record) {
    const fee = record?.fee && typeof record.fee === 'object' ? ` · fee ${safeLabel(record.fee.coinMin)}–${safeLabel(record.fee.coinMax)}` : '';
    return `${safeLabel(id)}${typeof record?.rank === 'string' && record.rank ? ` · rank ${safeLabel(record.rank)}` : ''}${fee}`;
}

/** A new template as §13.2 gives it: the first pack rank, an empty skill list and a fee of 1 (the checker asks for a skill before export). */
export function newTemplateRecord(model, slug, name) {
    return { slug, name, open: true, rank: ranksOf(model)[0]?.id ?? '', skills: [], fee: { coinMin: 1, coinMax: 1 }, minutes: 60, eventTemplates: [] };
}

/** Fixed to template: the place goes, a fee of n becomes { coinMin: n, coinMax: n }, the rank is the first pack rank. */
export function trainerToTemplate(record, rank) {
    const fee = isCount(record.fee) ? record.fee : 1;
    return { slug: record.slug, name: record.name, open: true, rank, skills: record.skills ?? [], fee: { coinMin: fee, coinMax: fee }, minutes: 60, eventTemplates: record.eventTemplates ?? [] };
}

/** Template to fixed: it stands at `place` and charges `fee`; the rank and the range go. */
export function templateToFixed(record, place, fee) {
    return { slug: record.slug, name: record.name, place, skills: record.skills ?? [], fee, minutes: 60, eventTemplates: record.eventTemplates ?? [] };
}

/**
 * What the pack calls the money a fee is paid in, the way Story Block names it: the coin worth 1 when the pack lists coins, else the
 * currency's own name and plural (a plural left out follows Story Block's rule), and Story Block's own default when the pack names none.
 * Fees are in that smallest unit. Returns `{ name, plural }`.
 */
export function feeUnit(model) {
    const currency = model?.document?.currency;
    const tidy = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
    const name = tidy(currency?.name);
    if (!name) return baseUnit();
    const plural = tidy(currency.plural);
    return baseUnit({ name, ...(plural ? { plural } : {}), coins: coinsOf(currency.coins) });
}

/** An amount with its unit: "1 crown", "40 copper", "90 crowns". */
export function feeAmount(model, amount) {
    const unit = feeUnit(model);
    return `${number(amount)} ${amount === 1 ? unit.name : unit.plural}`;
}

const basePath = idx => [...kindPath('trainers'), idx];
// A conversion replaces the whole record, so it is checked against the union of both variants.
const whole = idx => ({ rootPath: basePath(idx), rootSchema: schemaForKind('trainers') });

function uniqueTemplateIdentity(model) {
    const slugs = new Set(['classes', 'skills', 'branches', 'trainers'].flatMap(kind => records(model, kind).map(record => identity(record, kind))));
    for (let n = 1; ; n++) {
        const slug = n === 1 ? 'new-trainer-template' : `new-trainer-template-${n}`;
        if (!slugs.has(slug)) return { slug, name: n === 1 ? 'New trainer template' : `New trainer template ${n}` };
    }
}

/** "Trainer template" in the Add menu: the template is added at once and opened in the editor. */
export function addTrainerTemplate(ctx) {
    if (canConvertToTemplate(ctx.model)) { ctx.notify(NO_RANKS); return false; }
    const { slug, name } = uniqueTemplateIdentity(ctx.model);
    const result = add(ctx.model, 'trainers', newTemplateRecord(ctx.model, slug, name));
    if (!applyEdit(ctx, result, { id: slug })) return false;
    if (ctx.filters?.trainers === 'fixed') ctx.filters.trainers = 'all';
    ctx.select('trainers', slug);
    return true;
}

/** "Convert to template" on a fixed trainer's inspector. */
export function convertToTemplate(ctx, idx, id) {
    const blocked = canConvertToTemplate(ctx.model);
    if (blocked) { ctx.notify(blocked); return false; }
    const record = records(ctx.model, 'trainers')[idx];
    if (!record || record.open === true) return false;
    // The place it stood at is remembered, so converting it back to a fixed trainer can offer it again.
    if (typeof record.place === 'string' && record.place) ctx.trainerUi = { ...(ctx.trainerUi ?? { id: null }), places: { ...(ctx.trainerUi?.places ?? {}), [record.slug]: record.place } };
    const result = setField(ctx.model, basePath(idx), trainerToTemplate(record, ranksOf(ctx.model)[0].id), whole(idx));
    return applyEdit(ctx, result, { id });
}

// What the skill picker remembers while the same template stays open: the order of its groups (those with a chosen skill first, then the
// pack's order, fixed when the editor opens so a tick never moves a group), the search, whether the list is folded, and its scroll.
function uiFor(ctx, id) {
    if (ctx.trainerUi?.id !== id) ctx.trainerUi = { id, order: null, query: '', folded: false, scroll: 0, places: ctx.trainerUi?.places ?? {} };
    return ctx.trainerUi;
}

function skillGroups(model) {
    const names = new Map(records(model, 'skills').map(skill => [localId(model, identity(skill, 'skills')), skill.name]));
    const seen = new Set();
    const groups = [];
    for (const klass of records(model, 'classes')) {
        const skills = [];
        for (const ref of Array.isArray(klass.skills) ? klass.skills : []) {
            const slug = localId(model, ref);
            if (typeof slug !== 'string' || !names.has(slug) || seen.has(slug)) continue;
            seen.add(slug);
            skills.push({ slug, name: safeLabel(names.get(slug) ?? slug) });
        }
        if (skills.length) groups.push({ key: `class:${localId(model, identity(klass, 'classes'))}`, title: `Tier ${safeLabel(klass.tier)} · ${safeLabel(klass.name ?? identity(klass, 'classes'))}`, search: `tier ${klass.tier} ${klass.name ?? ''}`.toLowerCase(), skills });
    }
    const loose = [...names].filter(([slug]) => !seen.has(slug)).map(([slug, name]) => ({ slug, name: safeLabel(name ?? slug) }));
    if (loose.length) groups.push({ key: 'none', title: 'Not in a class', search: 'not in a class', skills: loose });
    return groups;
}

// The scrolling pane of the inspector, so an edit that redraws the page leaves the reader where they were.
const scroller = ctx => ctx.inspector?.parentElement ?? null;

// The control of `root` whose data-ctl is `ctl`. Compared as text, never put in a selector: a key can carry any character an author wrote.
const byCtl = (root, ctl) => [...(root?.querySelectorAll?.('[data-ctl]') ?? [])].find(node => node.getAttribute('data-ctl') === ctl) ?? null;

// Puts focus on a control; a text field also selects what it holds, as tabbing into it does, so the next keystrokes replace the
// old value instead of landing in the middle of it.
function focusControl(node) {
    if (!node) return;
    node.focus?.();
    const type = node.tagName === 'INPUT' ? (node.getAttribute('type') ?? 'text') : node.tagName === 'TEXTAREA' ? 'text' : '';
    if (['text', 'search', 'number', 'tel', 'url', 'email', 'password'].includes(type)) node.select?.();
}

// Runs an edit that redraws the page and leaves the reader where they were: the same scroll, and focus on the control `ctl` (if any).
function keepView(ctx, ui, ctl, action) {
    const pane = scroller(ctx);
    const top = pane?.scrollTop;
    const list = ctx.inspector?.querySelector?.('.skill-groups');
    if (list) ui.scroll = list.scrollTop;
    const done = action();
    if (ctl) focusControl(byCtl(ctx.inspector, ctl));
    if (pane && top !== undefined) pane.scrollTop = top;
    return done;
}

// Whether a pointer is down on the page. Focus leaves a field at the press, before the click that follows has happened, and a commit
// redraws the page: the node pressed on would be replaced and the click lost. So a pointer move waits for its click (see commitChange).
const pointers = new WeakMap();
function pointerState(doc) {
    let state = pointers.get(doc);
    if (!state) {
        state = { down: false };
        pointers.set(doc, state);
        doc.addEventListener?.('pointerdown', () => { state.down = true; }, true);
        for (const type of ['pointerup', 'pointercancel', 'dragend']) doc.addEventListener?.(type, () => { state.down = false; }, true);
        doc.defaultView?.addEventListener?.('blur', () => { state.down = false; });
    }
    return state;
}

// A text control commits on `change`. With Enter the control still has focus and the commit is at once. When focus is leaving, the
// browser fires `change` before it moves focus and the page is about to be redrawn, so the commit waits for `focusout` to learn where
// focus is going and puts it there afterwards. If the move is a click or a tap, it waits further, until that click has been handled
// (a click listener on the document, with a timeout in case none comes), so the click is not lost to the redraw. Without a window
// (the test DOM) it commits at once. `still` says whether the record is still where it was; a commit for a record that is gone is dropped.
function commitChange(ctx, ui, control, ctl, action, still = () => true) {
    const doc = ctx.doc;
    const win = doc.defaultView;
    if (!win?.setTimeout || doc.activeElement === control) return keepView(ctx, ui, ctl, action);
    const pointer = pointerState(doc).down;
    let done = false;
    let target = null;
    const flush = () => {
        if (done) return;
        done = true;
        control.removeEventListener('focusout', onOut);
        doc.removeEventListener('click', onClick);
        if (still()) keepView(ctx, ui, target, action);
    };
    const onClick = () => win.setTimeout(flush, 0);
    const onOut = event => {
        target = event.relatedTarget?.getAttribute?.('data-ctl') ?? null;
        if (!pointer) flush();
        else doc.addEventListener('click', onClick, { once: true });
    };
    control.addEventListener('focusout', onOut);
    win.setTimeout(flush, pointer ? 250 : 0);
    return true;
}

function row(doc, ...children) {
    const node = el(doc, 'div', '', { class: 'fieldset-row' });
    node.append(...children);
    return node;
}

function labelled(doc, text, control) {
    const label = el(doc, 'label', text, { class: 'field' });
    label.append(control);
    return label;
}

function textControl(doc, ctl, value, extra = {}) {
    const control = el(doc, 'input', '', { 'aria-label': ctl, 'data-ctl': ctl, ...extra });
    control.value = safeLabel(value ?? '');
    return control;
}

function warnLine(doc, text, extra = {}) {
    const line = el(doc, 'p', '', { class: 'field-warn', role: 'status', ...extra });
    line.append(icon(doc, 'warning'), el(doc, 'span', text));
    return line;
}

/** Renders the whole inspector body of one template: problems, fields, narrator line and actions. */
export function renderTrainerTemplate(ctx, container, { record, idx, id, problems, onDelete }) {
    const doc = ctx.doc;
    const model = ctx.model;
    const schema = schemaForRecord('trainers', record);
    const ui = uiFor(ctx, id);
    pointerState(doc); // listening before the first press, so a commit can tell a click from a key
    const base = basePath(idx);
    const here = () => records(ctx.model, 'trainers')[idx]?.slug === record.slug;
    const feePath = `content.rules[0].trainers[${idx}].fee`;
    const feeIssue = problems.find(problem => /\.fee$/.test((problem.path || '').replace(/\[(\d+)\]/g, '.$1')) && /ordered/i.test(problem.message || ''));
    const otherProblems = problems.filter(problem => problem !== feeIssue);

    if (problems.length) container.append(warnLine(doc, `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} in this record. Export is blocked until it is fixed.`));
    for (const problem of otherProblems) container.append(el(doc, 'p', `${problem.message}${problem.path ? ` (${safeLabel(problem.path)})` : ''}`, { class: 'field-hint' }));

    const body = el(doc, 'div', '', { class: 'inspector-form-body' });

    // slug and name
    const slug = textControl(doc, 'slug', record.slug);
    slug.addEventListener('change', () => {
        const next = slug.value;
        const checked = validateField(schema.properties.slug, next);
        if (!checked.ok) { ctx.notify(`${checked.code}: ${checked.message}`); slug.value = safeLabel(record.slug); return; }
        if (next === record.slug) return;
        commitChange(ctx, ui, slug, 'slug', () => {
            const result = renameId(ctx.model, 'trainers', identity(record, 'trainers'), next);
            // The selection follows the rename only while the record is still the one open.
            return applyEdit(ctx, result, ctx.selection.id === id ? { id: localId(result.model ?? ctx.model, next) } : undefined);
        }, here);
    });
    const name = textControl(doc, 'name', record.name);
    name.addEventListener('change', () => {
        const next = name.value;
        if (next === record.name) return;
        commitChange(ctx, ui, name, 'name', () => applyEdit(ctx, setField(ctx.model, [...base, 'name'], next)), here);
    });
    const grid = el(doc, 'div', '', { class: 'inspector-grid template-ids' });
    grid.append(row(doc, labelled(doc, 'slug', slug)), row(doc, labelled(doc, 'name', name)));
    body.append(grid);

    // rank
    const ranks = ranksOf(model);
    const rank = el(doc, 'select', '', { 'aria-label': 'rank', 'data-ctl': 'rank' });
    for (const choice of ranks) {
        const option = el(doc, 'option', `${choice.id} — ${safeLabel(choice.title ?? choice.id)}`, { value: choice.id });
        option.selected = choice.id === record.rank;
        rank.append(option);
    }
    if (!rankRow(model, record.rank)) {
        const unknown = el(doc, 'option', `${safeLabel(record.rank ?? '')} (not a pack rank)`, { value: '__current__', disabled: '' });
        unknown.selected = true;
        rank.prepend(unknown);
    }
    rank.addEventListener('change', () => {
        if (rank.value === '__current__' || rank.value === record.rank) return;
        keepView(ctx, ui, 'rank', () => applyEdit(ctx, setField(ctx.model, [...base, 'rank'], rank.value)));
    });
    const reward = rewardOf(rankRow(model, record.rank));
    const rankRowNode = row(doc, labelled(doc, 'rank', rank));
    rankRowNode.append(el(doc, 'small', reward ? `Rank ${safeLabel(record.rank)} (${safeLabel(rankRow(model, record.rank).title ?? '')}) quests pay ${number(reward[0])}–${number(reward[1])}.`
        : 'Name a rank of this pack: the checker refuses any other.', { class: 'field-hint' }));
    body.append(rankRowNode);

    body.append(feeFieldset(ctx, ui, { record, base, feePath, feeIssue, schema, reward, still: here }));

    body.append(row(doc, el(doc, 'span', 'minutes', { class: 'field' }), el(doc, 'span', '60 minutes (fixed by the rules)', { class: 'readonly-value' })));
    body.append(row(doc, el(doc, 'span', 'place', { class: 'field' }), el(doc, 'span', 'None: stands where the story offers it', { class: 'readonly-value' })));

    body.append(skillsFieldset(ctx, ui, { record, base, schema }));
    body.append(eventsFieldset(ctx, ui, { record, base, schema }));
    body.append(narratorLine(ctx, record, id));

    const actions = el(doc, 'div', '', { class: 'editor-actions' });
    const toFixed = button(doc, 'Convert to fixed trainer…', () => openConvertDialog(ctx, toFixed, idx, record), { 'data-ctl': 'convert' });
    const remove = button(doc, 'Delete', () => onDelete(remove), { class: 'danger', 'data-ctl': 'delete' });
    actions.append(toFixed, el(doc, 'span', '', { class: 'spacer' }), remove);
    body.append(actions);
    container.append(body);
    const list = body.querySelector?.('.skill-groups');
    if (list && ui.scroll) list.scrollTop = ui.scroll;
}

function feeFieldset(ctx, ui, { record, base, feePath, feeIssue, schema, reward, still }) {
    const doc = ctx.doc;
    const bounds = schema.properties.fee.properties.coinMin;
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset' });
    set.append(el(doc, 'legend', 'fee range'));
    const fee = record.fee && typeof record.fee === 'object' ? record.fee : {};
    const min = textControl(doc, 'coinMin', fee.coinMin, { inputmode: 'numeric', autocomplete: 'off' });
    const max = textControl(doc, 'coinMax', fee.coinMax, { inputmode: 'numeric', autocomplete: 'off' });
    const inputs = el(doc, 'div', '', { class: 'fee-row' });
    inputs.append(row(doc, labelled(doc, 'lowest fee (coinMin)', min)), row(doc, labelled(doc, 'highest fee (coinMax)', max)));
    const bar = el(doc, 'div', '', { class: 'fee-bar', 'aria-hidden': 'true' });
    const range = el(doc, 'span', '', { class: 'range' });
    bar.append(range);
    const scale = el(doc, 'div', '', { class: 'fee-scale', 'aria-hidden': 'true' });
    scale.append(el(doc, 'span', '1'), el(doc, 'span', reward ? `rank ${safeLabel(record.rank)} quest pay ${number(reward[0])}–${number(reward[1])}` : ''));
    const sentence = el(doc, 'p', '', { class: 'field-hint' });
    const error = el(doc, 'p', '', { class: 'field-error', role: 'alert', id: 'fee-err' });
    const note = el(doc, 'p', '', { class: 'field-warn', role: 'status' });
    set.append(inputs, bar, scale, sentence, error, note);

    const parse = control => {
        const parsed = parseIntegerInput(control.value);
        return parsed.ok && parsed.value >= bounds.minimum && parsed.value <= bounds.maximum ? parsed.value : null;
    };
    // The fee area follows what is typed; only a change (leaving the field, Enter) is committed, so typing never redraws the page.
    const refresh = () => {
        const low = parse(min), high = parse(max);
        const bad = [[min, low], [max, high]].filter(([, value]) => value === null);
        for (const control of [min, max]) { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby'); }
        const inverted = low !== null && high !== null && low > high;
        let message = '';
        if (bad.length) message = `${number(bounds.minimum)} to ${number(bounds.maximum)}`;
        else if (inverted) message = FEE_CHECK_MESSAGE;
        const flagged = bad.length ? bad.map(([control]) => control) : inverted ? [min, max] : [];
        for (const control of flagged) { control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', 'fee-err'); }
        error.replaceChildren();
        error.hidden = !message;
        if (message) {
            error.append(icon(doc, 'warning'));
            const text = el(doc, 'span', message);
            // The path is the checker's own, as it reports a damaged range.
            if (inverted) text.append(' ', el(doc, 'span', safeLabel(feeIssue?.path ?? feePath), { class: 'mono' }));
            error.append(text);
        }
        const shown = low !== null && high !== null && !inverted;
        sentence.hidden = bar.hidden = scale.hidden = !shown;
        if (shown) {
            sentence.textContent = `A session costs between ${number(low)} and ${feeAmount(ctx.model, high)}, rolled when a trainer is offered; the narrator never sets it. Each bound ${number(bounds.minimum)} to ${number(bounds.maximum)}.`;
            const top = Math.max(reward?.[1] ?? 0, high, 1);
            range.setAttribute('style', `left:${(low / top * 100).toFixed(1)}%;right:${(100 - high / top * 100).toFixed(1)}%`);
        }
        const over = shown && reward && high > reward[1];
        note.hidden = !over;
        note.replaceChildren();
        if (over) note.append(icon(doc, 'warning'), el(doc, 'span', `A lesson can cost up to ${number(high)}, more than a whole rank ${safeLabel(record.rank)} quest pays (${number(reward[1])}). Check the range.`));
    };
    refresh();
    for (const [control, key] of [[min, 'coinMin'], [max, 'coinMax']]) {
        control.addEventListener('input', refresh);
        control.addEventListener('change', () => {
            const value = parse(control);
            if (value === null) { refresh(); return; }
            if (value === fee[key]) return;
            commitChange(ctx, ui, control, key, () => applyEdit(ctx, setField(ctx.model, [...base, 'fee', key], value)), still);
        });
    }
    return set;
}

// A list of refs the pack does not have, with a way to drop each (the checker refuses an unknown ref).
function unknownRefs(ctx, ui, { refs, known, base, key, noun }) {
    const doc = ctx.doc;
    const unknown = refs.filter(ref => !known.has(localId(ctx.model, ref)));
    const nodes = [];
    for (const ref of unknown) {
        const line = el(doc, 'p', '', { class: 'field-warn', role: 'status' });
        const remove = button(doc, 'Remove', () => keepView(ctx, ui, null, () => {
            const next = refs.filter(entry => entry !== ref);
            return key === 'skills' ? changeSkills(ctx, base, next) : applyEdit(ctx, setField(ctx.model, [...base, key], next));
        }),
            { 'aria-label': `Remove ${safeLabel(ref)}`, 'data-ctl': `remove:${ref}` });
        line.append(icon(doc, 'warning'), el(doc, 'span', `${safeLabel(ref)} is not ${noun} of this pack.`), remove);
        nodes.push(line);
    }
    return nodes;
}

// The checker wants one skill at least, so the last one cannot be unticked: a refused edit puts the box back.
function changeSkills(ctx, base, next) {
    if (!next.length) { ctx.notify('A trainer template teaches at least 1 skill.'); ctx.render(); return false; }
    return applyEdit(ctx, setField(ctx.model, [...base, 'skills'], next));
}

function skillsFieldset(ctx, ui, { record, base, schema }) {
    const doc = ctx.doc;
    const model = ctx.model;
    const limit = schema.properties.skills.maxItems;
    const refs = Array.isArray(record.skills) ? record.skills.filter(ref => typeof ref === 'string') : [];
    const chosen = new Set(refs.map(ref => localId(model, ref)));
    const groups = skillGroups(model);
    const known = new Set(groups.flatMap(group => group.skills.map(skill => skill.slug)));
    const names = new Map(groups.flatMap(group => group.skills.map(skill => [skill.slug, skill.name])));
    const keys = groups.map(group => group.key);
    if (!ui.order || ui.order.length !== keys.length || keys.some(key => !ui.order.includes(key))) {
        const picked = groups.filter(group => group.skills.some(skill => chosen.has(skill.slug))).map(group => group.key);
        ui.order = [...picked, ...keys.filter(key => !picked.includes(key))];
    }
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset' });
    set.append(el(doc, 'legend', 'skills it can teach'));
    const toggle = (slugOrRef, on, ctl) => keepView(ctx, ui, ctl, () => {
        const next = on ? [...refs, slugOrRef] : refs.filter(ref => localId(model, ref) !== localId(model, slugOrRef));
        return changeSkills(ctx, base, next);
    });

    if (ui.folded) {
        const summary = chosen.size ? `${chosen.size} selected: ${[...chosen].map(slug => names.get(slug) ?? slug).join(', ')}.` : 'No skill is selected yet.';
        set.append(el(doc, 'p', summary, { class: 'muted fieldset-unset' }));
    } else {
        const search = el(doc, 'input', '', { type: 'search', 'aria-label': 'Find a skill', placeholder: 'Find a skill or class', 'data-ctl': 'search', autocomplete: 'off' });
        search.value = ui.query;
        const bar = el(doc, 'div', '', { class: 'skill-search' });
        bar.append(search, el(doc, 'span', `${chosen.size} of ${limit} at most`, { class: 'skill-count' }));
        const list = el(doc, 'div', '', { class: 'skill-groups' });
        const full = chosen.size >= limit;
        const draw = () => {
            list.replaceChildren();
            const query = ui.query.trim().toLowerCase();
            let shown = 0;
            for (const key of ui.order) {
                const group = groups.find(entry => entry.key === key);
                if (!group) continue;
                const hit = group.search.includes(query);
                const skills = query && !hit ? group.skills.filter(skill => skill.name.toLowerCase().includes(query) || skill.slug.includes(query)) : group.skills;
                if (!skills.length) continue;
                shown++;
                const section = el(doc, 'div', '', { class: 'skill-group' });
                const heading = el(doc, 'h4', group.title);
                heading.append(el(doc, 'small', `${group.skills.filter(skill => chosen.has(skill.slug)).length} of ${group.skills.length}`));
                const items = el(doc, 'div', '', { class: 'check-list' });
                for (const skill of skills) {
                    const box = el(doc, 'input', '', { type: 'checkbox', 'aria-label': skill.name, 'data-ctl': `skill:${skill.slug}` });
                    box.checked = chosen.has(skill.slug);
                    box.disabled = full && !box.checked;
                    box.addEventListener('change', () => toggle(refs.find(ref => localId(model, ref) === skill.slug) ?? skill.slug, box.checked, `skill:${skill.slug}`));
                    const item = el(doc, 'label', '', { class: 'check-row' });
                    item.append(box, el(doc, 'span', skill.name), el(doc, 'span', skill.slug, { class: 'slug' }));
                    items.append(item);
                }
                section.append(heading, items);
                list.append(section);
            }
            if (!shown) list.append(el(doc, 'p', groups.length ? 'No skill or class matches.' : 'This pack has no skills yet.', { class: 'muted fieldset-unset' }));
        };
        draw();
        // Typing filters the list in place: the box is never rebuilt, so it keeps focus and the caret.
        search.addEventListener('input', () => { ui.query = search.value; draw(); });
        set.append(bar, list);
        if (groups.length > 3) set.append(el(doc, 'p', `${groups.length} classes in all. The list scrolls.`, { class: 'muted fieldset-unset' }));
    }
    for (const node of unknownRefs(ctx, ui, { refs, known, base, key: 'skills', noun: 'a skill' })) set.append(node);
    const fold = button(doc, ui.folded ? 'Choose skills' : 'Fold the list', () => { ui.folded = !ui.folded; ctx.render(); focusControl(byCtl(ctx.inspector, 'fold')); }, { class: 'skill-fold', 'data-ctl': 'fold', 'aria-expanded': ui.folded ? 'false' : 'true' });
    set.append(fold);
    const hint = el(doc, 'p', '', { class: 'field-hint' });
    hint.append('The story may narrow this list with ', el(doc, 'code', '| teaches:'), ', never add to it. A trainer teaches the next form of a skill the character already has.');
    set.append(hint);
    return set;
}

function eventsFieldset(ctx, ui, { record, base, schema }) {
    const doc = ctx.doc;
    const model = ctx.model;
    const limit = schema.properties.eventTemplates.maxItems;
    const refs = Array.isArray(record.eventTemplates) ? record.eventTemplates.filter(ref => typeof ref === 'string') : [];
    const chosen = new Set(refs.map(ref => localId(model, ref)));
    const events = records(model, 'events').map(event => identity(event, 'events')).filter(slug => typeof slug === 'string' && slug).map(slug => localId(model, slug));
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset' });
    set.append(el(doc, 'legend', `event templates (${chosen.size} of ${limit})`));
    if (!events.length) set.append(el(doc, 'p', 'This pack has no events yet.', { class: 'muted fieldset-unset' }));
    const grid = el(doc, 'div', '', { class: 'check-grid' });
    for (const slug of events) {
        const box = el(doc, 'input', '', { type: 'checkbox', 'aria-label': slug, 'data-ctl': `event:${slug}` });
        box.checked = chosen.has(slug);
        box.disabled = chosen.size >= limit && !box.checked;
        box.addEventListener('change', () => keepView(ctx, ui, `event:${slug}`, () => {
            const next = box.checked ? [...refs, slug] : refs.filter(ref => localId(model, ref) !== slug);
            return applyEdit(ctx, setField(model, [...base, 'eventTemplates'], next));
        }));
        const item = el(doc, 'label', '', { class: 'check-row' });
        item.append(box, el(doc, 'span', slug, { class: 'mono' }));
        grid.append(item);
    }
    if (events.length) set.append(grid);
    for (const node of unknownRefs(ctx, ui, { refs, known: new Set(events), base, key: 'eventTemplates', noun: 'an event' })) set.append(node);
    return set;
}

function narratorLine(ctx, record, id) {
    const doc = ctx.doc;
    const model = ctx.model;
    const slugs = (Array.isArray(record.skills) ? record.skills : []).filter(ref => typeof ref === 'string').map(ref => localId(model, ref));
    const line = `+ trainer <Name> — <what they teach> | like: ${safeLabel(id)}`;
    const wrap = el(doc, 'div', '', { class: 'narrator-line' });
    const code = el(doc, 'code', line);
    const copy = button(doc, '', () => copyText(ctx, line), { 'aria-label': 'Copy the narrator line', 'data-ctl': 'copy' });
    copy.append(icon(doc, 'copy'));
    const lineRow = el(doc, 'div', '', { class: 'row' });
    lineRow.append(code, copy);
    const hint = el(doc, 'p', '', { class: 'field-hint' });
    hint.append('To narrow: ', el(doc, 'code', `| teaches: ${slugs.slice(0, 2).join(', ') || '<skill>'}`, { class: 'mono' }),
        '. In RPG Battle the reader can also use Make this a trainer on someone present.');
    wrap.append(el(doc, 'span', 'narrator line', { class: 'field' }), lineRow, hint);
    return wrap;
}

// The clipboard when the page may use it; otherwise a hidden field and the old copy command; otherwise say so.
async function copyText(ctx, text) {
    const doc = ctx.doc;
    try {
        await doc.defaultView.navigator.clipboard.writeText(text);
        ctx.notify('Copied the narrator line.');
        return;
    } catch { /* fall through */ }
    const field = el(doc, 'textarea', '', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;left:-9999px;top:0' });
    field.value = text;
    doc.body.append(field);
    field.select?.();
    let ok = false;
    try { ok = doc.execCommand?.('copy') === true; } catch { ok = false; }
    field.remove();
    ctx.notify(ok ? 'Copied the narrator line.' : 'Copying is not available here: select the line and copy it.');
}

function openConvertDialog(ctx, invoker, idx, record) {
    const doc = ctx.doc;
    const model = ctx.model;
    const places = records(model, 'places').map(place => ({ id: identity(place, 'places'), name: safeLabel(place.name ?? identity(place, 'places')) })).filter(place => typeof place.id === 'string' && place.id);
    const fixedSchema = schemaForRecord('trainers', { ...record, open: false });
    const dialog = el(doc, 'dialog', '', { 'aria-label': `Convert ${safeLabel(record.name || record.slug)} to a fixed trainer` });
    const close = () => {
        try { dialog.close?.(); } catch { /* ignore */ }
        dialog.remove();
        if (doc.contains?.(invoker)) invoker.focus?.();
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.append(el(doc, 'h2', `Convert ${safeLabel(record.name || record.slug)} to a fixed trainer`),
        el(doc, 'p', 'A fixed trainer stands at one place and charges one fee. The rank and the fee range are dropped.'));

    const place = el(doc, 'select', '', { 'aria-label': 'place', 'data-ctl': 'place' });
    for (const choice of places) place.append(el(doc, 'option', `${choice.name} (${choice.id})`, { value: choice.id }));
    // The place it stood at before it became a template, if it was a fixed trainer once and the pack still has that place.
    const before = ctx.trainerUi?.places?.[record.slug];
    const earlier = before ? places.find(choice => localId(model, choice.id) === localId(model, before)) : null;
    if (earlier) place.value = earlier.id;
    const fee = el(doc, 'input', '', { 'aria-label': 'fee', inputmode: 'numeric', autocomplete: 'off' });
    fee.value = safeLabel(record.fee?.coinMin ?? 1);
    const problem = el(doc, 'p', '', { class: 'field-error', role: 'alert' });
    problem.hidden = true;
    const confirm = button(doc, 'Convert', () => {
        const parsed = parseIntegerInput(fee.value);
        const bounds = fixedSchema.properties.fee;
        if (!parsed.ok || parsed.value < bounds.minimum || parsed.value > bounds.maximum) {
            problem.hidden = false;
            problem.textContent = `The fee is a whole number, ${number(bounds.minimum)} to ${number(bounds.maximum)}.`;
            fee.setAttribute('aria-invalid', 'true');
            return;
        }
        const target = referenceId(model, fixedSchema.properties.place, place.value);
        if (target === null) { problem.hidden = false; problem.textContent = 'Choose a place of this pack.'; return; }
        const result = setField(model, basePath(idx), templateToFixed(record, target, parsed.value), whole(idx));
        close();
        applyEdit(ctx, result, { id: localId(model, record.slug) });
    }, { class: 'primary' });
    if (places.length) {
        dialog.append(row(doc, labelled(doc, 'Place', place)), row(doc, labelled(doc, `Fee, in ${feeUnit(model).plural} (starts at the lowest fee of the range)`, fee)), problem);
    } else {
        dialog.append(el(doc, 'p', 'This pack has no places yet. Add one in Places, then convert.', { class: 'warning' }));
        confirm.disabled = true;
    }
    const actions = el(doc, 'div', '', { class: 'row' });
    const cancel = button(doc, 'Keep the template', close);
    actions.append(cancel, confirm);
    dialog.append(actions);
    ctx.overlays.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    (places.length ? place : cancel).focus?.();
}
