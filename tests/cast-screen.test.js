// The Cast part, driven through the real controls on the shared test DOM: list, form, edits, undo, problems and the check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack, withPortraits } from '../src/model.js';
import { renderScreen } from '../src/screens/index.js';
import { goToProblem } from '../src/screens/problems.js';
import { createTestContext } from './helpers/dom.js';
import { readFileSync } from 'node:fs';
import { castEntries, castPack } from './fixtures/cast.js';
import { webpBytes } from './helpers/images.js';

function open(pack = castPack(), id = 'fenna') {
    const ctx = createTestContext(openPack(pack));
    ctx.onRender = renderScreen;
    ctx.select('cast', id);
    return ctx;
}
const cast = ctx => ctx.model.document.content.cast;
const path = (...keys) => `[data-path='${JSON.stringify(['content', 'cast', ...keys])}']`;
const control = (ctx, ...keys) => {
    const found = ctx.inspector.querySelector(path(...keys));
    assert.ok(found, `no control for ${keys.join('.')}`);
    return found;
};
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent({ type: 'change' }); };
const edit = (ctx, keys, value) => change(control(ctx, ...keys), value);
const buttons = (root, label) => root.querySelectorAll('button').filter(node => node.textContent === label || node.getAttribute('aria-label') === label);
const press = (root, label) => { const [node] = buttons(root, label); assert.ok(node, `no button ${label}`); assert.equal(node.disabled, false, `${label} is disabled`); node.click(); };
const legends = ctx => ctx.inspector.querySelectorAll('legend').map(node => node.textContent);
const undo = ctx => { ctx.history.undo(); ctx.render(); };

test('the list shows each person with a face, one line, where they start and chips', () => {
    const ctx = open();
    ctx.select('cast');
    const cards = ctx.main.querySelectorAll('button.record-card');
    assert.equal(cards.length, 2);
    assert.equal(ctx.main.querySelector('h1').textContent, 'Cast');
    assert.equal(ctx.main.querySelector('.records-subtitle').textContent, '2 people · hidden from players until met');
    assert.equal(cards[0].querySelector('.record-card-name').textContent, 'Fenna');
    assert.equal(cards[0].querySelector('.record-card-meta').textContent, 'fenna · Runs the night ferry between Haven and Mill. · starts at Haven');
    assert.deepEqual(cards[0].querySelectorAll('.cc-tag').map(tag => tag.textContent), ['3 secrets', 'drawn to 2', 'portrait missing']);
    assert.equal(cards[0].querySelector('.cast-face').textContent, 'F');
    assert.equal(cards[1].querySelectorAll('.cc-tag').length, 0);
    assert.equal(buttons(ctx.main, '+ Add person').length, 1);
    assert.match(ctx.inspector.textContent, /Select a person from the list/);
});

test('a held picture is the card’s face and its size is a chip', () => {
    const model = withPortraits(openPack(castPack()), [['fenna.webp', Object.freeze({ bytes: webpBytes(), type: 'webp', width: 48, height: 60 })]]);
    const ctx = createTestContext(model);
    ctx.onRender = renderScreen;
    ctx.select('cast', 'fenna');
    const card = ctx.main.querySelector('button.record-card');
    assert.match(card.querySelector('img').getAttribute('src'), /^data:image\/webp;base64,/);
    assert.match(card.querySelectorAll('.cc-tag').at(-1).textContent, /^portrait \d+ KB$/);
    assert.match(ctx.inspector.querySelector('[data-portrait-facts]').textContent, /^fenna\.webp · 48 × 60 · \d+ KB\. Pictures are made smaller automatically to fit 150 KB; JPEG, PNG or WebP\.$/);
    assert.equal(ctx.inspector.querySelector('.cf-face img').getAttribute('alt'), 'Fenna\'s portrait');
});

test('an empty cast says what a person is', () => {
    const ctx = open(castPack({ cast: [] }), null);
    assert.match(ctx.main.textContent, /No one in the cast yet/);
    assert.equal(ctx.main.querySelector('.records-subtitle').textContent, '0 people · hidden from players until met');
});

test('the form is in the mockup’s order', () => {
    const ctx = open();
    assert.deepEqual(legends(ctx), ['Who they are', 'How they behave', 'Portrait', 'Where their story starts', 'Drawn to (optional)', 'Relationship at the start', 'Before they are met', 'Signature skills · 0 of 8', 'Secrets · 3 of 8']);
    const labels = ctx.inspector.querySelectorAll('fieldset')[0].querySelectorAll('label.field').map(node => node.childNodes[0].textContent);
    assert.deepEqual(labels, ['Name', 'Also called', 'In one line', 'Look', 'Usually wears', 'Voice', 'Background', 'Key']);
    assert.match(ctx.inspector.textContent, /Hidden from players until they meet Fenna; then NPC State Delta makes the dossier from this, at once\./);
    assert.equal(ctx.inspector.querySelector('h2').textContent, 'Fenna');
});

test('every limit is shown as a count that goes red past Story Block’s number', () => {
    const ctx = open();
    const look = control(ctx, 0, 'look');
    const count = look.parentElement.parentElement.querySelector('.tl-count');
    assert.equal(count.textContent, `${[...castEntries()[0].look].length} / 600`);
    look.value = 'x'.repeat(601);
    look.dispatchEvent({ type: 'input' });
    assert.equal(count.textContent, '601 / 600');
    assert.ok(count.classList.contains('cf-over'));
});

test('Usually wears sits right under Look, with both hints, a 300 counter and no placeholder', () => {
    const ctx = open();
    const labels = ctx.inspector.querySelectorAll('fieldset')[0].querySelectorAll('label.field').map(node => node.childNodes[0].textContent);
    assert.equal(labels.indexOf('Usually wears'), labels.indexOf('Look') + 1);
    const wears = control(ctx, 0, 'wears');
    assert.equal(wears.tagName.toLowerCase(), 'textarea');
    assert.equal(wears.value, '');
    assert.equal(wears.parentElement.parentElement.classList.contains('wide'), true);
    assert.equal(wears.parentElement.parentElement.querySelector('.tl-count').textContent, '0 / 300');
    assert.equal(wears.parentElement.parentElement.querySelector('.cf-hint').textContent, 'Clothes, armour and gear they usually have on. NPC State Delta shows it as their current appearance until the story changes it.');
    assert.equal(control(ctx, 0, 'look').parentElement.parentElement.querySelector('.cf-hint').textContent, 'Build, face, hair, eyes, marks: what stays the same whatever they wear. NPC State Delta shows it as their physical appearance.');
});

