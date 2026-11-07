// The player-facing preview under the Cast secrets form.
//
// Moved from the secrets section of the Cast screen; it shows each secret open or still hidden.

import { el, safeLabel } from '../../dom.js';
import { playerView } from '../../cast/data.js';
import { hint } from './pieces.js';

function showPlayerPreview(doc, model, person, preview) {
    preview.replaceChildren();
    preview.append(el(doc, 'b', `What the player sees after meeting ${safeLabel(person.name || 'them')}`));
    const view = playerView(model, person);
    if (!view.length) preview.append(hint(doc, 'Nothing yet: add a secret.'));
    view.forEach(item => {
        if (item.open) {
            const open = el(doc, 'div', '', { class: 'cf-open' });
            open.append(el(doc, 'b', safeLabel(item.title)), ' ', el(doc, 'span', item.rule, { class: 'cf-tag' }), el(doc, 'p', safeLabel(item.text), { class: 'cf-hint' }));
            preview.append(open);
        } else {
            preview.append(el(doc, 'span', '', { class: 'cf-bar', 'aria-hidden': 'true' }), hint(doc, item.rule));
        }
    });
}

export { showPlayerPreview };
