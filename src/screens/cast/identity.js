// Who a Cast person is: names, aliases, appearance, background and key.

import { applyEdit } from '../../apply-edit.js';
import { el, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { setSchemaField as setField, renameId } from '../../edits.js';
import { CAST_LIMITS, PLACEHOLDER_ID, idForName } from '../../cast/data.js';
import { packCalendar } from '../../timeline/calendar.js';
import { line, group, hint, wrap, text } from './form.js';

// The pack calendar's month names, as suggestions for the birthday (none when the pack has no calendar: Story Block needs one).
function birthdayMonths(ctx) {
    const calendar = packCalendar(ctx.model.document);
    return calendar.hasCalendar ? calendar.months.map(month => `${month.name} `) : [];
}

function whoFields(ctx, index, person) {
    const { doc } = ctx;
    const names = text(ctx, index, person, ['name'], 'Name', {
        max: CAST_LIMITS.name,
        // A new person's key follows the name until the writer has named them; after that it is theirs to keep.
        after: (value, at) => {
            const current = records(ctx.model, 'cast')[at];
            const id = idForName(ctx.model, value, current.id);
            if (!PLACEHOLDER_ID.test(current.id) || !id) return false;
            const moved = renameId(ctx.model, 'cast', current.id, id);
            if (!moved.ok) return false;
            const named = setField(moved.model, ['content', 'cast', at, 'name'], value);
            if (!named.ok) return false;
            applyEdit(ctx, named, { id });
            return true;
        },
    });
    const aliases = text(ctx, index, person, ['aliases'], 'Also called', {
        note: 'Comma between names.', transform: value => { const list = value.split(',').map(line).filter(Boolean); return list.length ? list : undefined; },
    });
    const body = [
        names, aliases,
        text(ctx, index, person, ['about'], 'In one line', { max: CAST_LIMITS.about, wide: true }),
        text(ctx, index, person, ['look'], 'Look', { area: true, max: CAST_LIMITS.look, wide: true,
            note: 'Build, face, hair, eyes, marks: what stays the same whatever they wear. NPC State Delta shows it as their physical appearance.' }),
        text(ctx, index, person, ['wears'], 'Usually wears', { area: true, max: CAST_LIMITS.wears, wide: true,
            note: 'Clothes, armour and gear they usually have on. NPC State Delta shows it as their current appearance until the story changes it.' }),
        text(ctx, index, person, ['voice'], 'Voice', { max: CAST_LIMITS.voice, wide: true }),
        text(ctx, index, person, ['birthday'], 'Birthday', { max: CAST_LIMITS.birthday, wide: true, suggest: birthdayMonths(ctx),
            note: 'A month and day of this pack’s calendar, like “Icewane 27”; a year may follow (“Icewane 27, 1204”). Left empty, NPC State Delta chooses one.' }),
        text(ctx, index, person, ['history'], 'Background', { area: true, max: CAST_LIMITS.history, wide: true }),
    ];
    const key = el(doc, 'input', '', { value: person.id, 'data-path': JSON.stringify(['content', 'cast', index, 'id']) });
    key.addEventListener('change', () => {
        const next = key.value.trim();
        const id = records(ctx.model, 'cast')[index].id;
        const result = renameId(ctx.model, 'cast', id, next);
        if (result.ok) applyEdit(ctx, result, { id: next });
        else { ctx.notify(`${result.errors?.[0]?.code ?? 'bad-id'}: ${result.errors?.[0]?.message ?? 'Use a lowercase key with hyphens.'}`); key.value = id; }
    });
    const grid = el(doc, 'div', '', { class: 'cf-grid' });
    grid.append(...body, wrap(ctx, 'Key', key, { note: 'What the story files them under. Change it only before anyone plays this pack.', wide: true }));
    const note = hint(doc, `Hidden from players until they meet ${safeLabel(person.name || 'them')}; then NPC State Delta makes the dossier from this, at once.`);
    return group(doc, 'Who they are', grid, note);
}

// --- how they behave ---------------------------------------------------------------------------------------------------


export { whoFields };
