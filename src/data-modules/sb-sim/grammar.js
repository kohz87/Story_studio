// The narrator grammar: the static text Story Block puts in the prompt for a data module once it is pinned.
import { validatePack } from '../../../vendor/story-block/src/v2/packs/validate.js';
import { dataModuleHash } from '../../../vendor/story-block/src/v2/data-modules/check.js';
import { grammarFor } from '../../../vendor/story-block/src/v2/data-modules/part.js';

// ---- the narrator grammar ---------------------------------------------------------------------------------------

/** The static grammar text Story Block puts in the prompt for this module once pinned, or null when it is not accepted. */
export function grammar(pack, module) {
    const verdict = validatePack(pack);
    const id = `pack.${pack?.id}/${module?.slug}`;
    const definition = verdict.ok ? (verdict.pack?.content?.dataModules ?? []).find(item => item?.id === id) : null;
    if (!definition) return null;
    const hash = dataModuleHash(definition);
    const state = { domains: { dataModules: { active: { [id]: { hash, generation: 1, subjects: [] } }, pins: { [hash]: { definition, interpreter: 1 } } } } };
    return grammarFor(state);
}
