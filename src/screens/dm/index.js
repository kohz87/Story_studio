// Data modules: authoring for data-defined modules (DATA_MODULES.md §8). Forms edit a draft record in place; the
// draft is checked by Story Block (through sb-adapter) as it changes and again on Apply, which is one undoable edit.
import { el, button, row, note, safeLabel } from './ui.js';
import * as sections from './sections.js';
import { presentationSection } from './present.js';
import { simulatorSection } from './sim.js';
import { verdictLines, grammarPanel, referencesSection, jsonSection } from './panels.js';
import { applyEdit } from '../../apply-edit.js';
import { replaceModules, deleteModule } from '../../data-modules/dm-edits.js';
import { newModule, renameInRecord, removeInRecord, replaceContents } from '../../data-modules/forms.js';
import { modulesOf, clone, isObject } from '../../data-modules/dm-model.js';
import { grammarPreview } from '../../data-modules/grammar.js';
import { defaultScenario, replyText } from '../../data-modules/simulator.js';
import { status, WAITING_MESSAGE } from '../../data-modules/sb-adapter.js';

const SECTIONS = [
    ['identity', 'Identity'], ['fields', 'Fields'], ['imports', 'Imports'], ['kinds', 'Kinds'], ['rules', 'Rules'], ['rewards', 'Rewards'],
    ['timers', 'Timers'], ['exports', 'Exports'], ['migrations', 'Migrations'], ['presentation', 'Screens'], ['simulator', 'Simulator'],
    ['references', 'References'], ['json', 'Record JSON'],
];

