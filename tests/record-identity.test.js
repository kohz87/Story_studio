// Records are told apart by Story Block's own key: a slug, or else the slug of the name (routes: of from, to and kind).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePack, slugify } from '../vendor/story-block/src/v2/packs/index.js';
import { openPack } from '../src/model.js';
import { add, remove, renameId, setField } from '../src/edits.js';
import { KINDS, records, identity } from '../src/records.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { goToProblem } from '../src/screens/problems.js';
import { worldPack } from './fixtures/world.js';

const bluewatch = () => JSON.parse(readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8'));

function controls(ctx, tag, key) {
    return ctx.inspector.querySelectorAll(tag).filter(node => {
        const raw = node.getAttribute('data-path');
        return raw && JSON.parse(raw).at(-1) === key;
    });
}
function rename(ctx, key, value) {
    const input = controls(ctx, 'input', key)[0];
    input.value = value;
    input.dispatchEvent({ type: 'change', target: input });
}
const pressed = ctx => ctx.main.querySelectorAll('.record-card').filter(card => card.getAttribute('aria-pressed') === 'true');
const names = (model, kind) => records(model, kind).map(record => record.name);

// A pack shaped like Bluewatch: items and places carry a name and no slug, id or def.
function nameKeyedPack() {
    const pack = worldPack();
    pack.content.items = [
        { name: 'Cane Blade', kind: 'equipment', rarity: 'common', slot: 'weapon' },
        { name: 'Patched Oilcloth Coat', kind: 'equipment', rarity: 'common', slot: 'body' },
        { name: 'Knife', kind: 'equipment', rarity: 'common', slot: 'weapon' },
    ];
    pack.content.places = [
        { name: 'Bluewatch Village', x: 1, y: 1 },
        { name: 'Auvoth', x: 2, y: 2 },
        { name: "Hollin's Reach", x: 3, y: 3 },
    ];
    pack.content.routes = [{ from: 'Auvoth', to: "Hollin's Reach", kind: 'road' }];
    pack.content.shops = [];
    pack.content.recipes = [];
    return pack;
}

test('identity follows each kind\'s key rule', () => {
    const cases = [
        ['items', { slug: 'iron', name: 'Iron Sword' }, 'iron'],
        ['items', { name: 'Iron Sword (old)' }, 'iron-sword-old'],
        ['places', { name: "Hollin's Reach" }, 'hollin-s-reach'],
        ['creatures', { name: 'Cave Troll' }, 'cave-troll'],
        ['quests', { name: 'Find the Ferry' }, 'find-the-ferry'],
        ['shops', { name: 'Tally & Co.' }, 'tally-co'],
        ['recipes', { name: 'Hardtack' }, 'hardtack'],
        ['legacySkills', { name: 'Lockpicking' }, 'lockpicking'],
        ['races', { id: 'elf', name: 'Elf' }, 'elf'],
        ['races', { name: 'Half Elf' }, 'half-elf'],
        ['talents', { name: 'Keen Eyed' }, 'keen-eyed'],
        ['presets', { id: 'ranger', name: 'Ranger' }, 'ranger'],
        ['events', { id: 'storm', when: 'x', cue: 'y' }, 'storm'],
        ['events', { slug: 'storm' }, 'storm'],
        ['events', { name: 'Storm' }, ''],
        ['routes', { from: 'Auvoth', to: 'Bluewatch Village', kind: 'river' }, 'auvoth-bluewatch-village-river'],
        ['routes', { slug: 'ferry', from: 'A', to: 'B', kind: 'river' }, 'ferry'],
        ['markets', { type: 'town', buy: 1 }, 'town'],
        ['markets', { tag: 'coastal', prices: {} }, 'coastal'],
    ];
    for (const [kind, record, expected] of cases) assert.equal(identity(record, kind), expected, `${kind} ${JSON.stringify(record)}`);
    // A slug always wins over the name.
    assert.equal(identity({ slug: 'mine', name: 'Other' }, 'places'), 'mine');
    // Nothing to key on, or nothing to read.
    for (const kind of KINDS) {
        assert.equal(identity({}, kind), '', kind);
        assert.equal(identity(null, kind), '', kind);
        assert.equal(identity('text', kind), '', kind);
    }
    // Two different names give two keys; the same name gives the same key.
    assert.notEqual(identity({ name: 'Knife' }, 'items'), identity({ name: 'Cane Blade' }, 'items'));
    assert.equal(identity({ name: 'Knife' }, 'items'), identity({ name: 'Knife' }, 'items'));
});

test('identity uses the vendored slugify, not its own', () => {
    for (const name of ['Café Noir', '  Edge  Case!! ', 'Ünï-cødé', 'x'.repeat(200)]) {
        assert.equal(identity({ name }, 'items'), slugify(name));
        assert.equal(identity({ name }, 'places'), slugify(name));
    }
});

test('identity agrees with the slug Story Block gives every record of the Bluewatch pack', () => {
    const raw = bluewatch();
    const checked = validatePack(raw);
    assert.equal(checked.ok, true);
    let compared = 0;
    for (const [content, kind] of [['events', 'events'], ['places', 'places'], ['routes', 'routes']]) {
        const given = raw.content[content];
        assert.ok(given.length > 0, content);
        given.forEach((record, i) => {
            assert.equal(identity(record, kind), checked.pack.content[content][i].slug, `${content}[${i}]`);
            compared++;
        });
    }
    assert.ok(compared > 200);
});

test('no two Bluewatch items, places or routes share a key, and none is empty', () => {
    const model = openPack(bluewatch());
    for (const kind of KINDS) {
        const keys = records(model, kind).map(record => identity(record, kind));
        assert.ok(keys.every(key => key !== ''), `${kind} has an empty key`);
        assert.equal(new Set(keys).size, keys.length, `${kind} keys collide`);
    }
});

test('the Bluewatch-shaped test pack is a valid pack', () => {
    assert.deepEqual(openPack(nameKeyedPack()).validation.errors, []);
});

test('reference index knows name-keyed items and places by their derived key', () => {
    const pack = nameKeyedPack();
    pack.content.shops = [{ slug: 'tally', name: 'Tally', place: 'pack.fixture/auvoth', kind: 'general-goods', stock: [{ item: 'knife', qty: 1, price: 2 }] }];
    const model = openPack(pack);
    assert.equal(model.validation.ok, true);
    const targets = model.references.filter(ref => ref.kind === 'shops').map(ref => [ref.id, ref.targetKind, ref.targetId]);
    assert.deepEqual(targets, [
        ['pack.fixture/tally', 'places', 'pack.fixture/auvoth'],
        ['pack.fixture/tally', 'items', 'pack.fixture/knife'],
    ]);
});

test('remove takes away only the record asked for, and an empty ID takes away nothing', () => {
    const model = openPack(nameKeyedPack());
    const none = remove(model, 'items', '');
    assert.equal(none.ok, false);
    assert.equal(none.errors[0].code, 'not-found');
    const plain = remove(model, 'items', 'patched-oilcloth-coat');
    assert.equal(plain.ok, true, 'an unreferenced item can be removed');
    const one = remove(model, 'items', identity(model.document.content.items[1], 'items'), { cascade: true });
    assert.equal(one.ok, true);
    assert.deepEqual(names(one.model, 'items'), ['Cane Blade', 'Knife']);
    const place = remove(model, 'places', 'auvoth');
    assert.equal(place.ok, false, 'a route still ends there');
    const away = remove(model, 'places', 'hollin-s-reach', { cascade: true });
    assert.equal(away.ok, true);
    assert.deepEqual(names(away.model, 'places'), ['Bluewatch Village', 'Auvoth']);
    assert.equal(records(away.model, 'routes').length, 0, 'the route that ended there goes with it');
});

test('add refuses a key that a name-keyed record already has', () => {
    const model = openPack(nameKeyedPack());
    const dup = add(model, 'items', { slug: 'knife', name: 'Another Knife', kind: 'goods', rarity: 'common' });
    assert.equal(dup.ok, false);
    assert.equal(dup.errors[0].code, 'dup-id');
    const fresh = add(model, 'items', { slug: 'rope', name: 'Rope', kind: 'goods', rarity: 'common' });
    assert.equal(fresh.ok, true);
});

test('renameId on a name-keyed place changes only that place and the routes that name it', () => {
    const model = openPack(nameKeyedPack());
    const result = renameId(model, 'places', 'auvoth', 'auvoth-port');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const [village, port, reach] = records(result.model, 'places');
    assert.equal(identity(village, 'places'), 'bluewatch-village');
    assert.equal(identity(port, 'places'), 'auvoth-port');
    assert.equal(identity(reach, 'places'), 'hollin-s-reach');
    assert.equal(port.name, 'Auvoth');
    assert.equal(records(result.model, 'routes')[0].from, 'auvoth-port');
    assert.equal(records(result.model, 'routes')[0].to, "Hollin's Reach");
});

test('setField refuses to change a name-keyed record\'s key through a whole-record replacement', () => {
    const model = openPack(nameKeyedPack());
    const same = setField(model, ['content', 'items', 1], { ...model.document.content.items[1], note: 'Oiled.' });
    assert.equal(same.ok, true, JSON.stringify(same.errors));
    const other = setField(model, ['content', 'items', 1], { ...model.document.content.items[1], name: 'Cloak' });
    assert.equal(other.ok, false);
    assert.equal(other.errors[0].code, 'identity-field');
});

for (const [kind, label, second] of [['items', 'Patched Oilcloth Coat', 'patched-oilcloth-coat'], ['places', 'Auvoth', 'auvoth']]) {
    test(`${kind}: selecting one name-keyed record highlights and inspects only that record`, () => {
        const ctx = createTestContext(nameKeyedPack());
        ctx.onRender = () => renderScreen(ctx);
        ctx.select(kind);
        const cards = ctx.main.querySelectorAll('.record-card');
        assert.equal(cards.length, 3);
        assert.deepEqual(cards.map(card => card.getAttribute('data-id')).length, 3);
        assert.equal(new Set(cards.map(card => card.getAttribute('data-id'))).size, 3);
        assert.equal(pressed(ctx).length, 0);
        assert.match(ctx.inspector.textContent, /Select a record/);

        ctx.main.querySelectorAll('.record-card')[1].click();
        assert.equal(ctx.selection.id, second);
        const after = ctx.main.querySelectorAll('.record-card');
        assert.deepEqual(after.map(card => card.getAttribute('aria-pressed')), ['false', 'true', 'false']);
        assert.equal(ctx.inspector.querySelector('h2').textContent, label);
        assert.equal(controls(ctx, 'input', 'name')[0].value, label);
        assert.doesNotMatch(ctx.inspector.textContent, /Select a record/);
    });

    test(`${kind}: renaming a name-keyed record keeps the selection on it`, () => {
        const ctx = createTestContext(nameKeyedPack());
        ctx.onRender = () => renderScreen(ctx);
        ctx.select(kind, second);
        rename(ctx, 'name', 'Renamed Thing');
        assert.equal(records(ctx.model, kind)[1].name, 'Renamed Thing');
        assert.equal(ctx.selection.id, 'renamed-thing');
        assert.deepEqual(ctx.main.querySelectorAll('.record-card').map(card => card.getAttribute('aria-pressed')), ['false', 'true', 'false']);
        assert.equal(ctx.inspector.querySelector('h2').textContent, 'Renamed Thing');
        ctx.history.undo(); ctx.changed();
        assert.equal(records(ctx.model, kind)[1].name, label);
    });

    test(`${kind}: a refused rename leaves the selection where it was`, () => {
        const ctx = createTestContext(nameKeyedPack());
        ctx.onRender = () => renderScreen(ctx);
        ctx.select(kind, second);
        rename(ctx, 'name', '');
        assert.equal(ctx.selection.id, second);
        assert.equal(records(ctx.model, kind)[1].name, label);
        assert.equal(pressed(ctx).length, 1);
    });

    test(`${kind}: Remove takes away only the selected name-keyed record`, () => {
        const ctx = createTestContext(nameKeyedPack());
        ctx.onRender = () => renderScreen(ctx);
        ctx.select(kind, second);
        const before = names(ctx.model, kind);
        const removeButton = ctx.inspector.querySelector('button.danger');
        removeButton.click();
        let dialog = ctx.overlays.querySelector('dialog');
        if (dialog) dialog.querySelector('button.primary').click();
        assert.deepEqual(names(ctx.model, kind), before.filter(name => name !== label));
        assert.equal(ctx.selection.id, null);
        assert.equal(pressed(ctx).length, 0);
    });
}

test('slug field of a name-keyed record renames it and the selection follows', () => {
    const ctx = createTestContext(nameKeyedPack());
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('places', 'auvoth');
    rename(ctx, 'slug', 'auvoth-port');
    assert.equal(records(ctx.model, 'places')[1].slug, 'auvoth-port');
    assert.equal(ctx.selection.id, 'auvoth-port');
    assert.deepEqual(ctx.main.querySelectorAll('.record-card').map(card => card.getAttribute('aria-pressed')), ['false', 'true', 'false']);
    assert.equal(records(ctx.model, 'routes')[0].from, 'auvoth-port');
});

test('routes are told apart by their ends, and editing an end keeps the selection on the route', () => {
    const pack = nameKeyedPack();
    pack.content.routes.push({ from: 'Bluewatch Village', to: 'Auvoth', kind: 'river' });
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('routes');
    ctx.main.querySelectorAll('.record-card')[1].click();
    assert.equal(ctx.selection.id, 'bluewatch-village-auvoth-river');
    assert.deepEqual(ctx.main.querySelectorAll('.record-card').map(card => card.getAttribute('aria-pressed')), ['false', 'true']);
    rename(ctx, 'kind', 'ferry');
    assert.equal(ctx.selection.id, 'bluewatch-village-auvoth-ferry');
    assert.deepEqual(ctx.main.querySelectorAll('.record-card').map(card => card.getAttribute('aria-pressed')), ['false', 'true']);
});

test('a record with no key is listed but cannot be picked, and never highlights the others', () => {
    const pack = nameKeyedPack();
    pack.content.items.push({ kind: 'goods', rarity: 'common' });
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items', 'knife');
    const cards = ctx.main.querySelectorAll('.record-card');
    assert.equal(cards.length, 4);
    assert.deepEqual(cards.map(card => card.getAttribute('aria-pressed')), ['false', 'false', 'true', 'false']);
    assert.equal(cards[3].disabled, true);
});

test('a problem in a name-keyed record opens that record', () => {
    const ctx = createTestContext(nameKeyedPack());
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items');
    goToProblem(ctx, { code: 'bad-record', path: 'content.places[2].x', message: 'x' });
    assert.equal(ctx.selection.kind, 'places');
    assert.equal(ctx.selection.id, 'hollin-s-reach');
    assert.deepEqual(ctx.main.querySelectorAll('.record-card').map(card => card.getAttribute('aria-pressed')), ['false', 'false', 'true']);
});

test('a problem is shown on the card of the record it belongs to and no other', () => {
    const pack = nameKeyedPack();
    pack.content.items[1].value = -1;
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('items');
    assert.deepEqual(ctx.main.querySelectorAll('.record-card').map(card => !!card.querySelector('.problem-dot')), [false, true, false]);
});
