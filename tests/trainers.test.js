// Open trainer templates (docs/v2/OPEN_TRAINERS_SPEC.md, Story Block 2.4.0): the 1.6.0 example pack opens, keeps its bytes,
// and its templates add no place reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { records } from '../src/records.js';
import { schemaForRecord } from '../src/form-schema.js';
import { setField } from '../src/edits.js';
import { createTestContext } from './helpers/dom.js';
import { renderScreen } from '../src/screens/index.js';
import { trainerToTemplate, templateToFixed, templateMeta, feeUnit, feeAmount } from '../src/screens/trainer-template.js';
import { exportRulesV2 } from '../vendor/story-block/src/v2/packs/rules-v2.js';

const text = readFileSync(new URL('./fixtures/ersveil-bluewatch-1.6.0.json', import.meta.url), 'utf8');

test('Ersveil 1.6.0 opens with seven fixed trainers and four templates, and exports its own bytes', () => {
    const model = openPack(text);
    assert.equal(model.validation.ok, true);
    assert.equal(model.rulesHash.slice(0, 8), '2a56f0cf');
    const trainers = records(model, 'trainers');
    assert.equal(trainers.length, 11);
    assert.equal(trainers.filter(t => t.open === true).length, 4);
    assert.equal(exportPack(model), text);
});

test('a template has no place, so it adds no reference to a place', () => {
    const model = openPack(text);
    const places = model.references.filter(ref => ref.kind === 'trainers' && ref.targetKind === 'places');
    assert.equal(places.length, 7, 'one per fixed trainer');
    assert.ok(places.every(ref => ref.path[4] < 7), 'none of the four templates, which come after the seven fixed trainers');
});

test('a trainer is edited against its own variant: fixed has a place and no open marker, a template has a rank and a fee range', () => {
    const fixed = schemaForRecord('trainers', { slug: 'a', place: 'haven' });
    assert.ok(fixed.properties.place);
    assert.equal(fixed.properties.open, undefined);
    assert.equal(fixed.oneOf, undefined);
    const template = schemaForRecord('trainers', { slug: 'a', open: true });
    assert.equal(template.properties.place, undefined);
    assert.ok(template.properties.rank);
    assert.deepEqual(Object.keys(template.properties.fee.properties), ['coinMin', 'coinMax']);
    assert.equal(schemaForRecord('quests', {}).oneOf.length, 2, 'other kinds are untouched');
});

// ---- The screen: chips, filter, Add menu, the template editor and the conversions (the mock DOM) ----

const rules = model => model.document.content.rules[0];
const trainerNamed = (model, slug) => rules(model).trainers.find(t => t.slug === slug);
const buttons = (root, text) => root.querySelectorAll('button').filter(b => b.textContent.startsWith(text));
const ctl = (ctx, key) => ctx.inspector.querySelector(`[data-ctl="${key}"]`);
const change = (control, value) => { control.value = value; control.dispatchEvent({ type: 'change' }); };

function screen() {
    const ctx = createTestContext(text);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('trainers');
    return ctx;
}

test('Trainers: Fixed and Template chips on the cards, and a filter with counts that shows only what it names', () => {
    const ctx = screen();
    const group = ctx.main.querySelector('[aria-label="Show trainers"]');
    assert.ok(group);
    assert.equal(group.getAttribute('role'), 'group');
    const tabs = group.querySelectorAll('button').map(b => [b.getAttribute('data-filter'), b.querySelector('.count').textContent, b.getAttribute('aria-pressed')]);
    assert.deepEqual(tabs, [['all', '11', 'true'], ['fixed', '7', 'false'], ['template', '4', 'false']]);
    assert.equal(ctx.main.querySelectorAll('.record-card').length, 11);
    assert.equal(ctx.main.querySelectorAll('.chip-fixed').length, 7);
    assert.equal(ctx.main.querySelectorAll('.chip-template').length, 4);
    group.querySelector('[data-filter="template"]').click();
    assert.equal(ctx.main.querySelectorAll('.record-card').length, 4);
    assert.equal(ctx.main.querySelector('[data-filter="template"]').getAttribute('aria-pressed'), 'true');
    assert.match(ctx.main.querySelector('.record-card').textContent, /open-blade-drills · rank F · fee 40–90/);
    ctx.main.querySelector('[data-filter="fixed"]').click();
    assert.equal(ctx.main.querySelectorAll('.record-card').length, 7);
    assert.match(ctx.main.querySelector('.filter-help').textContent, /^Templates have no place: the story offers one with \| like: <slug>, or the reader uses Make this a trainer\./);
    assert.match(ctx.main.querySelector('.records-note').textContent, /^Fixed trainers stand at one place with set skills and a fee\. Templates are open:/);
});

