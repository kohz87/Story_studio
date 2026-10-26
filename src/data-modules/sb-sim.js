// The simulator and the generated narrator grammar, on Story Block's own runtime. sb-backend.js is the only importer.
//
// A simulation builds a whole Story Block host on a disposable in-memory chat (the real store, command bus, capture,
// replay and data-module part, wired as the vendored testkit's createHost wires them), installs the pack, pins the module the way Setup does
// and plays the scenario's replies through it. Nothing here evaluates a line or a condition: the fields, refusals,
// timer cursors, inactive blocks and cold-replay comparison are what Story Block's runtime reports. The only part
// Studio supplies is the sample Story Director's published state (sim-director.js), because data modules read time and
// actors from it.
//
// request  { pack, module, scenario: { actors, startMinute, seed, answers, steps }, action } (see simulator.js)
// answers  Reserved for sample answers of other public queries; the published adapters v1 modules can import
//          (director minutes and actors, another data module's export) are all served from the host's own state.
// seed     v1 modules draw no dice (checks are v1.1); the seed is kept in the scenario for those.
import { createFakeContext } from '../../vendor/story-block/testkit/fake-st.js';
import { createRuntime } from '../../vendor/story-block/src/v2/runtime.js';
import { createStore } from '../../vendor/story-block/src/v2/store.js';
import { createCommandBus } from '../../vendor/story-block/src/v2/commands.js';
import { validatePack } from '../../vendor/story-block/src/v2/packs/validate.js';
import { parseChanges, extractBlock } from '../../vendor/story-block/src/v2/capture.js';
import { refusedFrom } from '../../vendor/story-block/src/v2/reply-notes.js';
import { grammarFor } from '../../vendor/story-block/src/v2/data-modules/part.js';
import { dataModuleHash } from '../../vendor/story-block/src/v2/data-modules/check.js';
import { sampleActors, sampleDirector } from './sim-director.js';

const MAX_STEPS = 24;
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (code, message, path = '') => ({ ok: false, errors: [{ code, path, message }] });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

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

// ---- the disposable host ----------------------------------------------------------------------------------------

/**
 * Story Block's host on a fake SillyTavern: the same wiring as the vendored testkit's createHost (which is what Story
 * Block's own tests use). That function loads the store and the bus through computed dynamic imports, which a single
 * bundled page cannot resolve, so the real modules are imported here instead.
 */
async function createSimulationHost({ modules }) {
    const st = createFakeContext({ extensionSettings: {} });
    st.notices = [];
    const runtime = createRuntime({
        ctx: st.ctx, core: true, modules, createStore, createCommandBus, callModel: null, timelineFaults: null, onBlocked: null,
        notify: (reason, moduleId) => st.notices.push({ reason, moduleId }),
    });
    const { store, sdk, turn, markReady } = runtime;
    turn.install({ globalName: null });
    st.interceptor = turn.interceptor;
    await turn.onChatChanged();
    markReady();
    return {
        st, ctx: st.ctx, store, sdk, turn, packs: runtime.packs,
        send: (text, reply = '') => st.send(text, { reply }),
        swipe: (reply = '') => st.generate('swipe', { reply }),
        cont: (reply = '') => st.generate('continue', { reply }),
        head: () => store.head(),
        close: () => turn.uninstall({ globalName: null }),
    };
}

// ---- reading the host -------------------------------------------------------------------------------------------

const TEXT = n => `Step ${n}.`;

function subjectsOf(host, id, scope) {
    const instances = host.head().domains?.dataModules?.instances?.[id];
    if (!instances) return {};
    return scope === 'chat' ? { chat: instances.chat } : instances.characters ?? {};
}

/** Fields and timer cursors as { fields, timers }: a chat module's own, or one entry per attached character name. */
function snapshot(host, target, names) {
    const view = host.sdk.query('dataModules.view', { module: target.id });
    const subjects = subjectsOf(host, target.id, target.scope);
    if (target.scope === 'chat') return { fields: clone(view?.chat ?? {}), timers: clone(subjects.chat?.timers ?? {}) };
    const fields = {}, timers = {};
    for (const row of view?.characters ?? []) {
        const { id, name, ...rest } = row;
        fields[names.get(id) ?? name] = rest;
        timers[names.get(id) ?? name] = clone(subjects[id]?.timers ?? {});
    }
    return { fields, timers };
}

function leaves(value, prefix = []) {
    if (!isObject(value)) return [[prefix.join('.'), value]];
    return Object.entries(value).flatMap(([key, child]) => leaves(child, [...prefix, key]));
}

