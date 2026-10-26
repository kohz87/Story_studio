// Data modules in a real browser: both worked examples from DATA_MODULES.md authored end to end through the forms,
// the expression editor and the JSON repair view; Story Block's verdict on screen; the simulator on Story Block's own
// runtime (a test-only page without the runtime shows the waiting state); refusals; references; and the guarantees:
// byte-identical export of untouched data, no requests, no page errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingDist } from './helpers/dm-waiting-dist.js';
import { SHIPPED, withPage, upload, openDataModules, section, verdict, waitAccepted, control, fill, choose, tick, exportedPack } from './helpers/dm-browser.js';
import { factionsText, survivalText, factions, survival, linked } from './fixtures/data-modules/index.js';

const blank = (id, name, capabilities = ['data-modules-v1']) => JSON.stringify({ id, version: '1.0.0', name, requires: { storyBlock: '^2', capabilities }, content: {} }, null, 2);

async function newModule(page, slug, name) {
    await page.getByRole('button', { name: 'New module', exact: true }).click();
    await page.locator('#dm-slug').fill(slug);
    await page.locator('#dm-name').fill(name);
}

async function addField(page, name, type) {
    await section(page, 'Fields');
    await choose(page.locator('#dm-section'), 'New field type', type);
    await page.locator('#dm-section [aria-label="New field name"]').fill(name);
    await page.getByRole('button', { name: 'Add field', exact: true }).click();
    return page.locator(`[data-field="${name}"]`);
}

/** Chooses an operator in the `index`th expression editor of `scope`. */
const operator = (scope, name, index = 0) => choose(scope, 'Operator', name, index);

async function applyModule(page) {
    await page.waitForTimeout(200);
    await page.locator('#dm-apply').click();
}

async function savedModules(page) {
    const bytes = await exportedPack(page);
    return JSON.parse(bytes.toString('utf8')).content.dataModules;
}

