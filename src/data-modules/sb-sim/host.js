// The disposable host: Story Block's runtime on a fake SillyTavern, wired as the vendored testkit wires it, plus the quiet
// that keeps the runtime's console lines out of the author's console while a simulation runs.
import { createFakeContext } from '../../../vendor/story-block/testkit/fake-st.js';
import { createRuntime } from '../../../vendor/story-block/src/v2/runtime.js';
import { createStore } from '../../../vendor/story-block/src/v2/store.js';
import { createCommandBus } from '../../../vendor/story-block/src/v2/commands.js';
import { parseChanges, extractBlock } from '../../../vendor/story-block/src/v2/capture.js';
import { refusedFrom } from '../../../vendor/story-block/src/v2/reply-notes.js';
import { sourceKey } from './util.js';

// ---- the disposable host ----------------------------------------------------------------------------------------

/**
 * Story Block's host on a fake SillyTavern: the same wiring as the vendored testkit's createHost (which is what Story
 * Block's own tests use). That function loads the store and the bus through computed dynamic imports, which a single
 * bundled page cannot resolve, so the real modules are imported here instead.
 */
export async function createSimulationHost({ modules, storeOptions = null }) {
    const st = createFakeContext({ extensionSettings: {} });
    st.notices = [];
    // Observe capture results by their parsed occurrence, including refusals (which have no receipt).
    // A Re-read may plan several passes; the last result for each occurrence is the settled one.
    let captured = new Map();
    let captureProblems = [];
    const outcomes = new Map();
    const runtime = createRuntime({
        ctx: st.ctx, core: true, modules,
        createStore: storeOptions ? options => createStore({ ...options, ...storeOptions }) : createStore,
        createCommandBus: options => {
            const bus = createCommandBus(options);
            const run = bus.run;
            bus.run = (type, payload, opts) => {
                const result = run(type, payload, opts);
                if (opts?.capture && Number.isInteger(payload?.index)) captured.set(payload.index, result);
                return result;
            };
            return bus;
        },
        callModel: null, timelineFaults: null, onBlocked: null,
        notify: (reason, moduleId) => st.notices.push({ reason, moduleId }),
    });
    const { store, sdk, turn, markReady, registry, settings } = runtime;
    runtime.events.on('turn', done => { captureProblems = done.problems ?? []; });
    turn.install({ globalName: null });
    st.interceptor = turn.interceptor;
    await turn.onChatChanged();
    markReady();
    return {
        st, ctx: st.ctx, store, sdk, turn, registry, settings, packs: runtime.packs, outcomes,
        beginCapture() { captured = new Map(); captureProblems = []; },
        endCapture(index, text, append = false) {
            const source = store.sourceAt(index);
            const key = sourceKey(source);
            const previous = append ? outcomes.get(key) : null;
            const unknown = captureProblems.filter(item => item.code === 'UNKNOWN_KIND');
            const lines = parseChanges(extractBlock(text) ?? '').lines.map(line => {
                const result = captured.get(line.index);
                const problem = result ? null : unknown.shift();
                return {
                    source: result?.block?.source ?? source, receipt: result?.receipt?.id ?? null,
                    refusal: result && !result.ok ? { code: result.code, path: '', message: result.message } :
                        problem ? { code: problem.code, path: '', message: refusedFrom([problem], index)[0]?.reason || problem.message } : null,
                    note: result?.problem,
                };
            });
            outcomes.set(key, {
                lines: [...(previous?.lines ?? []), ...lines],
                problems: [...(previous?.problems ?? []), ...captureProblems.filter(item => !item.line || ['CUT_OFF', 'STRAY'].includes(item.code))],
            });
        },
        send: (text, reply = '') => st.send(text, { reply }),
        swipe: (reply = '') => st.generate('swipe', { reply }),
        cont: (reply = '') => st.generate('continue', { reply }),
        head: () => store.head(),
        close: () => turn.uninstall({ globalName: null }),
    };
}

// The runtime reports skipped lines and clamps with console warnings meant for the reader's console; a disposable chat
// should not fill the author's. Only Story Block's own prefixed lines are dropped, and only while a simulation runs.
export function quiet() {
    const original = { warn: console.warn, info: console.info };
    const wrap = write => (...args) => { if (!/^\[Story (Suite|Block)\]/.test(String(args[0]))) write.apply(console, args); };
    console.warn = wrap(original.warn);
    console.info = wrap(original.info);
    return () => { console.warn = original.warn; console.info = original.info; };
}