test('editing Usually wears writes wears, the counter goes red past 300, and emptying it removes the key', () => {
    const ctx = open();
    edit(ctx, [0, 'wears'], 'Grey veil,\n patched habit.');
    assert.equal(cast(ctx)[0].wears, 'Grey veil, patched habit.');
    assert.equal(ctx.model.validation.ok, true);
    const wears = control(ctx, 0, 'wears');
    const count = wears.parentElement.parentElement.querySelector('.tl-count');
    assert.equal(count.textContent, '25 / 300');
    wears.value = 'x'.repeat(301);
    wears.dispatchEvent({ type: 'input' });
    assert.equal(count.textContent, '301 / 300');
    assert.ok(count.classList.contains('cf-over'));
    edit(ctx, [0, 'wears'], 'x'.repeat(301));
    assert.equal(ctx.model.validation.ok, false);
    edit(ctx, [0, 'wears'], '');
    assert.equal('wears' in cast(ctx)[0], false);
    assert.equal(ctx.model.validation.ok, true);
});

test('a pack with wears opens, shows it, and exports it again after an edit elsewhere', () => {
    const pack = castPack({ cast: castEntries().map((person, at) => (at === 0 ? { ...person, wears: 'Oilskin coat; boat hook.' } : person)) });
    const ctx = open(pack);
    assert.deepEqual(ctx.model.validation.errors, []);
    assert.equal(control(ctx, 0, 'wears').value, 'Oilskin coat; boat hook.');
    edit(ctx, [0, 'voice'], 'Quiet.');
    const out = JSON.parse(exportPack(ctx.model)).content.cast;
    assert.equal(out[0].wears, 'Oilskin coat; boat hook.');
    assert.equal(out[0].voice, 'Quiet.');
    assert.equal('wears' in out[1], false);
    assert.equal(exportPack(openPack(exportPack(ctx.model))), exportPack(ctx.model));
});

test('an edit is one undo step, and undo and redo bring the text back', () => {
    const ctx = open();
    edit(ctx, [0, 'look'], 'Grey braid, bad knee.');
    assert.equal(cast(ctx)[0].look, 'Grey braid, bad knee.');
    assert.equal(ctx.history.canUndo, true);
    undo(ctx);
    assert.equal(cast(ctx)[0].look, castEntries()[0].look);
    ctx.history.redo();
    assert.equal(cast(ctx)[0].look, 'Grey braid, bad knee.');
});

test('line breaks and runs of spaces become one space, as Story Block reads them', () => {
    const ctx = open();
    edit(ctx, [0, 'personality'], '  Stubborn,\n\n practical.  ');
    assert.equal(cast(ctx)[0].personality, 'Stubborn, practical.');
});

test('clearing an optional text removes it; clearing a required one shows Story Block’s own message', () => {
    const ctx = open();
    edit(ctx, [0, 'voice'], '');
    assert.equal('voice' in cast(ctx)[0], false);
    edit(ctx, [0, 'look'], '');
    assert.equal('look' in cast(ctx)[0], false);
    assert.equal(ctx.model.validation.ok, false);
    const note = control(ctx, 0, 'look').parentElement.parentElement.querySelector('.cf-error');
    assert.match(note.textContent, /Cast "Fenna": look must be text of 1 to 600 characters\./);
    assert.equal(control(ctx, 0, 'look').getAttribute('aria-invalid'), 'true');
    ctx.select('cast');
    assert.ok(ctx.main.querySelector('.record-card[data-has-problem=true]'));
    assert.match(ctx.model.validation.errors.map(error => error.message).join(' '), /look must be text/);
});

test('markup characters are refused by the checker and the message sits under the field', () => {
    const ctx = open();
    edit(ctx, [0, 'history'], 'He said <hello>');
    assert.match(control(ctx, 0, 'history').parentElement.parentElement.querySelector('.cf-error').textContent, /plain text: no < > \{ \}/);
    assert.match(ctx.inspector.querySelector('.warning').textContent, /plain text/);
});

test('also called takes names with commas, and clearing it removes the list', () => {
    const ctx = open();
    edit(ctx, [0, 'aliases'], 'the ferrywoman, Old Fen ,, ');
    assert.deepEqual(cast(ctx)[0].aliases, ['the ferrywoman', 'Old Fen']);
    edit(ctx, [0, 'aliases'], '');
    assert.equal('aliases' in cast(ctx)[0], false);
});

test('a new person is added with placeholders, selected, and takes an ID from the name once it is named, in one undo step', () => {
    const ctx = open();
    press(ctx.main, '+ Add person');
    assert.equal(cast(ctx).length, 3);
    assert.equal(ctx.selection.id, 'new-person');
    assert.equal(cast(ctx)[2].start.place, 'Haven');
    assert.equal(ctx.model.validation.ok, true);
    const steps = ctx.history.canUndo;
    edit(ctx, [2, 'name'], 'Old Marta');
    assert.equal(cast(ctx)[2].id, 'old-marta');
    assert.equal(cast(ctx)[2].name, 'Old Marta');
    assert.equal(ctx.selection.id, 'old-marta');
    assert.equal(ctx.inspector.querySelector('h2').textContent, 'Old Marta');
    undo(ctx);
    assert.equal(cast(ctx)[2].id, 'new-person');
    assert.equal(cast(ctx)[2].name, 'New person');
    assert.equal(steps, true);
});

test('a name that is already taken keeps the placeholder ID, and Story Block says the name is taken', () => {
    const ctx = open();
    press(ctx.main, '+ Add person');
    edit(ctx, [2, 'name'], 'Fenna');
    assert.equal(cast(ctx)[2].id, 'new-person');
    assert.match(ctx.model.validation.errors.map(error => error.message).join(' '), /already a name or alias of another person/);
});