test('Example A: author the Ersveil faction standing module through the forms, then simulate it', { timeout: 120000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, blank('ersveil-factions', 'Ersveil faction standing'));
        await openDataModules(page);
        await newModule(page, 'reputation', 'Reputation');

        // Fields: a map with three fixed keys, and a two-value enum latch.
        const standing = await addField(page, 'standing', 'map');
        await fill(standing, 'Fixed keys (one per line)', 'guild\nwatch\ncompact');
        await fill(standing, 'Minimum', -100);
        await fill(standing, 'Maximum', 100);
        const title = await addField(page, 'title', 'enum');
        await fill(title, 'Values (one per line)', 'none\nGuild Friend');
        await choose(title, 'Default', 'none');

        // Reward template: the narrator picks a faction, the code picks the amount.
        await section(page, 'Rewards');
        await page.locator('[aria-label="New template name"]').fill('favour');
        await page.getByRole('button', { name: 'Add template', exact: true }).click();
        const favour = page.locator('[data-template="favour"]');
        await favour.locator('[aria-label="New binding name for favour"]').fill('faction');
        await favour.getByRole('button', { name: 'Add binding to favour' }).click();
        await fill(favour.locator('[aria-label="Values (one per line)"]').locator('..').locator('..'), 'Values (one per line)', 'guild\nwatch\ncompact');
        await favour.locator('[aria-label="New effect operation for template favour"]').selectOption('add');
        await favour.getByRole('button', { name: 'Add effect to template favour' }).click();
        await choose(favour, 'Key from', 'expr');
        await choose(favour, 'Reward binding', 'faction');
        await operator(favour.locator('.effect-slot').first(), 'reward');
        await choose(favour, 'Reward value', 'amount');
        await choose(favour, 'Bounds', 'clamp');

        // Kinds: gain (an enum label, once per faction, grants the reward) and loss (a clamped -5).
        await section(page, 'Kinds');
        for (const [kind, op] of [['gain', '+'], ['loss', '-']]) {
            await page.locator('[aria-label="New kind name"]').fill(kind);
            await page.getByRole('button', { name: 'Add kind', exact: true }).click();
            const box = page.locator(`[data-kind="${kind}"]`);
            await choose(box, `Line operator for ${kind}`, op);
            await box.locator(`[aria-label="New label name for ${kind}"]`).fill('faction');
            await box.getByRole('button', { name: `Add label to ${kind}` }).click();
            const label = box.locator('[data-label="faction"]');
            await choose(label, 'Type', 'enum');
            await fill(label, 'Values (one per line)', 'guild\nwatch\ncompact');
            await tick(box, `${kind}: once per reply for each faction`);
        }
        const gain = page.locator('[data-kind="gain"]');
        await choose(gain, 'New effect operation for kind gain', 'reward');
        await gain.getByRole('button', { name: 'Add effect to kind gain' }).click();
        await choose(gain, 'Template', 'favour');
        await operator(gain.locator('.effect-slot').first(), 'arg');
        await choose(gain, 'Line label', 'faction');
        const loss = page.locator('[data-kind="loss"]');
        await choose(loss, 'New effect operation for kind loss', 'add');
        await loss.getByRole('button', { name: 'Add effect to kind loss' }).click();
        await choose(loss, 'Key from', 'expr');
        await choose(loss, 'Line label', 'faction');
        await fill(loss, 'Literal', -5);
        await choose(loss, 'Bounds', 'clamp');

        // A rule, built from typed slots: guild standing of 6 or more, and no title yet.
        await section(page, 'Rules');
        await page.getByRole('button', { name: 'Add rule', exact: true }).click();
        const rule = page.locator('[data-rule="rule"]');
        await fill(rule, 'Rule id (1)', 'guild-title');
        const when = rule.locator('.effect-slot').first().locator(':scope > .expr');
        const head = e => e.locator(':scope > [aria-label="Operator"]');
        const slot = (e, i) => e.locator(':scope > .expr-slots > .expr-slot').nth(i).locator(':scope > .expr');
        const slotBox = (e, i) => e.locator(':scope > .expr-slots > .expr-slot').nth(i);
        await head(when).selectOption('and');
        await head(slot(when, 0)).selectOption('ge');
        await head(slot(slot(when, 0), 0)).selectOption('get');
        await choose(slotBox(slot(when, 0), 0), 'Key', 'guild');
        await fill(slotBox(slot(when, 0), 1), 'Literal', 6);
        await head(slot(when, 1)).selectOption('eq');
        await head(slot(slot(when, 1), 0)).selectOption('get');
        await choose(slotBox(slot(when, 1), 0), 'Field', 'title');
        await choose(slotBox(slot(when, 1), 1), 'Literal', 'none');
        await rule.locator('[aria-label^="New effect operation for rule"]').selectOption('set');
        await rule.getByRole('button', { name: /^Add effect to rule/ }).click();
        const then = page.locator('[data-rule="guild-title"] .effects');
        await choose(then, 'Field', 'title');
        await choose(then, 'Literal', 'Guild Friend');

        await section(page, 'Exports');
        await page.locator('[aria-label="New export name"]').fill('standing');
        await page.getByRole('button', { name: 'Add export', exact: true }).click();
        await tick(page.locator('[data-export="standing"]'), 'standing exports standing');
        await tick(page.locator('[data-export="standing"]'), 'standing exports title');

        // The screens in the example are Part 4 layout JSON: the repair view carries them, keeping every key.
        const fixture = factions().content.dataModules[0];
        await section(page, 'Record JSON');
        const area = page.locator('#dm-json');
        const record = JSON.parse(await area.inputValue());
        record.screens = fixture.screens;
        await area.fill(JSON.stringify(record, null, 2));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        await waitAccepted(page);
        await applyModule(page);
        const [saved] = await savedModules(page);
        assert.deepEqual(saved, fixture);

        const beforeSimulation = (await exportedPack(page)).toString('utf8');

        // Simulate the three replies from the design: Guild 0 -> 3 -> 6 with the title, Watch 0 -> -5.
        await openDataModules(page);
        await page.getByRole('button', { name: '1. Reputation' }).click();
        await section(page, 'Simulator');
        const lines = [
            '+ dm reputation \u2014 repaired the Guild\u2019s weir | kind: gain | faction: guild',
            '+ dm reputation \u2014 brought back the register | kind: gain | faction: guild',
            '- dm reputation \u2014 broke the Watch\u2019s seal | kind: loss | faction: watch',
        ];
        for (const [index, line] of lines.entries()) {
            await page.getByRole('button', { name: 'Add reply', exact: true }).click();
            await fill(page, `Step ${index + 1} text`, `<Changes>\n${line}\n</Changes>`);
        }
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        const final = JSON.parse(await page.locator('#dm-sim-final').innerText());
        assert.deepEqual(final, { standing: { guild: 6, watch: -5, compact: 0 }, title: 'Guild Friend' });
        assert.match(await page.locator('[data-sim-step="1"] .sim-card').innerText(), /standing\.guild 3 \u2192 6/);

        // Deleting the second gain retracts its +3 and the title together; the later loss stays active because
        // its recorded condition answers are unchanged.
        await page.getByRole('button', { name: 'Delete step 2', exact: true }).click();
        const whatIf = await page.locator('#dm-sim-whatif').innerText();
        assert.match(whatIf, /standing\.guild: 6 \u2192 3/);
        assert.match(whatIf, /title: Guild Friend \u2192 none/);
        assert.doesNotMatch(whatIf, /Step 3:|REPLAY_PREREQUISITE/);
        assert.match(await page.locator('#dm-sim-output').innerText(), /watch.*-5/s);
        assert.match(whatIf, /Cold replay from the saved chat matches the live state\./);
        await page.getByRole('button', { name: 'Delete step 1', exact: true }).click();
        const firstDeleted = await page.locator('#dm-sim-whatif').innerText();
        assert.match(firstDeleted, /Step 2: applied \u2192 inactive/);
        assert.doesNotMatch(firstDeleted, /Step 3: applied \u2192 inactive/);
        assert.match(firstDeleted, /REPLAY_PREREQUISITE/);
        assert.match(firstDeleted, /"watch": -5/);
        assert.match(firstDeleted, /Cold replay from the saved chat matches the live state\./);
        // Simulation never writes to the author document: the pack still exports exactly as before.
        assert.equal((await exportedPack(page)).toString('utf8'), beforeSimulation);
    });
});

