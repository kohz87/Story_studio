// Simulator panel: sample `dm` lines and time advances run on Story Block's runtime through the adapter. Studio
// shows what comes back (parsed lines, refusals, field changes, reply-card text) and what a delete, Re-read, swipe
// or reload of a step would do; it computes none of that itself. Everything shown reaches the page as text.
import { el, button, textControl, intControl, card, row, note, heading, safeLabel } from './ui.js';
import { status, WAITING_MESSAGE, NO_SIMULATOR_MESSAGE } from '../../data-modules/sb-adapter.js';
import { buildRequest, run, defaultScenario, compareRuns, replyText, MAX_STEPS, MAX_STEP_TEXT } from '../../data-modules/simulator.js';
import { parseJsonInput } from '../../forms.js';
import { isObject, list } from '../../data-modules/dm-model.js';

const problemLine = problem => `${safeLabel(problem.code)} · ${safeLabel(problem.path)}: ${safeLabel(problem.message)}`;

function showResult(doc, host, result) {
    if (result.waiting) { host.append(el(doc, 'p', result.message, { class: 'warning', role: 'status', id: 'dm-sim-waiting' })); return; }
    if (!result.ok) {
        host.append(heading(doc, 'The simulator refused this scenario', 'h3'));
        for (const error of list(result.errors)) host.append(el(doc, 'p', problemLine(error), { class: 'warning' }));
        return;
    }
    list(result.steps).forEach((step, index) => {
        const box = card(doc);
        box.setAttribute('data-sim-step', String(index));
        box.append(heading(doc, `Step ${index + 1} · ${safeLabel(step.type)} · ${safeLabel(step.status)}`, 'h4'));
        for (const line of list(step.lines)) {
            box.append(el(doc, 'pre', line.raw, { class: `sim-line sim-${safeLabel(line.outcome)}` }));
            const parsed = isObject(line.parsed) ? Object.entries(line.parsed).map(([key, value]) => `${key}: ${safeLabel(value)}`).join(' | ') : '';
            box.append(el(doc, 'p', `${safeLabel(line.outcome)}${parsed ? ` · ${parsed}` : ''}`, { class: 'muted' }));
            if (line.refusal) box.append(el(doc, 'p', problemLine(line.refusal), { class: 'warning sim-refusal' }));
            for (const change of list(line.changes)) box.append(el(doc, 'p', `${safeLabel(change.path)}: ${safeLabel(change.before)} → ${safeLabel(change.after)}${change.note ? ` (${safeLabel(change.note)})` : ''}`, { class: 'sim-change' }));
        }
        for (const problem of list(step.problems)) box.append(el(doc, 'p', problemLine(problem), { class: 'warning sim-problem' }));
        if (step.replyCard) box.append(el(doc, 'p', 'Reply card', { class: 'muted' }), el(doc, 'pre', step.replyCard, { class: 'sim-card' }));
        if (step.fields) box.append(el(doc, 'pre', JSON.stringify(step.fields), { class: 'sim-fields' }));
        if (step.timers && Object.keys(step.timers).length) box.append(el(doc, 'pre', `timers ${JSON.stringify(step.timers)}`, { class: 'sim-timers' }));
        host.append(box);
    });
    host.append(heading(doc, 'Final fields', 'h3'), el(doc, 'pre', JSON.stringify(result.final?.fields ?? {}, null, 2), { id: 'dm-sim-final' }));
    if (result.usage) host.append(el(doc, 'pre', `budget ${JSON.stringify(result.usage)}`, { class: 'muted', id: 'dm-sim-usage' }));
}

