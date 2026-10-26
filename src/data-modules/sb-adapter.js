// Studio's narrow adapter to Story Block's data-module support. Every Studio feature that needs Story Block's
// verdict (validation), descriptors, limits, narrator grammar or simulator goes through these functions, so there
// is no second schema or interpreter in Studio. While the vendored copy lacks a capability the adapter says so and
// the UI shows WAITING_MESSAGE; it never invents an answer.
import { backend as vendored } from './sb-backend.js';

export const WAITING_MESSAGE = 'This needs Story Block with data-modules-v1';
export const NO_SIMULATOR_MESSAGE = 'This Story Block copy checks data modules but has no simulator entry point yet';

// Shown beside the forms only while Story Block exports no limits (never used to decide validity).
const PROVISIONAL_LIMITS = Object.freeze({
    fields: 32, kinds: 16, rules: 32, timers: 8, templates: 16, imports: 8, expressionDepth: 6, expressionNodes: 64,
    effects: 16, definitionBytes: 32768, definitions: 8, slug: 40,
});

let backend = vendored;

/** Test seam: tests install a clearly named stand-in backend. Production code never calls this. */
export function useBackendForTests(next) { backend = next ?? vendored; }

/** Which Story Block capabilities this build has, for banners and gating. */
export function status() {
    const checker = backend.supported === true;
    return Object.freeze({
        source: backend.source,
        checker,
        simulator: checker && typeof backend.simulate === 'function',
        descriptors: checker && typeof backend.descriptors === 'function',
        grammar: checker && typeof backend.grammar === 'function',
        message: checker ? '' : WAITING_MESSAGE,
    });
}

/** Story Block's verdict for a whole pack (ordinary packs included), exactly as the importer returns it. */
export function validatePack(input) { return backend.validatePack(input); }

/** True when a refusal only reflects Story Block lacking data-module support, not a problem with the pack. */
export function isWaitingError(error) {
    return !status().checker && error?.code === 'UNKNOWN_KIND' && error?.path === 'content.dataModules';
}

/** Limits Story Block exports, else the provisional hints, tagged with their origin. */
export function limits() {
    const real = status().checker && typeof backend.limits === 'function' ? backend.limits() : null;
    return real ? { source: 'story-block', values: real } : { source: 'provisional (DATA_MODULES.md draft)', values: PROVISIONAL_LIMITS };
}

/** Story Block's descriptors when exported, else null: the forms then use their provisional control hints. */
export function descriptors() {
    return status().descriptors ? backend.descriptors() : null;
}

/** Story Block's one-line explanation per DM_* code, or null. */
export function diagnostics() {
    return status().checker && typeof backend.diagnostics === 'function' ? backend.diagnostics() : null;
}

/** Story Block's narrator grammar for a definition when exported, else null (Studio previews its own wording). */
export function grammar(pack, module) {
    return status().grammar ? backend.grammar(pack, module) : null;
}

/**
 * Runs a scenario on Story Block's runtime. Returns { ok: false, waiting: true, message } while unavailable.
 * The request shape is Studio's contract with the simulator entry point; see simulator.js.
 */
export function simulate(request) {
    const state = status();
    if (!state.checker) return { ok: false, waiting: true, message: WAITING_MESSAGE };
    if (!state.simulator) return { ok: false, waiting: true, message: NO_SIMULATOR_MESSAGE };
    return backend.simulate(request);
}