test('Example B: author the Ersveil survival meters (imports, timer, character scope) through the forms, then simulate time', { timeout: 120000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, blank('ersveil-survival', 'Ersveil survival meters', ['data-modules-v1', 'story-director']));
        await openDataModules(page);
        await newModule(page, 'survival', 'Survival');
        await choose(page, 'Scope', 'character');

        await section(page, 'Imports');
        for (const [adapter, alias] of [['sd-minutes', 'clock'], ['sd-actors', 'actors']]) {
            await choose(page.locator('#dm-section'), 'New import adapter', adapter);
            await page.locator('[aria-label="New import alias"]').fill(alias);
            await page.getByRole('button', { name: 'Add import', exact: true }).click();
        }

        for (const name of ['hunger', 'fatigue']) {
            const field = await addField(page, name, 'int');
            await fill(field, 'Default', 0);
        }

        await section(page, 'Timers');
        await page.getByRole('button', { name: 'Add timer', exact: true }).click();
        const timer = page.locator('[data-timer="timer"]');
        await fill(timer, 'Timer id (1)', 'needs');
        await choose(timer, 'Clock for timer 1', 'clock');
        await fill(timer, 'Every (minutes) for timer 1', 60);
        for (let i = 0; i < 2; i++) {
            await page.locator('[data-timer] [aria-label^="New effect operation for timer"]').selectOption('add');
            await page.locator('[data-timer]').getByRole('button', { name: /^Add effect to timer/ }).click();
        }
        const needs = page.locator('[data-timer="needs"]');
        await choose(needs, 'Field', 'fatigue', 1);
        await choose(needs, 'Bounds', 'clamp', 0);
        await choose(needs, 'Bounds', 'clamp', 1);
        const amounts = needs.locator('.effect-slot > .expr');
        await amounts.nth(0).locator(':scope > [aria-label="Operator"]').selectOption('mul');
        await amounts.nth(0).locator(':scope > .expr-slots > .expr-slot').nth(0).locator(':scope > .expr > [aria-label="Operator"]').selectOption('timer');
        await amounts.nth(0).locator(':scope > .expr-slots > .expr-slot').nth(1).locator(':scope > .expr > [aria-label="Operator"]').selectOption('');
        await fill(amounts.nth(0).locator(':scope > .expr-slots > .expr-slot').nth(1), 'Literal', 2);
        await amounts.nth(1).locator(':scope > [aria-label="Operator"]').selectOption('timer');

        await section(page, 'Kinds');
        for (const kind of ['meal', 'rest']) {
            await page.locator('[aria-label="New kind name"]').fill(kind);
            await page.getByRole('button', { name: 'Add kind', exact: true }).click();
            const box = page.locator(`[data-kind="${kind}"]`);
            await choose(box, 'New effect operation for kind ' + kind, 'add');
            await box.getByRole('button', { name: 'Add effect to kind ' + kind }).click();
            await choose(box, 'Bounds', 'clamp');
        }
        const meal = page.locator('[data-kind="meal"]');
        await choose(meal, 'Field', 'hunger');
        await fill(meal, 'Literal', -20);
        const rest = page.locator('[data-kind="rest"]');
        await choose(rest, 'Field', 'fatigue');
        await rest.locator('[aria-label="New label name for rest"]').fill('hours');
        await rest.getByRole('button', { name: 'Add label to rest' }).click();
        await fill(rest.locator('[data-label="hours"]'), 'Maximum', 8);
        await fill(rest.locator('[data-label="hours"]'), 'Minimum', 1);
        await tick(rest, 'Has a condition (when)');
        const cond = rest.locator('.effect-slot').first().locator(':scope > .expr');
        await cond.locator(':scope > [aria-label="Operator"]').selectOption('ge');
        await cond.locator(':scope > .expr-slots > .expr-slot').nth(0).locator(':scope > .expr > [aria-label="Operator"]').selectOption('arg');
        await choose(rest, 'Line label', 'hours');
        await cond.locator(':scope > .expr-slots > .expr-slot').nth(1).locator(':scope > .expr > [aria-label="Operator"]').selectOption('');
        await fill(cond.locator(':scope > .expr-slots > .expr-slot').nth(1), 'Literal', 1);
        await fill(rest, 'Refusal text for rest', 'Rest needs 1 to 8 hours already narrated.');
        const effect = rest.locator('.effects .effect-slot > .expr').first();
        await effect.locator(':scope > [aria-label="Operator"]').selectOption('mul');
        await effect.locator(':scope > .expr-slots > .expr-slot').nth(0).locator(':scope > .expr > [aria-label="Operator"]').selectOption('arg');
        await choose(rest.locator('.effects'), 'Line label', 'hours');
        await effect.locator(':scope > .expr-slots > .expr-slot').nth(1).locator(':scope > .expr > [aria-label="Operator"]').selectOption('');
        await fill(effect.locator(':scope > .expr-slots > .expr-slot').nth(1), 'Literal', -10);
        // The label the form names, and each kind's op: meal and rest both use "!".
        await choose(meal, 'Line operator for meal', '!');
        await choose(rest, 'Line operator for rest', '!');

        await section(page, 'Exports');
        await page.locator('[aria-label="New export name"]').fill('needs');
        await page.getByRole('button', { name: 'Add export', exact: true }).click();
        await tick(page.locator('[data-export="needs"]'), 'needs exports hunger');
        await tick(page.locator('[data-export="needs"]'), 'needs exports fatigue');

        const fixture = survival().content.dataModules[0];
        await section(page, 'Record JSON');
        const area = page.locator('#dm-json');
        const record = JSON.parse(await area.inputValue());
        record.screens = fixture.screens;
        await area.fill(JSON.stringify(record, null, 2));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        await waitAccepted(page);
        await applyModule(page);
        const [saved] = await savedModules(page);
        assert.deepEqual(saved, fixture);

        await openDataModules(page);
        await page.getByRole('button', { name: '1. Survival' }).click();
        await section(page, 'Simulator');
        const replies = [
            '<Changes>\n! time +6h\n! dm survival — slept at the camp | kind: rest | who: Wessel | hours: 6\n</Changes>',
            '<Changes>\n! time +2h\n</Changes>',
            '<Changes>\n! dm survival — ate supper | kind: meal | who: Wessel\n</Changes>',
            '<Changes>\n! dm survival — slept again | kind: rest | who: Wessel | hours: 9\n</Changes>',
        ];
        for (const [index, text] of replies.entries()) {
            await page.getByRole('button', { name: 'Add reply', exact: true }).click();
            await fill(page, `Step ${index + 1} text`, text);
        }
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        const final = JSON.parse(await page.locator('#dm-sim-final').innerText());
        assert.deepEqual(final, { Wessel: { hunger: 0, fatigue: 2 } });
        const first = await page.locator('[data-sim-step="0"]').innerText();
        assert.match(first, /hunger: 0 \u2192 12/);
        assert.match(first, /Requested -60; applied -6 \(0\/100\)\./);
        assert.match(first, /"lastMinute":1360,"remainder":0/);
        assert.match(await page.locator('[data-sim-step="1"] .sim-fields').innerText(), /"hunger":16,"fatigue":2/);
        assert.match(await page.locator('[data-sim-step="3"]').innerText(), /refused/);
        assert.match(await page.locator('[data-sim-step="3"]').innerText(), /DM_LABEL \u00b7 : Survival: hours must be a whole number from 1 to 8; nothing applied\./);
    });
});

