import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPack, exportPack } from '../src/model.js';
import { setRecords } from '../src/edits.js';
import { renderScreen } from '../src/screens/index.js';
import { createTestContext } from './helpers/dom.js';
import { readCondition } from '../src/timeline/condition.js';
import { parse } from '../vendor/story-block/src/v2/events/condition.js';

const ersveil = readFileSync(new URL('./fixtures/ersveil-open-world.json', import.meta.url), 'utf8');
const base = events => ({
    id: 'tl', version: '1.0.0', name: 'Timeline pack', requires: { storyBlock: '^2' },
    calendar: { era: 'CY', months: ['Dawnwane', 'Rainmoot', 'Greengale'].map(name => ({ name, days: 30 })), start: { year: 613, month: 'Rainmoot', day: 1 } },
    content: { places: [{ slug: 'auvoth', name: 'Auvoth', region: 'Auvoth Compact', x: 0, y: 0 }, { slug: 'terrace', name: 'The Terrace', region: 'Shornmarch', x: 1, y: 0 }], events },
});
const open = (pack, kind = 'events', id = null) => {
    const ctx = createTestContext(typeof pack === 'string' || pack.document ? pack : openPack(pack));
    ctx.onRender = renderScreen;
    ctx.select(kind, id);
    return ctx;
};
const events = ctx => ctx.model.document.content.events;
const find = (ctx, selector) => ctx.inspector.querySelector(selector);
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent({ type: 'change', target: node, preventDefault() {} }); };
const click = (ctx, text, scope = 'button') => {
    const node = [...ctx.inspector.querySelectorAll(scope), ...ctx.main.querySelectorAll(scope)].find(item => item.textContent === text);
    assert.ok(node, `no ${scope} “${text}”`);
    node.click();
};
const check = (ctx, text, on) => {
    const label = ctx.inspector.querySelectorAll('label').find(item => item.textContent.includes(text));
    assert.ok(label, text);
    const box = label.querySelector('input');
    box.checked = on;
    change(box);
};
const aria = (name, tag = '') => `${tag}[aria-label="${name}"]`;

test('the section is the Timeline: events by story year, what follows nested, dateless ones last', () => {
    const ctx = open(ersveil);
    const text = ctx.main.textContent;
    assert.ok(text.startsWith('Timeline'));
    assert.match(text, /7 events · hidden from players/);
    assert.match(text, /Players never see these\./);
    const titles = ctx.main.querySelectorAll('h2').map(node => node.textContent);
    assert.deepEqual(titles, ['CY 611 · the story starts Goldwane 12', 'CY 612', 'CY 613', 'Any date · by place only']);
    const rows = ctx.main.querySelectorAll('button.tl-row');
    assert.deepEqual(rows.map(row => row.getAttribute('data-id')), ['bluewatch-guild-board', 'bluewatch-signal-braziers', 'the-turning-611', 'the-turning-612', 'the-turning-613', 'ghost-fleet-waters', 'wailing-battlefield-nights']);
    assert.ok(rows[1].classList.contains('tl-chain'));
    assert.ok(!rows[0].classList.contains('tl-chain'));
    assert.match(rows[0].textContent, /Goldwane 12from 6:40 am/);
    assert.match(rows[1].textContent, /6:40 – 8:00 pm/);
    assert.match(rows[1].textContent, /after: Bluewatch guild board/);
    assert.match(rows[2].textContent, /Frostfall 21– Deepwinter 30/);
    assert.match(rows[2].textContent, /\+2 regions/);
    assert.match(rows[5].textContent, /Any time/);
    assert.match(rows[5].textContent, /every visit/);
});

