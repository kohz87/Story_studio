import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factions, factionsText, survival, survivalText, linked } from './fixtures/data-modules/index.js';
import { oldBackend } from './helpers/dm-backends.js';
import * as adapter from '../src/data-modules/sb-adapter.js';
import { openPack, exportPack } from '../src/model.js';
import { createHistory } from '../src/history.js';
import { replaceModules, checkModules, setModule, deleteModule, renameDataModuleTarget, removeDataModuleTarget, attachPresentation, CAPABILITY } from '../src/data-modules/dm-edits.js';
import { modulesOf } from '../src/data-modules/dm-model.js';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';

after(() => adapter.useBackendForTests(null));
const waiting = () => adapter.useBackendForTests(oldBackend);
const ready = () => adapter.useBackendForTests(null);
const plain = { id: 'ersveil-factions', version: '1.0.0', name: 'Plain', requires: { storyBlock: '^2' }, content: {} };
const ersveil = () => readFileSync(new URL('./fixtures/ersveil-bluewatch.json', import.meta.url), 'utf8');

test('waiting: a pack with data modules opens as a safe invalid draft that keeps every authored byte', () => {
    waiting();
    const text = factionsText();
    const model = openPack(text);
    assert.equal(model.validation.ok, false);
    assert.deepEqual(model.validation.errors.map(error => error.code), ['UNKNOWN_KIND']);
    assert.equal(modulesOf(model.document).length, 1);
    assert.deepEqual(model.document.content.dataModules[0].kinds.gain.labels.faction.values, ['guild', 'watch', 'compact']);
    assert.throws(() => exportPack(model), /Cannot export/);
});

test('waiting: Apply keeps the module as an unchecked draft, adds the capability, and Undo restores the exact model', () => {
    waiting();
    const model = openPack(JSON.stringify(plain));
    const record = factions().content.dataModules[0];
    const result = replaceModules(model, [record]);
    assert.equal(result.ok, true);
    assert.equal(result.waiting, true);
    assert.equal(result.model.validation.ok, false);
    assert.deepEqual(result.model.document.requires.capabilities, [CAPABILITY]);
    assert.deepEqual(result.model.document.content.dataModules, [record]);
    assert.equal(result.undo(), model);
    assert.equal(history(model, result).current, result.model);
});

function history(model, result) {
    const log = createHistory(model);
    assert.equal(log.commit(result), true);
    return log;
}

test('waiting: a new unrelated problem still refuses, and the pack stays as it was', () => {
    waiting();
    const model = openPack(JSON.stringify(plain));
    const result = replaceModules(model, [factions().content.dataModules[0]], { extra: { screens: [{ id: 'x' }] } });
    assert.equal(result.ok, false);
    assert.equal(result.model, model);
    assert.ok(result.errors.some(error => error.code !== 'UNKNOWN_KIND'));
});

test('v1.1 features: Story Block\u2019s own refusal stands when it checks; a copy that cannot check gets the fixed refusal', () => {
    const record = () => {
        const next = survival().content.dataModules[0];
        next.kinds.meal.check = { skill: 'survival', stat: 'wis', dc: 10 };
        next.kinds.rest.effects.push({ op: 'grantCoin', amount: 2 });
        return next;
    };
    ready();
    const model = openPack(JSON.stringify({ ...plain, id: 'ersveil-survival' }));
    const result = replaceModules(model, [record()]);
    assert.equal(result.ok, false);
    assert.equal(result.model, model);
    const sb = validatePack({ ...model.document, requires: { ...model.document.requires, capabilities: ['data-modules-v1'] }, content: { dataModules: [record()] } });
    assert.deepEqual(result.errors, sb.errors);
    assert.ok(result.errors.length >= 2 && result.errors.every(error => error.code === 'DM_SCHEMA' && /needs data-modules v1\.1/.test(error.message)), JSON.stringify(result.errors));
    assert.deepEqual(checkModules(model, [record()]).v11, []);
    waiting();
    const old = openPack(JSON.stringify({ ...plain, id: 'ersveil-survival' }));
    const fixed = replaceModules(old, [record()]);
    assert.equal(fixed.ok, false);
    assert.deepEqual(fixed.errors.map(error => error.code), ['NEEDS_V1_1', 'NEEDS_V1_1']);
    assert.ok(fixed.errors.every(error => error.message.endsWith('needs data-modules v1.1')));
    assert.equal(checkModules(old, [record()]).v11.length, 2);
});

test('ready: both worked examples open valid and export their original bytes untouched', () => {
    ready();
    for (const text of [factionsText(), survivalText()]) {
        const model = openPack(text);
        assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));
        assert.equal(exportPack(model), text);
    }
});

test('ready: an edit is one undoable step; undo returns the exact model and the original bytes', () => {
    ready();
    const text = factionsText();
    const model = openPack(text);
    const record = JSON.parse(JSON.stringify(model.document.content.dataModules[0]));
    record.name = 'Standing';
    const result = setModule(model, 0, record);
    assert.equal(result.ok, true);
    assert.equal(result.waiting, false);
    assert.equal(result.model.document.content.dataModules[0].name, 'Standing');
    const log = history(model, result);
    assert.match(exportPack(log.current), /"name": "Standing"/);
    assert.equal(log.undo(), model);
    assert.equal(exportPack(log.current), text);
});