const undo = page => page.getByRole('button', { name: 'Undo', exact: true });

test('both examples open accepted by Story Block, export their bytes untouched, simulate on the runtime, and Apply then Undo restores the bytes', { timeout: 60000 }, async () => {
    for (const [text, line, expected] of [
        [factionsText(), '+ dm reputation \u2014 repaired the weir | kind: gain | faction: guild', /standing\.guild: 0 \u2192 3/],
        [survivalText(), '! dm survival \u2014 ate supper | kind: meal | who: Wessel', /"Wessel":\{"hunger":0,"fatigue":0\}/],
    ]) {
        await withPage(SHIPPED, {}, async page => {
            await upload(page, text);
            await openDataModules(page);
            await page.getByRole('button', { name: /^1\./ }).click();
            assert.equal(await verdict(page), 'Accepted by Story Block.');
            assert.equal((await exportedPack(page)).toString('utf8'), text);
            await openDataModules(page);
            await page.getByRole('button', { name: /^1\./ }).click();
            await section(page, 'Simulator');
            assert.equal(await page.locator('#dm-sim-unavailable').count(), 0, 'the shipped page has the runtime');
            await page.getByRole('button', { name: 'Add reply', exact: true }).click();
            await fill(page, 'Step 1 text', `<Changes>\n${line}\n</Changes>`);
            await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
            await page.locator('[data-sim-step="0"]').waitFor();
            assert.match(await page.locator('#dm-sim-output').innerText(), expected);
            assert.match(await page.locator('#dm-sim-replay').innerText(), /matches the live state/);
            // Applying an unchanged module is an edit that changes nothing; Undo returns the original bytes.
            await page.locator('#dm-apply').click();
            await undo(page).click();
            assert.equal((await exportedPack(page)).toString('utf8'), text);
        });
    }
});

