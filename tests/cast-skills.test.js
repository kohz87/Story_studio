// A cast member's signature skills: the checker rules, the form on the shared test DOM, the list tag, and the pack as it is written and read back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPack, exportPack } from '../src/model.js';
import { setSchemaField } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import { castCheck, cardTags } from '../src/cast/data.js';
import { SKILL_SLOTS, SKILL_STATS, checkCastSkills } from '../src/cast/skills.js';
import { readDraft, writeDraft } from '../src/session.js';
import { createTestContext } from './helpers/dom.js';
import { castPack } from './fixtures/cast.js';

const skill = (name, extra = {}) => ({ name, about: 'Does a thing.', stat: 'STR', uses: 'stamina', rank: 'novice', ...extra });
const withSkills = (skills, at = 0) => { const pack = castPack(); pack.content.cast[at].skills = skills; return pack; };
const three = () => [
    skill('Long Watch Cleave', { rank: 'expert' }),
    skill('Beacon Call', { stat: 'CHA', rank: 'adept' }),
    skill('Hold the Line', { stat: 'VIT', rank: 'master' }),
];
const problems = pack => openPack(JSON.stringify(pack)).validation.errors.map(error => error.message);

function open(pack = withSkills(three())) {
    const ctx = createTestContext(openPack(pack));
    ctx.onRender = renderScreen;
    ctx.select('cast', 'fenna');
    return ctx;
}
const section = ctx => ctx.inspector.querySelector('[data-cf="skills"]');
const cards = ctx => section(ctx).querySelectorAll('[data-skill]');
const path = (...keys) => `[data-path='${JSON.stringify(['content', 'cast', 0, 'skills', ...keys])}']`;
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent({ type: 'change' }); };
const buttons = (root, label) => root.querySelectorAll('button').filter(node => node.textContent === label || node.getAttribute('aria-label') === label);
const press = (root, label) => { const [node] = buttons(root, label); assert.ok(node, `no button ${label}`); assert.equal(node.disabled, false); node.click(); };
const saved = ctx => ctx.model.document.content.cast[0].skills;

test('three well-formed skills are accepted, and a skill may leave uses and rank to their defaults', () => {
    assert.deepEqual(openPack(JSON.stringify(withSkills(three()))).validation.errors, []);
    assert.deepEqual(openPack(JSON.stringify(withSkills([{ name: 'Spark', about: 'A small burst.', stat: 'int' }]))).validation.errors, []);
});