export function simulatorSection(S, host) {
    const { doc, draft } = S;
    const sim = S.state.sim ??= { scenario: defaultScenario(draft), result: null, whatIf: null, answers: '{}' };
    host.append(note(doc, 'Runs sample replies and time advances on Story Block’s own runtime, on a disposable chat. It never changes the pack or a real chat.'));
    const state = status();
    if (!state.simulator) host.append(el(doc, 'p', state.checker ? NO_SIMULATOR_MESSAGE : WAITING_MESSAGE, { class: 'warning', role: 'status', id: 'dm-sim-unavailable' }));
    const scenario = sim.scenario;
    const setup = card(doc, heading(doc, 'Starting point', 'h3'));
    if (draft.scope === 'character') textControl(doc, setup, 'Attached characters (one per line)', scenario.actors.join('\n'), v => { scenario.actors = v.split('\n').map(x => x.trim()).filter(Boolean); }, { multiline: true });
    intControl(doc, setup, 'Story minute at the start', scenario.startMinute, v => { scenario.startMinute = v; });
    intControl(doc, setup, 'Seed', scenario.seed, v => { scenario.seed = v; });
    textControl(doc, setup, 'Sample public query answers (JSON)', sim.answers, v => { sim.answers = v; }, { multiline: true });
    host.append(setup);

    host.append(heading(doc, 'Replies and time', 'h3'));
    scenario.steps.forEach((step, index) => {
        const box = card(doc);
        box.setAttribute('data-step', String(index));
        if (step.type === 'advance') {
            intControl(doc, box, `Step ${index + 1}: advance story time (minutes)`, step.minutes, v => { step.minutes = v; });
        } else {
            box.append(el(doc, 'strong', `Step ${index + 1}: ${step.type === 'continue' ? 'Continue (adds to the reply above)' : 'Reply'}`));
            textControl(doc, box, `Step ${index + 1} text`, step.text, v => { step.text = v.slice(0, MAX_STEP_TEXT); }, { multiline: true, rows: 5 });
        }
        box.append(button(doc, 'Remove step', () => { scenario.steps.splice(index, 1); S.redraw(); }, { 'aria-label': `Remove step ${index + 1}` }));
        host.append(box);
    });
    const add = row(doc);
    const sample = S.exampleLines?.() ?? [];
    add.append(button(doc, 'Add reply', () => { if (scenario.steps.length < MAX_STEPS) scenario.steps.push({ type: 'reply', text: replyText(sample.slice(0, 1)) }); S.redraw(); }),
        button(doc, 'Add Continue', () => { if (scenario.steps.length < MAX_STEPS) scenario.steps.push({ type: 'continue', text: replyText(sample.slice(0, 1)) }); S.redraw(); }),
        button(doc, 'Add time advance', () => { if (scenario.steps.length < MAX_STEPS) scenario.steps.push({ type: 'advance', minutes: 60 }); S.redraw(); }));
    host.append(add);

    const output = el(doc, 'div', '', { class: 'stack', id: 'dm-sim-output', 'aria-live': 'polite' });
    // A what-if replays the scenario as it was run; only the edited text of the chosen step comes from the form.
    const request = (action, ran) => {
        const parsed = parseJsonInput(sim.answers || '{}');
        if (!parsed.ok || !isObject(parsed.value)) return { error: `Sample answers refused: ${parsed.ok ? 'enter a JSON object' : parsed.error}` };
        return { value: buildRequest(S.studio.model.document, draft, S.state.index, ran ?? { ...scenario, answers: parsed.value }, action) };
    };
    const execute = (action, ran) => {
        const built = request(action, ran);
        if (built.error) { output.replaceChildren(el(doc, 'p', built.error, { class: 'warning' })); return null; }
        return run(built.value);
    };
    const draw = () => {
        output.replaceChildren();
        if (!sim.result) return;
        showResult(doc, output, sim.result);
        if (sim.result.ok && sim.ran) {
            const actions = row(doc);
            list(sim.result.steps).forEach((step, index) => {
                const original = scenario.steps[step?.index ?? index];
                if (!original || original.type === 'advance') return;
                const what = (type, text) => {
                    const result = execute({ type, step: step?.index ?? index, ...(text === undefined ? {} : { text }) }, sim.ran);
                    if (!result) return;
                    sim.whatIf = { type, step: index, result, diff: result.ok ? compareRuns(sim.result, result) : null };
                    S.redraw();
                };
                actions.append(button(doc, `Delete step ${index + 1}`, () => what('delete')), button(doc, `Re-read step ${index + 1}`, () => what('reread', original.text)),
                    button(doc, `Swipe step ${index + 1}`, () => what('swipe', original.text)));
            });
            actions.append(button(doc, 'Reload', () => {
                const result = execute({ type: 'reload', step: 0 }, sim.ran);
                if (!result) return;
                sim.whatIf = { type: 'reload', step: 0, result, diff: result.ok ? compareRuns(sim.result, result) : null };
                S.redraw();
            }));
            output.append(heading(doc, 'What would happen if', 'h3'), actions);
        }
        if (sim.whatIf) {
            const box = card(doc, heading(doc, `If you ${sim.whatIf.type} step ${sim.whatIf.step + 1}`, 'h3'));
            box.setAttribute('id', 'dm-sim-whatif');
            showResult(doc, box, sim.whatIf.result);
            if (sim.whatIf.diff) {
                if (!sim.whatIf.diff.fields.length && !sim.whatIf.diff.statuses.length) box.append(note(doc, 'Nothing changes.'));
                for (const item of sim.whatIf.diff.fields) box.append(el(doc, 'p', `${safeLabel(item.path)}: ${safeLabel(item.before)} → ${safeLabel(item.after)}`, { class: 'sim-diff' }));
                for (const item of sim.whatIf.diff.statuses) box.append(el(doc, 'p', `Step ${item.index + 1}: ${safeLabel(item.before)} → ${safeLabel(item.after)}`, { class: 'sim-status-change' }));
            }
            output.append(box);
        }
    };
    const runButton = button(doc, 'Run simulation', () => {
        sim.whatIf = null;
        sim.result = execute(null);
        sim.ran = sim.result && !sim.result.waiting ? JSON.parse(JSON.stringify({ ...scenario, answers: parseJsonInput(sim.answers || '{}').value ?? {} })) : null;
        draw();
    }, { class: 'primary' });
    host.append(row(doc, runButton, button(doc, 'Reset scenario', () => { S.state.sim = undefined; S.redraw(); })), output);
    draw();
}