test('a Story Block copy with the checker but no runtime: accepted, editable, and the simulator says what it needs', { timeout: 60000 }, async () => {
    await withPage(waitingDist().url, {}, async page => {
        const text = factionsText();
        await upload(page, text);
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        assert.equal(await verdict(page), 'Accepted by Story Block.');
        assert.equal(await page.locator('#dm-grammar-sb').count(), 0, 'no generated grammar text without the runtime');
        assert.equal((await exportedPack(page)).toString('utf8'), text);
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Simulator');
        assert.equal(await page.locator('#dm-sim-unavailable').innerText(), 'This needs Story Block with the data-modules runtime');
        await page.getByRole('button', { name: 'Add reply', exact: true }).click();
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        assert.equal(await page.locator('#dm-sim-waiting').innerText(), 'This needs Story Block with the data-modules runtime');
        assert.equal(await page.locator('[data-sim-step]').count(), 0);
    });
});

test('the narrator grammar Story Block generates is shown beside the Studio preview', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, factionsText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        assert.equal(await page.locator('#dm-grammar-sb').innerText(), 'Data modules in this story (write these lines exactly; a refused line changes nothing):\n+ dm reputation \u2014 reason | kind: gain | faction: guild|watch|compact\n- dm reputation \u2014 reason | kind: loss | faction: guild|watch|compact');
        assert.match(await page.locator('.dm-grammar').innerText(), /Generated by Story Block\./);
    });
});

test('refusals: an unknown key stays in a safe invalid draft beside Story Block\u2019s exact error; a refused Apply changes nothing; the repair applies and undoes', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        const text = factionsText();
        await upload(page, text);
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Record JSON');
        const area = page.locator('#dm-json');
        const record = JSON.parse(await area.inputValue());
        record.mystery = { keep: ['me'] };
        await area.fill(JSON.stringify(record, null, 2));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        assert.match(await verdict(page), /^DM_SCHEMA \u00b7 content\.dataModules\[0\]\.mystery: Unknown field "mystery"; expected slug, name, /m);
        assert.deepEqual(await page.locator('#dm-unknown li').allInnerTexts(), ['mystery']);
        await section(page, 'Fields');
        assert.ok(await page.locator('[data-field="standing"]').count(), 'the other sections still show the draft');
        await page.locator('#dm-apply').click();
        assert.match(await page.locator('.notice').innerText(), /DM_SCHEMA/);
        assert.equal((await exportedPack(page)).toString('utf8'), text, 'a refused Apply changes nothing');
        // Leaving the screen and coming back keeps the invalid draft: nothing the author typed is lost.
        await page.locator('.rail').getByRole('button', { name: /^Classes/ }).click();
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Record JSON');
        assert.ok(JSON.parse(await page.locator('#dm-json').inputValue()).mystery);
        assert.match(await verdict(page), /mystery/);
        delete record.mystery;
        record.name = 'Reputation (repaired)';
        await page.locator('#dm-json').fill(JSON.stringify(record, null, 2));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        await waitAccepted(page);
        await applyModule(page);
        assert.equal((await savedModules(page))[0].name, 'Reputation (repaired)');
        await undo(page).click();
        assert.equal((await exportedPack(page)).toString('utf8'), text);
    });
});

