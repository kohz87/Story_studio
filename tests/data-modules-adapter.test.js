import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { factionsText, survivalText, factions, survival } from './fixtures/data-modules/index.js';
import { noRuntimeBackend, oldBackend } from './helpers/dm-backends.js';
import { DM_DESCRIPTORS, DM_LIMITS, DM_DIAGNOSTICS } from '../vendor/story-block/src/v2/data-modules/check.js';
import { backend as vendored } from '../src/data-modules/sb-backend.js';
import * as adapter from '../src/data-modules/sb-adapter.js';
import { validatePack as vendoredValidatePack } from '../vendor/story-block/src/v2/packs/validate.js';

after(() => adapter.useBackendForTests(null));

const old = () => adapter.useBackendForTests(oldBackend);

test('production backend: the vendored Story Block checks data modules and ships the runtime Studio simulates on', () => {
    adapter.useBackendForTests(null);
    assert.equal(vendored.source, 'vendored');
    assert.equal(vendored.supported, true);
    const state = adapter.status();
    assert.deepEqual({ checker: state.checker, simulator: state.simulator, descriptors: state.descriptors, grammar: state.grammar }, { checker: true, simulator: true, descriptors: true, grammar: true });
    assert.equal(state.message, '');
    assert.equal(adapter.WAITING_MESSAGE, 'This needs Story Block with data-modules-v1');
    assert.equal(adapter.NO_SIMULATOR_MESSAGE, 'This needs Story Block with the data-modules runtime');
});

test('limits, descriptors and diagnostics are Story Block\u2019s own objects', () => {
    adapter.useBackendForTests(null);
    assert.equal(adapter.descriptors(), DM_DESCRIPTORS);
    assert.deepEqual(adapter.limits(), { source: 'story-block', values: DM_LIMITS });
    assert.equal(adapter.diagnostics(), DM_DIAGNOSTICS);
    // Story Block's grammar generator answers only for an accepted definition of the pack.
    assert.equal(adapter.grammar({}, {}), null);
    const pack = factions();
    assert.equal(adapter.grammar(pack, pack.content.dataModules[0]),
        '+ dm reputation \u2014 reason | kind: gain | faction: guild|watch|compact; - dm reputation \u2014 reason | kind: loss | faction: guild|watch|compact');
});

test('the adapter returns the vendored importer verdict unchanged', () => {
    adapter.useBackendForTests(null);
    for (const text of [factionsText(), survivalText()]) {
        assert.deepEqual(adapter.validatePack(text), vendoredValidatePack(text));
        assert.equal(adapter.validatePack(text).ok, true);
    }
    const bad = JSON.parse(factionsText());
    bad.content.dataModules[0].unknown = 1;
    const verdict = adapter.validatePack(bad);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.errors, vendoredValidatePack(bad).errors);
    assert.equal(adapter.isWaitingError(verdict.errors[0]), false);
});

test('a Story Block copy with the checker but no runtime says so precisely, and offers no grammar or simulation', async () => {
    adapter.useBackendForTests(noRuntimeBackend);
    const state = adapter.status();
    assert.deepEqual({ checker: state.checker, simulator: state.simulator, grammar: state.grammar, descriptors: state.descriptors }, { checker: true, simulator: false, grammar: false, descriptors: true });
    assert.deepEqual(await adapter.simulate({}), { ok: false, waiting: true, message: adapter.NO_SIMULATOR_MESSAGE });
    assert.equal(adapter.grammar(factions(), factions().content.dataModules[0]), null);
    assert.equal(noRuntimeBackend.validatePack, vendored.validatePack, 'the checker is still Story Block\u2019s');
});

test('an older Story Block without the data-modules checker keeps the waiting state', async () => {
    old();
    const state = adapter.status();
    assert.deepEqual({ checker: state.checker, simulator: state.simulator, descriptors: state.descriptors }, { checker: false, simulator: false, descriptors: false });
    assert.equal(state.message, 'This needs Story Block with data-modules-v1');
    const verdict = adapter.validatePack(factionsText());
    assert.equal(adapter.isWaitingError(verdict.errors[0]), true);
    assert.equal(adapter.isWaitingError({ code: 'UNKNOWN_KIND', path: 'content.items' }), false);
    assert.equal(adapter.isWaitingError({ code: 'BAD_RECORD', path: 'content.dataModules' }), false);
    assert.deepEqual(await adapter.simulate({}), { ok: false, waiting: true, message: adapter.WAITING_MESSAGE });
    assert.equal(adapter.descriptors(), null);
    const { source, values } = adapter.limits();
    assert.match(source, /provisional/);
    assert.equal(values.fields, 32);
    assert.equal(adapter.diagnostics(), null);
});

test('migration check: Story Block compares two checked definitions and its own errors come back', () => {
    adapter.useBackendForTests(null);
    const earlier = survival();
    const next = survival();
    const [module] = next.content.dataModules;
    module.stateVersion = 2;
    module.state.thirst = { type: 'int', min: 0, max: 100, default: 0 };
    module.migrations = [{ from: 1, to: 2, add: { thirst: { type: 'int', min: 0, max: 100, default: 0 } } }];
    assert.deepEqual(adapter.checkMigration(earlier, next, 'survival'), { ok: true, errors: [], add: { thirst: { type: 'int', min: 0, max: 100, default: 0 } } });
    // A narrower bound is not additive: the checker's own diagnostic is returned untouched.
    module.state.hunger.max = 50;
    const narrower = adapter.checkMigration(earlier, next, 'survival');
    assert.equal(narrower.ok, false);
    assert.ok(narrower.errors.some(error => error.code === 'DM_SCHEMA' && error.path === 'state.hunger' && /cannot be removed, retyped, reset or have changed bounds/.test(error.message)), JSON.stringify(narrower.errors));
    // Either pack must itself be accepted, and must hold the module.
    const broken = survival();
    broken.content.dataModules[0].mystery = 1;
    assert.match(adapter.checkMigration(broken, next, 'survival').errors[0].message, /^earlier version: /);
    assert.equal(adapter.checkMigration(earlier, factions(), 'survival').errors[0].message, 'The current draft has no data module "survival".');
    const invalidDraft = survival();
    invalidDraft.content.dataModules[0].kinds.rest.labels.hours.max = 'eight';
    const refusedDraft = adapter.checkMigration(earlier, invalidDraft, 'survival');
    assert.equal(refusedDraft.ok, false);
    assert.match(refusedDraft.errors[0].message, /^current draft: /);
    old();
    assert.deepEqual(adapter.checkMigration(earlier, next, 'survival'), { ok: false, waiting: true, message: adapter.WAITING_MESSAGE, errors: [] });
});