test('the quests filter is the same component and keeps its own choice', () => {
    const ctx = screen();
    ctx.select('quests');
    ctx.main.querySelector('[data-filter="template"]').click();
    assert.equal(ctx.main.querySelector('[aria-label="Show quests"]').querySelector('[aria-pressed="true"]').getAttribute('data-filter'), 'template');
    ctx.select('trainers');
    assert.equal(ctx.main.querySelector('[aria-label="Show trainers"]').querySelector('[aria-pressed="true"]').getAttribute('data-filter'), 'all');
});

test('+ Add Trainer opens a two-item menu; the template item adds the default record and opens it, and is off without ranks', () => {
    const ctx = screen();
    const trigger = buttons(ctx.main, '+ Add Trainer')[0];
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    const menu = ctx.main.querySelector('.add-menu');
    assert.equal(menu.hidden, true);
    trigger.click();
    assert.equal(menu.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(menu.querySelectorAll('[role="menuitem"]').map(item => item.childNodes[0].textContent), ['Fixed trainer', 'Trainer template']);
    menu.querySelectorAll('[role="menuitem"]')[1].click();
    assert.deepEqual(trainerNamed(ctx.model, 'new-trainer-template'), {
        slug: 'new-trainer-template', name: 'New trainer template', open: true, rank: 'F', skills: [], fee: { coinMin: 1, coinMax: 1 }, minutes: 60, eventTemplates: [],
    });
    assert.equal(ctx.selection.id, 'new-trainer-template');
    assert.equal(ctx.model.validation.ok, false, 'no skill yet: export waits for one');
    assert.ok(ctl(ctx, 'coinMin'), 'the template editor is open');
    // a second one gets its own key
    ctx.select('trainers');
    buttons(ctx.main, '+ Add Trainer')[0].click();
    ctx.main.querySelectorAll('[role="menuitem"]')[1].click();
    assert.ok(trainerNamed(ctx.model, 'new-trainer-template-2'));

    const pack = JSON.parse(text);
    delete pack.content.ranks;
    const bare = createTestContext(pack);
    bare.onRender = () => renderScreen(bare);
    bare.select('trainers');
    const item = bare.main.querySelectorAll('[role="menuitem"]')[1];
    assert.equal(item.disabled, true);
    assert.match(item.textContent, /Add a rank in Pack settings first\./);
});

test('the template editor: rank, fee range, skills grouped by class, events, the narrator line and the actions', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-blade-drills');
    assert.equal(ctx.inspector.querySelector('h2').textContent, 'Blade drills');
    assert.deepEqual(ctx.inspector.querySelectorAll('.inspector-title-row .chip').map(c => c.textContent), ['Trainers', 'Template']);
    assert.match(ctx.inspector.querySelector('.records-note').textContent, /^Template: the fee is rolled from this range when a trainer is offered with \| like: open-blade-drills, and the trainer stays where it was offered\.$/);
    assert.equal(ctl(ctx, 'slug').value, 'open-blade-drills');
    assert.equal(ctl(ctx, 'rank').childNodes.length, 7);
    assert.match(ctx.inspector.textContent, /Rank F \(Registered\) quests pay 50–400\./);
    assert.equal(ctl(ctx, 'coinMin').value, '40');
    assert.equal(ctl(ctx, 'coinMax').value, '90');
    assert.match(ctx.inspector.textContent, /A session costs between 40 and 90 copper, rolled when a trainer is offered; the narrator never sets it\. Each bound 1 to 1,000,000\./);
    assert.match(ctx.inspector.textContent, /60 minutes \(fixed by the rules\)/);
    assert.match(ctx.inspector.textContent, /None: stands where the story offers it/);
    const headings = ctx.inspector.querySelectorAll('.skill-group h4').map(h => h.childNodes[0].textContent);
    assert.deepEqual(headings.slice(0, 3), ['Tier 0 · Blade Initiate', 'Tier 1 · Mirage Fencer', 'Tier 0 · Barge Drifter'], 'the classes with chosen skills first, then the pack order');
    assert.equal(headings.length, 20);
    assert.equal(ctx.inspector.querySelector('.skill-count').textContent, '6 of 30 at most');
    assert.equal(ctx.inspector.querySelectorAll('.skill-group input[type="checkbox"]').filter(b => b.checked).length, 6);
    assert.match(ctx.inspector.textContent, /event templates \(0 of 8\)/);
    assert.equal(ctx.inspector.querySelectorAll('.check-grid input').length, 6);
    assert.equal(ctx.inspector.querySelector('.narrator-line code').textContent, '+ trainer <Name> — <what they teach> | like: open-blade-drills');
    assert.match(ctx.inspector.querySelector('.narrator-line .field-hint').textContent, /^To narrow: \| teaches: swift-thrust, parrying-turn\./);
    assert.deepEqual(ctx.inspector.querySelectorAll('.editor-actions button').map(b => b.textContent), ['Convert to fixed trainer…', 'Delete']);
});