test('a record that is not valid JSON never reaches the draft', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, factionsText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Record JSON');
        await page.locator('#dm-json').fill('{"slug": ');
        assert.match(await page.locator('#dm-json-error').innerText(), /^JSON refused/);
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        assert.match(await page.locator('#dm-json-error').innerText(), /^JSON refused/);
        await page.locator('#dm-json').fill('[1]');
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        assert.match(await page.locator('#dm-json-error').innerText(), /JSON object/);
        await page.getByRole('button', { name: 'Reload from form', exact: true }).click();
        assert.equal(JSON.parse(await page.locator('#dm-json').inputValue()).slug, 'reputation');
    });
});

test('v1.1 features are refused with Story Block\u2019s message and never offered by the forms', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, survivalText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Record JSON');
        const area = page.locator('#dm-json');
        const record = JSON.parse(await area.inputValue());
        record.kinds.meal.check = { skill: 'survival', stat: 'wis', dc: 10 };
        record.kinds.rest.effects.push({ op: 'grantCoin', amount: 2 });
        await area.fill(JSON.stringify(record, null, 2));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        const shown = await verdict(page);
        assert.match(shown, /kinds\.meal\.check: SD checks inside a dm root need data-modules v1\.1/);
        assert.match(shown, /kinds\.rest\.effects\[1\]: grantCoin needs data-modules v1\.1/);
        await section(page, 'Kinds');
        const offered = await page.locator('[data-kind="meal"] [aria-label="New effect operation for kind meal"] option').allInnerTexts();
        assert.deepEqual(offered, ['set', 'add', 'clamp', 'reward', 'offer', 'award']);
        assert.match(await page.locator('[data-kind="rest"]').innerText(), /grantCoin \(needs data-modules v1\.1\)/);
        assert.match(await page.locator('[data-kind="meal"]').innerText(), /check: needs data-modules v1\.1/);
        await page.locator('#dm-apply').click();
        assert.match(await page.locator('.notice').innerText(), /needs data-modules v1\.1/);
    });
});

test('references: a typed rename rewrites every reference by position and one Undo restores the bytes; removal that would orphan is refused', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        const text = factionsText();
        await upload(page, text);
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'References');
        const target = page.locator('#dm-ref-target');
        const options = await target.locator('option').allInnerTexts();
        assert.ok(options.some(item => item.startsWith('field \u00b7 pack.ersveil-factions/reputation#standing')), options.join('\n'));
        await target.selectOption({ label: options.find(item => item.startsWith('field \u00b7 pack.ersveil-factions/reputation#standing')) });
        const refs = await page.locator('#dm-ref-list li').allInnerTexts();
        assert.ok(refs.length >= 3, refs.join('\n'));
        // Removing a referenced field is refused, listing every place that still uses it.
        await page.getByRole('button', { name: 'Remove target', exact: true }).click();
        assert.ok((await page.locator('#dm-ref-refused li').count()) >= 3);
        assert.equal((await exportedPack(page)).toString('utf8'), text);
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'References');
        await target.selectOption({ label: options.find(item => item.startsWith('field \u00b7 pack.ersveil-factions/reputation#standing')) });
        // A name Story Block would refuse is refused before anything changes.
        await page.locator('#dm-ref-name').fill('by_faction');
        await page.getByRole('button', { name: 'Rename target and its references', exact: true }).click();
        assert.match(await page.locator('.notice').innerText(), /DM_SCHEMA: Names are safe lowercase slugs/);
        assert.equal((await exportedPack(page)).toString('utf8'), text);
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'References');
        await target.selectOption({ label: options.find(item => item.startsWith('field \u00b7 pack.ersveil-factions/reputation#standing')) });
        await page.locator('#dm-ref-name').fill('by-faction');
        await page.getByRole('button', { name: 'Rename target and its references', exact: true }).click();
        const renamed = (await exportedPack(page)).toString('utf8');
        const pack = JSON.parse(renamed);
        const [module] = pack.content.dataModules;
        assert.ok(module.state['by-faction'] && !module.state.standing);
        assert.deepEqual(module.exports.standing.fields, ['by-faction', 'title']);
        assert.deepEqual(module.rules[0].when[1][1], ['get', ['by-faction', 'guild']]);
        assert.equal(module.screens[0].layout.root.children[0].bind.path, 'chat.by-faction.guild');
        await undo(page).click();
        assert.equal((await exportedPack(page)).toString('utf8'), text);
    });
});

