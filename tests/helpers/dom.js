// Minimal DOM test helper for Node.js test environment (pure, zero dependencies).

export class MockNode {
    constructor(ownerDocument = null) {
        this.ownerDocument = ownerDocument;
        this.parentElement = null;
        this.parentNode = null;
        this.childNodes = [];
    }

    append(...nodes) {
        for (const n of nodes) {
            const node = typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n;
            if (node.parentElement) node.parentElement.removeChild(node);
            node.parentElement = this;
            node.parentNode = this;
            this.childNodes.push(node);
        }
    }

    prepend(...nodes) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            const node = typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n;
            if (node.parentElement) node.parentElement.removeChild(node);
            node.parentElement = this;
            node.parentNode = this;
            this.childNodes.unshift(node);
        }
    }

    replaceChildren(...nodes) {
        for (const child of [...this.childNodes]) {
            child.parentElement = null;
            child.parentNode = null;
        }
        this.childNodes = [];
        this.append(...nodes);
    }

    removeChild(node) {
        const idx = this.childNodes.indexOf(node);
        if (idx !== -1) {
            this.childNodes.splice(idx, 1);
            node.parentElement = null;
            node.parentNode = null;
        }
        return node;
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.removeChild(this);
        }
    }
}

export class MockTextNode extends MockNode {
    constructor(text = '', ownerDocument = null) {
        super(ownerDocument);
        this.nodeType = 3;
        this._text = String(text);
    }

    get textContent() {
        return this._text;
    }

    set textContent(val) {
        this._text = String(val);
    }
}