test('ticking skills and events edits the lists through the pack, and the picker only offers what the pack has', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-blade-drills');
    const tick = (key, on) => { const box = ctl(ctx, key); box.checked = on; box.dispatchEvent({ type: 'change' }); };
    tick('skill:brace-spear', true);
    assert.deepEqual(trainerNamed(ctx.model, 'open-blade-drills').skills.slice(-2), ['duelists-mark', 'brace-spear']);
    tick('skill:swift-thrust', false);
    assert.equal(trainerNamed(ctx.model, 'open-blade-drills').skills.includes('swift-thrust'), false);
    assert.equal(ctx.inspector.querySelector('.skill-count').textContent, '6 of 30 at most');
    tick('event:guild-board', true);
    assert.deepEqual(trainerNamed(ctx.model, 'open-blade-drills').eventTemplates, ['guild-board']);
    assert.match(ctx.inspector.textContent, /event templates \(1 of 8\)/);
    assert.equal(ctx.model.validation.ok, true);
    ctx.history.undo();
    assert.deepEqual(trainerNamed(ctx.model, 'open-blade-drills').eventTemplates, []);
});

test('the last skill cannot be unticked (the checker wants one): the edit is refused and the box goes back', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-blade-drills');
    ctx.history.commit(setField(ctx.model, ['content', 'rules', 0, 'trainers', 7, 'skills'], ['swift-thrust']));
    ctx.render();
    const box = ctl(ctx, 'skill:swift-thrust');
    box.checked = false;
    box.dispatchEvent({ type: 'change' });
    assert.deepEqual(trainerNamed(ctx.model, 'open-blade-drills').skills, ['swift-thrust']);
    assert.ok(ctx.notifications.some(n => /at least 1 skill/.test(n)));
    assert.equal(ctl(ctx, 'skill:swift-thrust').checked, true);
});

test('the skill picker filters by skill or class, and unknown refs are listed with a way to remove them', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-blade-drills');
    const search = ctl(ctx, 'search');
    search.value = 'frost';
    search.dispatchEvent({ type: 'input' });
    assert.equal(ctx.inspector.querySelectorAll('.skill-group').length, 2, 'Frost Shard sits in Spell Weaver, Frost Cinder in another class');
    assert.equal(ctl(ctx, 'search'), search, 'the search box is the same node: it keeps focus while typing');
    search.value = 'blade initiate';
    search.dispatchEvent({ type: 'input' });
    assert.equal(ctx.inspector.querySelectorAll('.skill-group').length, 1);
    search.value = 'zzz';
    search.dispatchEvent({ type: 'input' });
    assert.match(ctx.inspector.querySelector('.skill-groups').textContent, /No skill or class matches\./);

    const withGhost = createTestContext(text);
    const set = setField(withGhost.model, ['content', 'rules', 0, 'trainers', 7, 'skills'], [...trainerNamed(withGhost.model, 'open-blade-drills').skills, 'no-such-skill']);
    assert.equal(set.ok, true);
    withGhost.history.commit(set);
    withGhost.onRender = () => renderScreen(withGhost);
    withGhost.select('trainers', 'open-blade-drills');
    const warning = withGhost.inspector.querySelectorAll('.field-warn').find(w => /no-such-skill is not a skill of this pack\./.test(w.textContent));
    assert.ok(warning);
    assert.match(withGhost.inspector.textContent, /1 problem in this record\. Export is blocked until it is fixed\./);
    warning.querySelector('button').click();
    assert.equal(trainerNamed(withGhost.model, 'open-blade-drills').skills.length, 6);
    assert.equal(withGhost.model.validation.ok, true);
});