test('once a person has an ID of their own, renaming them does not move it', () => {
    const ctx = open();
    edit(ctx, [0, 'name'], 'Fenna of the Ferry');
    assert.equal(cast(ctx)[0].id, 'fenna');
    assert.equal(ctx.selection.id, 'fenna');
});

test('the key can be changed, and a bad or taken one is refused with a message', () => {
    const ctx = open();
    edit(ctx, [0, 'id'], 'ferry-fenna');
    assert.equal(cast(ctx)[0].id, 'ferry-fenna');
    assert.equal(ctx.selection.id, 'ferry-fenna');
    edit(ctx, [0, 'id'], 'sera');
    assert.equal(cast(ctx)[0].id, 'ferry-fenna');
    assert.match(ctx.notifications.at(-1), /dup-id: Duplicate ID: sera/);
    edit(ctx, [0, 'id'], 'Not Valid');
    assert.equal(cast(ctx)[0].id, 'ferry-fenna');
    assert.match(ctx.notifications.at(-1), /bad-id/);
});

test('the place is picked from the pack’s places; one that is not there stays visible and flagged', () => {
    const ctx = open();
    const select = control(ctx, 0, 'start', 'place');
    assert.equal(select.tagName, 'SELECT');
    assert.deepEqual(select.querySelectorAll('option').map(option => option.textContent), ['Haven', 'Mill']);
    change(select, 'Mill');
    assert.equal(cast(ctx)[0].start.place, 'Mill');
    assert.match(ctx.inspector.textContent, /From this pack’s places \(2\)\./);
    const odd = open(castPack({ cast: [{ ...castEntries()[1], start: { place: 'Nowhere', goal: 'Wander.' } }] }), 'sera');
    assert.deepEqual(control(odd, 0, 'start', 'place').querySelectorAll('option').map(option => option.textContent), ['Nowhere (not a place of this pack)', 'Haven', 'Mill']);
    const none = open(castPack({ places: [] }));
    assert.equal(control(none, 0, 'start', 'place').tagName, 'INPUT');
    assert.match(none.inspector.textContent, /This pack has no places yet; write the name of one\./);
});

test('routine and goal are saved, the routine can be cleared, the goal cannot be left empty', () => {
    const ctx = open();
    edit(ctx, [0, 'start', 'routine'], 'Mends nets by day.');
    assert.equal(cast(ctx)[0].start.routine, 'Mends nets by day.');
    edit(ctx, [0, 'start', 'routine'], '');
    assert.equal('routine' in cast(ctx)[0].start, false);
    edit(ctx, [0, 'start', 'goal'], '');
    assert.equal(ctx.model.validation.ok, false);
    assert.match(ctx.model.validation.errors.map(error => error.message).join(' '), /start\.goal|start must say/);
});

test('drawn to: chips are added with the field, removed with the cross, never duplicated, and stop at six', () => {
    const ctx = open();
    const chips = () => ctx.inspector.querySelectorAll('.cf-chip').map(chip => chip.childNodes[0].textContent);
    assert.deepEqual(chips(), ['the weir', 'a flood on the river']);
    edit(ctx, [0, 'drawnTo'], 'anyone hiring the night ferry');
    assert.deepEqual(cast(ctx)[0].drawnTo, ['the weir', 'a flood on the river', 'anyone hiring the night ferry']);
    press(ctx.inspector, 'Remove the weir');
    assert.deepEqual(cast(ctx)[0].drawnTo, ['a flood on the river', 'anyone hiring the night ferry']);
    for (const phrase of ['one', 'two', 'three', 'four']) edit(ctx, [0, 'drawnTo'], phrase);
    assert.equal(cast(ctx)[0].drawnTo.length, 6);
    assert.equal(control(ctx, 0, 'drawnTo').disabled, true);
    assert.equal(chips().length, 6);
    for (const chip of ctx.inspector.querySelectorAll('.cf-chip')) assert.equal(chip.querySelectorAll('button').length, 1);
    while (cast(ctx)[0].drawnTo?.length) press(ctx.inspector, `Remove ${cast(ctx)[0].drawnTo[0]}`);
    assert.equal('drawnTo' in cast(ctx)[0], false);
});

test('a drawn-to phrase entered with Enter is saved once and the next field starts empty', () => {
    const ctx = open();
    ctx.doc.defaultView = { Event: class { constructor(type) { this.type = type; } } };
    const input = control(ctx, 0, 'drawnTo');
    input.value = 'the old bridge';
    input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.deepEqual(cast(ctx)[0].drawnTo, ['the weir', 'a flood on the river', 'the old bridge']);
    assert.equal(control(ctx, 0, 'drawnTo').value, '');
});

test('list actions after a field edit use the current person while the redraw is pending', () => {
    const people = castEntries();
    people[0].behaviour = ['Care: high - watches the river'];
    people[0].mannerisms = ['Hums softly'];
    const ctx = open(castPack({ cast: people }));
    const named = label => ctx.inspector.querySelectorAll('input').find(node => node.getAttribute('aria-label') === label);
    const effect = named('Effect 1');
    const habit = named('Mannerism 1');
    const drawn = named('Add something they are drawn to');
    const addLever = buttons(ctx.inspector, '+ Add a lever')[0];
    const addHabit = buttons(ctx.inspector, '+ Add a mannerism')[0];
    const remove = buttons(ctx.inspector, 'Remove the weir')[0];
    ctx.render = () => {};
    change(effect, 'helps everyone');
    addLever.click();
    change(habit, 'Hums at dusk');
    addHabit.click();
    change(drawn, 'the old bridge');
    remove.click();
    assert.equal(cast(ctx)[0].behaviour[0], 'Care: high - helps everyone');
    assert.equal(cast(ctx)[0].behaviour.length, 2);
    assert.deepEqual(cast(ctx)[0].mannerisms, ['Hums at dusk', '']);
    assert.deepEqual(cast(ctx)[0].drawnTo, ['a flood on the river', 'the old bridge']);
});

