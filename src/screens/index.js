import { el } from '../dom.js';
export function renderScreen(ctx) {
    ctx.main.append(el(ctx.doc, 'h1', ctx.selection.kind === 'check' ? 'Check and export' : 'Pack editor'));
    ctx.main.append(el(ctx.doc, 'p', ctx.model?.document ? 'Select a pack part to begin editing.' : 'Open a JSON pack to begin. Your work stays on this device.', { class: 'muted' }));
}