export function renderDataModules(ctx) {
    const { doc, main } = ctx;
    const state = ctx.authoring.dm ??= { index: 0, section: 'identity' };
    const model = ctx.model;
    const saved = modulesOf(model.document);
    if (state.base !== model) { state.base = model; state.draft = undefined; state.sim = undefined; state.refRefused = undefined; state.presentation = undefined; }
    if (state.index > saved.length) state.index = saved.length;
    if (state.draft === undefined && state.index < saved.length) state.draft = clone(saved[state.index]);

    main.append(el(doc, 'h1', 'Data modules'), note(doc, 'Define a module as data: typed fields, the lines a narrator may write, rules, rewards and timers. Story Block checks and runs the definition; Studio edits it.'));
    const unavailable = !status().checker;
    if (unavailable) {
        main.append(el(doc, 'p', `${WAITING_MESSAGE}. You can write and keep definitions, but they cannot be checked or simulated until the pack's Story Block copy supports data modules.`, { class: 'warning', role: 'status', id: 'dm-waiting' }));
    }

    const picker = el(doc, 'div', '', { class: 'row', 'aria-label': 'Data modules' });
    saved.forEach((module, index) => picker.append(button(doc, `${index + 1}. ${safeLabel(module?.name ?? module?.slug ?? 'Module')}`, () => { state.index = index; state.draft = undefined; state.sim = undefined; ctx.render(); }, { 'aria-pressed': String(state.index === index && state.draft !== undefined) })));
    picker.append(button(doc, 'New module', () => {
        state.index = saved.length;
        state.draft = newModule(saved.map(module => module?.slug));
        state.sim = undefined;
        ctx.render();
    }));
    main.append(picker);
    if (state.draft === undefined) { main.append(note(doc, 'No data modules yet. Choose New module to begin.')); return; }
    if (!isObject(state.draft)) { main.append(note(doc, 'This record is not an object.', 'warning')); return; }

    const draft = state.draft;
    const packId = typeof model.document.id === 'string' ? model.document.id : 'pack';
    const listeners = [];
    const workspace = el(doc, 'div', '', { class: 'presentation-workspace dm-workspace' });
    const editor = el(doc, 'section', '', { class: 'stack', 'aria-label': 'Module form' });
    const side = el(doc, 'section', '', { class: 'stack dm-grammar', 'aria-label': 'Narrator grammar' });
    workspace.append(editor, side);
    const verdict = el(doc, 'pre', '', { id: 'dm-validation', role: 'status' });
    const body = el(doc, 'div', '', { class: 'stack', id: 'dm-section' });
    let pending = null;

    const S = {
        doc, studio: ctx, state, draft, packId, document: model.document, listeners,
        get others() { return saved.filter((_, index) => index !== state.index); },
        candidate() { const next = saved.slice(); next[state.index] = draft; return next; },
        candidateDocument() { return { ...model.document, content: { ...(model.document.content ?? {}), dataModules: S.candidate() } }; },
        dirty() { return state.index >= saved.length || JSON.stringify(draft) !== JSON.stringify(saved[state.index]); },
        exampleLines() { return grammarPreview(S.candidateDocument(), draft).kinds.flatMap(kind => kind.examples.valid); },
        useInSimulator(line) {
            state.sim ??= { scenario: defaultScenario(draft), result: null, whatIf: null, answers: '{}' };
            state.sim.scenario.steps.push({ type: 'reply', text: replyText([line]) });
            state.section = 'simulator';
            ctx.render();
        },
        refuse(errors) { applyEdit(ctx, { ok: false, errors }); },
        rename(target, name) {
            const result = renameInRecord(packId, draft, target, name);
            if (!result.ok) { S.refuse(result.errors); return; }
            replaceContents(draft, result.module);
            S.redraw();
        },
        remove(target) {
            const result = removeInRecord(packId, draft, target);
            if (!result.ok) { S.refuse(result.errors); return; }
            replaceContents(draft, result.module);
            S.redraw();
        },
        refresh() {
            pending = null;
            const shown = verdictLines(S);
            verdict.textContent = shown.lines.join('\n');
            verdict.setAttribute('data-ok', shown.verdict.ok && !shown.verdict.waiting ? 'true' : 'false');
            grammarPanel(S, side);
            for (const listener of listeners) listener();
        },
        touch() {
            const set = ctx.win?.setTimeout;
            if (typeof set !== 'function') { S.refresh(); return; }
            if (pending !== null) ctx.win.clearTimeout(pending);
            pending = set.call(ctx.win, S.refresh, 120);
        },
        redraw() {
            state.cleanup?.();
            state.cleanup = null;
            listeners.length = 0;
            body.replaceChildren();
            drawSection(S, body);
            S.refresh();
        },
    };

    const apply = button(doc, 'Apply module', () => {
        const result = replaceModules(ctx.model, S.candidate());
        if (!result.ok) {
            verdict.textContent = result.errors.map(error => `${safeLabel(error.code)} · ${safeLabel(error.path)}: ${safeLabel(error.message)}`).join('\n');
            applyEdit(ctx, result);
            return;
        }
        if (applyEdit(ctx, result) && result.waiting) ctx.notify(`${WAITING_MESSAGE}. The module is kept in the pack as a draft Story Block has not checked; export stays off until it can.`);
    }, { class: 'primary', id: 'dm-apply' });
    const actions = row(doc, apply,
        button(doc, 'Discard draft', () => { state.draft = undefined; state.sim = undefined; if (state.index >= saved.length) state.index = Math.max(0, saved.length - 1); ctx.render(); }),
        ...(state.index < saved.length ? [button(doc, 'Delete module', () => {
            if (applyEdit(ctx, deleteModule(ctx.model, state.index))) state.index = Math.max(0, Math.min(state.index, modulesOf(ctx.model.document).length - 1));
        })] : []));
    const nav = el(doc, 'div', '', { class: 'row', 'aria-label': 'Module sections' });
    for (const [key, label] of SECTIONS) nav.append(button(doc, label, () => { state.section = key; ctx.render(); }, { 'aria-pressed': String(state.section === key) }));
    editor.append(verdict, actions, nav, body);
    main.append(workspace);
    ctx.previewCleanup = () => { state.cleanup?.(); state.cleanup = null; };
    S.redraw();
}

function drawSection(S, host) {
    const { doc, state } = S;
    host.append(el(doc, 'h2', SECTIONS.find(([key]) => key === state.section)?.[1] ?? 'Identity'));
    switch (state.section) {
        case 'fields': return sections.fields(S, host);
        case 'imports': return sections.imports(S, host);
        case 'kinds': return sections.kinds(S, host);
        case 'rules': return sections.rules(S, host);
        case 'rewards': return sections.rewards(S, host);
        case 'timers': return sections.timers(S, host);
        case 'exports': return sections.exportsSection(S, host);
        case 'migrations': return sections.migrations(S, host);
        case 'presentation': return presentationSection(S, host);
        case 'simulator': return simulatorSection(S, host);
        case 'references': return referencesSection(S, host);
        case 'json': return jsonSection(S, host);
        default: return sections.identity(S, host);
    }
}

