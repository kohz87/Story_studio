// The Cast part: the people a pack writes by hand (content.cast), the list and one form per person.
//
// A person is a prepared dossier: who they are, a portrait, where their story starts, what draws them to the party, their
// relationship at the start, whether they may die before they are met, and up to eight secrets. Story Director keeps them off-screen
// until the party meets them; NPC State Delta makes the dossier from this entry at the first meeting. Every limit and message is
// Story Block's (vendor/.../packs/cast.js); the form only shows them where the writer is typing.

import { applyEdit } from '../apply-edit.js';
import { el, button, safeLabel } from '../dom.js';
import { records } from '../records.js';
import { add } from '../edits.js';
import { openRecordRemoveDialog } from './records.js';
import { cardTags, newPerson, pictureOf, problemsOfPerson } from '../cast/data.js';
import { pictureUrl } from '../cast/portrait.js';
import { isRecord } from './cast/pieces.js';
import { whoFields } from './cast/identity.js';
import { behaviourFields } from './cast/behaviour.js';
import { portraitFields } from './cast/portrait.js';
import { startFields, drawnFields, relationFields, dieFields } from './cast/story.js';
import { skillFields } from './cast/skills.js';
import { secretFields } from './cast/secrets.js';

export { castState } from './cast/form.js';

function renderPerson(ctx, inspector, { record, idx }) {
    const { doc, model } = ctx;
    const titleRow = el(doc, 'div', '', { class: 'inspector-title-row' });
    titleRow.append(el(doc, 'h2', record.name || record.id), el(doc, 'span', 'Cast', { class: 'chip' }));
    inspector.append(titleRow);
    const problems = problemsOfPerson(model, idx);
    if (problems.length) inspector.append(el(doc, 'div', problems.join('\n'), { role: 'status', class: 'warning' }));
    const form = el(doc, 'div', '', { class: 'inspector-form-body cf-form' });
    form.append(
        whoFields(ctx, idx, record), behaviourFields(ctx, idx, record), portraitFields(ctx, idx, record), startFields(ctx, idx, record), drawnFields(ctx, idx, record),
        relationFields(ctx, idx, record), dieFields(ctx, idx, record), skillFields(ctx, idx, record), secretFields(ctx, idx, record),
    );
    inspector.append(form);
    const remove = button(doc, 'Remove…', () => openRecordRemoveDialog(ctx, 'cast', record, remove), { class: 'danger' });
    inspector.append(remove);
}

function addPerson(ctx) {
    const person = newPerson(ctx.model);
    const result = add(ctx.model, 'cast', person);
    if (applyEdit(ctx, result, { id: person.id })) ctx.select('cast', person.id);
}

/** The Cast screen: the list in the middle, the selected person's form in the inspector. */
export function renderCast(ctx) {
    const { doc, model } = ctx;
    const list = records(model, 'cast').map((record, idx) => ({ record, idx })).filter(({ record }) => isRecord(record));
    const screen = el(doc, 'div', '', { class: 'records-screen' });
    const header = el(doc, 'div', '', { class: 'records-header' });
    header.append(el(doc, 'h1', 'Cast'), el(doc, 'div', `${list.length} ${list.length === 1 ? 'person' : 'people'} · hidden from players until met`, { class: 'records-subtitle' }),
        button(doc, '+ Add person', () => addPerson(ctx)));
    screen.append(header);
    const cards = el(doc, 'div', '', { class: 'records-list' });
    if (!list.length) cards.append(el(doc, 'p', 'No one in the cast yet. A person starts somewhere with a goal and lives off-screen until the party meets them.', { class: 'muted' }));
    for (const { record, idx } of list) {
        const id = typeof record.id === 'string' ? record.id : '';
        const card = button(doc, '', () => ctx.select('cast', id), { class: 'record-card cast-card', 'aria-pressed': String(ctx.selection.id === id), 'data-id': id });
        if (!id) card.disabled = true;
        const picture = pictureOf(model, record);
        card.append(picture ? el(doc, 'img', '', { src: pictureUrl(picture), alt: '' }) : el(doc, 'span', safeLabel(record.name || '?').trim().slice(0, 1).toUpperCase() || '?', { class: 'cast-face', 'aria-hidden': 'true' }));
        const body = el(doc, 'span', '', { class: 'cast-body' });
        const title = el(doc, 'span', '', { class: 'record-card-header' });
        title.append(el(doc, 'span', record.name || id || `Person ${idx + 1}`, { class: 'record-card-name' }));
        const problems = problemsOfPerson(model, idx);
        if (problems.length) { title.append(el(doc, 'span', '', { class: 'problem-dot', 'aria-label': 'Has problems' })); card.setAttribute('data-has-problem', 'true'); }
        body.append(title);
        const meta = [id, record.about, record.start?.place ? `starts at ${safeLabel(record.start.place)}` : ''].filter(Boolean).map(safeLabel).join(' · ');
        if (meta) body.append(el(doc, 'span', meta, { class: 'record-card-meta' }));
        const tags = cardTags(model, record);
        if (tags.length) {
            const row = el(doc, 'span', '', { class: 'cc-tags' });
            for (const tag of tags) row.append(el(doc, 'span', tag, { class: 'cc-tag' }));
            body.append(row);
        }
        card.append(body);
        cards.append(card);
    }
    screen.append(cards);
    ctx.main.append(screen);
    const inspector = ctx.inspector || screen;
    const selected = list.find(({ record }) => record.id === ctx.selection.id);
    if (!selected) { inspector.append(el(doc, 'p', 'Select a person from the list to read and edit them.', { class: 'muted' })); return; }
    renderPerson(ctx, inspector, selected);
}