/** What changed between two field snapshots, as [{ path, before, after }]. */
function changesBetween(before, after) {
    const was = new Map(leaves(before)), now = leaves(after);
    return now.filter(([path, value]) => !same(was.get(path), value)).map(([path, value]) => ({ path, before: was.get(path), after: value }));
}

function messageIndex(host, step) {
    return host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').startsWith(TEXT(step)));
}

function linesOf(host, text, chatIndex) {
    const block = extractBlock(text) ?? '';
    const parsed = parseChanges(block).lines;
    const problems = host.turn.problems().filter(item => item.index === chatIndex);
    return parsed.map(line => {
        const found = problems.find(item => item.line === line.raw);
        const limited = found?.code === 'LIMITED';
        const refusal = found && !limited ? (() => {
            const [reason] = refusedFrom([found], chatIndex).map(row => row.reason);
            return { code: found.code, path: '', message: reason || found.message };
        })() : null;
        return {
            raw: line.raw,
            parsed: { op: line.op, kind: line.kind === 'dm' ? `dm ${line.name}` : line.kind, ...(line.kind === 'dm' ? line.labels : { argument: line.name }) },
            outcome: refusal ? 'refused' : 'applied',
            ...(refusal ? { refusal } : {}), ...(limited ? { note: found.message } : {}),
            changes: [],
        };
    });
}

function cardOf(lines, changes) {
    const rows = lines.map(line => (line.refusal ? line.refusal.message : line.note ? line.note : null)).filter(Boolean);
    const moved = changes.map(change => `${change.path} ${change.before} → ${change.after}`);
    return [...moved, ...rows].join('\n');
}

function usageOf(host) {
    const reply = Object.values(host.head().domains?.dataModules?.perReply ?? {})[0];
    return reply ? { roots: reply.roots, visits: reply.visits } : { roots: 0, visits: 0 };
}

// ---- building the world -----------------------------------------------------------------------------------------

function needed(definitions, target) {
    const order = [];
    const visit = definition => {
        if (!definition || order.includes(definition)) return;
        for (const entry of Object.values(definition.imports ?? {})) {
            if (entry?.query === 'dataModules.public') visit(definitions.find(item => item.id === entry.args?.module));
        }
        order.push(definition);
    };
    visit(target);
    return order;
}

async function build(request, actors) {
    const { pack, module, scenario } = request;
    const verdict = validatePack(pack);
    if (!verdict.ok) return { error: { ok: false, errors: verdict.errors } };
    const definitions = verdict.pack.content.dataModules;
    const target = definitions.find(item => item.id === module);
    if (!target) return { error: fail('DM_SCHEMA', `The pack has no data module ${module}.`) };
    const minute = scenario.startMinute === null || scenario.startMinute === '' ? null : scenario.startMinute;
    if (minute !== null && !Number.isSafeInteger(minute)) return { error: fail('DM_BOUNDS', 'The starting story minute must be a whole number.', 'startMinute') };
    const host = await createSimulationHost({ modules: [sampleDirector({ minute, actors })] });
    const installed = await host.packs.packs.install(pack);
    if (!installed.ok) { host.close(); return { error: fail(installed.code ?? 'REFUSED', installed.message ?? 'The pack could not be installed on the sample chat.') }; }
    for (const definition of needed(definitions, target)) {
        const offer = host.sdk.query('dataModules.offers').find(row => row.module === definition.id);
        const subjects = definition.scope === 'character' ? actors.map(actor => actor.id) : [];
        const pinned = await host.sdk.command('dm.pin', { module: definition.id, hash: offer?.hash, packHash: offer?.packHash, subjects });
        if (!pinned.ok) { host.close(); return { error: fail(pinned.code ?? 'REFUSED', pinned.message ?? `Could not pin ${definition.id}.`) }; }
    }
    return { host, target };
}

// ---- playing a scenario -----------------------------------------------------------------------------------------

function stepText(step) {
    if (step.type === 'advance') return `<Changes>\n! time +${step.minutes}m\n</Changes>`;
    return String(step.text ?? '');
}

/** The text of the message step `i` lives in: its reply and every Continue after it, in order. */
function messageTexts(steps, texts) {
    const groups = [];
    steps.forEach((step, i) => {
        if (step.type === 'continue' && groups.length) groups.at(-1).steps.push(i);
        else groups.push({ steps: [i] });
    });
    return groups.map((group, n) => ({ ...group, number: n + 1, text: group.steps.map(i => texts[i]).join('\n') }));
}

