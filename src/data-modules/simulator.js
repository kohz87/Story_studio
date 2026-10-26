// The simulator's request and result contract with Story Block, plus pure helpers for the panel. Studio never
// evaluates a line itself: it sends a scenario through sb-adapter.js and renders what Story Block's runtime returns.
//
// request  { pack, module, scenario: { actors, startMinute, seed, steps }, action }
//          (sb-sim.js runs it on Story Block's runtime; `seed` is reserved for v1.1 checks: v1 modules roll nothing)
//   pack     the candidate pack document (the saved pack with the open draft substituted)
//   module   the full module ID
//   steps    [{ type: 'reply', text } | { type: 'continue', text } | { type: 'advance', minutes }]
//   action   null, or { type: 'delete' | 'reread' | 'swipe' | 'reload', step, text? } applied after the steps
//   actors   sample character names (or ca_ IDs) attached to a character-scope module; startMinute the sample clock
// result   { ok: true, steps: [{ index, type, status, lines: [{ raw, parsed, outcome, refusal?, note? }], changes,
//            fields, timers, replyCard, problems }], final: { fields, timers }, usage, problems, replay: { equal } }
//          or { ok: false, errors: [{ code, path, message }] }
//   status   applied | refused | advanced | inactive (a stored block Story Block now skips, with its code)
import { simulate } from './sb-adapter.js';
import { moduleId, entries, isObject, list, clone } from './dm-model.js';

export const MAX_STEPS = 24;
export const MAX_STEP_TEXT = 4000;

export function defaultScenario(module) {
    return { actors: module?.scope === 'character' ? ['Wessel'] : [], startMinute: 1000, seed: 1, steps: [] };
}

export function replyText(lines) {
    return `<Changes>\n${lines.join('\n')}\n</Changes>`;
}

export function buildRequest(document, draft, index, scenario, action = null) {
    const modules = list(document?.content?.dataModules).slice();
    modules[index] = draft;
    const pack = { ...document, content: { ...(document?.content ?? {}), dataModules: modules } };
    return { pack: clone(pack), module: moduleId(document, draft), scenario: clone(scenario), action: action ? clone(action) : null };
}

/** Runs the request on Story Block's runtime via the adapter; never rejects. */
export async function run(request) {
    try {
        const result = await simulate(request);
        if (result?.waiting) return result;
        if (!isObject(result) || (result.ok !== true && !Array.isArray(result.errors))) return { ok: false, errors: [{ code: 'BAD_RESULT', path: '', message: 'The simulator returned a result Studio cannot read.' }] };
        return result;
    } catch (err) {
        return { ok: false, errors: [{ code: 'SIMULATOR_ERROR', path: '', message: String(err?.message ?? err) }] };
    }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Field-by-field difference between two field snapshots: [{ path, before, after }]. */
export function diffFields(before, after, prefix = []) {
    const out = [];
    const keys = [...new Set([...Object.keys(isObject(before) ? before : {}), ...Object.keys(isObject(after) ? after : {})])];
    for (const key of keys) {
        const a = before?.[key];
        const b = after?.[key];
        if (isObject(a) && isObject(b)) out.push(...diffFields(a, b, [...prefix, key]));
        else if (!same(a, b)) out.push({ path: [...prefix, key].join('.'), before: a, after: b });
    }
    return out;
}

/** Compares a base run with a what-if run: changed final fields, and steps whose status changed. */
export function compareRuns(base, variant) {
    const fields = diffFields(base?.final?.fields, variant?.final?.fields);
    const baseSteps = list(base?.steps);
    // Steps are matched by their scenario index: a deleted step is absent from the variant, so positions drift.
    const statuses = list(variant?.steps).map((step, i) => {
        const index = step?.index ?? i;
        return { index, before: baseSteps.find(item => item?.index === index)?.status, after: step?.status };
    }).filter(item => item.before !== item.after);
    return { fields, statuses };
}

export { entries };
