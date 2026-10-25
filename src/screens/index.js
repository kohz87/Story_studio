import { el } from '../dom.js';
import { renderClasses } from './classes.js';
import { renderSkills } from './skills.js';
import { renderRecords } from './records.js';
import { renderCheck } from './problems.js';
import { KINDS } from '../records.js';

export function renderScreen(ctx) {
    if (ctx.selection.kind === 'check' && ctx.model?.document) {
        renderCheck(ctx);
        return;
    }
    if (ctx.selection.kind === 'classes' && ctx.model?.document) {
        renderClasses(ctx);
        return;
    }
    if (ctx.selection.kind === 'skills' && ctx.model?.document) {
        renderSkills(ctx);
        return;
    }
    if (ctx.selection.kind !== 'check' && ctx.model?.document && KINDS.includes(ctx.selection.kind)) {
        renderRecords(ctx);
        return;
    }
    ctx.main.append(el(ctx.doc, 'h1', 'Pack editor'));
    ctx.main.append(el(ctx.doc, 'p', ctx.model?.document ? 'Select a pack part to begin editing.' : 'Open a JSON pack to begin. Your work stays on this device.', { class: 'muted' }));
}
