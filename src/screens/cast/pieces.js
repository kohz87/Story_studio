// Shared Cast form pieces: fieldsets, hints and Story Block problem notes.
//
// The small drawing helpers the people, behaviour, portrait and story fields share.

import { el } from '../../dom.js';
import { problemsAt, problemsExactly } from '../../cast/data.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const line = value => String(value ?? '').replace(/\s+/g, ' ').trim();
// --- small pieces ----------------------------------------------------------------------------------------------------

let sequence = 0;
const hintId = () => `cast-hint-${++sequence}`;

/** The problems Story Block reports under `path`, as a message under the control. */
function problemNote(doc, model, path, exact = false) {
    const messages = (exact ? problemsExactly : problemsAt)(model, path);
    if (!messages.length) return null;
    return el(doc, 'p', messages.join('\n'), { class: 'cf-error', role: 'status' });
}

function group(doc, title, ...children) {
    const set = el(doc, 'fieldset', '', { class: 'form-fieldset cf' });
    set.append(el(doc, 'legend', title), ...children);
    return set;
}
const hint = (doc, text, attrs = {}) => el(doc, 'p', text, { class: 'cf-hint', ...attrs });

export { isRecord, line, group, hint, hintId, problemNote };
