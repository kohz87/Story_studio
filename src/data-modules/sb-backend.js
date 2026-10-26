// The one place Studio's production build reaches Story Block for data modules. sb-adapter.js is the only importer.
//
// Wired to the vendored Story Block (vendor/story-block, see VERSION for the commit):
//   validatePack  the whole-pack importer; its checker for `content.dataModules` is Story Block's
//   descriptors   DM_DESCRIPTORS, the closed authoring contract the forms are built from
//   limits        DM_LIMITS, the version 1 budgets
//   migration     validateDataMigration, which compares two checked definitions for additive compatibility
//   grammar       the narrator grammar Story Block's data-module part generates for a pinned definition
//   simulate      the runtime itself: a disposable Story Block host (sb-sim.js), not a Studio interpreter
// Support is detected by asking the checker, so an older vendored copy (UNKNOWN_KIND for the content kind) keeps
// the "needs Story Block with data-modules-v1" state without a code change.
import { validatePack } from '../../vendor/story-block/src/v2/packs/validate.js';
import { simulate, grammar } from './sb-sim.js';
import { DM_DESCRIPTORS, DM_LIMITS, DM_DIAGNOSTICS, validateDataMigration } from '../../vendor/story-block/src/v2/data-modules/check.js';

const PROBE = Object.freeze({
    id: 'probe', version: '1.0.0', name: 'Probe',
    requires: { storyBlock: '^2', capabilities: ['data-modules-v1'] },
    content: { dataModules: [] },
});

function checkerSupportsDataModules() {
    try {
        const verdict = validatePack(PROBE);
        return !(verdict.errors ?? []).some(error => error.code === 'UNKNOWN_KIND' && error.path === 'content.dataModules');
    } catch {
        return false;
    }
}

export const backend = Object.freeze({
    source: 'vendored',
    supported: checkerSupportsDataModules(),
    validatePack,
    descriptors: () => DM_DESCRIPTORS,
    limits: () => DM_LIMITS,
    diagnostics: () => DM_DIAGNOSTICS,
    validateDataMigration,
    grammar,
    simulate,
});