test('a delayed event sits under the one it follows, with "N days later"', () => {
    const ctx = open(base([
        { id: 'cracks', when: "time() != null && time() >= 318153600", cue: 'Cracks.', then: [{ command: 'chronicle.lasting', payload: { name: 'Cracks in the seal', state: 'looming' } }] },
        { id: 'seal-fails', after: 'cracks', when: "query('chronicle.passed', { name: 'Cracks in the seal', minutes: 86400 })", cue: 'It fails.' },
        { id: 'right-away', after: 'cracks', when: 'true', cue: 'Straight away.' },
    ]));
    const rows = ctx.main.querySelectorAll('button.tl-row');
    assert.deepEqual(rows.map(row => row.getAttribute('data-id')), ['cracks', 'right-away', 'seal-fails']);
    assert.match(rows[1].textContent, /right after/);
    assert.match(rows[2].textContent, /60 days later/);
});

test('the List keeps the plain view, with the same switch and form', () => {
    const ctx = open(ersveil);
    click(ctx, 'List');
    assert.equal(ctx.main.querySelectorAll('button.tl-row').length, 0);
    assert.equal(ctx.main.querySelectorAll('button.record-card').length, 7);
    assert.ok(ctx.main.textContent.startsWith('Timeline'));
    ctx.select('events', 'ghost-fleet-waters');
    assert.ok(find(ctx, aria('Event name')));
    click(ctx, 'Timeline');
    assert.equal(ctx.main.querySelectorAll('button.tl-row').length, 7);
});

test('a condition Studio wrote reopens in the form', () => {
    const ctx = open(ersveil, 'events', 'the-turning-612');
    assert.equal(find(ctx, aria('From day')).value, '21');
    assert.equal(find(ctx, aria('From month')).value, '8');
    assert.equal(find(ctx, aria('From year')).value, '612');
    assert.equal(find(ctx, aria('From time of day')).value, 'midnight');
    assert.equal(find(ctx, aria('Until day')).value, '30');
    assert.equal(find(ctx, aria('Until time of day')).value, 'exact');
    assert.equal(find(ctx, aria('Until exact time')).value, '23:59');
    assert.equal(ctx.inspector.querySelectorAll('.tl-chips button').length, 5);
    assert.match(ctx.inspector.textContent, /When this fires: on the first reply at or after the start of Frostfall 21, CY 612, until the end of Deepwinter 30, CY 612, while the party is in River Confederacy: Bluewatch/);
    assert.deepEqual(ctx.notifications, []);
});

test('a condition written by hand is shown as such and kept byte for byte, whatever else is edited', () => {
    const when = "has('Rope') && time() != null && time() >= 100";
    const ctx = open(base([{ id: 'rope', when, cue: 'A rope.', once: false }]), 'events', 'rope');
    assert.equal(ctx.inspector.textContent.split('Written by hand: edit it under Advanced.').length - 1, 2);
    assert.equal(ctx.inspector.querySelectorAll('.tl-pick').length, 0);
    change(find(ctx, aria('News the AI is told')), 'A long rope.');
    check(ctx, 'Happens once', true);
    check(ctx, 'Add to Story Director', true);
    const [record] = events(ctx);
    assert.equal(record.when, when);
    assert.equal(record.cue, 'A long rope.');
    assert.equal(record.once, true);
    assert.equal(record.then[0].command, 'chronicle.lasting');
    click(ctx, 'Use the form instead');
    assert.equal(events(ctx)[0].when, 'true');
});

test('an exported pack is unchanged unless an event is edited', () => {
    const model = openPack(ersveil);
    const ctx = open(model, 'events', 'the-turning-611');
    ctx.select('events', 'ghost-fleet-waters');
    click(ctx, 'List');
    assert.equal(exportPack(ctx.model), ersveil);
});

