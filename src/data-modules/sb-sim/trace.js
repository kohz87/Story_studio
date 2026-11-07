// Rebuilding a simulated chat's rows: each step's lines, refusals, changes and field state, from the saved records and the
// receipts that survive. Pure over the host it is given.
import { parseChanges, extractBlock } from '../../../vendor/story-block/src/v2/capture.js';
import { readRecord } from '../../../vendor/story-block/src/v2/persist.js';
import { apply as applyOps } from '../../../vendor/story-block/src/v2/ops.js';
import { sourceKey } from './util.js';
import { messageIndex, stateSnapshot, changesBetween, cardOf } from './read.js';
import { messageTexts } from './play.js';

// A receipt ends at its own revision op, whether or not the command made a guarded block. An unguarded
// capture's fallback Source ordinal names the *next* block, which a later Continue may have filled.
function receiptPositions(record) {
    const receipts = new Map((record?.receipts ?? []).map(receipt => [receipt.rev, receipt]));
    const positions = [];
    (record?.ops ?? []).forEach((op, index) => {
        if (op.path !== '/meta/rev') return;
        const receipt = receipts.get(op.value);
        if (receipt) positions.push({ receipt, end: index + 1 });
    });
    return positions;
}

function boundaryState(host, at, source, record, end) {
    const prefix = host.store.prefixWitness({ ...source, op: end });
    if (prefix) return prefix.state;
    // Re-read may coalesce several unguarded story receipts into one span. Only that span may be
    // split at a receipt boundary; guarded spans must always be replayed by the host's witness.
    let start = 0;
    for (const span of record?.spans ?? []) {
        if (start < end && end < start + span.n && !span.id) {
            const before = host.store.prefixWitness({ ...source, op: start });
            if (before) return applyOps(before.state, record.ops.slice(start, end));
        }
        start += span.n;
    }
    if (end === 0) return host.store.before(at);
    throw new Error('The host has no witness for this step boundary.');
}

/** Rebuild every row from the current message, its Source/line occurrence and surviving receipts. */
export function trace(host, target, steps, texts, names, deleted) {
    const records = [];
    const skipped = host.store.problems();
    for (const group of messageTexts(steps, texts)) {
        const at = messageIndex(host, group.number);
        if (at < 0) continue;
        const source = host.store.sourceAt(at);
        const observed = host.outcomes.get(sourceKey(source)) ?? { lines: [], problems: [] };
        const parsed = parseChanges(extractBlock(host.ctx.chat[at].mes) ?? '').lines;
        const record = readRecord(host.ctx.chat[at]);
        const receipts = new Map((record?.receipts ?? []).map(receipt => [receipt.id, receipt]));
        const positions = receiptPositions(record);
        const byReceipt = new Map(positions.map(position => [position.receipt.id, position]));
        const problems = skipped.filter(item => item.index === at);
        let previous = stateSnapshot(host.store.before(at), target, names);
        let end = 0;
        let occurrence = 0;
        const surviving = group.steps.filter(index => !deleted.has(index));
        for (const index of surviving) {
            const count = parseChanges(extractBlock(texts[index]) ?? '').lines.length;
            const lines = parsed.slice(occurrence, occurrence + count).map(line => {
                const outcome = observed.lines[occurrence++];
                const receipt = receipts.get(outcome?.receipt);
                const problem = receipt ? problems.find(item => item.receipts?.includes(receipt.id)) : null;
                const inactive = Boolean(problem);
                const refusal = outcome?.refusal ?? null;
                if (receipt) end = Math.max(end, byReceipt.get(receipt.id)?.end ?? end);
                return {
                    raw: line.raw,
                    parsed: { op: line.op, kind: line.kind === 'dm' ? `dm ${line.name}` : line.kind, ...(line.kind === 'dm' ? line.labels : { argument: line.name }) },
                    outcome: inactive ? 'inactive' : refusal ? 'refused' : receipt ? 'applied' : 'unread',
                    ...(refusal ? { refusal } : {}), ...(outcome?.note && !inactive ? { note: outcome.note } : {}),
                    changes: [],
                    ...(problem ? { problem: { code: problem.code, path: '', message: problem.why ?? problem.message } } : {}),
                };
            });
            // Hooks stored after these story lines belong to this step, up to the next story receipt.
            // This includes afterCapture ticks and beforeGenerate commands stored on this reply.
            for (const position of positions) {
                if (position.end <= end) continue;
                if (position.receipt.cause === 'story') break;
                end = position.end;
            }
            const now = stateSnapshot(index === surviving.at(-1) ? host.store.at(at) : boundaryState(host, at, source, record, end), target, names);
            const changes = changesBetween(previous.fields, now.fields);
            const inactive = lines.some(line => line.outcome === 'inactive');
            const ownProblems = [...lines.flatMap(line => line.problem ? [line.problem] : []),
                ...(index === surviving.at(-1) ? observed.problems.map(item => ({ code: item.code, path: '', message: item.message })) : [])];
            records.push({
                index, type: steps[index].type, reply: group.number,
                status: inactive ? 'inactive' : lines.some(line => line.outcome === 'refused') ? 'refused' : steps[index].type === 'advance' ? 'advanced' : 'applied',
                lines, changes, fields: now.fields, timers: now.timers,
                replyCard: [cardOf(lines, changes), ...ownProblems.map(item => item.message)].filter(Boolean).join('\n'),
                problems: ownProblems,
            });
            previous = now;
        }
    }
    return records;
}
