import { el, button, field } from '../dom.js';
import { narratorFields, exportNarrator } from '../narrator.js';
import { exportCardPng } from '../card-png.js';
import { worldInfo, exportWorldInfo, importWorldInfo, acceptLoreDraft, MAX_LORE_BYTES } from '../lorebook.js';
import { downloadFile } from '../export.js';
import { applyEdit } from '../apply-edit.js';

const LABELS = {
    name: 'Card name', description: 'Description and Changes instruction', personality: 'Tone notes',
    scenario: 'Start place and time', first_mes: 'First message', mes_example: 'Example messages',
    creator_notes: 'Creator notes', system_prompt: 'System prompt', post_history_instructions: 'Post-history instructions',
    creator: 'Creator', character_version: 'Character version',
};

function save(ctx, makePayload, suffix, type = 'application/json;charset=utf-8') {
    try { return downloadFile(ctx, makePayload(), `${ctx.model.document.id}-${suffix}`, type); }
    catch (err) { ctx.notify(`export-error: ${err.message}`); return false; }
}

export function renderNarrator(ctx) {
    const { doc, main } = ctx;
    const state = ctx.authoring;
    state.card ??= {};
    const pack = ctx.model.document;
    const defaults = narratorFields(pack);
    main.append(el(doc, 'h1', 'Narrator card'), el(doc, 'p',
        'Build a Character Card V2 from this pack. Edit the fields before downloading JSON or PNG. Card edits stay in this session; they do not change pack metadata.', { class: 'muted' }));
    if (!pack.start?.scene?.place) main.append(el(doc, 'p', 'This pack has no start place. Set the start place and first message before export.', { class: 'warning' }));
    const actions = el(doc, 'div', '', { class: 'row' });
    const json = () => exportNarrator(ctx.model.document, state.card);
    actions.append(button(doc, 'Download card JSON', () => save(ctx, json, 'narrator.json'), { class: 'primary' }),
        button(doc, 'Download card PNG', () => save(ctx, () => exportCardPng(json()), 'narrator.png', 'image/png')),
        button(doc, 'Reset card from pack', () => { state.card = {}; ctx.render(); }));
    main.append(actions);
    const form = el(doc, 'div', '', { class: 'stack authoring-form' });
    const extra = el(doc, 'details', '', { class: 'card stack' });
    extra.append(el(doc, 'summary', 'Additional card fields'));
    const preview = el(doc, 'pre', '', { id: 'card-preview' });
    const updatePreview = () => {
        try { preview.textContent = json(); }
        catch (err) { preview.textContent = `export-error: ${err.message}`; }
    };
    updatePreview();
    for (const key of Object.keys(defaults)) {
        const input = el(doc, ['name', 'creator', 'character_version'].includes(key) ? 'input' : 'textarea', '', { id: `card-${key}` });
        input.value = state.card[key] ?? defaults[key];
        if (key === 'description') input.setAttribute('rows', '14');
        input.addEventListener('input', () => { state.card[key] = input.value; updatePreview(); });
        const target = ['name', 'description', 'personality', 'scenario', 'first_mes'].includes(key) ? form : extra;
        target.append(field(doc, LABELS[key], input));
    }
    const details = el(doc, 'details', '', { class: 'card' });
    details.append(el(doc, 'summary', 'Card JSON preview'), preview);
    main.append(form, extra, details);
}

export function renderLorebook(ctx) {
    const { doc, main } = ctx;
    main.append(el(doc, 'h1', 'Lorebook'), el(doc, 'p',
        'World Info uses only this pack’s places, factions, NPCs / creatures and items. Each record keeps its name, aliases and text fields. Places include their region.', { class: 'muted' }));
    let book;
    try { book = worldInfo(ctx.model.document); }
    catch (err) { main.append(el(doc, 'p', err.message, { class: 'warning' })); return; }
    const entries = Object.values(book.entries);
    const counts = {};
    for (const entry of entries) {
        const kind = entry.extensions.story_studio.kind;
        counts[kind] = (counts[kind] ?? 0) + 1;
    }
    main.append(el(doc, 'p', `${entries.length} entries · ${Object.entries(counts).map(([kind, count]) => `${kind}: ${count}`).join(' · ')}`, { id: 'lore-counts' }),
        el(doc, 'p', 'Keyword activation · order 100 · before character · probability 100% · recursion disabled', { class: 'muted' }),
        button(doc, 'Download World Info JSON', () => save(ctx, () => exportWorldInfo(ctx.model.document), 'world-info.json'), { class: 'primary' }));
    const list = el(doc, 'div', '', { class: 'stack' });
    for (const entry of entries) {
        const details = el(doc, 'details', '', { class: 'card lore-entry' });
        details.append(el(doc, 'summary', `${entry.comment} · ${entry.extensions.story_studio.kind}`),
            el(doc, 'p', `Keys: ${entry.key.join(', ')}`, { class: 'muted' }), el(doc, 'pre', entry.content));
        list.append(details);
    }
    main.append(list);
}

