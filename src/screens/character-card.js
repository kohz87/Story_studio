// The Character card page: every card field, the "Put in the card" checklist with real sizes, and the card downloads.
// The draft is ctx.card (saved with the pack); the picture is ctx.cardImage (PNG bytes). Mockup section 7, SDK-CARD-CONTRACT addendum D.

import { el, button, field } from '../dom.js';
import { downloadFile } from '../export.js';
import { exportCardPng, defaultCoverPng } from '../card-png.js';
import { portraitSignature, portraitNames, zipPortraits, castOf } from '../cast/data.js';
import { worldInfo } from '../lorebook.js';
import { browserCardTools, cardImageFrom, CARD_IMAGE_LIMITS } from '../card-image.js';
import { MAX_CARD_BYTES, NOTE_DEPTH, NOTE_ROLES, SETTING_ROWS, PORTRAIT_ENTRY_LIMITS, buildCard, cardSizes, emptyCard, fieldValues, readCard, settingRowValid, shrinkPortraits } from '../card.js';

const LABELS = {
    name: 'Card name', description: 'Description and Changes instruction', personality: 'Tone notes',
    scenario: 'Start place and time', first_mes: 'First message', mes_example: 'Example messages',
    creator_notes: 'Creator notes', system_prompt: 'System prompt', post_history_instructions: 'Post-history instructions',
    creator: 'Creator', character_version: 'Character version',
};
const ONE_LINE = ['name', 'creator', 'character_version'];
const MAIN = ['name', 'description', 'personality', 'scenario', 'first_mes'];
const MORE_BEFORE = ['mes_example', 'system_prompt', 'post_history_instructions'];
const MORE_AFTER = ['creator', 'character_version', 'creator_notes'];
const PART_NAMES = { pack: 'Pack', lore: 'Lore', portraits: 'Portraits', statusBar: 'Status bar', settings: 'Recommended settings', ownLore: 'Card’s own lore' };