export class MockElement extends MockNode {
    constructor(tagName, ownerDocument = null) {
        super(ownerDocument);
        this.nodeType = 1;
        this.tagName = tagName.toUpperCase();
        this._attributes = new Map();
        this._listeners = new Map();
        this._value = '';
        this._disabled = false;
        this._hidden = false;
        this._open = false;

        this.dataset = new Proxy({}, {
            get: (_, prop) => {
                const attr = `data-${String(prop).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`;
                return this.getAttribute(attr) ?? undefined;
            },
            set: (_, prop, val) => {
                const attr = `data-${String(prop).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`;
                this.setAttribute(attr, String(val));
                return true;
            },
        });

        this.classList = {
            add: (...tokens) => {
                const current = (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
                for (const t of tokens) {
                    if (!current.includes(t)) current.push(t);
                }
                this.setAttribute('class', current.join(' '));
            },
            remove: (...tokens) => {
                const current = (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
                const filtered = current.filter(t => !tokens.includes(t));
                this.setAttribute('class', filtered.join(' '));
            },
            contains: (token) => {
                const current = (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
                return current.includes(token);
            },
            toggle: (token, force) => {
                const has = this.classList.contains(token);
                const shouldHave = force !== undefined ? force : !has;
                if (shouldHave) this.classList.add(token);
                else this.classList.remove(token);
                return shouldHave;
            },
        };
    }

    get children() {
        return this.childNodes.filter(n => n.nodeType === 1);
    }

    get textContent() {
        return this.childNodes.map(n => n.textContent).join('');
    }

    set textContent(val) {
        for (const c of [...this.childNodes]) {
            c.parentElement = null;
            c.parentNode = null;
        }
        this.childNodes = [];
        if (val !== '') {
            this.append(this.ownerDocument.createTextNode(val));
        }
    }

    get value() {
        if (this.tagName === 'SELECT') {
            const selectedOpt = this.querySelectorAll('option').find(o => o.selected);
            if (selectedOpt) return selectedOpt.value;
            const firstOpt = this.querySelector('option');
            return firstOpt ? firstOpt.value : this._value;
        }
        return this._value;
    }

    set value(v) {
        const str = String(v);
        this._value = str;
        if (this.tagName === 'SELECT') {
            for (const opt of this.querySelectorAll('option')) {
                opt.selected = opt.value === str;
            }
        }
    }

    get disabled() {
        return this._disabled || this.hasAttribute('disabled');
    }

    set disabled(v) {
        this._disabled = Boolean(v);
        if (this._disabled) this.setAttribute('disabled', '');
        else this.removeAttribute('disabled');
    }

    get hidden() {
        return this._hidden || this.hasAttribute('hidden');
    }

    set hidden(v) {
        this._hidden = Boolean(v);
        if (this._hidden) this.setAttribute('hidden', '');
        else this.removeAttribute('hidden');
    }

    get id() {
        return this.getAttribute('id') || '';
    }

    set id(v) {
        this.setAttribute('id', v);
    }

    get title() {
        return this.getAttribute('title') || '';
    }

    set title(v) {
        this.setAttribute('title', v);
    }

    get selected() {
        return this.hasAttribute('selected');
    }

    set selected(v) {
        if (v) this.setAttribute('selected', '');
        else this.removeAttribute('selected');
    }

    get open() {
        return this._open || this.hasAttribute('open');
    }

    set open(v) {
        this._open = Boolean(v);
        if (this._open) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    setAttribute(name, value) {
        this._attributes.set(name, String(value));
        if (name === 'value') this._value = String(value);
    }

    getAttribute(name) {
        return this._attributes.get(name) ?? null;
    }

    hasAttribute(name) {
        return this._attributes.has(name);
    }

    removeAttribute(name) {
        this._attributes.delete(name);
    }

    addEventListener(type, listener) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
        if (!this._listeners.has(type)) return;
        const list = this._listeners.get(type);
        const idx = list.indexOf(listener);
        if (idx !== -1) list.splice(idx, 1);
    }

    dispatchEvent(event) {
        event.target = this;
        const list = this._listeners.get(event.type) || [];
        for (const listener of list) {
            listener.call(this, event);
        }
        return !event.defaultPrevented;
    }

    click() {
        let prevented = false;
        const event = {
            type: 'click',
            target: this,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; prevented = true; },
        };
        this.dispatchEvent(event);
    }

    focus() {
        if (this.ownerDocument) {
            this.ownerDocument.activeElement = this;
        }
    }

    showModal() {
        this.open = true;
        this.focus();
    }

    close() {
        this.open = false;
        this.dispatchEvent({ type: 'close', target: this });
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const test = createSelectorMatcher(selector);

        function walk(node) {
            for (const child of node.childNodes) {
                if (child.nodeType === 1) {
                    if (test(child)) matches.push(child);
                    walk(child);
                }
            }
        }

        walk(this);
        return matches;
    }
}

function createSelectorMatcher(selector) {
    selector = selector.trim();
    const parts = selector.split(/\s+(?=(?:[^"']|"[^"]*"|'[^']*')*$)/);
    if (parts.length > 1) {
        const last = createSelectorMatcher(parts.pop());
        const ancestor = createSelectorMatcher(parts.join(' '));
        return el => {
            if (!last(el)) return false;
            for (let node = el.parentElement; node; node = node.parentElement) {
                if (ancestor(node)) return true;
            }
            return false;
        };
    }
    if (selector.endsWith(':first-child')) {
        const match = createSelectorMatcher(selector.slice(0, -12));
        return el => match(el) && el.parentElement?.children[0] === el;
    }
    if (selector.endsWith(':last-child')) {
        const match = createSelectorMatcher(selector.slice(0, -11));
        return el => match(el) && el.parentElement?.children.at(-1) === el;
    }
    const compound = selector.match(/^(\.[\w-]+)(\[.*\])$/);
    if (compound) {
        const a = createSelectorMatcher(compound[1]);
        const b = createSelectorMatcher(compound[2]);
        return el => a(el) && b(el);
    }
    const attrClass = selector.match(/^([\w-]+\[.*\])(\.[\w-]+)$/);
    if (attrClass) {
        const a = createSelectorMatcher(attrClass[1]);
        const b = createSelectorMatcher(attrClass[2]);
        return el => a(el) && b(el);
    }

    if (selector.startsWith('#')) {
        const id = selector.slice(1);
        return el => el.getAttribute('id') === id;
    }

    if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return el => el.classList.contains(cls);
    }

    if (selector.startsWith('[') && selector.endsWith(']')) {
        const inner = selector.slice(1, -1);
        const eqIdx = inner.indexOf('=');
        if (eqIdx === -1) {
            return el => el.hasAttribute(inner);
        }
        const key = inner.slice(0, eqIdx);
        const val = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
        return el => el.getAttribute(key) === val;
    }

    // Tag + attribute e.g. button[aria-pressed=true] or option[value="s00"]
    const attrMatch = selector.match(/^([a-zA-Z0-9_-]+)\[([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/);
    if (attrMatch) {
        const [, tag, attrKey, q1, q2, q3] = attrMatch;
        const expectedVal = q1 ?? q2 ?? q3;
        return el => {
            if (el.tagName !== tag.toUpperCase()) return false;
            if (expectedVal === undefined) return el.hasAttribute(attrKey);
            return el.getAttribute(attrKey) === expectedVal;
        };
    }

    // Tag + class e.g. button.danger
    const classMatch = selector.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
    if (classMatch) {
        const [, tag, cls] = classMatch;
        return el => el.tagName === tag.toUpperCase() && el.classList.contains(cls);
    }

    // Plain tag name
    return el => el.tagName === selector.toUpperCase();
}

export class MockDocument {
    constructor() {
        this.documentElement = new MockElement('html', this);
        this.body = new MockElement('body', this);
        this.documentElement.append(this.body);
        this.activeElement = null;
    }

    createElement(tag) {
        return new MockElement(tag, this);
    }

    createElementNS(_ns, tag) {
        return new MockElement(tag, this);
    }

    createTextNode(text) {
        return new MockTextNode(text, this);
    }

    contains(node) {
        let curr = node;
        while (curr) {
            if (curr === this.documentElement || curr === this.body) return true;
            curr = curr.parentElement;
        }
        return false;
    }
}

import { openPack } from '../../src/model.js';
import { createHistory } from '../../src/history.js';

export function createTestContext(packOrModel) {
    const doc = new MockDocument();
    const model = packOrModel?.document ? packOrModel : openPack(packOrModel);
    let history = createHistory(model);
    const selection = { kind: 'classes', id: null, form: null };

    const app = doc.createElement('div');
    app.classList.add('studio');
    const main = doc.createElement('main');
    const inspector = doc.createElement('aside');
    const overlays = doc.createElement('div');
    app.append(main, inspector, overlays);
    doc.body.append(app);

    const ctx = {
        doc,
        app,
        main,
        inspector,
        overlays,
        selection,
        notifications: [],
        get model() { return history.current; },
        get history() { return history; },
        apply(result) {
            if (!history.commit(result)) {
                ctx.notify((result?.errors || [{ code: 'refused-edit', message: 'Edit refused' }]).map(e => `${e.code}: ${e.message}`).join('\n'));
                return false;
            }
            ctx.changed();
            return true;
        },
        changed() { ctx.render(); },
        notify(msg) { ctx.notifications.push(msg); },
        select(kind, id = null, form = null) {
            selection.kind = kind;
            selection.id = id;
            selection.form = form;
            ctx.render();
            if (id !== null) app.classList.add('inspector-open');
        },
        render() {
            main.replaceChildren();
            inspector.replaceChildren();
            ctx.onRender?.(ctx);
        },
    };

    return ctx;
}