test('one to five skills: none, or more than five, is refused as a list', () => {
    assert.match(problems(withSkills([]))[0], /^Cast "Fenna": skills must be a list of 1 to 5 skills: \[\{ "name": "Spark"/);
    const six = Array.from({ length: SKILL_SLOTS + 1 }, (_, n) => skill(`Skill ${n}`));
    assert.match(problems(withSkills(six))[0], /skills must be a list of 1 to 5 skills/);
    assert.deepEqual(problems(withSkills(six.slice(0, SKILL_SLOTS))), []);
    assert.match(problems(withSkills('Spark'))[0], /skills must be a list/);
});

test('a name once per person, ignoring case; the same name for two people is fine', () => {
    assert.deepEqual(problems(withSkills([skill('Beacon Call'), skill('Hold'), skill('beacon call')])), ['Cast "Fenna": skills[2].name repeats "beacon call"; a person names each skill once.']);
    const pack = withSkills([skill('Beacon Call')]);
    pack.content.cast[1].skills = [skill('Beacon Call')];
    assert.deepEqual(problems(pack), []);
});

test('name 1 to 40 and what it does 1 to 120 characters', () => {
    assert.match(problems(withSkills([skill('')]))[0], /skills\[0\]\.name must be text of 1 to 40 characters\./);
    assert.match(problems(withSkills([skill('x'.repeat(41))]))[0], /skills\[0\]\.name must be text of 1 to 40/);
    assert.deepEqual(problems(withSkills([skill('x'.repeat(40), { about: 'y'.repeat(120) })])), []);
    assert.match(problems(withSkills([skill('A', { about: 'y'.repeat(121) })]))[0], /skills\[0\]\.about must be text of 1 to 120 characters/);
    assert.match(problems(withSkills([skill('A', { about: '' })]))[0], /skills\[0\]\.about must be text of 1 to 120/);
});

test('stat, uses and rank are checked, and a key the checker does not know is refused', () => {
    assert.deepEqual(SKILL_STATS, ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);
    assert.match(problems(withSkills([skill('A', { stat: 'CON' })]))[0], /skills\[0\]\.stat must be one of str, vit, agi, dex, int, luk, cha\./);
    assert.match(problems(withSkills([skill('A', { uses: 'rage' })]))[0], /skills\[0\]\.uses must be stamina or mana\./);
    assert.match(problems(withSkills([skill('A', { rank: 'legend' })]))[0], /skills\[0\]\.rank must be one of novice, adept, expert, master\./);
    assert.match(problems(withSkills([skill('A', { level: 3 })]))[0], /"level" is not a skill field \(expected name, about, stat, uses, rank\)\./);
    assert.match(problems(withSkills(['A']))[0], /skills\[0\] must be an object\./);
    assert.equal(openPack(JSON.stringify(withSkills([skill('A', { stat: ' cha ', uses: 'MANA', rank: 'Master' })]))).validation.errors.length, 0);
});

test('checkCastSkills gives each problem its path', () => {
    assert.deepEqual(checkCastSkills([skill('A'), skill('A')], 'content.cast[1]', 'Cast "Sera"').map(error => [error.code, error.path]), [['DUPLICATE', 'content.cast[1].skills[1].name']]);
});

test('the form: a section after “Before they are met” and before Secrets, with the hint and one card per skill', () => {
    const ctx = open();
    const legends = ctx.inspector.querySelectorAll('legend').map(node => node.textContent);
    assert.deepEqual(legends.slice(-3), ['Before they are met', 'Signature skills · 3 of 5', 'Secrets · 3 of 8']);
    assert.match(section(ctx).textContent, /Filled into their skill slots when they join; free slots stay for the story\./);
    assert.equal(cards(ctx).length, 3);
    assert.equal(ctx.inspector.querySelector(path(0, 'name')).value, 'Long Watch Cleave');
    assert.equal(ctx.inspector.querySelector(path(1, 'stat')).value, 'CHA');
    assert.equal(ctx.inspector.querySelector(path(0, 'rank')).value, 'expert');
    assert.equal(section(ctx).querySelectorAll('.tl-count')[0].textContent, '17 / 40');
    assert.equal(section(ctx).querySelectorAll('.tl-count')[1].textContent, '13 / 120');
    const uses = cards(ctx)[0].querySelectorAll('.cf-seg button');
    assert.deepEqual(uses.map(node => [node.textContent, node.getAttribute('aria-pressed')]), [['Stamina', 'true'], ['Mana', 'false']]);
});

test('a person without skills has an empty section and an Add button; the pack stays as it was until one is added', () => {
    const ctx = open(castPack());
    assert.deepEqual(ctx.inspector.querySelectorAll('legend').map(node => node.textContent).slice(-2), ['Signature skills · 0 of 5', 'Secrets · 3 of 8']);
    assert.equal(cards(ctx).length, 0);
    assert.equal(ctx.model.document.content.cast[0].skills, undefined);
});

test('add: a new skill starts from placeholders with a name nobody has, up to five, in one undo step', () => {
    const ctx = open(castPack());
    press(section(ctx), '+ Add skill');
    assert.deepEqual(saved(ctx), [{ name: 'New skill', about: '[WHAT IT DOES]', stat: 'STR', uses: 'stamina', rank: 'novice' }]);
    assert.deepEqual(ctx.model.validation.errors, []);
    for (let n = 0; n < 4; n++) press(section(ctx), '+ Add skill');
    assert.deepEqual(saved(ctx).map(item => item.name), ['New skill', 'New skill 2', 'New skill 3', 'New skill 4', 'New skill 5']);
    assert.equal(buttons(section(ctx), '+ Add skill')[0].disabled, true);
    assert.equal(section(ctx).querySelector('legend').textContent, 'Signature skills · 5 of 5');
    ctx.history.undo(); ctx.render();
    assert.equal(saved(ctx).length, 4);
});

test('edit: name, what it does, stat, rank and uses are saved as whole rows, one undo step each', () => {
    const ctx = open();
    change(ctx.inspector.querySelector(path(1, 'name')), '  Rallying   Horn ');
    assert.equal(saved(ctx)[1].name, 'Rallying Horn');
    change(ctx.inspector.querySelector(path(1, 'about')), 'A blast that rallies the party.');
    change(ctx.inspector.querySelector(path(1, 'stat')), 'DEX');
    change(ctx.inspector.querySelector(path(1, 'rank')), 'master');
    press(cards(ctx)[1], 'Mana');
    assert.deepEqual(saved(ctx)[1], { name: 'Rallying Horn', about: 'A blast that rallies the party.', stat: 'DEX', uses: 'mana', rank: 'master' });
    assert.deepEqual(saved(ctx)[0], three()[0]);
    ctx.history.undo(); ctx.render();
    assert.equal(saved(ctx)[1].uses, 'stamina');
});

test('a skill written without uses or rank shows the defaults and is written out in full once edited', () => {
    const ctx = open(withSkills([{ name: 'Spark', about: 'A small burst.', stat: 'int' }]));
    assert.equal(ctx.inspector.querySelector(path(0, 'rank')).value, 'novice');
    assert.equal(cards(ctx)[0].querySelectorAll('.cf-seg button')[0].getAttribute('aria-pressed'), 'true');
    change(ctx.inspector.querySelector(path(0, 'about')), 'A bigger burst.');
    assert.deepEqual(saved(ctx)[0], { name: 'Spark', about: 'A bigger burst.', stat: 'INT', uses: 'stamina', rank: 'novice' });
});

test('move up and down changes the slot order; Remove drops a skill, and the last one takes the field away', () => {
    const ctx = open();
    press(cards(ctx)[2], 'Move skill 3 up');
    assert.deepEqual(saved(ctx).map(item => item.name), ['Long Watch Cleave', 'Hold the Line', 'Beacon Call']);
    assert.equal(buttons(cards(ctx)[0], 'Move skill 1 up')[0].disabled, true);
    assert.equal(buttons(cards(ctx)[2], 'Move skill 3 down')[0].disabled, true);
    press(cards(ctx)[0], 'Remove skill 1');
    press(cards(ctx)[0], 'Remove skill 1');
    press(cards(ctx)[0], 'Remove skill 1');
    assert.equal(ctx.model.document.content.cast[0].skills, undefined);
    assert.deepEqual(ctx.model.validation.errors, []);
});

test('a name that repeats is refused under its field and in Problems; the pack cannot be exported until it is mended', () => {
    const ctx = open();
    change(ctx.inspector.querySelector(path(2, 'name')), 'beacon call');
    assert.equal(saved(ctx)[2].name, 'beacon call', 'the edit is kept, with the checker’s message under it, as for every cast field');
    assert.match(cards(ctx)[2].querySelector('.cf-error').textContent, /skills\[2\]\.name repeats "beacon call"/);
    assert.match(ctx.inspector.querySelector('.warning').textContent, /a person names each skill once/);
    const duplicate = open(withSkills([skill('Beacon Call'), skill('Beacon Call')]));
    assert.match(cards(duplicate)[1].querySelector('.cf-error').textContent, /skills\[1\]\.name repeats "Beacon Call"; a person names each skill once\./);
    assert.equal(cards(duplicate)[1].querySelector(path(1, 'name')).getAttribute('aria-invalid'), 'true');
    assert.throws(() => exportPack(duplicate.model));
});

test('too many rows from a hand-edited pack: all of them show, the list message sits under the last card and Add is off', () => {
    const six = Array.from({ length: 6 }, (_, n) => skill(`Skill ${n + 1}`));
    const ctx = open(withSkills(six));
    assert.equal(cards(ctx).length, 6);
    assert.equal(section(ctx).querySelector('legend').textContent, 'Signature skills · 6 of 5');
    assert.match(section(ctx).querySelectorAll('.cf-error').at(-1).textContent, /skills must be a list of 1 to 5 skills/);
    assert.equal(buttons(section(ctx), '+ Add skill')[0].disabled, true);
    assert.ok(ctx.inspector.querySelector('.warning'), 'the person’s problems are listed at the top');
});

test('a key the checker does not know sits on its card', () => {
    const ctx = open(withSkills([skill('A', { level: 3 })]));
    assert.match(cards(ctx)[0].querySelector('.cf-error').textContent, /"level" is not a skill field/);
});

test('the list says how many skills a person has', () => {
    const model = openPack(withSkills(three()));
    assert.deepEqual(cardTags(model, model.document.content.cast[0]), ['3 secrets', 'drawn to 2', '3 skills', 'portrait missing']);
    const one = openPack(withSkills([skill('Hold')]));
    assert.ok(cardTags(one, one.document.content.cast[0]).includes('1 skill'));
    const ctx = open();
    ctx.select('cast');
    assert.deepEqual(ctx.main.querySelectorAll('button.record-card')[0].querySelectorAll('.cc-tag').map(tag => tag.textContent), ['3 secrets', 'drawn to 2', '3 skills', 'portrait missing']);
});

test('the cast check counts the signature skills', () => {
    const lines = castCheck(openPack(withSkills(three())));
    assert.ok(lines.some(line => line.level === 'ok' && line.text === 'Signature skills: 3 for 1 person, each filled into a skill slot when they join.'));
    assert.ok(!castCheck(openPack(castPack())).some(line => /Signature skills/.test(line.text)));
});

test('export writes cast[].skills where they were written, and the bytes come back as they went in', () => {
    const text = JSON.stringify(withSkills(three()), null, 2) + '\n';
    const model = openPack(text);
    assert.deepEqual(model.validation.errors, []);
    assert.equal(exportPack(model), text);
    // An edit elsewhere re-serialises: the skills stay, in their place among the person's keys, and the other people are untouched.
    const edited = setSchemaField(model, ['content', 'cast', 0, 'voice'], 'Quiet.');
    assert.equal(edited.ok, true, JSON.stringify(edited.errors));
    const out = JSON.parse(exportPack(edited.model)).content.cast;
    assert.deepEqual(out[0].skills, three());
    assert.deepEqual(Object.keys(out[0]), Object.keys(JSON.parse(text).content.cast[0]));
    assert.deepEqual(out[1], JSON.parse(text).content.cast[1]);
    assert.deepEqual(JSON.parse(exportPack(openPack(exportPack(edited.model)))).content.cast[0].skills, three());
});

test('a skill edited in the form goes out in the exported pack and opens again', () => {
    const ctx = open(castPack());
    press(section(ctx), '+ Add skill');
    change(ctx.inspector.querySelector(path(0, 'name')), 'Long Watch Cleave');
    change(ctx.inspector.querySelector(path(0, 'about')), 'A two-handed sweep.');
    const text = exportPack(ctx.model);
    assert.deepEqual(JSON.parse(text).content.cast[0].skills, [{ name: 'Long Watch Cleave', about: 'A two-handed sweep.', stat: 'STR', uses: 'stamina', rank: 'novice' }]);
    assert.deepEqual(openPack(text).validation.errors, []);
});

test('the browser draft keeps the skills, including ones the checker refuses, so nothing typed is lost', () => {
    const store = new Map();
    const win = { localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) } };
    for (const skills of [three(), [skill('A'), skill('a')]]) {
        const model = openPack(withSkills(skills));
        assert.equal(writeDraft(win, model, true), true);
        const back = readDraft(win);
        assert.deepEqual(back.model.document.content.cast[0].skills, skills);
        assert.deepEqual(back.model.validation.errors.map(error => error.message), model.validation.errors.map(error => error.message));
    }
});