test('the meter preset is picked from the pack’s own and the built-in ones; the starting values follow it', () => {
    const pack = castPack();
    pack.content.meterPresets = [{ id: 'regard', title: 'Regard', meters: [{ id: 'esteem', name: 'Esteem', min: 0, max: 100, start: 0 }] }];
    const ctx = open(pack);
    const preset = control(ctx, 0, 'meters', 'preset');
    assert.deepEqual(preset.querySelectorAll('option').map(option => option.textContent), [
        'Default (Trust, Affection, Desire, Tension)', 'Regard (Esteem)', 'Companion (Loyalty) · built in', 'Rival (Respect, Rivalry) · built in', 'Mentor (Approval) · built in']);
    assert.equal(preset.value, 'companion');
    change(preset, 'regard');
    assert.equal(cast(ctx)[0].meters.preset, 'regard');
    assert.ok(control(ctx, 0, 'meters', 'esteem'));
    change(control(ctx, 0, 'meters', 'preset'), '');
    assert.equal('preset' in cast(ctx)[0].meters, false);
    assert.equal(cast(ctx)[0].meters.trust, 10);
});

test('a starting value is a whole number from -1000 to 1000, and blank takes it away', () => {
    const ctx = open();
    edit(ctx, [0, 'meters', 'affection'], '25');
    assert.deepEqual(cast(ctx)[0].meters, { preset: 'companion', trust: 10, affection: 25 });
    edit(ctx, [0, 'meters', 'affection'], '1.5');
    assert.equal(cast(ctx)[0].meters.affection, 25);
    assert.match(ctx.notifications.at(-1), /bad-value: Enter a whole number/);
    edit(ctx, [0, 'meters', 'affection'], '1001');
    assert.equal(ctx.model.validation.ok, false);
    assert.match(ctx.model.validation.errors.map(error => error.message).join(' '), /whole number from -1000 to 1000/);
    edit(ctx, [0, 'meters', 'affection'], '');
    edit(ctx, [0, 'meters', 'trust'], '');
    assert.deepEqual(cast(ctx)[0].meters, { preset: 'companion' });
    edit(ctx, [0, 'meters', 'preset'], '');
    assert.equal('meters' in cast(ctx)[0], false);
});

test('stages: added with a rule, named (the ID follows the name), given more rules, and removed', () => {
    const ctx = open();
    press(ctx.inspector, '+ Add stage');
    assert.deepEqual(cast(ctx)[0].stages.at(-1), { id: 'stage', name: 'New stage', needs: [{ meter: 'trust', at: 20 }] });
    edit(ctx, [0, 'stages', 1, 'name'], 'Calls you crew');
    assert.equal(cast(ctx)[0].stages[1].id, 'calls-you-crew');
    edit(ctx, [0, 'stages', 1, 'needs', 0, 'at'], '60');
    assert.equal(cast(ctx)[0].stages[1].needs[0].at, 60);
    change(control(ctx, 0, 'stages', 1, 'needs', 0, 'meter'), 'affection');
    assert.equal(cast(ctx)[0].stages[1].needs[0].meter, 'affection');
    press(ctx.inspector.querySelectorAll('[data-stage]')[1], '+ Add rule');
    assert.equal(cast(ctx)[0].stages[1].needs.length, 2);
    press(ctx.inspector, 'Remove stage 2 rule 2');
    assert.equal(cast(ctx)[0].stages[1].needs.length, 1);
    assert.equal(buttons(ctx.inspector, 'Remove stage 2 rule 1')[0].disabled, true);
    edit(ctx, [0, 'stages', 1, 'milestone'], 'saw the weir opened');
    assert.equal(cast(ctx)[0].stages[1].milestone, 'saw the weir opened');
    edit(ctx, [0, 'stages', 1, 'milestone'], '');
    assert.equal('milestone' in cast(ctx)[0].stages[1], false);
    press(ctx.inspector, 'Remove stage 2');
    assert.equal(cast(ctx)[0].stages.length, 1);
    press(ctx.inspector, 'Remove stage 1');
    assert.equal('stages' in cast(ctx)[0], false);
    assert.equal(ctx.model.validation.ok, true);
});

test('at most eight stages', () => {
    const ctx = open();
    for (let n = 0; n < 7; n++) press(ctx.inspector, '+ Add stage');
    assert.equal(cast(ctx)[0].stages.length, 8);
    assert.equal(buttons(ctx.inspector, '+ Add stage')[0].disabled, true);
    assert.equal(new Set(cast(ctx)[0].stages.map(stage => stage.id)).size, 8);
});

test('own fields are one per line as “Name: value”; a line without a colon is refused and nothing changes', () => {
    const ctx = open();
    assert.equal(control(ctx, 0, 'fields').value, 'Trade: Night ferry');
    edit(ctx, [0, 'fields'], 'Trade: Night ferry\nHome: Haven docks\nRank: Guild: associate');
    assert.deepEqual(cast(ctx)[0].fields, { Trade: 'Night ferry', Home: 'Haven docks', Rank: 'Guild: associate' });
    edit(ctx, [0, 'fields'], 'no colon here');
    assert.match(ctx.notifications.at(-1), /Write each field as “Name: value”/);
    assert.equal(Object.keys(cast(ctx)[0].fields).length, 3);
    edit(ctx, [0, 'fields'], '');
    assert.equal('fields' in cast(ctx)[0], false);
});

test('dying before they are met is off by default and a plain tick', () => {
    const ctx = open();
    const box = control(ctx, 0, 'canDieUnmet');
    assert.equal(box.checked, false);
    box.checked = true;
    change(box);
    assert.equal(cast(ctx)[0].canDieUnmet, true);
    assert.match(ctx.inspector.textContent, /Fenna may die off-screen before the party meets them/);
    assert.match(ctx.inspector.textContent, /Off by default, for every player’s setting\./);
    const again = control(ctx, 0, 'canDieUnmet');
    again.checked = false;
    change(again);
    assert.equal('canDieUnmet' in cast(ctx)[0], false);
});

