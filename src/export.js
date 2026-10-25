import { safeLabel } from './dom.js';
import { exportPack } from './model.js';

// The shared engine owns the downloaded bytes, including the final newline.
export function downloadPack(ctx, filename) {
    let url;
    let link;
    try {
        const text = exportPack(ctx.model);
        const blob = new ctx.win.Blob([text], { type: 'application/json;charset=utf-8' });
        url = ctx.win.URL.createObjectURL(blob);
        link = ctx.doc.createElement('a');
        link.href = url;
        const safeName = safeLabel(filename || 'pack.json').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
        link.download = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
        link.hidden = true;
        ctx.root.append(link);
        link.click();
        ctx.markExported();
        return true;
    } catch (err) {
        ctx.notify(`export-error: ${err.message || 'Could not export pack'}`);
        return false;
    } finally {
        link?.remove();
        if (url) ctx.win.setTimeout(() => ctx.win.URL.revokeObjectURL(url), 1000);
    }
}