test('an inverted fee range is kept, shows the checker\'s message and path on the fee fields, and blocks export until it is fixed', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-hedge-lessons');
    change(ctl(ctx, 'coinMin'), '170');
    const issue = ctx.model.validation.errors.find(e => /\.fee$/.test(e.path));
    assert.equal(issue.path, 'content.rules[0].trainers[10].fee');
    assert.equal(ctx.model.validation.ok, false);
    const error = ctx.inspector.querySelector('.field-error');
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, `Lowest fee must not be above the highest. ${issue.path}`);
    assert.equal(ctl(ctx, 'coinMin').getAttribute('aria-invalid'), 'true');
    assert.equal(ctl(ctx, 'coinMax').getAttribute('aria-invalid'), 'true');
    assert.match(ctx.inspector.textContent, /1 problem in this record\. Export is blocked until it is fixed\./);
    assert.equal(ctx.inspector.querySelector('.fee-bar').hidden, true);
    change(ctl(ctx, 'coinMax'), '180');
    assert.equal(ctx.model.validation.ok, true);
    assert.equal(ctx.inspector.querySelector('.field-error').hidden, true);
    assert.deepEqual(trainerNamed(ctx.model, 'open-hedge-lessons').fee, { coinMin: 170, coinMax: 180 });
});

test('a fee that is not a whole number from 1 to 1,000,000 is explained on the field and never committed; a high maximum is only a note', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-blade-drills');
    for (const bad of ['0', '12.5', 'abc', '1000001', '']) {
        const box = ctl(ctx, 'coinMin');
        box.value = bad;
        box.dispatchEvent({ type: 'input' });
        assert.equal(ctx.inspector.querySelector('.field-error').textContent, '1 to 1,000,000', bad);
        box.dispatchEvent({ type: 'change' });
        assert.deepEqual(trainerNamed(ctx.model, 'open-blade-drills').fee, { coinMin: 40, coinMax: 90 }, bad);
    }
    change(ctl(ctx, 'coinMax'), '500');
    assert.equal(ctx.model.validation.ok, true, 'a warning, not an error');
    assert.match(ctx.inspector.querySelector('.field-warn').textContent, /^A lesson can cost up to 500, more than a whole rank F quest pays \(400\)\. Check the range\.$/);
});

test('rank, slug and name edits go through the pack; a new slug keeps the selection', () => {
    const ctx = screen();
    ctx.select('trainers', 'open-hedge-lessons');
    change(ctl(ctx, 'rank'), 'D');
    assert.equal(trainerNamed(ctx.model, 'open-hedge-lessons').rank, 'D');
    assert.match(ctx.inspector.textContent, /Rank D \(Proven\) quests pay 3,000–12,000\./);
    change(ctl(ctx, 'name'), 'Hedge craft');
    assert.equal(trainerNamed(ctx.model, 'open-hedge-lessons').name, 'Hedge craft');
    change(ctl(ctx, 'slug'), 'open-hedge-craft');
    assert.ok(trainerNamed(ctx.model, 'open-hedge-craft'));
    assert.equal(ctx.selection.id, 'open-hedge-craft');
    assert.equal(ctl(ctx, 'slug').value, 'open-hedge-craft');
    change(ctl(ctx, 'slug'), 'Not A Slug');
    assert.ok(ctx.notifications.some(n => /bad-value/.test(n)));
    assert.equal(ctx.model.validation.ok, true);
});

