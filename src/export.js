import { safeLabel } from './dom.js';
import { exportPack } from './model.js';
import { writeZip } from './cast/zip.js';
import { zipPortraits } from './cast/data.js';
import { ZIP_LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';

export function downloadFile(ctx, payload, filename, type) {
    let url;
    let link;
    try {
        const blob = new ctx.win.Blob([payload], { type });
        url = ctx.win.URL.createObjectURL(blob);
        link = ctx.doc.createElement('a');
        link.href = url;
        link.download = safeLabel(filename).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
        link.hidden = true;
        ctx.root.append(link);
        link.click();
        return true;
    } catch (err) {
        ctx.notify(`export-error: ${err.message || 'Could not export file'}`);
        return false;
    } finally {
        link?.remove();
        if (url) ctx.win.setTimeout(() => ctx.win.URL.revokeObjectURL(url), 1000);
    }
}

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

/**
 * The pack as one .zip: pack.json (exactly what "Export pack.json only" gives) and portraits/<file> for each picture the cast names.
 * Story Block imports it as it is. A picture nobody names is left out, and so is a name with no picture.
 */
export async function downloadZip(ctx, filename) {
    try {
        const text = exportPack(ctx.model);
        const { files } = zipPortraits(ctx.model);
        const bytes = await writeZip([
            { name: 'pack.json', bytes: new TextEncoder().encode(text) },
            ...files.map(file => ({ name: `portraits/${file.name}`, bytes: file.picture.bytes })),
        ]);
        if (bytes.length > ZIP_LIMITS.archive) throw new Error(`The zip would be larger than ${Math.round(ZIP_LIMITS.archive / 1024 / 1024)} MB`);
        const safeName = safeLabel(filename || 'pack.zip').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
        if (!downloadFile(ctx, bytes, safeName.endsWith('.zip') ? safeName : `${safeName}.zip`, 'application/zip')) return false;
        ctx.markExported();
        return true;
    } catch (err) {
        ctx.notify(`export-error: ${safeLabel(err?.message || 'Could not export the zip')}`);
        return false;
    }
}