test('ready: a candidate Story Block refuses leaves the pack and history untouched, with the checker’s own diagnostics', () => {
    ready();
    const model = openPack(factionsText());
    const record = JSON.parse(JSON.stringify(model.document.content.dataModules[0]));
    record.slug = 'Bad Slug';
    const result = replaceModules(model, [record]);
    assert.equal(result.ok, false);
    assert.equal(result.model, model);
    assert.deepEqual(result.errors, adapter.validatePack({ ...model.document, content: { ...model.document.content, dataModules: [record] } }).errors);
    assert.deepEqual(result.errors.map(error => `${error.code} ${error.path}`), ['DM_SCHEMA content.dataModules[0].slug']);
    const verdict = checkModules(model, [record]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.waiting, false);
});

test('ready: the capability is added once, in place, and existing capabilities keep their order', () => {
    ready();
    const model = openPack(JSON.stringify({ ...plain, requires: { storyBlock: '^2', capabilities: ['story-director'] } }));
    const first = replaceModules(model, [factions().content.dataModules[0]]);
    assert.equal(first.ok, true);
    assert.deepEqual(first.model.document.requires.capabilities, ['story-director', CAPABILITY]);
    const second = replaceModules(first.model, [factions().content.dataModules[0], { ...survival().content.dataModules[0], slug: 'survival' }]);
    assert.deepEqual(second.model?.document.requires.capabilities ?? first.model.document.requires.capabilities, ['story-director', CAPABILITY]);
});

test('ready: removing the last module drops content.dataModules and leaves the rest of content alone', () => {
    ready();
    const model = openPack(factionsText());
    const result = replaceModules(model, []);
    assert.equal(result.ok, true);
    assert.equal(Object.hasOwn(result.model.document.content, 'dataModules'), false);
    assert.deepEqual(result.model.document.requires.capabilities, [CAPABILITY], 'the capability is not silently removed');
});

test('ready: deleting a module refuses while another module or screen refers to it', () => {
    ready();
    const model = openPack(JSON.stringify(linked()));
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));
    const refused = deleteModule(model, 0);
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].code, 'has-references');
    assert.ok(refused.references.length >= 1);
    assert.equal(refused.model, model);
    const removed = deleteModule(model, 1);
    assert.equal(removed.ok, true);
    assert.equal(modulesOf(removed.model.document).length, 1);
    assert.equal(deleteModule(model, 9).ok, false);
});

test('ready: typed rename and remove go through the same checked edit', () => {
    ready();
    const model = openPack(JSON.stringify(linked()));
    const renamed = renameDataModuleTarget(model, { targetKind: 'dm.export', targetId: 'pack.ersveil-survival/survival#needs' }, 'meters');
    assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
    assert.equal(renamed.model.document.content.dataModules[1].imports.needs.args.export, 'meters');
    assert.equal(renamed.undo(), model);
    const refused = removeDataModuleTarget(model, { targetKind: 'dm.export', targetId: 'pack.ersveil-survival/survival#needs' });
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].code, 'has-references');
    assert.equal(refused.references.length, 1);
    assert.equal(removeDataModuleTarget(model, { targetKind: 'dm.field', targetId: 'pack.ersveil-survival/survival#nope' }).ok, false);
});

test('ready: attaching a pack screen copies it into the module and refuses a duplicate id', () => {
    ready();
    const pack = factions();
    pack.screens = [{ id: 'side', title: 'Side', mounts: ['tab'], layout: { root: { type: 'text', value: 'Hello' } } }];
    const model = openPack(JSON.stringify(pack));
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));
    const attached = attachPresentation(model, 0, 'screens', 'side');
    assert.equal(attached.ok, true, JSON.stringify(attached.errors));
    const module = attached.model.document.content.dataModules[0];
    assert.deepEqual(module.screens.map(screen => screen.id), ['ersveil-reputation', 'side']);
    assert.equal(attached.model.document.screens.length, 1, 'the pack screen stays');
    assert.notEqual(module.screens[1], attached.model.document.screens[0], 'it is a copy');
    assert.equal(attachPresentation(attached.model, 0, 'screens', 'side').ok, false);
    assert.equal(attachPresentation(model, 0, 'layouts', 'missing').ok, false);
    assert.equal(attachPresentation(model, 0, 'themes', 'side').ok, false);
});

test('ready: editing a data module in the Ersveil pack and undoing restores its 247 KB source bytes', () => {
    ready();
    const text = ersveil();
    const model = openPack(text);
    assert.equal(model.validation.ok, true);
    const record = factions().content.dataModules[0];
    delete record.screens;
    const edited = replaceModules(model, [record]);
    assert.equal(edited.ok, true, JSON.stringify(edited.errors));
    assert.ok(edited.model.document.requires.capabilities.includes(CAPABILITY));
    const log = history(model, edited);
    assert.match(exportPack(log.current), /"dataModules"/);
    assert.equal(log.undo(), model);
    assert.equal(exportPack(log.current), text);
    assert.equal(log.current.rulesHash, model.rulesHash);
});

test('refusals never mutate their inputs', () => {
    ready();
    const model = openPack(factionsText());
    const modules = JSON.parse(JSON.stringify(modulesOf(model.document)));
    modules[0].slug = 'Bad Slug';
    const before = JSON.stringify(modules);
    replaceModules(model, modules);
    assert.equal(JSON.stringify(modules), before);
    assert.equal(replaceModules(null, []).ok, false);
    assert.equal(replaceModules(model, 'x').ok, false);
    assert.equal(replaceModules(model, [5]).ok, false);
});
