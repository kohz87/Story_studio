// The adjustable columns' rules without a browser: how widths fit, what each key asks for, and the optional storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, COLUMNS_KEY, LIST_MIN, DIVIDER_WIDTH, cleanWidths, fit, keyWidth, readWidths, writeWidths } from '../src/columns.js';

const { rail, inspector } = COLUMNS;
const press = (key, shiftKey = false) => ({ key, shiftKey });

test('the columns have the approved ranges and defaults', () => {
    assert.deepEqual([rail.def, rail.min, rail.max], [190, 150, 320]);
    assert.deepEqual([inspector.def, inspector.min, inspector.max], [330, 280, 640]);
    assert.equal(LIST_MIN, 320);
});

test('cleanWidths keeps whole pixels inside each range and falls back to the default for anything else', () => {
    assert.deepEqual(cleanWidths(null), { rail: 190, inspector: 330 });
    assert.deepEqual(cleanWidths({ rail: 10, inspector: 9000 }), { rail: 150, inspector: 640 });
    assert.deepEqual(cleanWidths({ rail: 200.6, inspector: '400' }), { rail: 201, inspector: 330 });
    assert.deepEqual(cleanWidths({ rail: NaN, inspector: Infinity }), { rail: 190, inspector: 330 });
});

test('fit leaves the list at least 320 px and reports how far each column may go', () => {
    const roomy = fit(1280, { rail: 190, inspector: 330 }, true);
    assert.deepEqual(roomy, { rail: 190, inspector: 330, railMax: 320, inspectorMax: 640 });
    const tight = fit(1101, { rail: 320, inspector: 640 }, true);
    assert.ok(tight.rail + tight.inspector + 2 * DIVIDER_WIDTH + LIST_MIN <= 1101);
    assert.ok(tight.rail >= rail.min && tight.inspector >= inspector.min);
    const widest = fit(1280, { rail: 190, inspector: 640 }, true);
    assert.equal(widest.railMax, 1280 - 2 * DIVIDER_WIDTH - LIST_MIN - 640);
    assert.equal(fit(1280, { rail: 320, inspector: 640 }, true).inspectorMax, 1280 - 2 * DIVIDER_WIDTH - LIST_MIN - 320);
});

test('fit with no inspector column lets the rail use the room the inspector would have had', () => {
    assert.equal(fit(601, { rail: 320, inspector: 330 }, false).railMax, 269);
    assert.equal(fit(1280, { rail: 320, inspector: 330 }, false).railMax, 320);
    assert.equal(fit(0, { rail: 320, inspector: 640 }, true).railMax, 320);
});

test('keys: arrows move 16 px, Shift 64 px, Home and End the ends, Enter the default; the inspector goes the other way', () => {
    assert.equal(keyWidth(rail, 190, 320, press('ArrowRight')), 206);
    assert.equal(keyWidth(rail, 190, 320, press('ArrowLeft')), 174);
    assert.equal(keyWidth(rail, 190, 320, press('ArrowRight', true)), 254);
    assert.equal(keyWidth(rail, 190, 320, press('ArrowLeft', true)), 126);
    assert.equal(keyWidth(inspector, 330, 640, press('ArrowLeft')), 346);
    assert.equal(keyWidth(inspector, 330, 640, press('ArrowRight')), 314);
    assert.equal(keyWidth(inspector, 330, 640, press('ArrowLeft', true)), 394);
    assert.equal(keyWidth(rail, 200, 296, press('Home')), 150);
    assert.equal(keyWidth(rail, 200, 296, press('End')), 296);
    assert.equal(keyWidth(inspector, 500, 640, press('Enter')), 330);
    assert.equal(keyWidth(rail, 190, 320, press('ArrowUp')), null);
    assert.equal(keyWidth(rail, 190, 320, press('a')), null);
});

function storage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data };
}

test('widths are read and written through localStorage and survive a round trip', () => {
    const win = { localStorage: storage() };
    assert.deepEqual(readWidths(win), { rail: 190, inspector: 330 });
    writeWidths(win, { rail: 240, inspector: 500 });
    assert.deepEqual(readWidths(win), { rail: 240, inspector: 500 });
});

test('garbage in storage gives the defaults', () => {
    for (const raw of ['', 'nope', '[1,2]', 'null', '{"rail":"wide"}']) {
        assert.deepEqual(readWidths({ localStorage: storage({ [COLUMNS_KEY]: raw }) }), { rail: 190, inspector: 330 }, raw);
    }
});

test('with no storage, or storage that throws, every access is caught and the defaults apply', () => {
    const denied = { get localStorage() { throw new Error('denied'); } };
    const broken = { localStorage: { getItem() { throw new Error('boom'); }, setItem() { throw new Error('full'); } } };
    for (const win of [undefined, {}, denied, broken]) {
        assert.deepEqual(readWidths(win), { rail: 190, inspector: 330 });
        assert.doesNotThrow(() => writeWidths(win, { rail: 200, inspector: 400 }));
    }
});
