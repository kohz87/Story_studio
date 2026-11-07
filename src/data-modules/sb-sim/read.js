// Reading the sample host: the fields and timer cursors of a data module, what changed between two snapshots, the card text a
// reply gets, and the usage of its last reply. Pure over the host it is given.
import { frozenCopy } from '../../../vendor/story-block/src/v2/ops.js';
import { clone, same, isObject, TEXT } from './util.js';


function subjectsOf(host, id, scope) {
    const instances = host.head().domains?.dataModules?.instances?.[id];
    if (!instances) return {};
    return scope === 'chat' ? { chat: instances.chat } : instances.characters ?? {};
}

/** Fields and timer cursors as { fields, timers }: a chat module's own, or one entry per attached character name. */
export function snapshot(host, target, names) {
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
export function changesBetween(before, after) {
    const was = new Map(leaves(before)), now = leaves(after);
    return now.filter(([path, value]) => !same(was.get(path), value)).map(([path, value]) => ({ path, before: was.get(path), after: value }));
}
export function messageIndex(host, step) {
    return host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').startsWith(TEXT(step)));
}

export function stateSnapshot(state, target, names) {
    const instances = state?.domains?.dataModules?.instances?.[target.id];
    if (target.scope === 'chat') return frozenCopy({ fields: instances?.chat?.fields ?? {}, timers: instances?.chat?.timers ?? {} });
    const fields = {}, timers = {};
    for (const [id, subject] of Object.entries(instances?.characters ?? {})) {
        fields[names.get(id) ?? id] = subject.fields ?? {};
        timers[names.get(id) ?? id] = subject.timers ?? {};
    }
    return frozenCopy({ fields, timers });
}

// The finished data-module part exposes no replyCard hook or card-text query. Its summaryOf is prompt tail text,
// not a reply's changes. Compose the field diff here; refusal reasons and clamp notes remain the runtime's exact text.
export function cardOf(lines, changes) {
    const rows = lines.map(line => (line.refusal ? line.refusal.message : line.note ? line.note : null)).filter(Boolean);
    const moved = changes.map(change => `${change.path} ${change.before} → ${change.after}`);
    return [...moved, ...rows].join('\n');
}

export function usageOf(host) {
    const reply = Object.values(host.head().domains?.dataModules?.perReply ?? {})[0];
    return reply ? { roots: reply.roots, visits: reply.visits } : { roots: 0, visits: 0 };
}