test('a new event starts with no condition; choosing a date writes it from the form', () => {
    const ctx = open(base([]));
    click(ctx, '+ Add event');
    assert.equal(ctx.selection.id, 'new-event');
    assert.equal(events(ctx)[0].when, 'true');
    change(find(ctx, aria('Event name')), 'The seventh seal fails');
    assert.equal(ctx.selection.id, 'the-seventh-seal-fails');
    click(ctx, 'On a date');
    // The story starts Rainmoot 1, CY 613: day 30 + 613 years of 90 days.
    assert.equal(events(ctx)[0].when, `time() != null && time() >= ${(613 * 90 + 30) * 1440}`);
    change(find(ctx, aria('From day')), '5');
    change(find(ctx, aria('From time of day')), 'dusk');
    assert.equal(events(ctx)[0].when, `time() != null && time() >= ${(613 * 90 + 34) * 1440 + 1140}`);
    change(find(ctx, aria('Until day')), '8');
    assert.match(ctx.inspector.textContent, /Fill in the day, month and year/);
    change(find(ctx, aria('Until month')), '1');
    change(find(ctx, aria('Until year')), '613');
    assert.equal(events(ctx)[0].when, `time() != null && time() >= ${(613 * 90 + 34) * 1440 + 1140} && time() < ${(613 * 90 + 37 + 1) * 1440}`);
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    ctx.history.undo(); ctx.render();
    assert.ok(!/time\(\) < /.test(events(ctx)[0].when));
});

test('a day the month does not have is explained and nothing is saved', () => {
    const ctx = open(base([{ id: 'a', when: 'true', cue: 'x' }]), 'events', 'a');
    click(ctx, 'On a date');
    const before = events(ctx)[0].when;
    change(find(ctx, aria('From day')), '31');
    assert.match(ctx.inspector.textContent, /Rainmoot has 30 days in 613/);
    assert.equal(events(ctx)[0].when, before);
});

test('places and regions are searched, chosen and removed, and written as the pack\'s own events write them', () => {
    const ctx = open(base([{ id: 'a', when: 'true', cue: 'x' }]), 'events', 'a');
    click(ctx, 'Only in…');
    const search = find(ctx, aria('Add a region or place'));
    assert.match(search.getAttribute('placeholder'), /Search 2 places and 2 regions/);
    search.value = 'auv';
    search.dispatchEvent({ type: 'input', target: search });
    const results = ctx.inspector.querySelectorAll('button.tl-result').map(node => node.textContent);
    assert.deepEqual(results, ['Auvoth Compact · region', 'Auvoth · place']);
    click(ctx, 'Auvoth Compact · region');
    assert.equal(events(ctx)[0].when, "query('scene.place') != null && (query('scene.place').region == 'Auvoth Compact')");
    const again = find(ctx, aria('Add a region or place'));
    again.value = 'terr';
    again.dispatchEvent({ type: 'input', target: again });
    click(ctx, 'The Terrace · place');
    assert.equal(events(ctx)[0].when, "query('scene.place') != null && (query('scene.place').region == 'Auvoth Compact' || query('scene.place').name == 'The Terrace')");
    assert.deepEqual(readCondition(events(ctx)[0].when).where.map(place => place.name), ['Auvoth Compact', 'The Terrace']);
    click(ctx, 'Auvoth Compact ✕');
    click(ctx, 'The Terrace ✕');
    assert.equal(events(ctx)[0].when, 'true');
});

