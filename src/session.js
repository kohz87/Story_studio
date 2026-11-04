import { LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';
import { openPack, sourceTextOf, draftsOf, withDrafts } from './model.js';
import { sanitizeDrafts } from './timeline/drafts.js';
import { sanitizeCard, cardTouched } from './card.js';

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
        // The Character card page's draft belongs to the pack it was written for.
        const card = isCardOf(parsed.card, model) ? sanitizeCard(parsed.card.draft) : null;
        return { model, dirty: Boolean(parsed.dirty), card, cardImage: card ? Boolean(parsed.card.image) : false };
    } catch {
        return null;
    }
}

const isCardOf = (saved, model) => Boolean(saved) && typeof saved === 'object' && typeof saved.packId === 'string' && saved.packId === model.document.id && Boolean(saved.draft);

/**
 * Keeps the project in the browser. `card` is the Character card page's draft (and `cardImage` whether a card picture is kept beside it):
 * it is saved with the pack, so a reload brings it back.
 */
export function writeDraft(win, model, dirty, card = null, cardImage = false) {
    if (!model?.document) return false;
    try {
        if (!win?.localStorage) return false;
        const payload = JSON.stringify({
            version: 1,
            document: model.document,
            sourceText: sourceTextOf(model),
            dirty: Boolean(dirty),
            ...draftsOf(model).length ? { drafts: draftsOf(model) } : {},
            ...cardTouched(card) || cardImage ? { card: { packId: model.document.id, draft: card, image: Boolean(cardImage) } } : {},
        });
        if (payload.length > MAX_DRAFT_BYTES) return false;
        win.localStorage.setItem(DRAFT_KEY, payload);
        return true;
    } catch {
        return false;
    }
}
