// Edit results: a snapshot the pack checker accepts, or a refusal that leaves the model as it was.
import { openPack } from '../model.js';
import { withLastingCapability } from '../timeline/lasting.js';

export function commitSnapshot(newDoc, originalModel) {
    // The capability a lasting change needs follows the events, so no edit can leave the pack without it.
    const snapshot = openPack(withLastingCapability(newDoc));
    if (!snapshot || snapshot.document === null) {
        return {
            ok: false,
            model: originalModel,
            errors: (snapshot?.validation?.errors?.length) ? snapshot.validation.errors : [{
                code: 'unsafe-edit',
                path: '',
                message: 'Edit produced unsafe or out-of-limits document',
            }],
        };
    }
    return {
        ok: true,
        model: snapshot,
        undo: () => originalModel,
    };
}

export function refuse(model, code, path, message, extra = {}) { return { ok: false, model, errors: [{ code, path, message }], ...extra }; }