test('secrets: edited, switched between a meter and a story event, reordered, added up to eight and removed', () => {
    const ctx = open();
    edit(ctx, [0, 'secrets', 0, 'title'], 'The debt');
    assert.equal(cast(ctx)[0].secrets[0].title, 'The debt');
    edit(ctx, [0, 'secrets', 0, 'at'], '30');
    assert.equal(cast(ctx)[0].secrets[0].at, 30);
    change(control(ctx, 0, 'secrets', 0, 'meter'), 'affection');
    assert.equal(cast(ctx)[0].secrets[0].meter, 'affection');
    press(ctx.inspector.querySelectorAll('[data-secret]')[0], 'on a story event');
    assert.deepEqual(Object.keys(cast(ctx)[0].secrets[0]).sort(), ['text', 'title', 'when']);
    edit(ctx, [0, 'secrets', 0, 'when'], 'the party finds the ledger');
    assert.equal(cast(ctx)[0].secrets[0].when, 'the party finds the ledger');
    press(ctx.inspector.querySelectorAll('[data-secret]')[0], 'at a meter');
    assert.deepEqual(Object.keys(cast(ctx)[0].secrets[0]).sort(), ['at', 'meter', 'text', 'title']);
    assert.equal(ctx.model.validation.ok, true);

    press(ctx.inspector, 'Move secret 1 down');
    assert.deepEqual(cast(ctx)[0].secrets.map(secret => secret.title), ['The weir night', 'The debt', 'Who paid her']);
    assert.equal(buttons(ctx.inspector, 'Move secret 1 up')[0].disabled, true);
    assert.equal(buttons(ctx.inspector, 'Move secret 3 down')[0].disabled, true);
    press(ctx.inspector, 'Move secret 3 up');
    assert.deepEqual(cast(ctx)[0].secrets.map(secret => secret.title), ['The weir night', 'Who paid her', 'The debt']);

    while (cast(ctx)[0].secrets.length < 8) press(ctx.inspector, '+ Add secret');
    assert.equal(legends(ctx).at(-1), 'Secrets · 8 of 8');
    assert.equal(buttons(ctx.inspector, '+ Add secret')[0].disabled, true);
    assert.equal(ctx.model.validation.ok, true);
    press(ctx.inspector, 'Remove secret 8');
    assert.equal(cast(ctx)[0].secrets.length, 7);
});

test('the player view shows a blank bar and the rule for each hidden secret and never the event’s words', () => {
    const ctx = open();
    const preview = ctx.inspector.querySelector('[data-cf=preview]');
    assert.equal(preview.querySelector('b').textContent, 'What the player sees after meeting Fenna');
    assert.equal(preview.querySelectorAll('.cf-bar').length, 3);
    assert.deepEqual(preview.querySelectorAll('.cf-hint').map(node => node.textContent), ['Opens at Trust 20', 'Opens at Trust 60', 'Opens with the story']);
    assert.doesNotMatch(preview.textContent, /ledger|smugglers/);
    edit(ctx, [0, 'meters', 'trust'], '25');
    const after = ctx.inspector.querySelector('[data-cf=preview]');
    assert.equal(after.querySelectorAll('.cf-bar').length, 2);
    assert.equal(after.querySelector('.cf-open b').textContent, 'Her husband’s debt');
    assert.equal(after.querySelector('.cf-tag').textContent, 'Opened · Trust 20');
});

test('a secret with no rule shows Story Block’s message on its card', () => {
    const cast = castEntries();
    cast[0].secrets = [{ title: 'x', text: 'y' }];
    const ctx = open(castPack({ cast }));
    assert.match(ctx.inspector.querySelector('[data-secret]').textContent, /needs a rule: a meter \("meter" and "at"\), a story event \("when"\), or both/);
});

test('removing a person takes them out in one undoable step and clears the selection', () => {
    const ctx = open();
    press(ctx.inspector, 'Remove…');
    assert.deepEqual(cast(ctx).map(person => person.id), ['sera']);
    assert.equal(ctx.selection.id, null);
    undo(ctx);
    assert.deepEqual(cast(ctx).map(person => person.id), ['fenna', 'sera']);
});

test('a problem in the Problems list goes to the field it names', () => {
    const ctx = open();
    edit(ctx, [0, 'look'], '<');
    ctx.select('cast');
    const issue = ctx.model.validation.errors.find(error => error.path === 'content.cast[0].look');
    assert.ok(issue);
    goToProblem(ctx, issue);
    assert.equal(ctx.selection.id, 'fenna');
    assert.equal(ctx.doc.activeElement, control(ctx, 0, 'look'));
    const secret = open(castPack({ cast: [{ ...castEntries()[0], secrets: [{ title: 'a', text: '>', meter: 'trust', at: 5 }] }] }));
    goToProblem(secret, secret.model.validation.errors.find(error => /secrets\[0\]\.text/.test(error.path)));
    assert.equal(secret.doc.activeElement, control(secret, 0, 'secrets', 0, 'text'));
});

test('the rail knows nothing of the cast’s pictures: a swap of a picture is undone with the edit that made it', () => {
    const ctx = open();
    const picture = Object.freeze({ bytes: webpBytes(), type: 'webp', width: 48, height: 60 });
    // What choosing a picture commits: the name in the pack, the bytes beside it.
    const result = { ok: true, model: withPortraits(openPack({ ...ctx.model.document, content: { ...ctx.model.document.content, cast: castEntries().map((person, n) => (n ? person : { ...person, portrait: 'fenna.webp' })) } }), [['fenna.webp', picture]]) };
    assert.equal(ctx.apply(result), true);
    assert.equal(ctx.inspector.querySelectorAll('img').length, 1);
    undo(ctx);
    assert.equal(ctx.inspector.querySelectorAll('img').length, 0);
    ctx.history.redo();
    ctx.render();
    assert.equal(ctx.inspector.querySelectorAll('img').length, 1);
    // A later edit keeps the pictures.
    edit(ctx, [0, 'voice'], 'Low.');
    assert.equal(ctx.inspector.querySelectorAll('img').length, 1);
});

test('removing a portrait after naming a new person uses their current key', () => {
    const people = castEntries();
    people[0].id = 'new-person';
    const ctx = open(castPack({ cast: people }), 'new-person');
    const name = control(ctx, 0, 'name');
    const remove = buttons(ctx.inspector, 'Remove').find(button => !button.disabled);
    ctx.render = () => {};
    change(name, 'Old Marta');
    assert.equal(cast(ctx)[0].id, 'old-marta');
    remove.click();
    assert.equal('portrait' in cast(ctx)[0], false);
});

