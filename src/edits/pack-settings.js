// The pack's stat formula, set as one edit. The rest of content.rpg (skill sets, numbers) stays as it is.
import { RPG_FORMULAS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { refuse, commitSnapshot } from './commit.js';
import { cloneDoc } from './values.js';

/**
 * Sets the pack's stat formula (`content.rpg.formula`, 'standard' or 'classic') as one edit; null asks for the reader's choice and
 * removes the field. The rest of `content.rpg` (skill sets, numbers) stays as it is; an `rpg` left with nothing in it is dropped.
 */
export function setRpgFormula(model, formula) {
    if (!model?.document || typeof model.document !== 'object') return refuse(model, 'bad-model', '', 'Open a pack first.');
    if (formula !== null && !RPG_FORMULAS.includes(formula)) return refuse(model, 'bad-value', 'content.rpg.formula', `The formula must be one of ${RPG_FORMULAS.join(', ')}.`);
    const doc = cloneDoc(model.document);
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (doc.content !== undefined && !plain(doc.content)) return refuse(model, 'bad-container', 'content', 'The pack content is not an object.');
    if (doc.content?.rpg !== undefined && !plain(doc.content.rpg)) return refuse(model, 'bad-container', 'content.rpg', 'content.rpg is not an object; fix it as JSON first.');
    if (formula === null && doc.content?.rpg === undefined) return commitSnapshot(doc, model);
    doc.content = doc.content ?? {};
    const rpg = doc.content.rpg ?? {};
    if (formula === null) delete rpg.formula; else rpg.formula = formula;
    if (Object.keys(rpg).length) doc.content.rpg = rpg; else delete doc.content.rpg;
    return commitSnapshot(doc, model);
}