test('a delay after another event needs that event\'s Lasting change, then counts from it', () => {
    const ctx = open(base([
        { id: 'cracks', when: 'true', cue: 'Cracks.' },
        { id: 'seal-fails', when: 'true', cue: 'It fails.' },
    ]), 'events', 'seal-fails');
    click(ctx, 'After another event');
    assert.equal(events(ctx)[1].after, 'cracks');
    assert.equal(events(ctx)[1].when, 'true');
    assert.ok(find(ctx, aria('Delay')).disabled);
    assert.match(ctx.inspector.textContent, /Give “Cracks” a Lasting change first: the days count from when it enters the chronicle\./);
    ctx.select('events', 'cracks');
    check(ctx, 'Add to Story Director', true);
    change(find(ctx, aria('World event')), 'Cracks in the seventh seal');
    click(ctx, 'Looming');
    ctx.select('events', 'seal-fails');
    assert.ok(!find(ctx, aria('Delay')).disabled);
    change(find(ctx, aria('Delay')), '60');
    assert.equal(events(ctx)[1].when, "query('chronicle.passed', { name: 'Cracks in the seventh seal', minutes: 86400 })");
    assert.equal(events(ctx)[1].after, 'cracks');
    assert.equal(parse(events(ctx)[1].when).ok, true);
    change(find(ctx, aria('Delay unit')), 'hours');
    assert.match(events(ctx)[1].when, /minutes: 3600 \}\)$/);
    change(find(ctx, aria('Delay unit')), 'months');
    assert.match(events(ctx)[1].when, /minutes: 2592000 \}\)$/);
    assert.equal(find(ctx, aria('Delay')).value, '60');
    assert.match(ctx.inspector.textContent, /When this fires: at least 1800 days after “Cracks”/);
    change(find(ctx, aria('Delay unit')), 'days');
    change(find(ctx, aria('Delay')), '45');
    click(ctx, 'Only in…');
    change(find(ctx, aria('Add a region or place')));
    const search = find(ctx, aria('Add a region or place'));
    search.value = 'Shorn';
    search.dispatchEvent({ type: 'input', target: search });
    click(ctx, 'Shornmarch · region');
    assert.equal(events(ctx)[1].when, "query('chronicle.passed', { name: 'Cracks in the seventh seal', minutes: 64800 }) && query('scene.place') != null && (query('scene.place').region == 'Shornmarch')");
    assert.match(ctx.inspector.textContent, /at least 45 days after “Cracks”.*while the party is in Shornmarch/);
    // Reopened, the form reads it back.
    ctx.select('events', 'cracks'); ctx.select('events', 'seal-fails');
    assert.equal(find(ctx, aria('Delay')).value, '45');
    assert.equal(find(ctx, aria('Delay unit')).value, 'days');
    assert.equal(ctx.model.validation.ok, true, JSON.stringify(ctx.model.validation.errors));
    // Renaming the world event the delay counts from keeps the delay with it.
    ctx.select('events', 'cracks');
    change(find(ctx, aria('World event')), 'Cracks widen');
    assert.match(events(ctx)[1].when, /name: 'Cracks widen', minutes: 64800/);
});

test('Lasting change writes the chronicle command, within the limits Story Director keeps', () => {
    const ctx = open(base([{ id: 'seal-fails', when: 'true', cue: 'It fails.', once: true }]), 'events', 'seal-fails');
    assert.equal(events(ctx)[0].then, undefined);
    check(ctx, 'Add to Story Director', true);
    assert.deepEqual(events(ctx)[0].then, [{ command: 'chronicle.lasting', payload: { name: 'Seal fails', state: 'ongoing' } }]);
    change(find(ctx, aria('World event')), 'Seventh seal failed');
    click(ctx, 'Resolved');
    click(ctx, 'Ongoing');
    change(find(ctx, aria('Place')), 'Auvoth');
    change(find(ctx, aria('Summary')), 'The seal is broken.');
    check(ctx, 'Keep in mind', true);
    click(ctx, '+ faction');
    const input = find(ctx, aria('New faction'));
    input.value = 'Sealwardens';
    click(ctx, 'Add');
    click(ctx, '+ faction');
    find(ctx, aria('New faction')).value = 'Adventurer Guild';
    click(ctx, 'Add');
    assert.deepEqual(events(ctx)[0].then, [{ command: 'chronicle.lasting', payload: { name: 'Seventh seal failed', state: 'ongoing', place: 'Auvoth', summary: 'The seal is broken.', keep: true, factions: ['Sealwardens', 'Adventurer Guild'] } }]);
    click(ctx, 'Sealwardens ✕');
    assert.deepEqual(events(ctx)[0].then[0].payload.factions, ['Adventurer Guild']);
    check(ctx, 'Keep in mind', false);
    assert.equal(Object.hasOwn(events(ctx)[0].then[0].payload, 'keep'), false);
    // Over a limit it is refused, with the reason, and the pack stays as it was.
    const before = JSON.stringify(events(ctx));
    change(find(ctx, aria('Summary')), 's'.repeat(241));
    assert.match(ctx.notifications.at(-1), /summary must be text of at most 240 characters/);
    change(find(ctx, aria('World event')), ' ');
    assert.match(ctx.notifications.at(-1), /name must be 1 to 80 characters/);
    assert.equal(JSON.stringify(events(ctx)), before);
    check(ctx, 'Add to Story Director', false);
    assert.equal(events(ctx)[0].then, undefined);
});

