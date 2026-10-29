import { el } from '../dom.js';
import { renderJson } from '../forms.js';
import { PACK_FIELDS, CONTENT_KINDS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { KINDS } from '../records.js';
import { DRAFT_WITH_AI } from '../draft-hint.js';

// Host fields without a dedicated record screen remain editable as plain JSON.
export function renderPackSettings(ctx) {
    ctx.main.append(el(ctx.doc, 'h1', 'Pack settings'));
    ctx.main.append(el(ctx.doc, 'p', 'Edit a field as JSON. Problems appear in Check / export; Undo restores the previous value.', { class: 'muted' }));
    ctx.main.append(el(ctx.doc, 'p', DRAFT_WITH_AI, { class: 'muted draft-hint' }));
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