test('editing a template changes only that record: every other record keeps its bytes', () => {
    const ctx = screen();
    const before = JSON.parse(text);
    ctx.select('trainers', 'open-street-craft');
    change(ctl(ctx, 'coinMax'), '75');
    const after = ctx.model.document;
    const expected = JSON.parse(text);
    expected.content.rules[0].trainers[9].fee.coinMax = 75;
    assert.deepEqual(after, expected);
    assert.equal(JSON.stringify(after.content.rules[0].trainers.filter((_, i) => i !== 9)), JSON.stringify(before.content.rules[0].trainers.filter((_, i) => i !== 9)));
    assert.deepEqual(JSON.parse(exportPack(ctx.model)), expected);
});

test('conversions: fixed to template and back keep the pack valid and round-trip through the checker\'s own export', () => {
    const ctx = screen();
    ctx.select('trainers', 'guild-drillmaster-morn');
    const toTemplate = buttons(ctx.inspector, 'Convert to template')[0];
    assert.ok(toTemplate);
    toTemplate.click();
    const template = trainerNamed(ctx.model, 'guild-drillmaster-morn');
    assert.deepEqual(template, {
        slug: 'guild-drillmaster-morn', name: 'Guild Drillmaster Morn', open: true, rank: 'F',
        skills: ['brace-spear', 'shield-bash', 'hidden-shiv', 'swift-thrust'], fee: { coinMin: 40, coinMax: 40 }, minutes: 60, eventTemplates: [],
    });
    assert.equal('place' in template, false);
    assert.equal(rules(ctx.model).trainers.indexOf(template), 0, 'the record keeps its place in the list');
    assert.equal(ctx.model.validation.ok, true);
    assert.equal(exportRulesV2(ctx.model.document).ok, true);
    assert.ok(ctl(ctx, 'coinMin'), 'the template editor opens on the converted record');
    assert.equal(ctx.selection.id, 'guild-drillmaster-morn');

    buttons(ctx.inspector, 'Convert to fixed trainer')[0].click();
    const dialog = ctx.overlays.querySelector('dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('[aria-label="fee"]').value, '40', 'the fee starts at the lowest fee');
    dialog.querySelector('[aria-label="place"]').value = 'guild-office';
    buttons(dialog, 'Convert')[0].click();
    const fixed = trainerNamed(ctx.model, 'guild-drillmaster-morn');
    assert.deepEqual(fixed, {
        slug: 'guild-drillmaster-morn', name: 'Guild Drillmaster Morn', place: 'pack.ersveil-bluewatch/guild-office',
        skills: ['brace-spear', 'shield-bash', 'hidden-shiv', 'swift-thrust'], fee: 40, minutes: 60, eventTemplates: [],
    });
    assert.equal(ctx.model.validation.ok, true);
    assert.equal(exportPack(ctx.model), text, 'the same bytes as the file we started from');
    assert.equal(exportRulesV2(ctx.model.document).ok, true);
});

test('conversion refuses without a rank, and a template cannot become fixed without a place', () => {
    const pack = JSON.parse(text);
    delete pack.content.ranks;
    pack.content.rules[0].trainers = pack.content.rules[0].trainers.slice(0, 7);
    const noRanks = createTestContext(pack);
    noRanks.onRender = () => renderScreen(noRanks);
    noRanks.select('trainers', 'guild-drillmaster-morn');
    const convert = buttons(noRanks.inspector, 'Convert to template')[0];
    assert.equal(convert.disabled, true);
    assert.match(noRanks.inspector.textContent, /Add a rank in Pack settings first\./);

    const noPlaces = JSON.parse(text);
    noPlaces.content.places = [];
    noPlaces.content.rules[0].trainers = noPlaces.content.rules[0].trainers.slice(7);
    const bare = createTestContext(noPlaces);
    bare.onRender = () => renderScreen(bare);
    bare.select('trainers', 'open-blade-drills');
    buttons(bare.inspector, 'Convert to fixed trainer')[0].click();
    const dialog = bare.overlays.querySelector('dialog');
    assert.match(dialog.textContent, /This pack has no places yet\./);
    assert.equal(buttons(dialog, 'Convert')[0].disabled, true);
});

test('the pure conversions are inverses on the fields they keep', () => {
    const fixed = { slug: 'a', name: 'A', place: 'p', skills: ['s'], fee: 55, minutes: 60, eventTemplates: ['e'] };
    const template = trainerToTemplate(fixed, 'F');
    assert.deepEqual(template, { slug: 'a', name: 'A', open: true, rank: 'F', skills: ['s'], fee: { coinMin: 55, coinMax: 55 }, minutes: 60, eventTemplates: ['e'] });
    assert.deepEqual(templateToFixed(template, 'p', template.fee.coinMin), fixed);
    assert.equal(templateMeta('a', template), 'a · rank F · fee 55–55');
});

test('the template screen builds no markup from text: no innerHTML or its relatives in its sources', () => {
    for (const file of ['../src/screens/trainer-template.js', '../src/screens/records.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|\beval\(|new Function/, file);
    }
});

// ---- The fee is named in the pack's own money, never a word of the editor's choosing ----

const feeSentence = (currency) => {
    const pack = JSON.parse(text);
    if (currency === undefined) delete pack.currency; else pack.currency = currency;
    const ctx = createTestContext(pack);
    ctx.onRender = () => renderScreen(ctx);
    ctx.select('trainers', 'open-blade-drills');
    const hints = ctx.inspector.querySelectorAll('.form-fieldset .field-hint').map(h => h.textContent);
    return { sentence: hints.find(h => h.startsWith('A session costs')), ctx };
};

test('the fee sentence uses the pack\'s own currency: Ersveil counts in copper', () => {
    const { sentence, ctx } = feeSentence(JSON.parse(text).currency);
    assert.equal(sentence, 'A session costs between 40 and 90 copper, rolled when a trainer is offered; the narrator never sets it. Each bound 1 to 1,000,000.');
    assert.doesNotMatch(ctx.inspector.textContent, /crown/i);
    change(ctl(ctx, 'coinMin'), '1');
    assert.match(ctx.inspector.textContent, /between 1 and 90 copper,/);
});

test('a pack whose currency is crowns reads crowns, with its singular for exactly one', () => {
    const { sentence, ctx } = feeSentence({ name: 'crown', plural: 'crowns', short: 'cr' });
    assert.equal(sentence, 'A session costs between 40 and 90 crowns, rolled when a trainer is offered; the narrator never sets it. Each bound 1 to 1,000,000.');
    change(ctl(ctx, 'coinMax'), '1');
    change(ctl(ctx, 'coinMin'), '1');
    assert.match(ctx.inspector.textContent, /between 1 and 1 crown,/);
});

test('the money word follows Story Block: the coin worth 1, a plural left out, and its default when the pack names none', () => {
    assert.equal(feeAmount(openPack(text), 90), '90 copper');
    assert.deepEqual(feeUnit({ document: { currency: { name: 'penny', plural: 'pennies', short: 'p', coins: [{ name: 'penny', plural: 'pennies', value: 1 }, { name: 'silver', value: 10 }] } } }), { name: 'penny', plural: 'pennies' });
    assert.deepEqual(feeUnit({ document: { currency: { name: 'mark', short: 'mk' } } }), { name: 'mark', plural: 'marks' });
    assert.deepEqual(feeUnit({ document: { currency: { name: 'crowns', short: 'cr' } } }), { name: 'crowns', plural: 'crowns' });
    assert.deepEqual(feeUnit({ document: {} }), { name: 'gold', plural: 'gold' });
    assert.equal(feeSentence(undefined).sentence.slice(0, 50), 'A session costs between 40 and 90 gold, rolled whe');
});

test('the convert dialog names the unit the fee is in', () => {
    const { ctx } = feeSentence({ name: 'crown', plural: 'crowns', short: 'cr' });
    buttons(ctx.inspector, 'Convert to fixed trainer')[0].click();
    assert.match(ctx.overlays.querySelector('dialog').textContent, /Fee, in crowns \(starts at the lowest fee of the range\)/);
});
