// Reading a pack chosen or dropped on the Studio page: JSON text with its size limit, or the shared Story Block zip
// reader with its portrait checks. Both reads carry a sequence token so a newer edit wins over a slow file.
import { isZipFile, readPackZip } from '../../vendor/story-block/src/v2/packs/bundle.js';
import { ZIP_LIMITS, PORTRAIT_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { safeLabel } from '../dom.js';
import { MAX_PACK_BYTES } from '../session.js';
import { imageSize, sniffImage, kb } from '../cast/portrait.js';

export async function openPackFile(f, { destroyed, nextToken, isStale, notify, openZip, loadText }) {
    if (destroyed()) return false;
    if (isZipFile(f)) return openZip(f);
    const token = nextToken();
    if (f && typeof f.size === 'number' && f.size > MAX_PACK_BYTES) {
        notify('too-large: Pack file exceeds maximum size limit');
        return false;
    }
    let text;
    try {
        text = await f.text();
    } catch (err) {
        if (isStale(token)) return false;
        notify(`file-read-error: ${err?.message || 'Failed to read file'}`);
        return false;
    }
    if (isStale(token)) return false;
    return loadText(text);
}

export async function openPackZip(f, { destroyed, nextToken, isStale, notify, loadText }) {
    if (destroyed()) return false;
    const token = nextToken();
    if (f && typeof f.size === 'number' && f.size > ZIP_LIMITS.archive) {
        notify(`too-large: The zip is larger than ${Math.round(ZIP_LIMITS.archive / 1024 / 1024)} MB`);
        return false;
    }
    let opened;
    const held = new Map();
    const left = [];
    try {
        opened = await readPackZip(new Uint8Array(await f.arrayBuffer()));
        if (opened.ok) {
            for (const file of opened.files) {
                const bytes = await file.read();
                const type = sniffImage(bytes);
                if (!type) left.push(`${file.name} is not a picture`);
                else if (bytes.length > PORTRAIT_LIMITS.bytes) left.push(`${file.name} is over ${kb(PORTRAIT_LIMITS.bytes)} KB`);
                else held.set(file.name, Object.freeze({ bytes, type, ...(imageSize(bytes) ?? { width: 0, height: 0 }) }));
            }
        }
    } catch (err) {
        if (isStale(token)) return false;
        notify(`file-read-error: ${safeLabel(err?.message || 'Failed to read file')}`);
        return false;
    }
    if (isStale(token)) return false;
    if (!opened.ok) { notify(`zip-refused: ${safeLabel(opened.message)}`); return false; }
    const model = loadText(opened.text, held);
    if (model?.document && left.length) notify(`portrait: ${left.join('; ')}; left out.`);
    return model;
}
