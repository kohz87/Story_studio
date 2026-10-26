// TEST-ONLY adapter backends for the waiting states. The shipped page has Story Block's checker and runtime, so the
// states "no data-module support at all" and "checker but no runtime" can only be reached with one of these installed
// through useBackendForTests (or the test-only page built by dm-waiting-dist.js). Neither is imported by src/.
import { backend as vendored } from '../../src/data-modules/sb-backend.js';

/** The vendored checker with no grammar generator and no simulator: a Story Block copy from before the runtime. */
export const noRuntimeBackend = Object.freeze({ ...vendored, source: 'test-no-runtime', grammar: null, simulate: null });

/** An older Story Block that predates data modules: its importer refuses the content kind. */
export const oldBackend = Object.freeze({
    source: 'test-old', supported: false, descriptors: null, limits: null, diagnostics: null, grammar: null, simulate: null,
    validatePack: (input, options) => {
        const pack = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return null; } })() : input;
        if (!pack?.content || !Object.hasOwn(pack.content, 'dataModules')) return vendored.validatePack(input, options);
        const { dataModules, ...content } = pack.content;
        void dataModules;
        const rest = vendored.validatePack({ ...pack, content }, options);
        return { ok: false, errors: [...(rest.errors ?? []), { code: 'UNKNOWN_KIND', path: 'content.dataModules', message: '"dataModules" is not a content kind.' }] };
    },
});
