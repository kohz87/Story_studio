import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { identity } from '../src/identity.js';
import { add, remove, renameId, setSchemaField } from '../src/edits.js';
import { createHistory } from '../src/history.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';
import { acceptLoreDraft } from '../src/lorebook.js';

const source = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const world = () => openPack(source);

test('an ordinary world with places, routes, calendar, weather, events and data modules opens and exports unchanged', () => {
    const model = world();
    assert.equal(model.validation.ok, true, JSON.stringify(model.validation.errors));
    for (const key of ['places', 'routes', 'events', 'dataModules']) assert.ok(model.document.content[key].length, key);
    assert.ok(model.document.calendar && model.document.weather);
    assert.equal(exportPack(model), source);
});

test('renaming a place follows its routes; undo restores the original source bytes', () => {
    const model = world();
    const first = model.document.content.places[0];
    const previous = identity(first, 'places');
    const incoming = model.references.filter(ref => ref.targetKind === 'places' && ref.targetId === `pack.ersveil/${previous}`);
    assert.ok(incoming.some(ref => ref.kind === 'routes'));
    const renamed = renameId(model, 'places', previous, 'lanternfall-test-place');
    assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
    assert.equal(renamed.model.validation.ok, true, JSON.stringify(renamed.model.validation.errors));
    assert.equal(renamed.model.references.filter(ref => ref.targetKind === 'places' && ref.targetId === 'pack.ersveil/lanternfall-test-place').length, incoming.length);
    const history = createHistory(model);
    history.commit(renamed);
    assert.equal(exportPack(history.undo()), source);
});

test('removing a referenced place requires an explicit cascade and removes its dependent routes', () => {
    const model = world();
    const id = identity(model.document.content.places[0], 'places');
    const refused = remove(model, 'places', id);
    assert.equal(refused.ok, false);
    assert.equal(refused.errors[0].code, 'referenced');
    const result = remove(model, 'places', id, { cascade: true });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.model.validation.ok, true, JSON.stringify(result.model.validation.errors));
    assert.ok(result.model.document.content.routes.length < model.document.content.routes.length);
});

test('ordinary record and calendar edits retain the rest of the world', () => {
    const model = world();
    const added = add(model, 'places', { name: 'Lanternfall Test', slug: 'lanternfall-test', x: 0, y: 0 });
    assert.equal(added.ok, true, JSON.stringify(added.errors));
    assert.equal(added.model.validation.ok, true, JSON.stringify(added.model.validation.errors));
    const calendar = setSchemaField(added.model, ['calendar', 'era'], 'Test Era');
    assert.equal(calendar.ok, true, JSON.stringify(calendar.errors));
    assert.equal(calendar.model.document.calendar.era, 'Test Era');
    assert.deepEqual(calendar.model.document.weather, model.document.weather);
    assert.deepEqual(calendar.model.document.content.dataModules, model.document.content.dataModules);
});

test('the host refuses a removed rules manifest', () => {
    const model = openPack({ id: 'old-world', version: '1.0.0', name: 'Old World', content: { rules: [{ schema: 2, slug: 'rules' }] } });
    assert.equal(model.validation.ok, false);
    assert.ok(model.validation.errors.some(error => error.path.startsWith('content.rules')));
    assert.throws(() => exportPack(model));
});

test('editing the name of a name-keyed place follows its references', () => {
    const model = world();
    const changed = setSchemaField(model, ['content', 'places', 0, 'name'], 'Lanternfall Renamed');
    assert.equal(changed.ok, true, JSON.stringify(changed.errors));
    assert.equal(changed.model.validation.ok, true, JSON.stringify(changed.model.validation.errors));
    assert.ok(changed.model.references.some(ref => ref.targetKind === 'places' && ref.targetId === 'pack.ersveil/lanternfall-renamed'));
    assert.equal(changed.undo(), model);
});


test('world records and pack settings render with the ordinary pack', () => {
    const model = world();
    const ctx = createTestContext(model);
    ctx.onRender = renderScreen;
    for (const kind of ['places', 'routes', 'events', 'items']) {
        ctx.select(kind);
        // The Events section is the Timeline now: its heading changed with its name.
        assert.ok(ctx.main.textContent.includes(kind === 'events' ? 'Timeline' : kind[0].toUpperCase() + kind.slice(1)));
    }
    ctx.select('settings');
    const paths = ctx.main.querySelectorAll('textarea').map(node => JSON.parse(node.getAttribute('data-path')).join('.'));
    assert.ok(paths.includes('calendar'));
    assert.ok(paths.includes('weather'));
    assert.ok(!paths.some(path => path.startsWith('content.rules')));
});

test('lore import still adds a narrative person to an ordinary pack', () => {
    const model = openPack({ id: 'world', version: '1.0.0', name: 'World', requires: { storyBlock: '^2' }, content: {} });
    const result = acceptLoreDraft(model, { kind: 'creatures', name: 'Fenna', slug: 'fenna', aliases: [], content: 'A keeper.', region: '' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.model.validation.ok, true, JSON.stringify(result.model.validation.errors));
    assert.equal(result.model.document.content.creatures[0].name, 'Fenna');
});
