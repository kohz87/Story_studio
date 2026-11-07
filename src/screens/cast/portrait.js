// The Cast portrait field and the picture it keeps on the snapshot.

import { el, button, safeLabel } from '../../dom.js';
import { records } from '../../records.js';
import { portraitsOf, withPortraits } from '../../model.js';
import { PORTRAIT_LIMITS, pictureOf, portraitNames } from '../../cast/data.js';
import { browserIo, fitPortrait, kb, pictureUrl, portraitFileName, sniffImage } from '../../cast/portrait.js';
import { isRecord, castState, edit, group, hint, problemNote } from './form.js';

function portraitFields(ctx, index, person) {
    const { doc, model } = ctx;
    const ui = castState(ctx);
    const picture = pictureOf(model, person);
    const named = typeof person.portrait === 'string' ? person.portrait : '';
    const face = el(doc, 'div', '', { class: 'cf-face' });
    if (picture) face.append(el(doc, 'img', '', { src: pictureUrl(picture), alt: `${safeLabel(person.name)}'s portrait` }));
    else face.append(el(doc, 'span', safeLabel(person.name || '?').trim().slice(0, 1).toUpperCase() || '?', { class: 'cf-face-empty', 'aria-hidden': 'true' }));

    const chooser = el(doc, 'input', '', { type: 'file', accept: 'image/webp,image/png,image/jpeg', hidden: '', 'aria-label': 'Portrait image', 'data-cast-portrait': 'true' });
    chooser.addEventListener('change', async () => {
        const file = chooser.files?.[0];
        chooser.value = '';
        if (file) await choosePortrait(ctx, records(ctx.model, 'cast')[index]?.id, file);
    });
    const choose = button(doc, picture || named ? 'Replace image…' : 'Choose image…', () => chooser.click());
    const remove = button(doc, 'Remove', () => removePortrait(ctx, records(ctx.model, 'cast')[index]?.id), { class: 'danger' });
    remove.disabled = !named;
    const row = el(doc, 'div', '', { class: 'cf-row' });
    row.append(choose, remove, chooser);

    const facts = el(doc, 'p', '', { class: 'cf-hint', 'data-portrait-facts': 'true' });
    if (picture) {
        facts.append(`${named} · ${picture.width} × ${picture.height} · `, el(doc, 'b', `${kb(picture.bytes.length)} KB`, { class: 'cf-ok' }));
        const shrunk = ui.shrunk.get(named);
        if (shrunk?.picture === picture) facts.append(` (${shrunk.text})`);
        facts.append('. ');
    } else if (named) {
        facts.append(el(doc, 'span', `${named} is named, but no picture is held for it: choose the image again, or open the pack as a .zip.`, { class: 'cf-warn' }), ' ');
    }
    facts.append(`Pictures are made smaller automatically to fit ${kb(PORTRAIT_LIMITS.bytes)} KB; JPEG, PNG or WebP.`);
    const where = hint(doc, `Exported beside the pack in portraits/; shown on their dossier from the first meeting.${ui.busy === person.id ? ' Making it smaller…' : ''}`);
    const side = el(doc, 'div', '', { class: 'cf-stack' });
    side.append(row, facts, where);
    const problem = problemNote(doc, model, ['content', 'cast', index, 'portrait']);
    if (problem) side.append(problem);
    const layout = el(doc, 'div', '', { class: 'cf-portrait' });
    layout.append(face, side);
    const set = group(doc, 'Portrait', layout);
    set.setAttribute('data-cf', 'portrait');
    return set;
}

/** Takes a picked image: makes it fit, then saves the picture and the name in one undo step. */
async function choosePortrait(ctx, id, file) {
    const ui = castState(ctx);
    if (ui.busy) return;
    ui.busy = id;
    ctx.render();
    let fit;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const io = browserIo(ctx.win, bytes);
        try { fit = await fitPortrait(bytes, io); } finally { io.close(); }
        fit.original = sniffImage(bytes);
    } catch (error) {
        ui.busy = false;
        ctx.notify(`portrait: ${safeLabel(error?.message || 'That picture could not be used.')}`);
        ctx.render();
        return;
    }
    ui.busy = false;
    const index = records(ctx.model, 'cast').findIndex(person => isRecord(person) && person.id === id);
    if (index < 0) { ctx.render(); return; }
    const person = records(ctx.model, 'cast')[index];
    const table = new Map(portraitsOf(ctx.model));
    const others = portraitNames(records(ctx.model, 'cast').filter(other => other !== person));
    const reuse = typeof person.portrait === 'string' && person.portrait.toLowerCase().endsWith(fit.type === 'jpg' ? '.jpg' : `.${fit.type}`) && !others.includes(person.portrait);
    const name = reuse ? person.portrait : portraitFileName(person.id, fit.type, new Set([...table.keys(), ...others]));
    if (!others.includes(name) && new Set([...others, name]).size > PORTRAIT_LIMITS.perPack) {
        ctx.notify(`portrait: A pack may name at most ${PORTRAIT_LIMITS.perPack} different portrait files.`);
        ctx.render();
        return;
    }
    const picture = Object.freeze({ bytes: fit.bytes, type: fit.type, width: fit.width, height: fit.height });
    if (typeof person.portrait === 'string' && person.portrait !== name && !others.includes(person.portrait)) table.delete(person.portrait);
    table.set(name, picture);
    const label = fit.changed ? `made smaller from ${fit.from >= 1024 * 1024 ? `${(fit.from / 1024 / 1024).toFixed(1)} MB` : `${kb(fit.from)} KB`} ${String(fit.original ?? 'picture').toUpperCase()}` : 'kept as it was';
    ui.shrunk.set(name, { picture, text: label });
    edit(ctx, index, record => { record.portrait = name; }, result => ({ ...result, model: withPortraits(result.model, table) }));
}

function removePortrait(ctx, id) {
    const index = records(ctx.model, 'cast').findIndex(person => isRecord(person) && person.id === id);
    if (index < 0) return;
    const person = records(ctx.model, 'cast')[index];
    if (typeof person.portrait !== 'string') return;
    const table = new Map(portraitsOf(ctx.model));
    if (!portraitNames(records(ctx.model, 'cast').filter(other => other !== person)).includes(person.portrait)) table.delete(person.portrait);
    edit(ctx, index, record => { delete record.portrait; }, result => ({ ...result, model: withPortraits(result.model, table) }));
}


export { portraitFields };