test('the check lists the cast and offers the .zip and the plain pack.json', () => {
    const ctx = createTestContext(openPack(castPack()));
    ctx.onRender = renderScreen;
    ctx.select('check');
    const lines = ctx.main.querySelectorAll('.cf-list li').map(item => item.textContent);
    assert.equal(lines[0], 'Cast: 2 people, all fields within limits.');
    assert.ok(lines.includes('Sera has no voice written — the narrator will invent one at the first meeting.'));
    assert.match(ctx.main.querySelector('.cf-zip').textContent, /^fixture-2\.0\.0\.zip\n {2}pack\.json +\d+ KB$/);
    assert.deepEqual(['#export-zip', '#export-btn'].map(id => ctx.main.querySelector(id).textContent), ['Export .zip', 'Export pack.json only']);
    assert.equal(ctx.main.querySelector('#filename').value, 'fixture-2.0.0.json');
});

test('a pack without a cast keeps the check and the one export button as they were', () => {
    const ctx = createTestContext(openPack(castPack({ cast: [] })));
    ctx.onRender = renderScreen;
    ctx.select('check');
    assert.equal(ctx.main.querySelector('.cf-check'), null);
    assert.equal(ctx.main.querySelector('.cf-zip'), null);
    assert.equal(ctx.main.querySelector('#export-zip'), null);
    assert.equal(ctx.main.querySelector('#export-btn').textContent, 'Export pack file');
    assert.equal(ctx.main.querySelector('#filename').value, 'fixture.json');
});

test('a meter secret has an optional story event beside it: it saves when beside meter and at, and clears when emptied', () => {
    const ctx = open();
    const secret = () => cast(ctx)[0].secrets[0];
    const also = () => control(ctx, 0, 'secrets', 0, 'when');
    assert.equal(also().value, '');
    const box = also().parentElement.parentElement;
    assert.equal(box.querySelector('label').childNodes[0].textContent, '…or also on a story event (optional)');
    assert.equal(box.querySelector('.tl-count').textContent, '0 / 120');
    assert.equal(box.querySelector('.cf-hint').textContent, 'Opens at Trust 20 or when this happens, whichever comes first.');
    edit(ctx, [0, 'secrets', 0, 'when'], 'the party finds the ledger');
    assert.deepEqual(secret(), { title: 'Her husband’s debt', text: 'He owed the smugglers.', meter: 'trust', at: 20, when: 'the party finds the ledger' });
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    assert.equal(also().parentElement.parentElement.querySelector('.tl-count').textContent, '26 / 120');
    // The meter row is still the meter row, and the mode is still "at a meter".
    assert.equal(buttons(ctx.inspector.querySelectorAll('[data-secret]')[0], 'at a meter')[0].getAttribute('aria-pressed'), 'true');
    edit(ctx, [0, 'secrets', 0, 'at'], '30');
    assert.equal(secret().when, 'the party finds the ledger');
    assert.match(ctx.inspector.querySelectorAll('[data-secret]')[0].querySelector('.cf-hint').textContent, /^$|Opens at Trust 30 or when this happens/);
    edit(ctx, [0, 'secrets', 0, 'when'], '  ');
    assert.equal('when' in secret(), false);
    assert.equal(secret().at, 30);
    undo(ctx);
    assert.equal(secret().when, 'the party finds the ledger');
});

test('the player preview follows a story event change while the form redraw is deferred', () => {
    const entries = castEntries();
    entries[0].secrets[0].when = 'Severa comes to Bluewatch';
    const ctx = open(castPack({ cast: entries }));
    const input = control(ctx, 0, 'secrets', 0, 'when');
    const preview = ctx.inspector.querySelector('[data-cf=preview]');
    const rules = () => preview.querySelectorAll('.cf-hint').map(node => node.textContent);
    assert.deepEqual(rules(), ['Opens at Trust 20 or with the story', 'Opens at Trust 60', 'Opens with the story']);
    const render = ctx.render;
    ctx.render = () => {};
    input.focus();
    change(input, '');
    assert.equal(ctx.doc.activeElement, input);
    assert.equal(control(ctx, 0, 'secrets', 0, 'when'), input);
    assert.equal('when' in cast(ctx)[0].secrets[0], false);
    assert.deepEqual(rules(), ['Opens at Trust 20', 'Opens at Trust 60', 'Opens with the story']);
    change(input, 'the party finds the ledger');
    assert.equal(cast(ctx)[0].secrets[0].when, 'the party finds the ledger');
    assert.deepEqual(rules(), ['Opens at Trust 20 or with the story', 'Opens at Trust 60', 'Opens with the story']);
    assert.doesNotMatch(preview.textContent, /the party finds the ledger/);
    ctx.render = render;
    ctx.render();
    assert.deepEqual(ctx.inspector.querySelector('[data-cf=preview]').querySelectorAll('.cf-hint').map(node => node.textContent), rules());
});

test('choosing "on a story event" is the event alone, and an event that is already there is kept; "at a meter" keeps meter only', () => {
    const ctx = open();
    edit(ctx, [0, 'secrets', 0, 'when'], 'the ledger');
    press(ctx.inspector.querySelectorAll('[data-secret]')[0], 'on a story event');
    assert.deepEqual(Object.keys(cast(ctx)[0].secrets[0]).sort(), ['text', 'title', 'when']);
    assert.equal(cast(ctx)[0].secrets[0].when, 'the ledger');
    press(ctx.inspector.querySelectorAll('[data-secret]')[0], 'at a meter');
    assert.deepEqual(Object.keys(cast(ctx)[0].secrets[0]).sort(), ['at', 'meter', 'text', 'title']);
    assert.equal(ctx.model.validation.ok, true);
});