test('the Advanced fold shows and edits when, after and then', () => {
    const ctx = open(base([{ id: 'a', when: 'true', cue: 'x' }, { id: 'b', when: 'true', cue: 'y' }]), 'events', 'a');
    assert.equal(find(ctx, aria('when')).value, 'true');
    change(find(ctx, aria('when')), "time() != null && time() >= 1440");
    assert.equal(events(ctx)[0].when, 'time() != null && time() >= 1440');
    assert.equal(find(ctx, aria('From day')).value, '2');
    change(find(ctx, aria('after')), 'b');
    assert.equal(events(ctx)[0].after, 'b');
    change(find(ctx, aria('then')), '[{ "command": "wallet.receive", "payload": { "amount": 3 } }]');
    assert.equal(events(ctx)[0].then[0].command, 'wallet.receive');
    change(find(ctx, aria('then')), 'not json');
    assert.match(ctx.notifications.at(-1), /not valid JSON/);
    change(find(ctx, aria('after')), '');
    assert.equal(Object.hasOwn(events(ctx)[0], 'after'), false);
});

test('renaming an event moves what follows it, and an event cannot be made to follow itself in a loop', () => {
    const ctx = open(base([
        { id: 'first', when: 'true', cue: 'x', once: true },
        { id: 'second', after: 'first', when: 'true', cue: 'y' },
    ]), 'events', 'first');
    change(find(ctx, aria('Event name')), 'The first thing');
    assert.equal(ctx.selection.id, 'the-first-thing');
    assert.equal(events(ctx)[1].after, 'the-first-thing');
    // The only other event follows this one, so it cannot be the one this follows.
    ctx.select('events', 'the-first-thing');
    const button = ctx.inspector.querySelectorAll('button').find(item => item.textContent === 'After another event');
    assert.equal(button.disabled, true);
});

test('a problem with an event\'s lasting change shows on its row and in its inspector', () => {
    const model = openPack(base([{ id: 'a', when: 'true', cue: 'x', then: [{ command: 'chronicle.lasting', payload: { name: 'N', state: 'soon' } }] }]));
    const ctx = open(model, 'events', 'a');
    assert.match(ctx.inspector.textContent, /state must be looming, ongoing or resolved/);
    assert.equal(ctx.main.querySelectorAll('button.tl-row')[0].getAttribute('data-has-problem'), 'true');
});

test('several events change in one edit (one undo), and only the events that are there', () => {
    const model = openPack(base([{ id: 'a', when: 'true', cue: 'x' }, { id: 'b', when: 'true', cue: 'y' }]));
    const events = model.document.content.events;
    const changed = setRecords(model, 'events', [{ ...events[0], cue: 'one' }, { ...events[1], cue: 'two' }]);
    assert.equal(changed.ok, true, JSON.stringify(changed.errors));
    assert.deepEqual(changed.model.document.content.events.map(event => event.cue), ['one', 'two']);
    assert.equal(changed.undo(), model);
    assert.equal(setRecords(model, 'events', [events[1], events[0]]).ok, false);
    assert.equal(setRecords(model, 'events', [events[0]]).ok, false);
    assert.equal(setRecords(model, 'events', [events[0], { ...events[1], id: 'c' }]).ok, false);
});
