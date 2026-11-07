// The simulator and the generated narrator grammar, on Story Block's own runtime. sb-backend.js is the only importer.
//
// A simulation builds a whole Story Block host on a disposable in-memory chat (the real store, command bus, capture,
// replay and data-module part, wired as the vendored testkit's createHost wires them), installs the pack, pins the module the way Setup does
// and plays the scenario's replies through it. Nothing here evaluates a line or a condition: the fields, refusals,
// timer cursors, inactive blocks and cold-replay comparison (including no-op write and import prefix witnesses) are
// what Story Block's runtime reports. The only part
// Studio supplies is the sample Story Director's published state (sim-director.js), because data modules read time and
// actors from it.
//
// request  { pack, module, scenario: { actors, startMinute, seed, answers, steps }, action } (see simulator.js)
// answers  Reserved for sample answers of other public queries; the published adapters v1 modules can import
//          (director minutes and actors, another data module's export) are all served from the host's own state.
// seed     v1 modules draw no dice (checks are v1.1); the seed is kept in the scenario for those.
import { sampleActors } from './sim-director.js';
import { fail } from './sb-sim/util.js';
import { quiet } from './sb-sim/host.js';
import { build } from './sb-sim/build.js';
import { stepText, play, apply } from './sb-sim/play.js';
import { snapshot, usageOf } from './sb-sim/read.js';
import { trace } from './sb-sim/trace.js';
import { replayEqual } from './sb-sim/replay.js';

export { grammar } from './sb-sim/grammar.js';

const MAX_STEPS = 24;

/** Runs the request on Story Block's runtime. Never throws; resolves { ok, ... } as simulator.js describes. */
export async function simulate(request) {
    let host = null;
    const restore = quiet();
    try {
        const { scenario } = request;
        const steps = Array.isArray(scenario?.steps) ? scenario.steps : [];
        if (steps.length > MAX_STEPS) return fail('DM_BUDGET', `A scenario holds at most ${MAX_STEPS} steps.`);
        for (const [index, step] of steps.entries()) {
            if (step?.type === 'advance' && !(Number.isSafeInteger(step.minutes) && step.minutes >= 1 && step.minutes <= 525600)) return fail('DM_BOUNDS', `Step ${index + 1}: advance by 1 to 525600 minutes.`, `steps[${index}]`);
            if (!['reply', 'continue', 'advance'].includes(step?.type)) return fail('SIMULATOR', `Step ${index + 1} is not a reply, Continue or time advance.`);
        }
        const actors = sampleActors(scenario?.actors);
        const names = new Map(actors.map(actor => [actor.id, actor.name]));
        const built = await build(request, actors);
        if (built.error) return built.error;
        ({ host } = built);
        const { target } = built;
        await play(host, steps);
        const texts = steps.map(stepText);
        const deleted = new Set();
        if (request.action) {
            const refused = await apply(host, steps, request.action, texts, deleted);
            if (refused) return refused;
        }
        const records = trace(host, target, steps, texts, names, deleted);
        const final = snapshot(host, target, names);
        const problems = host.store.problems().map(item => ({ code: item.code, path: '', message: item.message }));
        const usage = usageOf(host);
        return { ok: true, steps: records, final, usage, problems, replay: { equal: replayEqual(host) } };
    } catch (error) {
        return fail('SIMULATOR_ERROR', String(error?.message ?? error));
    } finally {
        restore();
        try { host?.close(); } catch { /* the disposable chat is dropped either way */ }
    }
}