test('the story event field is Story Block’s: past 120 characters or with markup it shows the checker’s message under it', () => {
    const ctx = open();
    edit(ctx, [0, 'secrets', 0, 'when'], 'x'.repeat(121));
    const box = control(ctx, 0, 'secrets', 0, 'when').parentElement.parentElement;
    assert.match(box.querySelector('.cf-error').textContent, /when must be plain text of 1 to 120 characters/);
    assert.ok(box.querySelector('.tl-count').classList.contains('cf-over'));
    assert.equal(ctx.model.validation.ok, false);
    edit(ctx, [0, 'secrets', 0, 'when'], 'a <thing>');
    assert.equal(ctx.model.validation.ok, false);
});

test('the player view says "or with the story" for a secret with both rules, never the event’s words, and the check accepts it', () => {
    const entries = castEntries();
    entries[0].secrets[1] = { ...entries[0].secrets[1], when: 'Severa comes to Bluewatch' };
    const ctx = open(castPack({ cast: entries }));
    const preview = ctx.inspector.querySelector('[data-cf=preview]');
    assert.deepEqual(preview.querySelectorAll('.cf-hint').map(node => node.textContent), ['Opens at Trust 20', 'Opens at Trust 60 or with the story', 'Opens with the story']);
    assert.doesNotMatch(preview.textContent, /Severa/);
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    const check = createTestContext(openPack(castPack({ cast: entries })));
    check.onRender = renderScreen;
    check.select('check');
    const lines = check.main.querySelectorAll('.cf-list li').map(item => item.textContent);
    assert.equal(lines[0], 'Cast: 2 people, all fields within limits.');
    assert.ok(lines.includes('Secrets: 3, each opens at a meter or on a story event.'));
});

// --- How they behave ---------------------------------------------------------------------------------------------------

const LEVERS = ['Disposition', 'Care', 'Expression', 'Independence', 'Conflict', 'Threat', 'Analytical', 'Presentation', 'Mercy', 'Loyalty', 'Drive', 'Honesty'];
const behaving = (extra = {}) => castPack({ cast: castEntries().map((person, at) => (at === 0 ? { ...person, ...extra } : person)) });
const group = ctx => ctx.inspector.querySelector("[data-cf='behave']");
const named = (root, label) => { const found = ['select', 'input', 'textarea', 'button'].flatMap(tag => root.querySelectorAll(tag)).find(node => node.getAttribute('aria-label') === label || (node.tagName.toLowerCase() === 'button' && node.textContent === label)); assert.ok(found, `no control ${label}`); return found; };
const rowsOf = ctx => group(ctx).querySelectorAll('.cf-lever');
const habitsOf = ctx => group(ctx).querySelectorAll('.cf-item');
const fullPack = () => behaving({
    behaviour: ['Mercy: low - slow stitches', 'Care: high - protective', 'Loyalty: high - cannot let go', 'Independence: high - refuses', 'Presentation: high - plays on it', 'Drive: medium - restless'],
    mannerisms: ['A weary smirk', 'Laughs at pain', 'Taps the rail', 'Hums'],
    withYou: 'Jealous once you matter.',
});

test('How they behave holds Personality (same binding and limit), Behaviour, Mannerisms and With you, with the approved hints', () => {
    const ctx = open();
    const set = group(ctx);
    assert.equal(set.querySelector('legend').textContent, 'How they behave');
    const personality = control(ctx, 0, 'personality');
    assert.equal(personality.tagName.toLowerCase(), 'textarea');
    assert.equal(set.querySelectorAll('textarea').includes(personality), true);
    assert.equal(personality.value, castEntries()[0].personality);
    assert.equal(personality.parentElement.parentElement.querySelector('.tl-count').textContent, `${[...castEntries()[0].personality].length} / 600`);
    const hints = set.querySelectorAll('.cf-hint').map(node => node.textContent);
    assert.deepEqual(hints, [
        'Who they are inside, in a few words.',
        `How they generally respond or decide. Levers: ${LEVERS.join(', ')}. Level: low, medium or high.`,
        'Small recurring habits you would notice in a scene.',
        "How they treat the player character. Becomes the dossier's relationship summary at the first meeting; the story keeps it up to date after that.",
    ]);
    assert.equal(control(ctx, 0, 'withYou').parentElement.parentElement.querySelector('.tl-count').textContent, '0 / 320');
    assert.equal(rowsOf(ctx).length, 0);
    assert.equal(named(set, '+ Add a lever').disabled, false);
});

test('rows render from a pack: lever, level, effect and a remove button', () => {
    const ctx = open(fullPack());
    assert.equal(rowsOf(ctx).length, 6);
    const first = rowsOf(ctx)[0];
    assert.equal(named(first, 'Lever 1').value, 'Mercy');
    assert.equal(named(first, 'Level 1').value, 'low');
    assert.equal(named(first, 'Effect 1').value, 'slow stitches');
    assert.equal(named(first, 'Remove lever 1').textContent, '✕');
    assert.deepEqual(named(first, 'Lever 1').querySelectorAll('option').map(node => node.value), LEVERS);
    assert.deepEqual(named(first, 'Level 1').querySelectorAll('option').map(node => node.value), ['low', 'medium', 'high']);
    assert.equal(habitsOf(ctx).length, 4);
    assert.equal(named(habitsOf(ctx)[2], 'Mannerism 3').value, 'Taps the rail');
    assert.equal(control(ctx, 0, 'withYou').value, 'Jealous once you matter.');
    assert.equal(control(ctx, 0, 'withYou').parentElement.parentElement.querySelector('.tl-count').textContent, '24 / 320');
});

test('Add a lever stops at six, Add a mannerism at four, and removing frees the button again', () => {
    const ctx = open();
    for (let n = 1; n <= 6; n += 1) {
        assert.equal(rowsOf(ctx).length, n - 1);
        press(group(ctx), '+ Add a lever');
    }
    assert.equal(rowsOf(ctx).length, 6);
    assert.equal(cast(ctx)[0].behaviour.length, 6);
    assert.equal(named(group(ctx), '+ Add a lever').disabled, true);
    press(group(ctx), 'Remove lever 6');
    assert.equal(named(group(ctx), '+ Add a lever').disabled, false);
    for (let n = 1; n <= 4; n += 1) press(group(ctx), '+ Add a mannerism');
    assert.equal(cast(ctx)[0].mannerisms.length, 4);
    assert.equal(named(group(ctx), '+ Add a mannerism').disabled, true);
    press(group(ctx), 'Remove mannerism 1');
    assert.equal(cast(ctx)[0].mannerisms.length, 3);
    assert.equal(named(group(ctx), '+ Add a mannerism').disabled, false);
});

