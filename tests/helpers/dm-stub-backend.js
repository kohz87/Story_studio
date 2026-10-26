// TEST-ONLY STAND-IN for Story Block's data-module runtime, which has not shipped yet (stage6/data-modules has the
// checker only). Validation, descriptors and limits here are the REAL vendored Story Block ones; only `simulate` is
// a stand-in. It knows just enough of DATA_MODULES.md to run the document's two worked examples, so Studio's
// simulator panel and its replay what-ifs can be exercised end to end. It is never imported by src/ and is installed
// only by tests (useBackendForTests, or the test-only bundle in dm-stub-dist.js).
// Nothing here may be copied into src/: the shipped simulator is Story Block's runtime through sb-adapter.js.
import { backend as vendored } from '../../src/data-modules/sb-backend.js';

const validatePack = vendored.validatePack;
const isExpr = value => Array.isArray(value) && typeof value[0] === 'string';

// ---- simulation ------------------------------------------------------------------------------------------------

const clone = value => JSON.parse(JSON.stringify(value));
const TIME = /^!\s+time\s+\+(\d+)\s*(h|m)$/i;

function initial(module) {
    const fields = {};
    for (const [name, schema] of Object.entries(module.state)) {
        fields[name] = schema.type === 'map' ? Object.fromEntries(schema.keys.map(key => [key, schema.values.default])) : schema.default;
    }
    return fields;
}

class Refusal extends Error { constructor(code, message) { super(message); this.code = code; } }

const readAt = (fields, path) => path.reduce((node, key) => node?.[key], fields);
function writeAt(fields, path, value) { path.slice(0, -1).reduce((node, key) => node[key], fields)[path.at(-1)] = value; }

function evaluate(expr, scope) {
    if (!isExpr(expr)) return expr;
    const [name, ...a] = expr;
    const v = i => evaluate(a[i], scope);
    switch (name) {
        case 'get': {
            const path = a[0].map(segment => evaluate(segment, scope));
            const key = path.join('.');
            const value = readAt(scope.fields, path);
            if (scope.reads && !scope.written.has(key) && !Object.hasOwn(scope.reads, key)) scope.reads[key] = value;
            return value;
        }
        case 'arg': return scope.args[a[0]];
        case 'bind': return scope.bind[a[0]];
        case 'reward': return scope.reward[a[0]];
        case 'timer': return scope.periods;
        case 'eq': return v(0) === v(1);
        case 'ne': return v(0) !== v(1);
        case 'lt': return v(0) < v(1);
        case 'le': return v(0) <= v(1);
        case 'gt': return v(0) > v(1);
        case 'ge': return v(0) >= v(1);
        case 'and': return v(0) && v(1);
        case 'or': return v(0) || v(1);
        case 'not': return !v(0);
        case 'add': return v(0) + v(1);
        case 'sub': return v(0) - v(1);
        case 'mul': return v(0) * v(1);
        case 'min': return Math.min(v(0), v(1));
        case 'max': return Math.max(v(0), v(1));
        case 'floorDiv': return Math.floor(v(0) / v(1));
        case 'clamp': return Math.min(Math.max(v(0), v(1)), v(2));
        default: throw new Error(`cannot evaluate ${name}`);
    }
}

