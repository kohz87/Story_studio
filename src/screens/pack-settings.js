import { el, button } from '../dom.js';
import { applyEdit } from '../apply-edit.js';
import { setRpgFormula } from '../edits.js';
import { renderJson } from '../forms.js';
import { PACK_FIELDS, CONTENT_KINDS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { KINDS } from '../records.js';
import { DRAFT_WITH_AI } from '../draft-hint.js';

// The words are Story Block's own (Settings > RPG), so the pack and the reader's page say the same thing.
const FORMULAS = [
    { value: null, label: "Reader's choice", help: 'The reader picks in Settings → RPG; a chat that never chose plays Standard.' },
    { value: 'standard', label: 'Standard', help: 'A main stat plus half a second one, stats start at 5 and grow, and the bars grow with VIT, AGI and INT.' },
    { value: 'classic', label: 'Classic', help: 'One stat on its own, stats start at 10, and the bars are fixed.' },
];

/** The "Stat formula" card: which formula the story plays on (`content.rpg.formula`); the JSON card of `content.rpg` stays below. */
function formulaCard(ctx) {
    const { doc } = ctx;
    const rpg = ctx.model.document.content?.rpg;
    const readable = rpg === undefined || (rpg !== null && typeof rpg === 'object' && !Array.isArray(rpg));
    const current = readable ? rpg?.formula ?? null : undefined;
    const known = FORMULAS.find(choice => choice.value === current);
    const card = el(doc, 'section', '', { class: 'card cf-formula', 'data-cf': 'formula' });
    card.append(el(doc, 'h3', 'Stat formula'));
    const row = el(doc, 'div', '', { class: 'cf-row' });
    const segment = el(doc, 'span', '', { class: 'cf-seg', role: 'group', 'aria-label': 'Stat formula' });
    for (const choice of FORMULAS) {
        const pick = button(doc, choice.label, () => { if (choice.value !== current) applyEdit(ctx, setRpgFormula(ctx.model, choice.value)); }, { 'aria-pressed': String(choice.value === current), 'data-formula': choice.value ?? 'reader' });
        pick.disabled = !readable;
        segment.append(pick);
    }
    row.append(el(doc, 'span', 'Plays on'), segment);
    const help = known ? known.help
        : readable ? 'This value is not a formula Story Block knows; Check names it. Pick one to replace it.'
            : 'content.rpg is not an object, so it is left alone; fix it in the JSON card below.';
    card.append(row, el(doc, 'p', help, { class: 'cf-hint', 'data-cf': 'formula-help' }));
    return card;
}

// Host fields without a dedicated record screen remain editable as plain JSON.
export function renderPackSettings(ctx) {
    ctx.main.append(el(ctx.doc, 'h1', 'Pack settings'));
    ctx.main.append(el(ctx.doc, 'p', 'Edit a field as JSON. Problems appear in Check / export; Undo restores the previous value.', { class: 'muted' }));
    ctx.main.append(el(ctx.doc, 'p', DRAFT_WITH_AI, { class: 'muted draft-hint' }));
    ctx.main.append(formulaCard(ctx));
    const edit = (path, value) => {
        const section = el(ctx.doc, 'details', '', { class: 'card' });
        const title = path.join('.');
        section.append(el(ctx.doc, 'summary', title));
        renderJson(ctx, section, value, path, { rootPath: path, rootSchema: {}, rootValue: value }, title);
        ctx.main.append(section);
    };
    for (const key of PACK_FIELDS) {
        if (key !== 'id' && key !== 'content') edit([key], ctx.model.document[key]);
    }
    if (ctx.model.document.content) {
        for (const key of CONTENT_KINDS) {
            if (key !== 'rules' && key !== 'skills' && !KINDS.includes(key)) edit(['content', key], ctx.model.document.content[key]);
        }
    }
}