export function renderLoreImport(ctx) {
    const { doc, main } = ctx;
    const state = ctx.authoring;
    main.append(el(doc, 'h1', 'Import lorebook'), el(doc, 'p',
        'Review each World Info entry as a draft place, NPC / creature or item. Accept adds a new record with Undo; Skip leaves the pack alone. Existing records are never merged. Review decisions stay in this session.', { class: 'muted' }));
    const input = el(doc, 'input', '', { type: 'file', accept: '.json,application/json', id: 'lore-file' });
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        const token = state.readSeq = (state.readSeq ?? 0) + 1;
        try {
            if (file.size > MAX_LORE_BYTES) throw new Error('World Info exceeds 2 MiB');
            const source = await file.text();
            if (ctx.authoring !== state || token !== state.readSeq) return;
            const queue = importWorldInfo(source);
            state.queue = queue;
            state.active = 0;
            state.importError = '';
        } catch (err) {
            if (ctx.authoring !== state || token !== state.readSeq) return;
            state.importError = `Import refused: ${err.message}`;
        }
        ctx.render();
    });
    main.append(field(doc, 'World Info JSON file', input));
    if (state.importError) main.append(el(doc, 'p', state.importError, { class: 'warning', role: 'alert' }));
    if (!state.queue) return;
    const queue = state.queue;
    const completed = queue.filter(entry => ['accepted', 'skipped'].includes(entry.status)).length;
    main.append(el(doc, 'p', `${queue.length} entries · ${completed} reviewed`, { id: 'import-counts' }));
    const layout = el(doc, 'div', '', { class: 'lore-review' });
    const review = el(doc, 'section', '', { class: 'card stack', 'aria-label': 'Draft entry' });
    const decisions = el(doc, 'section', '', { class: 'stack', 'aria-label': 'Entry decisions' });
    decisions.append(el(doc, 'h2', 'Entry decisions'));
    queue.forEach((entry, index) => {
        const row = el(doc, 'div', '', { class: 'card stack' });
        row.append(button(doc, `${entry.draft.name || `Entry ${entry.id}`} — ${entry.status}`, () => { state.active = index; ctx.render(); },
            { 'aria-pressed': String(index === state.active) }));
        if (entry.errors.length) row.append(el(doc, 'p', entry.errors.join('\n'), { class: 'warning' }));
        decisions.append(row);
    });
    const entry = queue[state.active];
    if (entry) {
        const draft = entry.draft;
        review.append(el(doc, 'h2', `Entry ${entry.id}`), el(doc, 'p', entry.comment),
            el(doc, 'p', `Decision: ${entry.status}`, { class: 'muted' }));
        const kind = el(doc, 'select', '', { id: 'lore-kind' });
        for (const [value, label] of [['places', 'Place'], ['creatures', 'NPC / creature'], ['items', 'Item']]) kind.append(el(doc, 'option', label, { value }));
        kind.value = draft.kind;
        kind.addEventListener('change', () => { draft.kind = kind.value; ctx.render(); });
        kind.disabled = ['accepted', 'skipped'].includes(entry.status);
        review.append(field(doc, 'Draft type', kind));
        for (const [key, label] of [['name', 'Name'], ['slug', 'Record ID'], ['aliases', 'Aliases (one per line)'], ['region', 'Region'], ['content', 'Record text']]) {
            if (key === 'region' && draft.kind !== 'places') continue;
            const control = el(doc, ['aliases', 'content'].includes(key) ? 'textarea' : 'input', '', { id: `lore-${key}` });
            control.value = key === 'aliases' ? draft.aliases.join('\n') : draft[key];
            control.disabled = kind.disabled;
            control.addEventListener('input', () => { draft[key] = key === 'aliases' ? control.value.split('\n').map(value => value.trim()).filter(Boolean) : control.value; });
            review.append(field(doc, label, control));
        }
        if (draft.kind === 'creatures') review.append(el(doc, 'p',
            'NPCs are narrative creature drafts. In a rules pack, author combat fields and resolve schema problems before pack export.', { class: 'warning' }));
        if (entry.errors.length) review.append(el(doc, 'p', entry.errors.join('\n'), { class: 'warning', role: 'alert' }));
        const advance = () => {
            const next = queue.findIndex((item, index) => index > state.active && !['accepted', 'skipped'].includes(item.status));
            if (next !== -1) state.active = next;
        };
        const accept = button(doc, 'Accept draft', () => {
            const result = acceptLoreDraft(ctx.model, draft);
            if (!result.ok) {
                entry.status = 'refused';
                entry.errors = result.errors.map(error => `${error.code}: ${error.message}`);
                ctx.render();
                return;
            }
            entry.status = 'accepted';
            entry.errors = [];
            advance();
            if (!applyEdit(ctx, result)) {
                entry.status = 'refused';
                entry.errors = ['Could not commit draft'];
                ctx.render();
            } else if (!ctx.model.validation.ok) ctx.notify('Draft accepted. Resolve the pack’s Problems before exporting the pack.');
        }, { class: 'primary' });
        const skip = button(doc, 'Skip entry', () => { entry.status = 'skipped'; advance(); ctx.render(); });
        accept.disabled = skip.disabled = kind.disabled;
        const actions = el(doc, 'div', '', { class: 'row' });
        actions.append(accept, skip);
        review.append(actions);
    } else review.append(el(doc, 'p', 'This World Info file has no entries.'));
    layout.append(review, decisions);
    main.append(layout);
}
