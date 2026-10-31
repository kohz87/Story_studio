// Writing timeline events with an AI: the panel in the inspector (ask, then paste the answer) and the banner on a draft.
//
// Studio sends nothing anywhere: the writer copies a prompt Studio built from the open pack into an AI chat of their own and
// pastes the answer back. What it reads becomes drafts on the Timeline (see timeline/drafts.js), kept or discarded one by one.
import { applyEdit } from '../apply-edit.js';
import { el, button, field } from '../dom.js';
import { downloadFile } from '../export.js';
import { draftsOf } from '../model.js';
import { records, identity, localId } from '../records.js';
import { buildPrompt, wordCount, cutNote, IDEA_LIMIT } from '../timeline/ai-prompt.js';
import { readAnswer } from '../timeline/ai-answer.js';
import { addDrafts, saveFailed, draftProblems, draftIssues, waitingFor, summarize, keepDraft, keepAll, keepableCount, discardDraft, ackNote } from '../timeline/drafts.js';
import { humanName } from '../timeline/event.js';
import { timelineState, fieldset, checkbox, small } from './timeline-form.js';

const newState = () => ({ open: false, step: 1, idea: '', include: { calendar: true, places: true, names: true, events: true }, answer: '', result: null });

/** What the panel keeps between renders (it lives with the Timeline's own state, so a pack opened later starts clean). */
export function aiState(ctx) {
    const ui = timelineState(ctx);
    return ui.ai ??= newState();
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Opens the panel in the inspector (on a phone, the inspector slides over the list). */
export function openAiPanel(ctx) {
    aiState(ctx).open = true;
    ctx.select('events', null);
    ctx.app?.classList.add('inspector-open');
}

/** Whether the panel is what the inspector shows now: it is open and no event is selected. */
export const aiShown = ctx => aiState(ctx).open && ctx.selection.id === null;

// ---------------------------------------------------------------- the panel

export function renderAiPanel(ctx, container) {
    const { doc } = ctx;
    const ui = aiState(ctx);
    const panel = el(doc, 'div', '', { class: 'tl-ai' });
    container.append(panel);

    const draw = focus => {
        panel.replaceChildren();
        const title = el(doc, 'div', '', { class: 'inspector-title-row' });
        const heading = el(doc, 'h2', 'Write events with an AI', { tabindex: '-1' });
        title.append(heading, button(doc, 'Close', () => { ui.open = false; ctx.app?.classList.remove('inspector-open'); ctx.render(); }, { 'aria-label': 'Close the AI writing help' }));
        const steps = el(doc, 'div', '', { class: 'tl-ai-steps', role: 'group', 'aria-label': 'Steps' });
        for (const [number, label] of [[1, '1 · Ask'], [2, '2 · Paste the answer']]) {
            steps.append(el(doc, 'span', label, ui.step === number ? { 'aria-current': 'step' } : {}));
        }
        panel.append(title, steps);
        if (ui.step === 1) ask(); else paste();
        if (focus) (focus === 'heading' ? heading : panel.querySelector(focus))?.focus?.();
    };

    // ------------------------------------------------------------ step 1
    function ask() {
        const model = ctx.model;
        const idea = el(doc, 'textarea', '', { rows: '4', maxlength: String(IDEA_LIMIT), 'aria-describedby': 'tl-ai-count' });
        idea.value = ui.idea;
        const count = el(doc, 'div', '', { class: 'tl-count', id: 'tl-ai-count' });
        const status = el(doc, 'span', '', { class: 'tl-ai-note', role: 'status' });
        const pre = el(doc, 'pre', '', { class: 'tl-ai-pre', tabindex: '0', role: 'region', 'aria-label': 'The prompt' });
        const cut = small(doc, '');
        const fold = el(doc, 'details', '', { class: 'tl-ai-fold' });
        fold.open = ui.fold !== false;
        fold.addEventListener('toggle', () => { ui.fold = fold.open; });
        const summary = el(doc, 'summary', '', { class: 'tl-small' });
        fold.append(summary, pre, cut);
        const copy = button(doc, 'Copy prompt', () => copyPrompt(), { class: 'primary' });
        const save = button(doc, 'Save as .txt', () => {
            const id = typeof model.document?.id === 'string' ? model.document.id : 'pack';
            if (downloadFile(ctx, current().text, `${id}-timeline-prompt.txt`, 'text/plain;charset=utf-8')) status.textContent = 'Saved. Open the file and paste its text into your AI chat.';
        });
        const current = () => buildPrompt(model.document, { idea: ui.idea, include: ui.include });
        const refresh = () => {
            const prompt = current();
            pre.textContent = prompt.text;
            summary.textContent = `The prompt (${wordCount(prompt.words)})`;
            cut.textContent = cutNote(prompt.cut, prompt.trimmed);
            cut.hidden = !cut.textContent;
            count.textContent = `${[...ui.idea].length} / ${IDEA_LIMIT}`;
            const empty = !ui.idea.trim();
            copy.disabled = empty;
            save.disabled = empty;
            return prompt;
        };
        function copyPrompt() {
            const { text } = current();
            const clipboard = ctx.win?.navigator?.clipboard;
            const fallback = () => {
                fold.open = true;
                try {
                    const range = doc.createRange();
                    range.selectNodeContents(pre);
                    const selection = ctx.win.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch { /* Selecting is a convenience. */ }
                status.textContent = 'Your browser would not copy it. The prompt is selected below: press Ctrl+C (Cmd+C on a Mac).';
            };
            if (!clipboard?.writeText) return fallback();
            return clipboard.writeText(text).then(() => { status.textContent = 'Copied. Paste it into your AI chat.'; }, fallback);
        }
        idea.addEventListener('input', () => { ui.idea = idea.value; refresh(); });
        const counts = refresh().counts;
        const include = el(doc, 'div', '', { class: 'tl-ai-incl' });
        include.append(small(doc, 'The prompt includes, from this pack:'));
        const row = (key, text) => include.append(checkbox(doc, text, ui.include[key], checked => { ui.include[key] = checked; refresh(); }));
        row('calendar', 'Calendar and the story’s start');
        row('places', `Regions and places (${counts.regions} · ${counts.places})`);
        row('names', `Factions and lore names (from the lorebook${counts.names ? '' : ': none yet'})`);
        row('events', counts.events === 1 ? 'The 1 event already here' : `The ${counts.events} events already here`);
        const ideaRow = el(doc, 'div', '', { class: 'fieldset-row' });
        ideaRow.append(field(doc, 'Your idea, in your own words', idea));
        panel.append(fieldset(doc, 'What should happen?', ideaRow, count, include));
        const actions = el(doc, 'div', '', { class: 'tl-ai-row' });
        actions.append(copy, save, el(doc, 'span', 'Paste it into any AI chat. Studio sends nothing anywhere.', { class: 'tl-ai-note' }));
        panel.append(actions, status, fold, button(doc, 'Next: paste the answer', () => { ui.step = 2; draw('textarea'); }));
    }

    // ------------------------------------------------------------ step 2
    function paste() {
        const model = ctx.model;
        const answer = el(doc, 'textarea', '', { class: 'mono', rows: '7', spellcheck: 'false' });
        answer.value = ui.answer;
        const results = el(doc, 'div', '', { class: 'tl-ai-results' });
        const drawResults = () => {
            results.replaceChildren();
            const { result } = ui;
            if (!result) return;
            if (!result.ok) { results.append(el(doc, 'p', result.error, { class: 'warning', role: 'status' })); return; }
            const found = result.items.length;
            const drafts = [...draftsOf(model), ...result.items.map(item => item.draft)];
            const set = fieldset(doc, found ? `${plural(found, 'event')} found` : 'No events found');
            const list = el(doc, 'div', '', { class: 'tl-ai-list' });
            result.items.forEach((item, at) => {
                const problems = draftProblems(model, drafts, draftsOf(model).length + at);
                const said = summarize(model, item.draft.record);
                const card = el(doc, 'div', '', { class: 'tl-ai-draft' });
                card.append(el(doc, 'span', problems.length ? '⚠ Needs a look' : '✓ Ready', { class: problems.length ? 'tl-ai-warn' : 'tl-ai-ok' }),
                    el(doc, 'b', item.name),
                    el(doc, 'span', [said.when, said.where, said.lasting].filter(Boolean).join(' · '), { class: 'tl-ai-meta' }));
                for (const note of [...problems, ...item.info]) card.append(el(doc, 'span', note, { class: `tl-ai-meta${problems.includes(note) ? ' tl-ai-warn' : ''}` }));
                list.append(card);
            });
            for (const left of result.skipped) list.append(el(doc, 'p', `Left out, entry ${left.index + 1}${left.name ? ` (${left.name})` : ''}: ${left.reason}`, { class: 'tl-small' }));
            if (result.extra) list.append(el(doc, 'p', `Only the first ${result.items.length + result.skipped.length} entries were read; ${plural(result.extra, 'more entry', 'more entries')} left out. Paste them again in another round.`, { class: 'tl-small' }));
            set.append(list);
            results.append(set);
            if (!found) return;
            const add = button(doc, `Add ${found} as ${found === 1 ? 'a draft' : 'drafts'}`, () => addAll(), { class: 'primary' });
            const row = el(doc, 'div', '', { class: 'tl-ai-row' });
            row.append(add, el(doc, 'span', 'Drafts sit on the Timeline but stay out of the exported pack until you keep them.', { class: 'tl-ai-note' }));
            results.append(row);
        };
        const addAll = () => {
            // Read it again against the pack as it is now, so an ID that became taken since the check is not reused.
            const again = readAnswer(ui.answer, ctx.model);
            if (!again.ok || !again.items.length) { ui.result = again; drawResults(); return; }
            const first = again.items[0].id;
            if (applyEdit(ctx, addDrafts(ctx.model, again.items.map(item => item.draft)), { id: first, form: 'draft' })) {
                // The project is saved with its drafts. If the browser would not keep that, take them back out (the history as it was,
                // with no redo step for them) and say so, rather than let a reload lose them without a word.
                if (ctx.saved === false) {
                    ctx.history.revert();
                    Object.assign(ctx.selection, { id: null, form: null });
                    ctx.changed();
                    ui.open = true;
                    ctx.render();
                    ctx.notify(saveFailed('they were not added'));
                    return;
                }
                Object.assign(ui, { step: 1, answer: '', result: null });
                ctx.notify(`Added ${plural(again.items.length, 'draft')}. They stay out of the pack until you keep them.`);
            }
        };
        answer.addEventListener('input', () => {
            ui.answer = answer.value;
            if (ui.result) { ui.result = null; drawResults(); }
        });
        const check = button(doc, 'Check it', () => { ui.result = readAnswer(ui.answer, ctx.model); drawResults(); }, { class: 'primary' });
        const row = el(doc, 'div', '', { class: 'fieldset-row' });
        row.append(field(doc, 'Paste it here', answer));
        const actions = el(doc, 'div', '', { class: 'tl-ai-row' });
        actions.append(check, el(doc, 'span', 'Checked against this pack: names, dates, places, lengths and Story Director’s limits.', { class: 'tl-ai-note' }));
        panel.append(fieldset(doc, 'The AI’s answer', row, actions), results, button(doc, 'Back to the prompt', () => { ui.step = 1; draw('heading'); }));
        drawResults();
    }

    draw(null);
}

// ---------------------------------------------------------------- the banner on a draft

/** The banner above a draft's form: what is wrong with it, and Keep, Discard and Keep all. */
export function draftBanner(ctx, index) {
    const { doc, model } = ctx;
    const drafts = draftsOf(model);
    const draft = drafts[index];
    const id = localId(model, identity(draft.record, 'events'));
    const issues = draftIssues(model, drafts, index);
    const problems = issues.map(issue => issue.text);
    const waiting = waitingFor(model, drafts, index);
    const name = humanName(id);
    const banner = el(doc, 'div', '', { class: 'tl-banner' });
    const words = el(doc, 'span');
    words.append(el(doc, 'b', 'Draft from the AI.'), ' Check it in the form below like any event. It is not in the pack until you keep it.');
    banner.append(words);
    if (problems.length) {
        const list = el(doc, 'ul', '', { class: 'tl-banner-list', 'aria-label': 'What needs a look' });
        for (const issue of issues) {
            const item = el(doc, 'li', issue.text);
            // A note about something left out of the answer can be set aside, once the writer has chosen to leave it so.
            if (issue.ack) item.append(button(doc, issue.ack, () => { applyEdit(ctx, ackNote(ctx.model, id, issue.note), { id }); }, { class: 'tl-ack' }));
            list.append(item);
        }
        banner.append(list);
    }
    const row = el(doc, 'div', '', { class: 'tl-ai-row' });
    const keep = button(doc, 'Keep', () => {
        if (applyEdit(ctx, keepDraft(ctx.model, id), { id, form: null })) ctx.notify(`Kept “${name}”: it is part of the pack now.`);
    }, { class: 'primary' });
    const reason = problems.length ? 'Fix what needs a look first.' : waiting ? `Keep “${waiting.name}” first: this event comes after it.` : '';
    if (reason) { keep.disabled = true; keep.setAttribute('aria-describedby', 'tl-draft-reason'); }
    row.append(keep, button(doc, 'Discard', () => {
        if (applyEdit(ctx, discardDraft(ctx.model, id), { id: null, form: null })) ctx.notify(`Discarded “${name}”.`);
    }));
    if (drafts.length > 1) {
        const ready = keepableCount(model);
        const all = button(doc, ready === drafts.length ? `Keep all ${drafts.length} drafts` : `Keep the ${ready} that ${ready === 1 ? 'is' : 'are'} ready`, () => {
            const done = keepAll(ctx.model);
            if (!done.result) return ctx.notify('None of the drafts can be kept yet: each one needs a look.');
            if (applyEdit(ctx, done.result, {})) ctx.notify(`Kept ${plural(done.kept, 'draft')}${done.left ? `; ${done.left} still ${done.left === 1 ? 'needs' : 'need'} a look` : ''}.`);
        });
        if (!ready) all.disabled = true;
        row.append(all);
    }
    banner.append(row);
    if (reason) banner.append(el(doc, 'span', reason, { class: 'tl-small', id: 'tl-draft-reason' }));
    return banner;
}

/** The draft with this ID as `{ index }` among the project's drafts, or null. */
export function findDraft(model, id) {
    const index = draftsOf(model).findIndex(draft => localId(model, identity(draft.record, 'events')) === id);
    return index < 0 ? null : { index, count: records(model, 'events').length };
}

/** What the selected event ID means: `'draft'` or `'pack'`, or null when it is neither. A draft row selects with the form 'draft', so a draft and an event that share an ID can each be opened. */
export function selectedKind(ctx) {
    const { id, form } = ctx.selection;
    if (id === null) return null;
    const isPack = records(ctx.model, 'events').some(event => event !== null && typeof event === 'object' && localId(ctx.model, identity(event, 'events')) === id);
    const isDraft = findDraft(ctx.model, id) !== null;
    if (form === 'draft') return isDraft ? 'draft' : isPack ? 'pack' : null;
    return isPack ? 'pack' : isDraft ? 'draft' : null;
}
