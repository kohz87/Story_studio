import { safeLabel } from './dom.js';

// Rebuild refused controls from the current model without saving or adding history.
export function applyEdit(ctx, result, selection) {
    const previous = { ...ctx.selection };
    let errors = result?.errors;
    try {
        if (result?.ok && selection) Object.assign(ctx.selection, selection);
        if (ctx.apply(result)) return true;
    } catch (err) {
        errors = [{ code: err?.code || 'refused-edit', message: err?.message || 'Edit refused' }];
    }
    Object.assign(ctx.selection, previous);
    ctx.render();
    if (!errors?.length) errors = [{ code: 'refused-edit', message: 'Edit refused' }];
    ctx.notify(errors.map(e => `${safeLabel(e.code)}: ${safeLabel(e.message)}`).join('\n'));
    return false;
}