/** "318 KB", "1.6 MB", "197 B". */
export function sizeText(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const urls = new WeakMap();
function pictureUrl(bytes) {
    if (urls.has(bytes)) return urls.get(bytes);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    const url = `data:image/png;base64,${btoa(binary)}`;
    urls.set(bytes, url);
    return url;
}

/** The card JSON for the preview: the same card, with long entry text cut short so a book of lore does not fill the page. */
function previewText(json) {
    const card = JSON.parse(json);
    for (const entry of card.data.character_book?.entries ?? []) {
        if (typeof entry.content === 'string' && entry.content.length > 200) entry.content = `${entry.content.slice(0, 200)}… [${entry.content.length - 200} more characters]`;
    }
    return JSON.stringify(card, null, 2);
}

export function renderCharacterCard(ctx) {
    const { doc, win, main } = ctx;
    const state = ctx.authoring;
    const model = ctx.model;
    const pack = model.document;
    const card = ctx.card;
    ctx.cardTools ??= browserCardTools(win);
    const values = fieldValues(pack, card);
    const portraitState = state.portraits ??= { sig: null, status: 'idle', result: null };
    const save = () => ctx.saveCard();

    main.append(el(doc, 'h1', 'Character card'),
        el(doc, 'p', 'Saved with the pack.', { class: 'muted', id: 'card-saved' }),
        el(doc, 'p', 'Build a Character Card V2 from this pack. Card edits never change the pack itself.', { class: 'muted' }));
    if (!pack.start?.scene?.place) main.append(el(doc, 'p', 'This pack has no start place. Set the start place and first message before export.', { class: 'warning' }));

    // --- Top: pick, reset, image -------------------------------------------------------------------------------------------------
    const top = el(doc, 'div', '', { class: 'cc-top stack' });
    const pickInput = el(doc, 'input', '', { type: 'file', accept: '.json,.png,application/json,image/png', id: 'card-file', hidden: '', 'aria-label': 'Card file' });
    pickInput.addEventListener('change', async () => {
        const file = pickInput.files?.[0];
        pickInput.value = '';
        if (!file) return;
        const token = state.pickSeq = (state.pickSeq ?? 0) + 1;
        let read;
        try {
            if (file.size > MAX_CARD_BYTES) throw new Error('that file is too large for a card');
            read = readCard(new Uint8Array(await file.arrayBuffer()));
        } catch (err) {
            if (ctx.authoring !== state || token !== state.pickSeq) return;
            state.pickNote = { error: true, text: `Pick refused: ${err.message}` };
            ctx.render();
            return;
        }
        if (ctx.authoring !== state || token !== state.pickSeq) return;
        const next = read.card;
        // The ticks for the pack's own parts stay as they are; a card only says whether it had the status bar and the settings.
        next.include = { ...card.include, statusBar: next.include.statusBar, settings: read.found.settings ? true : card.include.settings, ownLore: true };
        if (!read.found.settings) next.settings = card.settings;
        ctx.setCard(next);
        if (read.image) ctx.setCardImage(read.image);
        const lore = next.ownLore.length;
        state.pickNote = { error: false, text: `Read ${next.fields.name || 'the card'} (${read.spec === 'chara_card_v3' ? 'V3' : read.spec === 'chara_card_v2' ? 'V2' : 'V1'} card)${lore ? `; its ${lore} lorebook ${lore === 1 ? 'entry is' : 'entries are'} kept as Card’s own lore` : ''}${read.notes.length ? `; ${read.notes.join('; ')}` : ''}.` };
        ctx.render();
    });
    const actions = el(doc, 'div', '', { class: 'row cc-actions' });
    actions.append(button(doc, 'Pick a card…', () => pickInput.click(), { id: 'card-pick' }),
        button(doc, 'Reset card from pack', () => { state.pickNote = null; ctx.setCard(emptyCard()); ctx.render(); }), pickInput);
    top.append(actions);
    if (state.pickNote) top.append(el(doc, 'p', state.pickNote.text, state.pickNote.error ? { class: 'warning', role: 'alert', id: 'card-pick-note' } : { class: 'muted', role: 'status', id: 'card-pick-note' }));

    const imageInput = el(doc, 'input', '', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'card-image-file', hidden: '', 'aria-label': 'Card image file' });
    imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        imageInput.value = '';
        if (!file) return;
        const token = state.imageSeq = (state.imageSeq ?? 0) + 1;
        try {
            if (file.size > CARD_IMAGE_LIMITS.source) throw new Error(`that picture is over ${CARD_IMAGE_LIMITS.source / 1024 / 1024} MB`);
            const png = await cardImageFrom(new Uint8Array(await file.arrayBuffer()), ctx.cardTools);
            if (ctx.authoring !== state || token !== state.imageSeq) return;
            state.imageError = '';
            ctx.setCardImage(png);
        } catch (err) {
            if (ctx.authoring !== state || token !== state.imageSeq) return;
            state.imageError = `Image refused: ${err.message}`;
        }
        ctx.render();
    });
    const picture = el(doc, 'div', '', { class: 'cc-image row' });
    const shown = ctx.cardImage ?? defaultCoverPng();
    picture.append(el(doc, 'img', '', { src: pictureUrl(shown), alt: ctx.cardImage ? 'Card image' : 'Default card cover', width: 80, height: 120, class: 'cc-cover', id: 'card-image' }));
    const imageButtons = el(doc, 'div', '', { class: 'row' });
    const remove = button(doc, 'Remove', () => { state.imageError = ''; ctx.setCardImage(null); ctx.render(); }, { id: 'card-image-remove' });
    remove.disabled = !ctx.cardImage;
    imageButtons.append(button(doc, 'Change…', () => imageInput.click(), { id: 'card-image-change' }), remove, imageInput);
    picture.append(imageButtons);
    top.append(picture);
    if (state.imageError) top.append(el(doc, 'p', state.imageError, { class: 'warning', role: 'alert', id: 'card-image-error' }));
    top.append(el(doc, 'p', ctx.cardImage ? 'Written as the card’s PNG image.' : 'No picture chosen: the card uses the default cover. PNG, JPEG or WebP; it is written as a PNG.', { class: 'muted cc-image-note' }));
    main.append(top);

    // --- The checklist, built first so the fields can refresh it ---------------------------------------------------------------
    const preview = el(doc, 'pre', '', { id: 'card-preview' });
    const totals = { data: el(doc, 'span', '', { id: 'card-total' }), png: el(doc, 'span', '', { id: 'card-total-png' }) };
    const sizeCells = new Map();
    let sizeTimer = null;
    const portraitsReady = () => portraitState.sig === portraitSignature(model) && portraitState.status === 'done' ? portraitState.result : null;

    const refreshPreview = () => {
        try { preview.textContent = previewText(buildCard(model, card, { portraits: portraitsReady() }).json); }
        catch (err) { preview.textContent = `export-error: ${err.message}`; }
    };
    const refreshSizes = () => {
        sizeTimer = null;
        let sizes = null;
        try { sizes = cardSizes(model, card, { portraits: portraitsReady(), image: ctx.cardImage }); } catch { /* the preview says why */ }
        for (const [part, cell] of sizeCells) {
            const unavailable = cell.dataset.unavailable === 'true';
            const ticked = card.include[part];
            if (part === 'portraits' && ticked && !unavailable && !portraitsReady()) cell.textContent = portraitState.status === 'working' ? 'shrinking…' : '—';
            else cell.textContent = sizes && !unavailable && ticked && Object.hasOwn(sizes.rows, part) ? sizeText(sizes.rows[part]) : '—';
            cell.dataset.bytes = sizes && Object.hasOwn(sizes.rows, part) ? String(sizes.rows[part]) : '0';
        }
        totals.data.textContent = sizes ? sizeText(sizes.total) : '—';
        totals.data.dataset.bytes = sizes ? String(sizes.total) : '';
        totals.png.textContent = sizes ? sizeText(sizes.png) : '—';
        totals.png.dataset.bytes = sizes ? String(sizes.png) : '';
        if (sizes) totals.data.title = `Card text and fields ${sizeText(sizes.base)}`;
    };
    const refresh = () => { refreshPreview(); refreshSizes(); };
    // Typing is saved and previewed at once; the sizes (the heavy part) follow a moment later.
    const edited = () => {
        save();
        refreshPreview();
        if (sizeTimer !== null) win.clearTimeout(sizeTimer);
        sizeTimer = win.setTimeout(refreshSizes, 120);
    };

    const shrinkNow = () => {
        const sig = portraitSignature(model);
        if (portraitState.sig === sig && portraitState.status !== 'idle') return portraitState.promise;
        portraitState.sig = sig;
        portraitState.status = 'working';
        const promise = shrinkPortraits(model, (bytes, name) => ctx.cardTools.shrink(bytes, name)).then(result => {
            if (portraitState.sig !== sig) return result;
            portraitState.result = result;
            portraitState.status = 'done';
            if (ctx.authoring === state && ctx.selection.kind === 'card') { renderChecklistNote(); refresh(); }
            return result;
        });
        portraitState.promise = promise;
        return promise;
    };

    // --- Main ------------------------------------------------------------------------------------------------------------------------
    const textField = key => {
        const input = el(doc, ONE_LINE.includes(key) ? 'input' : 'textarea', '', { id: `card-${key}` });
        input.value = values[key];
        if (key === 'description') input.setAttribute('rows', '14');
        input.addEventListener('input', () => { card.fields[key] = input.value; edited(); });
        return field(doc, LABELS[key], input);
    };
    const mainBox = el(doc, 'section', '', { class: 'card stack cc-box', 'aria-label': 'Main', id: 'card-main' });
    mainBox.append(el(doc, 'h2', 'Main'));
    for (const key of MAIN) mainBox.append(textField(key));

    const greetings = el(doc, 'div', '', { class: 'stack cc-greetings', id: 'card-greetings' });
    greetings.append(el(doc, 'h3', 'Alternate greetings'));
    card.greetings.forEach((greeting, at) => {
        const row = el(doc, 'div', '', { class: 'cc-greeting' });
        const input = el(doc, 'textarea', '', { id: `card-greeting-${at}`, 'aria-label': `Alternate greeting ${at + 1}`, rows: 3 });
        input.value = greeting;
        input.addEventListener('input', () => { card.greetings[at] = input.value; edited(); });
        row.append(input, button(doc, 'Remove', () => { card.greetings.splice(at, 1); save(); ctx.render(); }, { 'aria-label': `Remove alternate greeting ${at + 1}`, class: 'cc-remove' }));
        greetings.append(row);
    });
    greetings.append(button(doc, 'Add greeting', () => { card.greetings.push(''); save(); ctx.render(); }, { id: 'card-greeting-add' }));
    mainBox.append(greetings);

    // --- More ------------------------------------------------------------------------------------------------------------------------
    const more = el(doc, 'details', '', { class: 'card cc-box', id: 'card-more' });
    state.moreOpen ??= !win.matchMedia?.('(max-width: 600px)')?.matches;
    more.open = state.moreOpen;
    more.addEventListener('toggle', () => { state.moreOpen = more.open; });
    const moreBody = el(doc, 'div', '', { class: 'stack' });
    more.append(el(doc, 'summary', 'More'), moreBody);
    for (const key of MORE_BEFORE) moreBody.append(textField(key));
    const note = el(doc, 'textarea', '', { id: 'card-note', rows: 4 });
    note.value = card.note.prompt;
    note.addEventListener('input', () => { card.note.prompt = note.value; edited(); });
    const depth = el(doc, 'input', '', { id: 'card-note-depth', type: 'number', min: NOTE_DEPTH.min, max: NOTE_DEPTH.max, step: 1 });
    depth.value = String(card.note.depth);
    depth.addEventListener('input', () => {
        const number = Number(depth.value);
        card.note.depth = Number.isInteger(number) && number >= NOTE_DEPTH.min && number <= NOTE_DEPTH.max ? number : NOTE_DEPTH.default;
        edited();
    });
    const role = el(doc, 'select', '', { id: 'card-note-role' });
    for (const choice of NOTE_ROLES) role.append(el(doc, 'option', choice[0].toUpperCase() + choice.slice(1), { value: choice }));
    role.value = card.note.role;
    role.addEventListener('change', () => { card.note.role = role.value; edited(); });
    const pair = el(doc, 'div', '', { class: 'cc-pair' });
    pair.append(field(doc, 'Depth', depth), field(doc, 'Role', role));
    moreBody.append(field(doc, 'Character’s Note', note), pair);
    const talk = el(doc, 'input', '', { id: 'card-talkativeness', type: 'number', min: 0, max: 1, step: 0.05, placeholder: 'not set' });
    talk.value = card.talkativeness;
    talk.addEventListener('input', () => { card.talkativeness = talk.value; edited(); });
    moreBody.append(field(doc, 'Talkativeness (0 to 1)', talk));

    const chips = el(doc, 'div', '', { class: 'row cc-chips', id: 'card-tags' });
    const drawChips = () => {
        chips.replaceChildren();
        card.tags.forEach((tag, at) => {
            const chip = el(doc, 'span', '', { class: 'chip cc-chip' });
            chip.append(el(doc, 'span', tag), button(doc, '×', () => { card.tags.splice(at, 1); save(); drawChips(); refreshPreview(); }, { 'aria-label': `Remove tag ${tag}`, class: 'cc-chip-x' }));
            chips.append(chip);
        });
    };
    drawChips();
    const tagInput = el(doc, 'input', '', { id: 'card-tag-input', placeholder: 'Add a tag', 'aria-label': 'Add a tag' });
    const addTag = () => {
        for (const tag of tagInput.value.split(',').map(item => item.trim()).filter(Boolean)) if (!card.tags.includes(tag)) card.tags.push(tag);
        tagInput.value = '';
        save(); drawChips(); refreshPreview();
    };
    tagInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } });
    const tagRow = el(doc, 'div', '', { class: 'row cc-tagrow' });
    tagRow.append(tagInput, button(doc, 'Add tag', addTag, { id: 'card-tag-add' }));
    const tagBox = el(doc, 'div', '', { class: 'stack' });
    tagBox.append(el(doc, 'h3', 'Tags'), chips, tagRow);
    moreBody.append(tagBox);
    for (const key of MORE_AFTER) moreBody.append(textField(key));

    // --- Put in the card -----------------------------------------------------------------------------------------------------
    const putBox = el(doc, 'section', '', { class: 'card stack cc-box', 'aria-label': 'Put in the card', id: 'card-put' });
    putBox.append(el(doc, 'h2', 'Put in the card'));
    const list = el(doc, 'div', '', { class: 'cc-list' });
    const held = zipPortraits(model);
    let loreCount = 0, loreError = '';
    try { loreCount = Object.keys(worldInfo(pack).entries).length; } catch (err) { loreError = err.message; }
    const castPortraits = portraitNames(castOf(model)).length;
    const parts = [
        ['pack', model.validation?.ok ? 'Pack file for Story Block, as a disabled entry.' : 'Fix the pack’s problems first.', !model.validation?.ok],
        ['lore', loreError || (loreCount ? `${loreCount} lore ${loreCount === 1 ? 'entry' : 'entries'}, switched on.` : 'This pack has no places, factions, NPCs or items.'), Boolean(loreError) || !loreCount],
        ['portraits', held.files.length ? `${held.files.length} ${held.files.length === 1 ? 'picture' : 'pictures'}, each shrunk to about ${PORTRAIT_ENTRY_LIMITS.shrinkBytes / 1024} KB, as a disabled entry.`
            : castPortraits ? 'No portrait pictures are held for this pack.' : 'The cast names no portraits.', !held.files.length],
        ['statusBar', 'Shows place, purse and health under a reply; end replies with [STATUS]. From Story Block’s examples.', false],
        ['settings', 'Story Block and NPC State Delta settings the player may take. Only ticked rows go in.', false],
        ...(card.ownLore.length ? [['ownLore', `${card.ownLore.length} ${card.ownLore.length === 1 ? 'entry' : 'entries'} from the card you picked.`, false]] : []),
    ];
    const noteLine = el(doc, 'p', '', { class: 'muted', id: 'card-portrait-note' });
    function renderChecklistNote() {
        const lines = portraitState.sig === portraitSignature(model) ? portraitState.result?.lines ?? [] : [];
        noteLine.textContent = lines.join('; ');
        noteLine.hidden = !lines.length;
    }
    for (const [part, detail, unavailable] of parts) {
        const row = el(doc, 'div', '', { class: 'cc-row', 'data-part': part });
        const box = el(doc, 'input', '', { type: 'checkbox', id: `put-${part}`, 'aria-label': PART_NAMES[part] });
        box.checked = Boolean(card.include[part]) && !unavailable;
        box.disabled = unavailable;
        box.addEventListener('change', () => {
            card.include[part] = box.checked;
            save();
            if (part === 'portraits' && box.checked) shrinkNow();
            refresh();
        });
        const label = el(doc, 'label', '', { class: 'cc-name', for: `put-${part}` });
        label.append(el(doc, 'span', PART_NAMES[part], { class: 'cc-title' }), el(doc, 'small', detail));
        const size = el(doc, 'span', '—', { class: 'cc-size', 'data-size': part, 'data-unavailable': String(unavailable) });
        sizeCells.set(part, size);
        row.append(box, label, size);
        list.append(row);
        if (part === 'settings') list.append(settingsRows());
    }
    function settingsRows() {
        const wrap = el(doc, 'div', '', { class: 'cc-settings', id: 'card-settings' });
        for (const row of SETTING_ROWS) {
            const given = card.settings[row.id];
            const line = el(doc, 'div', '', { class: 'cc-setting', 'data-setting': row.id });
            const box = el(doc, 'input', '', { type: 'checkbox', id: `setting-${row.id}`, 'aria-label': `Put ${row.label} in the card` });
            box.checked = given.on;
            let control;
            if (row.kind === 'toggle') {
                control = el(doc, 'select', '', { id: `setting-${row.id}-value`, 'aria-label': row.label });
                control.append(el(doc, 'option', 'On', { value: 'true' }), el(doc, 'option', 'Off', { value: 'false' }));
                control.value = String(given.value);
            } else if (row.kind === 'choice') {
                control = el(doc, 'select', '', { id: `setting-${row.id}-value`, 'aria-label': row.label });
                for (const [id, name] of row.choices) control.append(el(doc, 'option', name, { value: id }));
                control.value = given.value;
            } else {
                control = el(doc, 'input', '', { id: `setting-${row.id}-value`, type: 'number', min: row.min, max: row.max, step: row.step, 'aria-label': row.label });
                control.value = String(given.value);
            }
            const apply = () => {
                const value = row.kind === 'toggle' ? control.value === 'true' : row.kind === 'choice' ? control.value : Number(control.value);
                if (settingRowValid(row, value)) { given.value = value; control.removeAttribute('aria-invalid'); } else control.setAttribute('aria-invalid', 'true');
                given.on = box.checked && control.getAttribute('aria-invalid') !== 'true';
                save();
                refresh();
            };
            box.addEventListener('change', apply);
            control.addEventListener(row.kind === 'number' ? 'input' : 'change', apply);
            line.append(box, el(doc, 'label', row.label, { for: `setting-${row.id}-value`, class: 'cc-setting-name' }), control);
            wrap.append(line);
        }
        return wrap;
    }
    putBox.append(list, noteLine);
    const total = el(doc, 'div', '', { class: 'cc-totals' });
    const dataRow = el(doc, 'div', '', { class: 'cc-total' });
    dataRow.append(el(doc, 'span', 'Total card data'), totals.data);
    const pngRow = el(doc, 'div', '', { class: 'cc-total' });
    pngRow.append(el(doc, 'span', 'As a card PNG (the card as base64, plus the picture)'), totals.png);
    total.append(dataRow, pngRow);
    putBox.append(total);

    const download = async kind => {
        try {
            const portraits = card.include.portraits && held.files.length ? await shrinkNow() : null;
            if (ctx.authoring !== state) return false;
            const { json } = buildCard(ctx.model, ctx.card, { portraits });
            const id = ctx.model.document.id;
            return kind === 'png' ? downloadFile(ctx, exportCardPng(json, ctx.cardImage), `${id}-card.png`, 'image/png')
                : downloadFile(ctx, json, `${id}-card.json`, 'application/json;charset=utf-8');
        } catch (err) {
            ctx.notify(`export-error: ${err.message}`);
            return false;
        }
    };
    const downloads = el(doc, 'div', '', { class: 'row cc-downloads' });
    downloads.append(button(doc, 'Download card PNG', () => download('png'), { class: 'primary', id: 'card-download-png' }),
        button(doc, 'Download card JSON', () => download('json'), { id: 'card-download-json' }));
    putBox.append(downloads);

    const details = el(doc, 'details', '', { class: 'card' });
    details.append(el(doc, 'summary', 'Card JSON preview'), preview);
    main.append(mainBox, more, putBox, details);
    renderChecklistNote();
    if (card.include.portraits && held.files.length) shrinkNow();
    refresh();
}