test('a lever is used once: its option is disabled in the other rows, and a new row takes an unused lever', () => {
    const ctx = open(behaving({ behaviour: ['Care: high - protective', 'Mercy: low - slow'] }));
    const options = label => named(group(ctx), label).querySelectorAll('option');
    assert.deepEqual(options('Lever 1').filter(node => node.disabled).map(node => node.value), ['Mercy']);
    assert.deepEqual(options('Lever 2').filter(node => node.disabled).map(node => node.value), ['Care']);
    press(group(ctx), '+ Add a lever');
    const third = cast(ctx)[0].behaviour[2];
    assert.match(third, /^Disposition: medium - ?$/);
    assert.deepEqual(options('Lever 3').filter(node => node.disabled).map(node => node.value), ['Care', 'Mercy']);
});

test('edits write the strings “Lever: level - effect”, mannerism lines and withYou', () => {
    const ctx = open();
    press(group(ctx), '+ Add a lever');
    change(named(group(ctx), 'Lever 1'), 'Care');
    change(named(group(ctx), 'Level 1'), 'high');
    change(named(group(ctx), 'Effect 1'), '  fiercely\n protective of the dead ');
    assert.deepEqual(cast(ctx)[0].behaviour, ['Care: high - fiercely protective of the dead']);
    assert.deepEqual(ctx.model.validation.errors, []);
    press(group(ctx), '+ Add a mannerism');
    change(named(group(ctx), 'Mannerism 1'), 'A weary  smirk');
    assert.deepEqual(cast(ctx)[0].mannerisms, ['A weary smirk']);
    edit(ctx, [0, 'withYou'], 'Cold to rivals,\n sweet to you.');
    assert.equal(cast(ctx)[0].withYou, 'Cold to rivals, sweet to you.');
    edit(ctx, [0, 'personality'], 'Weary.');
    assert.equal(cast(ctx)[0].personality, 'Weary.');
    assert.deepEqual(ctx.model.validation.errors, []);
    undo(ctx);
    assert.equal(cast(ctx)[0].personality, castEntries()[0].personality);
});

test('emptying everything removes behaviour, mannerisms and withYou from the entry', () => {
    const ctx = open(fullPack());
    for (let n = 6; n >= 1; n -= 1) press(group(ctx), `Remove lever ${n}`);
    for (let n = 4; n >= 1; n -= 1) press(group(ctx), `Remove mannerism ${n}`);
    edit(ctx, [0, 'withYou'], '');
    for (const key of ['behaviour', 'mannerisms', 'withYou']) assert.equal(key in cast(ctx)[0], false, key);
    assert.deepEqual(cast(ctx)[0], castEntries()[0]);
});

test('Story Block’s problems show under the field: a long effect, a repeated lever, a mannerism over 120', () => {
    const ctx = open(behaving({ behaviour: ['Care: high - ok'], mannerisms: ['fine'], withYou: 'ok' }));
    change(named(group(ctx), 'Effect 1'), 'x'.repeat(121));
    assert.match(group(ctx).querySelector("[data-cf='behaviour'] .cf-error").textContent, /Care.*1 to 120 characters/);
    change(named(group(ctx), 'Mannerism 1'), 'y'.repeat(121));
    assert.match(group(ctx).querySelector("[data-cf='mannerisms'] .cf-error").textContent, /1 to 120 characters/);
    edit(ctx, [0, 'withYou'], 'z'.repeat(401));
    assert.match(control(ctx, 0, 'withYou').parentElement.parentElement.querySelector('.cf-error').textContent, /320/);
    assert.ok(ctx.model.validation.errors.length >= 3);
});

test('an old pack without the new keys exports byte-identical, also after an edit and a re-open', () => {
    const pack = castPack();
    const text = JSON.stringify(pack, null, 2) + '\n';
    const ctx = open(pack);
    assert.equal(exportPack(ctx.model), text);
    edit(ctx, [0, 'personality'], castEntries()[0].personality);
    assert.equal(exportPack(ctx.model), text);
    edit(ctx, [0, 'voice'], 'Quiet.');
    const out = JSON.parse(exportPack(ctx.model)).content.cast;
    for (const person of out) for (const key of ['behaviour', 'mannerisms', 'withYou']) assert.equal(key in person, false);
});

test('Ersveil round trip: import, edit a lever, export, re-open', () => {
    const text = readFileSync(new URL('./fixtures/ersveil-pack.json', import.meta.url), 'utf8');
    const ctx = createTestContext(openPack(text));
    ctx.onRender = renderScreen;
    ctx.select('cast', 'temiwa');
    assert.deepEqual(ctx.model.validation.errors, []);
    const before = ctx.model.document.content.cast[0];
    assert.equal(before.behaviour.length, 5);
    assert.equal(rowsOf(ctx).length, 5);
    assert.equal(habitsOf(ctx).length, 2);
    assert.equal(exportPack(ctx.model), text);
    change(named(group(ctx), 'Level 1'), 'high');
    change(named(group(ctx), 'Effect 5'), 'plays on it');
    const out = exportPack(ctx.model);
    assert.notEqual(out, text);
    const person = JSON.parse(out).content.cast[0];
    assert.equal(person.behaviour[0], before.behaviour[0].replace(/: \w+ -/, ': high -'));
    assert.match(person.behaviour[4], / - plays on it$/);
    assert.deepEqual(person.mannerisms, before.mannerisms);
    assert.equal(person.withYou, before.withYou);
    JSON.parse(out).content.cast.forEach((other, at) => { if (at !== 0) assert.deepEqual(other, JSON.parse(text).content.cast[at]); });
    const again = createTestContext(openPack(out));
    again.onRender = renderScreen;
    again.select('cast', 'temiwa');
    assert.deepEqual(again.model.validation.errors, []);
    assert.equal(named(group(again), 'Level 1').value, 'high');
    assert.equal(named(group(again), 'Effect 5').value, 'plays on it');
    assert.equal(exportPack(again.model), out);
});
