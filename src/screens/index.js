import { renderPresentation, renderSettingsDefaults } from './presentation.js';
import { renderPackSettings } from './pack-settings.js';
import { el } from '../dom.js';
import { renderRecords } from './records.js';
import { renderTimeline } from './timeline.js';
import { renderCheck } from './problems.js';
import { KINDS } from '../records.js';
import { renderNarrator, renderLorebook, renderLoreImport } from './authoring.js';
import { renderDataModules } from './dm/index.js';
import { DRAFT_WITH_AI } from '../draft-hint.js';
import { renderCodeModule } from './code-module.js';

export function renderScreen(ctx) {
    if (ctx.selection.kind === 'code-module') {
        renderCodeModule(ctx);
        return;
    }
    const authoring = { presentation: renderPresentation, defaults: renderSettingsDefaults, narrator: renderNarrator, lorebook: renderLorebook, 'lore-import': renderLoreImport, 'data-modules': renderDataModules };
    if (Object.hasOwn(authoring, ctx.selection.kind) && ctx.model?.document) {
        authoring[ctx.selection.kind](ctx);
        return;
    }
    if (ctx.selection.kind === 'settings' && ctx.model?.document) {
        renderPackSettings(ctx);
        return;
    }
    if (ctx.selection.kind === 'check' && ctx.model?.document) {
        renderCheck(ctx);
        return;
    }
    if (ctx.selection.kind !== 'check' && ctx.model?.document && KINDS.includes(ctx.selection.kind)) {
        (ctx.selection.kind === 'events' ? renderTimeline : renderRecords)(ctx);
        return;
    }
    ctx.main.append(el(ctx.doc, 'h1', 'Pack editor'));
    ctx.main.append(el(ctx.doc, 'p', ctx.model?.document ? 'Select a pack part to begin editing.' : 'Open a JSON pack to begin. Your work stays on this device.', { class: 'muted' }));
    if (!ctx.model?.document) ctx.main.append(el(ctx.doc, 'p', DRAFT_WITH_AI, { class: 'muted draft-hint' }));
}