test('cross-module imports: a second module reads a named export of the first, and the reference index sees it', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, JSON.stringify(linked(), null, 2));
        await openDataModules(page);
        await page.getByRole('button', { name: /^2\./ }).click();
        assert.equal(await verdict(page), 'Accepted by Story Block.');
        await section(page, 'Imports');
        const box = page.locator('[data-import="needs"]');
        assert.equal(await box.locator('[aria-label="Export imported by needs"]').inputValue(), 'needs');
        assert.equal(await box.locator('[aria-label="Module imported by needs"]').inputValue(), 'pack.ersveil-survival/survival');
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'References');
        const target = page.locator('#dm-ref-target');
        const option = (await target.locator('option').allInnerTexts()).find(item => item.startsWith('export \u00b7 pack.ersveil-survival/survival#needs'));
        assert.ok(option);
        await target.selectOption({ label: option });
        assert.ok((await page.locator('#dm-ref-list li').allInnerTexts()).some(item => item.includes('fatigue-watch') || item.includes('[1]')));
        // Removing the export while another module imports it is refused.
        await page.getByRole('button', { name: 'Remove target', exact: true }).click();
        assert.ok(await page.locator('#dm-ref-refused li').count());
    });
});

test('author text is only ever text: hostile names and descriptions render inertly in forms, grammar, verdict and simulator', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
        const pack = factions();
        const [module] = pack.content.dataModules;
        module.name = hostile;
        module.kinds.gain.refusal = hostile;
        module.kinds.gain.when = ['ne', ['get', ['title']], 'none'];
        await upload(page, JSON.stringify(pack));
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Kinds');
        assert.match(await page.locator('[data-grammar-kind="gain"]').innerText(), /Otherwise refused: <img src=x/);
        assert.equal(await page.locator('main img, main script').count(), 0);
        await section(page, 'Simulator');
        await page.getByRole('button', { name: 'Add reply', exact: true }).click();
        await fill(page, 'Step 1 text', '<Changes>\n+ dm reputation \u2014 ' + hostile + ' | kind: gain | faction: guild\n</Changes>');
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        assert.ok(await page.locator('#dm-sim-output').innerText());
        assert.equal(await page.locator('main img, main script').count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
    });
});

test('narrow screens: the Data modules forms, grammar and simulator fit 390px without horizontal scrolling', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, { width: 390, height: 800 }, async page => {
        await upload(page, survivalText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        for (const name of ['Identity', 'Fields', 'Imports', 'Kinds', 'Rules', 'Rewards', 'Timers', 'Exports', 'Migrations', 'Screens', 'Simulator', 'References', 'Record JSON']) {
            await section(page, name);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            assert.ok(overflow <= 0, `${name}: page overflows by ${overflow}px`);
            const unlabelled = await page.evaluate(() => [...document.querySelectorAll('main input, main select, main textarea')]
                .filter(node => node.type !== 'file' && !node.getAttribute('aria-label') && !node.labels?.length).map(node => node.id || node.tagName));
            assert.deepEqual(unlabelled, [], `${name}: unlabelled controls`);
        }
    });
});

test('the narrator grammar preview uses the short module reference while the slug is unique', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, factionsText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        assert.match(await page.locator('#dm-grammar-ref').innerText(), /^Reference: reputation \(short form/);
        assert.match(await page.locator('[data-grammar-kind="gain"] .grammar-line').innerText(), /^\+ dm reputation \u2014 <what happened> \| kind: gain \| faction: guild\|watch\|compact$/);
        assert.doesNotMatch(await page.locator('.dm-grammar').innerText(), /pack\.ersveil-factions\/reputation/);
    });
});

test('migrations: adding a field is an additive migration Story Block accepts; narrowing a bound is explained before export', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, survivalText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Migrations');
        await page.locator('[aria-label="Migration field name"]').fill('thirst');
        await page.getByRole('button', { name: 'Add field and migration', exact: true }).click();
        await waitAccepted(page);
        assert.ok(await page.locator('[data-migration="0"]').innerText().then(text => /Version 1 to 2/.test(text)));
        await page.locator('#dm-migration-earlier').fill(survivalText());
        await page.getByRole('button', { name: 'Check migration', exact: true }).click();
        assert.equal(await page.locator('#dm-migration-result').innerText(), 'Compatible: an additive migration adding thirst.');
        await section(page, 'Fields');
        await fill(page.locator('[data-field="hunger"]'), 'Maximum', 50);
        await section(page, 'Migrations');
        await page.locator('#dm-migration-earlier').fill(survivalText());
        await page.getByRole('button', { name: 'Check migration', exact: true }).click();
        assert.match(await page.locator('#dm-migration-result').innerText(), /DM_SCHEMA · state\.hunger: Old fields cannot be removed, retyped, reset or have changed bounds\/defaults\./);
        await page.locator('#dm-migration-earlier').fill('{"nope"');
        await page.getByRole('button', { name: 'Check migration', exact: true }).click();
        assert.match(await page.locator('#dm-migration-result').innerText(), /^JSON refused/);
        assert.equal((await exportedPack(page)).toString('utf8'), survivalText(), 'checking changes nothing');
    });
});