function runEffects(module, effects, scope, changes) {
    for (const effect of effects) {
        if (effect.op === 'reward') {
            const template = module.rewards[effect.template];
            const bind = Object.fromEntries(Object.entries(effect.bind ?? {}).map(([name, e]) => [name, evaluate(e, scope)]));
            for (const [name, schema] of Object.entries(template.bindings ?? {})) {
                if (schema.type === 'enum' && !schema.values.includes(bind[name])) throw new Refusal('DM_LABEL', `${name} must be ${schema.values.join(', ')}`);
            }
            const reward = {};
            for (const [name, range] of Object.entries(template.values)) {
                reward[name] = range.pick === 'min' ? range.min : range.pick === 'max' ? range.max : range.min + Math.floor((range.max - range.min) / 2);
            }
            changes.rewards.push({ template: effect.template, bind, values: reward });
            runEffects(module, template.effects, { ...scope, bind, reward }, changes);
            continue;
        }
        const path = effect.path.map(segment => evaluate(segment, scope));
        const key = path.join('.');
        const schema = module.state[path[0]].type === 'map' ? module.state[path[0]].values : module.state[path[0]];
        const before = readAt(scope.fields, path);
        if (scope.reads && !scope.written.has(key) && !Object.hasOwn(scope.reads, key)) scope.reads[key] = before;
        let after;
        let note;
        if (effect.op === 'set') after = evaluate(effect.value, scope);
        else if (effect.op === 'clamp') after = Math.min(Math.max(before, evaluate(effect.min, scope)), evaluate(effect.max, scope));
        else {
            const amount = evaluate(effect.value, scope);
            const requested = before + amount;
            if (requested < schema.min || requested > schema.max) {
                if (effect.bounds !== 'clamp') throw new Refusal('DM_BOUNDS', `${key} would be ${requested}, outside ${schema.min} to ${schema.max}`);
                after = Math.min(Math.max(requested, schema.min), schema.max);
                note = `Requested ${amount >= 0 ? '+' : ''}${amount}; applied ${after - before >= 0 ? '+' : ''}${after - before} (${after}/${schema.max})`;
            } else after = requested;
        }
        writeAt(scope.fields, path, after);
        scope.written.add(key);
        if (before !== after || note) changes.list.push({ path: key, before, after, ...(note ? { note } : {}) });
    }
}

function parseLine(raw) {
    const match = /^([+\-~!])\s+dm\s+(\S+)\s+\u2014\s*(.*)$/.exec(raw.trim());
    if (!match) return null;
    const parts = match[3].split('|').map(part => part.trim());
    return { op: match[1], ref: match[2], labels: parts.slice(1).map(part => { const at = part.indexOf(':'); return [part.slice(0, at).trim(), part.slice(at + 1).trim()]; }) };
}

function makeContext(request) {
    const { pack, scenario } = request;
    const modules = pack.content.dataModules;
    const module = modules.find(item => `pack.${pack.id}/${item.slug}` === request.module);
    const subjects = module.scope === 'character' ? scenario.actors : ['chat'];
    return { request, module, subjects, unique: modules.filter(item => item.slug === module.slug).length === 1 };
}

function newState({ module, subjects, request }) {
    const start = request.scenario.startMinute;
    return {
        minute: start,
        instances: Object.fromEntries(subjects.map(name => [name, initial(module)])),
        timers: Object.fromEntries(subjects.map(name => [name, Object.fromEntries((module.timers ?? []).map(timer => [timer.id, { lastMinute: start, remainder: 0 }]))])),
    };
}

// Settles due timers for one subject on `state` (mutates). Returns true when any whole period elapsed.
function sync(ctx, state, subject, changes) {
    let any = false;
    for (const timer of ctx.module.timers ?? []) {
        const cursor = state.timers[subject][timer.id];
        const elapsed = state.minute - cursor.lastMinute;
        if (elapsed <= 0) continue;
        if (elapsed > 525600) throw new Refusal('DM_BUDGET', 'too much time has passed to settle at once');
        const total = elapsed + cursor.remainder;
        const periods = Math.floor(total / timer.every);
        cursor.remainder = total % timer.every;
        cursor.lastMinute = state.minute;
        if (periods > 0) {
            any = true;
            runEffects(ctx.module, timer.effects, { fields: state.instances[subject], periods, args: {}, bind: {}, reward: {}, written: new Set() }, changes);
        }
    }
    return any;
}

// A rule's reads count toward the line's read set only when the rule fires (an unrelated false rule is not a prerequisite).
function runRules(module, scope, changes) {
    for (const rule of module.rules ?? []) {
        const probe = { ...scope, reads: scope.reads ? {} : undefined };
        if (evaluate(rule.when, probe) !== true) continue;
        for (const [key, value] of Object.entries(probe.reads ?? {})) if (!Object.hasOwn(scope.reads, key)) scope.reads[key] = value;
        runEffects(module, rule.then, scope, changes);
    }
}

function refused(raw, parsed, code, message, module) {
    return { raw, parsed, outcome: 'refused', changes: [], refusal: { code, path: '', message: `${module.name}: ${message}; nothing applied.` } };
}

