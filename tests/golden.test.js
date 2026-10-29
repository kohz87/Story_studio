import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack } from '../vendor/story-block/src/v2/packs/validate.js';
import { openPack, exportPack } from '../src/model.js';
import { setField } from '../src/edits.js';
import { createHistory } from '../src/history.js';

const source = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const pack = () => JSON.parse(source);
function parity(input, expected) {
    const checked = validatePack(input), model = openPack(input);
    assert.equal(checked.ok, expected, JSON.stringify(checked.errors));
    assert.equal(model.validation.ok, checked.ok);
    assert.deepEqual(model.validation.errors, checked.errors ?? []);
    if (expected) assert.equal(validatePack(exportPack(model)).ok, true);
    else assert.throws(() => exportPack(model));
    return model;
}

test('the open world retains original bytes and undo restores them', () => {
    const model = parity(source, true);
    assert.equal(exportPack(model), source);
    const history = createHistory(model);
    const edited = setField(model, ['name'], 'Edited world');
    assert.equal(edited.ok, true);
    assert.equal(edited.model.validation.ok, true);
    history.commit(edited);
    assert.equal(exportPack(history.undo()), source);
});

test('calendar, weather, places, routes, events and data modules survive edit and export', async t => {
    const cases = [
        [['calendar', 'era'], 'New Era'],
        [['weather', 'tables', 0, 'weather', 0], 'a cold wind'],
        [['content', 'places', 0, 'note'], 'A harbor'],
        [['content', 'routes', 0, 'note'], 'A road'],
        [['content', 'events', 0, 'cue'], 'A bell sounds'],
        [['content', 'dataModules', 0, 'name'], 'Standing'],
    ];
    for (const [path, value] of cases) await t.test(path.join('.'), () => {
        const original = openPack(source);
        const edited = setField(original, path, value);
        assert.equal(edited.ok, true, JSON.stringify(edited.errors));
        const reopened = parity(exportPack(edited.model), true);
        assert.deepEqual(path.reduce((node, key) => node[key], reopened.document), value);
        assert.equal(exportPack(edited.undo()), source);
    });
});

test('Studio and Story Block reject the same invalid worlds and removed rules content', async t => {
    const cases = [
        ['unknown envelope', p => { p.unrecognized = true; }],
        ['unknown content', p => { p.content.unrecognized = []; }],
        ['removed rules', p => { p.content.rules = [{ slug: 'rules', schema: 2 }]; }],
        ['bad coordinate', p => { p.content.places[0].x = 'invalid'; }],
        ['unsafe markup', p => { p.description = '<script>bad</script>'; }],
        ['bad weather', p => { p.weather = { tables: [] }; }],
    ];
    for (const [name, change] of cases) await t.test(name, () => {
        const candidate = pack(); change(candidate);
        parity(candidate, false); parity(JSON.stringify(candidate), false);
    });
});