test('simulator controls: Continue claims once, Re-read, Swipe and Reload report what Story Block does, and a time advance moves the clock', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, factionsText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Simulator');
        await page.getByRole('button', { name: 'Add reply', exact: true }).click();
        await page.getByRole('button', { name: 'Add Continue', exact: true }).click();
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        await page.locator('[data-sim-step="1"]').waitFor();
        assert.match(await page.locator('[data-sim-step="1"]').innerText(), /CLAIMED/);
        assert.equal(JSON.parse(await page.locator('#dm-sim-final').innerText()).standing.guild, 3);
        await page.getByRole('button', { name: 'Reload', exact: true }).click();
        assert.match(await page.locator('#dm-sim-whatif').innerText(), /If you reload step 1[\s\S]*Nothing changes\./);
        await page.getByRole('button', { name: 'Re-read step 1', exact: true }).click();
        assert.match(await page.locator('#dm-sim-whatif').innerText(), /If you reread step 1/);
        await page.getByRole('button', { name: 'Swipe step 1', exact: true }).click();
        assert.match(await page.locator('#dm-sim-whatif').innerText(), /If you swipe step 1/);
        // Deleting the Continue drops only its text.
        await page.getByRole('button', { name: 'Delete step 2', exact: true }).click();
        assert.match(await page.locator('#dm-sim-whatif').innerText(), /If you delete step 2/);
    });
    await withPage(SHIPPED, {}, async page => {
        await upload(page, survivalText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Simulator');
        await page.getByRole('button', { name: 'Add time advance', exact: true }).click();
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        await page.locator('[data-sim-step="0"]').waitFor();
        assert.deepEqual(JSON.parse(await page.locator('#dm-sim-final').innerText()), { Wessel: { hunger: 2, fatigue: 1 } });
        assert.match(await page.locator('[data-sim-step="0"]').innerText(), /advanced/);
        await fill(page, 'Story minute at the start', '');
        await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
        await page.locator('#dm-sim-output').waitFor();
    });
});

test('review 116: changing a field type and effect operation keeps authored unknown keys until removed', { timeout: 60000 }, async () => {
    await withPage(SHIPPED, {}, async page => {
        await upload(page, factionsText());
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Record JSON');
        const record = JSON.parse(await page.locator('#dm-json').inputValue());
        const authorNote = { keep: ['authored', { text: 'until I remove it' }] };
        record.state.memo = { type: 'enum', values: ['none', 'other'], default: 'none', authorNote };
        record.kinds.loss.effects[0].authorNote = authorNote;
        const path = record.kinds.loss.effects[0].path;
        await page.locator('#dm-json').fill(JSON.stringify(record));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        await section(page, 'Fields');
        await choose(page.locator('[data-field="memo"]'), 'Type', 'text');
        await section(page, 'Kinds');
        await choose(page.locator('[data-kind="loss"]'), 'Effect 1 operation', 'set');
        await section(page, 'Record JSON');
        const changed = JSON.parse(await page.locator('#dm-json').inputValue());
        assert.deepEqual(changed.state.memo, { type: 'text', max: 80, default: 'none', authorNote });
        assert.deepEqual(changed.kinds.loss.effects[0], { op: 'set', path, value: -5, authorNote });
        assert.match(await verdict(page), /Unknown field "authorNote"/);
        await page.locator('#dm-apply').click();
        assert.equal((await exportedPack(page)).toString('utf8'), factionsText());
        delete changed.state.memo.authorNote;
        delete changed.kinds.loss.effects[0].authorNote;
        await openDataModules(page);
        await page.getByRole('button', { name: /^1\./ }).click();
        await section(page, 'Record JSON');
        await page.locator('#dm-json').fill(JSON.stringify(changed));
        await page.getByRole('button', { name: 'Use record JSON', exact: true }).click();
        await waitAccepted(page);
    });
});