async function play(host, target, steps, names) {
    const records = [];
    let reply = 0;
    for (const [index, step] of steps.entries()) {
        const before = snapshot(host, target, names);
        const text = stepText(step);
        if (step.type === 'continue' && reply) await host.cont(`\n${text}`);
        else { reply += 1; await host.send(`Go on (${reply}).`, `${TEXT(reply)}\n${text}`); }
        const chatIndex = host.ctx.chat.length - 1;
        const lines = linesOf(host, text, chatIndex);
        const now = snapshot(host, target, names);
        const changes = changesBetween(before.fields, now.fields);
        const refused = lines.some(line => line.outcome === 'refused');
        records.push({
            index, type: step.type, reply, status: step.type === 'advance' ? 'advanced' : refused ? 'refused' : 'applied',
            lines, changes, fields: now.fields, timers: now.timers, replyCard: cardOf(lines, changes), problems: [],
        });
    }
    return records;
}

/** The step list after a reload or action, with each step's status read from what Story Block kept or skipped. */
function restate(host, base, deleted = new Set()) {
    const skipped = new Map();
    for (const item of host.store.problems()) skipped.set(item.index, item);
    return base.filter(record => !deleted.has(record.index)).map(record => {
        const at = messageIndex(host, record.reply);
        const problem = at >= 0 ? skipped.get(at) : null;
        const inactive = Boolean(problem);
        return {
            index: record.index, type: record.type, status: inactive ? 'inactive' : record.status,
            lines: record.lines, changes: [], replyCard: inactive ? problem.message : record.replyCard,
            problems: inactive ? [{ code: problem.code, path: '', message: problem.why ?? problem.message }] : [],
        };
    });
}

async function apply(host, target, names, steps, action, texts) {
    const groups = messageTexts(steps, texts);
    const group = groups.find(item => item.steps.includes(action.step));
    if (!group && action.type !== 'reload') return fail('SIMULATOR', 'Choose a step of the scenario.');
    const replyText = list => `${TEXT(group.number)}\n${list}`;
    if (action.type === 'reload') {
        await host.store.flush();
        await host.st.loadChat(host.ctx.chat);
        return null;
    }
    const at = messageIndex(host, group.number);
    if (at < 0) return fail('SIMULATOR', 'That reply is not in the sample chat.');
    if (action.type === 'delete') {
        if (steps[action.step].type === 'continue') {
            const left = group.steps.filter(i => i !== action.step).map(i => texts[i]).join('\n');
            await host.st.editMessage(at, replyText(left));
            await host.sdk.reread(at);
        } else await host.st.deleteMessage(at);
        return null;
    }
    const edited = { ...texts, [action.step]: String(action.text ?? texts[action.step]) };
    const combined = replyText(group.steps.map(i => edited[i]).join('\n'));
    if (action.type === 'reread') {
        await host.st.editMessage(at, combined);
        await host.sdk.reread(at);
        return null;
    }
    if (action.type === 'swipe') {
        if (at !== host.ctx.chat.length - 1) return fail('SIMULATOR', 'A swipe replaces the latest reply: choose the last reply of the scenario.');
        await host.swipe(combined);
        return null;
    }
    return fail('SIMULATOR', `Unknown action ${action.type}.`);
}

// The runtime reports skipped lines and clamps with console warnings meant for the reader's console; a disposable chat
// should not fill the author's. Only Story Block's own prefixed lines are dropped, and only while a simulation runs.
function quiet() {
    const original = { warn: console.warn, info: console.info };
    const wrap = write => (...args) => { if (!/^\[Story (Suite|Block)\]/.test(String(args[0]))) write.apply(console, args); };
    console.warn = wrap(original.warn);
    console.info = wrap(original.info);
    return () => { console.warn = original.warn; console.info = original.info; };
}

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
        const base = await play(host, target, steps, names);
        const texts = steps.map(stepText);
        let records = base;
        if (request.action) {
            const refused = await apply(host, target, names, steps, request.action, texts);
            if (refused) return refused;
            const group = messageTexts(steps, texts).find(item => item.steps.includes(request.action.step));
            const gone = request.action.type === 'delete' && steps[request.action.step]?.type !== 'continue' && group ? new Set(group.steps) : new Set();
            records = restate(host, base, gone);
        }
        const final = snapshot(host, target, names);
        const problems = host.store.problems().map(item => ({ code: item.code, path: '', message: item.message }));
        const usage = usageOf(host);
        // The comparison the design asks for: what Story Block holds now against a cold rebuild from the saved chat.
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        return { ok: true, steps: records, final, usage, problems, replay: { equal: JSON.stringify(host.head()) === live } };
    } catch (error) {
        return fail('SIMULATOR_ERROR', String(error?.message ?? error));
    } finally {
        restore();
        try { host?.close(); } catch { /* the disposable chat is dropped either way */ }
    }
}
