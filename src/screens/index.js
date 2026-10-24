import { el } from '../dom.js';
import { renderClasses } from './classes.js';

export function renderScreen(ctx) {
    if (ctx.selection.kind === 'classes' && ctx.model?.document) {
        renderClasses(ctx);
        return;
    }
    ctx.main.append(el(ctx.doc, 'h1', ctx.selection.kind === 'check' ? 'Check and export' : 'Pack editor'));
    ctx.main.append(el(ctx.doc, 'p', ctx.model?.document ? 'Select a pack part to begin editing.' : 'Open a JSON pack to begin. Your work stays on this device.', { class: 'muted' }));
}
