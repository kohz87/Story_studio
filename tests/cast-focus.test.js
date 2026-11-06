// Focus and draft preservation when a Cast form redraw follows a change or pointer transition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepCastFocus } from '../src/cast/focus.js';

class Events {
    listeners = new Map();
    addEventListener(type, listener, options) {
        const list = this.listeners.get(type) ?? [];
        list.push({ listener, once: options?.once });
        this.listeners.set(type, list);
    }
    removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.listener !== listener));
    }
    dispatchEvent(event) {
        for (const item of [...(this.listeners.get(event.type) ?? [])]) {
            if (item.once) this.removeEventListener(event.type, item.listener);
            item.listener(event);
        }
    }
}

function harness(specs) {
    const doc = { activeElement: null };
    const selection = { kind: 'cast', id: 'fenna' };
    const inspector = new Events();
    inspector.parentElement = { scrollTop: 85, scrollLeft: 3 };
    const win = new Events();
    let nextTimer = 0;
    const timers = new Map();
    win.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
    win.clearTimeout = id => timers.delete(id);
    win.scrollX = 5;
    win.scrollY = 6;
    win.scrollTo = (x, y) => { win.scrollX = x; win.scrollY = y; };
    win.Event = class { constructor(type) { this.type = type; } };
    const section = {};
    const makeControl = spec => {
        const node = new Events();
        const attrs = new Map([['data-path', spec.path]]);
        Object.assign(node, {
            tagName: spec.tag ?? 'INPUT', type: spec.type ?? 'text', value: spec.value ?? '', checked: spec.checked ?? false,
            selectionStart: spec.start ?? null, selectionEnd: spec.end ?? null, selectionDirection: spec.direction ?? null,
            scrollTop: 4, scrollLeft: 2, disabled: false, hidden: false, textContent: '',
            getAttribute: key => attrs.get(key) ?? null, setAttribute: (key, value) => attrs.set(key, value),
            closest: selector => selector === 'fieldset' ? section : selector === '.cf-form' ? form : null,
            focus: () => { doc.activeElement = node; },
            setSelectionRange: (start, end, direction) => Object.assign(node, { selectionStart: start, selectionEnd: end, selectionDirection: direction }),
        });
        return node;
    };
    let form;
    const newForm = () => {
        const controls = specs.map(makeControl);
        return {
            children: [section], controls,
            contains: node => controls.includes(node),
            querySelectorAll: selector => selector === '[data-cast-focus]' ? controls.filter(node => node.getAttribute('data-cast-focus')) : controls,
        };
    };
    inspector.querySelector = selector => selector === '.cf-form' ? form : null;
    let focus;
    const render = () => {
        const snapshot = focus.before();
        if (snapshot.defer) return;
        form = newForm();
        focus.after(snapshot);
    };
    focus = keepCastFocus({ doc, win, inspector, selection, render });
    render();
    const change = (node, action) => {
        const event = { type: 'change', target: node };
        // The inspector captures the change before the control's handler and sees it bubble afterwards.
        const listeners = inspector.listeners.get('change');
        listeners[0].listener(event);
        action();
        listeners[1].listener(event);
    };
    const flush = () => {
        const ready = [...timers.values()];
        timers.clear();
        for (const callback of ready) callback();
    };
    return { doc, inspector, selection, win, focus, change, flush, render, controls: () => form.controls, timers };
}

test('a deferred cast redraw preserves the next field draft, selection and eventual change', () => {
    const specs = [{ path: 'name', value: 'Fenna' }, { path: 'aliases', value: '' }];
    const h = harness(specs);
    const [name, aliases] = h.controls();
    name.focus();
    h.change(name, () => { specs[0].value = 'Fenna Vale'; h.render(); });
    assert.equal(h.controls()[0], name);
    aliases.focus();
    aliases.value = 'Captain Fen';
    aliases.setSelectionRange(3, 7, 'backward');
    h.flush();
    const replacement = h.controls()[1];
    assert.notEqual(replacement, aliases);
    assert.equal(h.doc.activeElement, replacement);
    assert.deepEqual([replacement.value, replacement.selectionStart, replacement.selectionEnd, replacement.selectionDirection], ['Captain Fen', 3, 7, 'backward']);
    let changes = 0;
    replacement.addEventListener('change', () => { changes++; });
    replacement.dispatchEvent({ type: 'blur' });
    assert.equal(changes, 1);
    assert.deepEqual([h.inspector.parentElement.scrollTop, h.inspector.parentElement.scrollLeft, h.win.scrollX, h.win.scrollY], [85, 3, 5, 6]);
    h.focus.destroy();
});

test('successive field changes before a redraw keep both saves and the latest focus', () => {
    const specs = [{ path: 'name', value: 'Fenna' }, { path: 'aliases', value: '' }, { path: 'about', value: '' }];
    const h = harness(specs);
    const [name, aliases, about] = h.controls();
    name.focus();
    name.value = 'Fenna Vale';
    h.change(name, () => { specs[0].value = name.value; h.render(); });
    aliases.focus();
    aliases.value = 'Captain Fen';
    h.change(aliases, () => { specs[1].value = aliases.value; h.render(); });
    about.focus();
    assert.equal(h.timers.size, 1);
    h.flush();
    assert.deepEqual(h.controls().map(node => node.value), ['Fenna Vale', 'Captain Fen', '']);
    assert.equal(h.doc.activeElement, h.controls()[2]);
    h.focus.destroy();
});

test('a pointer transition delays the redraw until the click can finish', () => {
    const specs = [{ path: 'name', value: 'Fenna' }, { path: 'aliases', value: '' }];
    const h = harness(specs);
    const [name, aliases] = h.controls();
    name.focus();
    h.win.dispatchEvent({ type: 'pointerdown', pointerId: 1 });
    h.change(name, () => { specs[0].value = 'Fenna Vale'; h.render(); });
    assert.equal(h.timers.size, 0);
    aliases.focus();
    aliases.value = 'Captain';
    h.win.dispatchEvent({ type: 'pointerup', pointerId: 1 });
    assert.equal(h.timers.size, 1);
    h.flush();
    assert.equal(h.doc.activeElement, h.controls()[1]);
    assert.equal(h.controls()[1].value, 'Captain');
    h.focus.destroy();
});

test('a change that does not redraw leaves an uncommitted draft intact on a later redraw', () => {
    const h = harness([{ path: 'fields', tag: 'TEXTAREA', value: 'Trade: Ferry' }]);
    const field = h.controls()[0];
    field.focus();
    field.value = 'an incomplete field';
    h.change(field, () => {});
    h.render();
    assert.equal(h.doc.activeElement, h.controls()[0]);
    assert.equal(h.controls()[0].value, 'an incomplete field');
    h.focus.destroy();
});

test('cast selects, number fields and checkboxes regain focus with their saved values', () => {
    for (const spec of [
        { path: 'level', tag: 'SELECT', value: 'medium' },
        { path: 'count', type: 'number', value: '21' },
        { path: 'enabled', type: 'checkbox', checked: true },
    ]) {
        const h = harness([spec]);
        const old = h.controls()[0];
        old.focus();
        h.change(old, () => h.render());
        h.flush();
        assert.notEqual(h.controls()[0], old);
        assert.equal(h.doc.activeElement, h.controls()[0]);
        assert.equal(h.controls()[0].value, old.value);
        assert.equal(h.controls()[0].checked, old.checked);
        h.focus.destroy();
    }
});