function capture(ctx, state, raw, claims) {
    const { module } = ctx;
    const parsed = parseLine(raw);
    if (!parsed) return refused(raw, null, 'DM_SCHEMA', 'not a data module line', module);
    if (!(parsed.ref === module.slug ? ctx.unique : parsed.ref === ctx.request.module)) return refused(raw, null, 'DM_SCHEMA', `${parsed.ref} is not a pinned module`, module);
    const kindName = parsed.labels.find(([key]) => key === 'kind')?.[1];
    const shown = { kind: kindName };
    const trial = clone({ minute: state.minute, instances: state.instances, timers: state.timers });
    const changes = { list: [], rewards: [] };
    try {
        const kind = module.kinds[kindName];
        if (!kind) throw new Refusal('DM_SCHEMA', `kind must be ${Object.keys(module.kinds).join(', ')}`);
        if (kind.op !== parsed.op) throw new Refusal('DM_SCHEMA', `kind ${kindName} uses ${kind.op}`);
        const seen = new Set();
        const args = {};
        let subject = 'chat';
        for (const [key, value] of parsed.labels) {
            if (key === 'kind') continue;
            if (key === 'who') {
                if (module.scope !== 'character') throw new Refusal('DM_LABEL', 'this module is chat scope; who is not accepted');
                if (!ctx.subjects.includes(value)) throw new Refusal('DM_LABEL', `who must be an attached character (${ctx.subjects.join(', ')})`);
                subject = value; shown.who = value; continue;
            }
            if (seen.has(key)) throw new Refusal('DM_LABEL', `label ${key} was given twice`);
            seen.add(key);
            const schema = kind.labels?.[key];
            if (!schema) throw new Refusal('DM_LABEL', `${key} is not a label of ${kindName}`);
            if (schema.type === 'enum') {
                if (!schema.values.includes(value)) throw new Refusal('DM_LABEL', `${key[0].toUpperCase()}${key.slice(1)} must be ${schema.values.slice(0, -1).join(', ')} or ${schema.values.at(-1)}`);
                args[key] = value;
            } else {
                const number = /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
                if (!(number >= schema.min && number <= schema.max)) throw new Refusal('DM_BOUNDS', `${key} must be ${schema.min} to ${schema.max}`);
                args[key] = number;
            }
            shown[key] = value;
        }
        for (const key of Object.keys(kind.labels ?? {})) if (!seen.has(key)) throw new Refusal('DM_LABEL', `missing label ${key}`);
        if (module.scope === 'character' && !shown.who) throw new Refusal('DM_LABEL', 'who is required');
        const claim = [kindName, subject, ...(kind.oncePerReply ?? []).map(key => `${key}=${args[key]}`)].join('|');
        if (claims.has(claim)) throw new Refusal('CLAIMED', 'already applied in this reply');
        sync(ctx, trial, subject, changes);
        const scope = { fields: trial.instances[subject], args, bind: {}, reward: {}, reads: {}, written: new Set() };
        if (Object.hasOwn(kind, 'when') && evaluate(kind.when, scope) !== true) throw new Refusal('DM_CONDITION', kind.refusal ?? 'condition not met');
        const own = { list: [], rewards: changes.rewards };
        runEffects(module, kind.effects, scope, own);
        runRules(module, scope, own);
        state.instances = trial.instances; state.timers = trial.timers;
        claims.add(claim);
        const writes = Object.fromEntries([...scope.written].map(key => [key, readAt(trial.instances[subject], key.split('.'))]));
        return { raw, parsed: shown, outcome: 'applied', changes: [...changes.list, ...own.list], subject, claim, reads: scope.reads, writes, rewards: own.rewards };
    } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        return refused(raw, shown, err.code, err.message, module);
    }
}

function replay(ctx, state, old, claims) {
    if (old.system) { state.minute += old.minutes; return { ...old }; }
    if (old.outcome !== 'applied') return { ...old };
    const trial = clone({ minute: state.minute, instances: state.instances, timers: state.timers });
    try { sync(ctx, trial, old.subject, { list: [], rewards: [] }); } catch (err) { if (!(err instanceof Refusal)) throw err; }
    for (const [key, value] of Object.entries(old.reads)) {
        const now = readAt(trial.instances[old.subject], key.split('.'));
        if (now !== value) {
            return { raw: old.raw, parsed: old.parsed, outcome: 'inactive', changes: [], refusal: { code: 'REPLAY_PREREQUISITE', path: '', message: `${key} was ${value} when this was captured and is ${now} now; Re-read to apply.` } };
        }
    }
    if (claims.has(old.claim)) return refused(old.raw, old.parsed, 'CLAIMED', 'already applied in this reply', ctx.module);
    for (const [key, value] of Object.entries(old.writes)) writeAt(trial.instances[old.subject], key.split('.'), value);
    state.instances = trial.instances; state.timers = trial.timers;
    claims.add(old.claim);
    return { ...old };
}

