import { LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { openPack, sourceTextOf, draftsOf, withDrafts } from './model.js';
import { sanitizeDrafts } from './timeline/drafts.js';

export const DRAFT_KEY = 'story-studio-draft';
export const MAX_PACK_BYTES = LIMITS.packBytes;
const MAX_DRAFT_BYTES = MAX_PACK_BYTES * 6;

export function readDraft(win) {
    try {
        if (!win?.localStorage) return null;
        const raw = win.localStorage.getItem(DRAFT_KEY);
        if (!raw || typeof raw !== 'string' || raw.length > MAX_DRAFT_BYTES) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;
        if (!parsed.document || typeof parsed.document !== 'object') return null;
        let model = openPack(parsed.document);
        if (typeof parsed.sourceText === 'string') {
            const original = openPack(parsed.sourceText);
            if (original.validation.ok && JSON.stringify(original.document) === JSON.stringify(model.document)) model = original;
        }
        if (!model?.document) return null;
        const drafts = sanitizeDrafts(parsed.drafts);
        if (drafts.length) model = withDrafts(model, drafts);
        return { model, dirty: Boolean(parsed.dirty) };
    } catch {
        return null;
    }
}

export function writeDraft(win, model, dirty) {
    if (!model?.document) return false;
    try {
        if (!win?.localStorage) return false;
        const payload = JSON.stringify({
            version: 1,
            document: model.document,
            sourceText: sourceTextOf(model),
            dirty: Boolean(dirty),
            ...draftsOf(model).length ? { drafts: draftsOf(model) } : {},
        });
        if (payload.length > MAX_DRAFT_BYTES) return false;
        win.localStorage.setItem(DRAFT_KEY, payload);
        return true;
    } catch {
        return false;
    }
}
