// The twelve real Ersveil cast entries (written for the pack): they open, show, edit and export without losing a byte they were given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { setSchemaField } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import { castCheck, metersOf } from '../src/cast/data.js';
import { writeZip } from '../src/cast/zip.js';
import { readPackZip } from '../vendor/story-block/src/v2/packs/bundle.js';
import { createTestContext } from './helpers/dom.js';
import { castPack } from './fixtures/cast.js';

const entries = JSON.parse(readFileSync(new URL('./fixtures/ersveil-cast.json', import.meta.url), 'utf8'));
const text = JSON.stringify(castPack({ cast: entries }), null, 2) + '\n';

test('the twelve entries are accepted by Story Block’s checker and export as the very bytes they came in', () => {
    const model = openPack(text);
    assert.deepEqual(model.validation.errors, []);
    assert.equal(model.document.content.cast.length, 12);
    assert.equal(exportPack(model), text);
    assert.deepEqual(castCheck(model).filter(line => line.level === 'bad'), []);
});

test('an edit to one person leaves the other eleven exactly as they were, in the exported pack too', () => {
    const model = openPack(text);
    const edited = setSchemaField(model, ['content', 'cast', 3], { ...model.document.content.cast[3], voice: 'Quiet.' });
    assert.equal(edited.ok, true);
    const out = JSON.parse(exportPack(edited.model)).content.cast;
    assert.equal(out[3].voice, 'Quiet.');
    out.forEach((person, at) => { if (at !== 3) assert.deepEqual(person, entries[at]); });
    assert.equal(edited.undo() === model, true);
    assert.equal(exportPack(model), text);
});

test('every one of them has a form that opens with its meters, stages and secrets', () => {
    const ctx = createTestContext(openPack(text));
    ctx.onRender = renderScreen;
    ctx.select('cast');
    assert.equal(ctx.main.querySelectorAll('.record-card').length, 12);
    entries.forEach((person, at) => {
        ctx.select('cast', person.id);
        assert.equal(ctx.inspector.querySelector('h2').textContent, person.name);
        assert.equal(ctx.inspector.querySelectorAll('[data-secret]').length, person.secrets?.length ?? 0, person.id);
        assert.equal(ctx.inspector.querySelectorAll('[data-stage]').length, person.stages?.length ?? 0, person.id);
        assert.equal(ctx.inspector.querySelectorAll('.cf-error').length, 0, person.id);
        // Every meter the entry uses has a place to edit its starting value.
        for (const meter of metersOf(ctx.model, ctx.model.document.content.cast[at])) {
            if (person.meters?.[meter.id] !== undefined) assert.ok(ctx.inspector.querySelector(`[data-path='${JSON.stringify(['content', 'cast', at, 'meters', meter.id])}']`), `${person.id} ${meter.id}`);
        }
    });
});

test('the pack as a zip with its portraits opens back to the same text, as Story Block reads it', async () => {
    const names = [...new Set(entries.map(person => person.portrait).filter(Boolean))];
    const zip = await writeZip([{ name: 'pack.json', bytes: new TextEncoder().encode(text) }, ...names.map(name => ({ name: `portraits/${name}`, bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]) }))]);
    const read = await readPackZip(zip);
    assert.equal(read.ok, true, read.message);
    assert.equal(read.text, text);
    assert.deepEqual(read.files.map(file => file.name), names);
});

test('a secret with both rules opens, shows and exports as the very bytes it came in, edited elsewhere or not', () => {
    const both = JSON.parse(JSON.stringify(entries));
    both[0].secrets = [{ title: 'Two ways', text: 'Either opens it.', meter: 'trust', at: 90, when: 'Severa or an Inquest agent comes to Bluewatch' }, ...(both[0].secrets ?? [])].slice(0, 8);
    const bothText = JSON.stringify(castPack({ cast: both }), null, 2) + '\n';
    const model = openPack(bothText);
    assert.deepEqual(model.validation.errors, []);
    assert.equal(exportPack(model), bothText);
    const edited = setSchemaField(model, ['content', 'cast', 0, 'voice'], 'Low.');
    assert.equal(edited.ok, true);
    assert.deepEqual(JSON.parse(exportPack(edited.model)).content.cast[0].secrets[0], both[0].secrets[0]);
    const ctx = createTestContext(model);
    ctx.onRender = renderScreen;
    ctx.select('cast', both[0].id);
    assert.equal(ctx.inspector.querySelector(`[data-path='${JSON.stringify(['content', 'cast', 0, 'secrets', 0, 'when'])}']`).value, both[0].secrets[0].when);
    assert.equal(ctx.inspector.querySelector('[data-cf=preview] .cf-hint').textContent, 'Opens at Trust 90 or with the story');
});