function play(ctx, steps, { skip = new Set(), fresh = new Set(), recorded = null } = {}) {
    const state = newState(ctx);
    const out = [];
    let claims = new Set();
    const subjectsView = () => (ctx.module.scope === 'character' ? Object.fromEntries(ctx.subjects.map(name => [name, state.instances[name]])) : state.instances.chat);
    const timersView = () => (ctx.module.scope === 'character' ? clone(state.timers) : clone(state.timers.chat));
    const tick = () => {
        for (const subject of ctx.subjects) {
            const changes = { list: [], rewards: [] };
            try {
                if (sync(ctx, state, subject, changes)) {
                    const scope = { fields: state.instances[subject], args: {}, bind: {}, reward: {}, written: new Set() };
                    runRules(ctx.module, scope, changes);
                }
            } catch (err) { if (!(err instanceof Refusal)) throw err; }
        }
    };
    steps.forEach((step, index) => {
        if (skip.has(index)) return;
        if (step.type === 'advance') {
            state.minute += step.minutes;
            tick();
            out.push({ index, type: 'advance', status: 'advanced', lines: [], fields: clone(subjectsView()), timers: timersView(), replyCard: `Story time +${step.minutes} min`, problems: [] });
            return;
        }
        if (step.type === 'reply') claims = new Set();
        const prior = recorded?.find(item => item.index === index);
        const raws = (/<Changes>([\s\S]*?)<\/Changes>/i.exec(step.text)?.[1] ?? '').split('\n').map(line => line.trim()).filter(Boolean);
        const lines = raws.map((raw, j) => {
            const time = TIME.exec(raw);
            if (time) { const minutes = Number(time[1]) * (time[2].toLowerCase() === 'h' ? 60 : 1); state.minute += minutes; return { raw, parsed: { kind: 'time' }, outcome: 'applied', changes: [], system: true, minutes }; }
            const old = !fresh.has(index) && prior?.lines[j]?.raw === raw ? prior.lines[j] : null;
            return old ? replay(ctx, state, old, claims) : capture(ctx, state, raw, claims);
        });
        tick();
        const dm = lines.filter(line => !line.system);
        const status = dm.some(line => line.outcome === 'inactive') ? 'inactive' : dm.some(line => line.outcome === 'refused') ? 'refused' : 'applied';
        const card = lines.map(line => (line.outcome === 'applied' ? (line.system ? `Story time +${line.minutes} min` : line.changes.map(change => `${change.path} ${change.before} \u2192 ${change.after}${change.note ? ` (${change.note})` : ''}`).join('; ') || 'No change') : line.refusal?.message ?? '')).join('\n');
        out.push({ index, type: step.type, status, lines, fields: clone(subjectsView()), timers: timersView(), replyCard: card, problems: [] });
    });
    return { ok: true, steps: out, final: { fields: clone(subjectsView()), timers: timersView() }, usage: { visits: out.length } };
}

export function simulate(request) {
    const verdict = validatePack(request.pack);
    if (!verdict.ok) return { ok: false, errors: verdict.errors };
    if (!request.pack.content.dataModules.some(item => `pack.${request.pack.id}/${item.slug}` === request.module)) return { ok: false, errors: [{ code: 'DM_SCHEMA', path: '', message: `No data module ${request.module}` }] };
    const ctx = makeContext(request);
    const steps = request.scenario.steps;
    const base = play(ctx, steps);
    const action = request.action;
    if (!action) return base;
    if (action.type === 'delete') return play(ctx, steps, { skip: new Set([action.step]), recorded: base.steps });
    if (action.type === 'reread' || action.type === 'swipe') {
        const edited = steps.map((step, index) => (index === action.step ? { ...step, text: action.text ?? step.text } : step));
        return play(ctx, edited, { fresh: new Set([action.step]), recorded: base.steps });
    }
    return play(ctx, steps, { recorded: base.steps });
}

export const backend = Object.freeze({ ...vendored, source: 'test-stub', simulate });

/** An older Story Block that predates data modules: its importer refuses the content kind (test-only). */
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
