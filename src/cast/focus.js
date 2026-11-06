// Keep the Cast form's focus through a redraw, including the focus transition that commits a field on blur.

export function keepCastFocus({ doc, win, inspector, selection, render }) {
    const changing = new Map();
    let lastChange = null;
    let renderedId = null;
    let pending = null;
    let timer = null;
    const pointers = new Set();

    const schedule = () => {
        if (!pending || pointers.size || timer !== null) return;
        timer = win.setTimeout(() => { timer = null; render(); }, 0);
    };
    const onChange = event => {
        if (selection.kind !== 'cast' || !event.target.closest?.('.cf-form')) return;
        changing.set(event, { node: event.target, value: event.target.value });
    };
    const afterChange = event => { changing.delete(event); };
    const onPointerDown = event => {
        pointers.add(event.pointerId);
        if (timer !== null) { win.clearTimeout(timer); timer = null; }
    };
    const onPointerUp = event => { pointers.delete(event.pointerId); schedule(); };
    const onBlur = () => { pointers.clear(); schedule(); };
    inspector.addEventListener('change', onChange, true);
    inspector.addEventListener('change', afterChange);
    win?.addEventListener?.('pointerdown', onPointerDown, true);
    win?.addEventListener?.('pointerup', onPointerUp, true);
    win?.addEventListener?.('pointercancel', onPointerUp, true);
    win?.addEventListener?.('blur', onBlur);

    // Paths identify most fields; the others have labels or live in a numbered stage, skill or secret.
    const mark = form => {
        const counts = new Map();
        for (const node of form.querySelectorAll('input, textarea, select, button')) {
            const section = [...form.children].indexOf(node.closest('fieldset'));
            const row = node.closest('[data-stage], [data-skill], [data-secret]');
            const rowKey = row && ['data-stage', 'data-skill', 'data-secret'].map(name => row.getAttribute(name)).find(value => value !== null);
            const key = JSON.stringify([section, rowKey, node.tagName, node.getAttribute('data-path') ?? node.getAttribute('aria-label') ?? node.textContent]);
            const count = counts.get(key) ?? 0;
            counts.set(key, count + 1);
            node.setAttribute('data-cast-focus', JSON.stringify([key, count]));
        }
    };

    const before = () => {
        if (changing.size && win?.setTimeout) {
            lastChange = [...changing.values()].at(-1);
            pending = { kind: selection.kind, id: selection.id };
            schedule();
            return { defer: true };
        }
        if (timer !== null) { win.clearTimeout(timer); timer = null; }
        const form = inspector.querySelector('.cf-form');
        const node = doc.activeElement;
        const samePerson = selection.kind === 'cast' && (selection.id === renderedId || (pending?.kind === 'cast' && pending.id === selection.id));
        const key = samePerson && node?.getAttribute?.('data-cast-focus');
        const snapshot = key && form?.contains(node) ? {
            key, value: node.value, keepValue: node !== lastChange?.node || node.value !== lastChange.value,
            start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection,
            top: node.scrollTop, left: node.scrollLeft, inspectorTop: inspector.parentElement.scrollTop,
            inspectorLeft: inspector.parentElement.scrollLeft, pageX: win.scrollX, pageY: win.scrollY,
        } : null;
        pending = null;
        lastChange = null;
        return { snapshot };
    };

    const after = ({ snapshot }) => {
        const form = selection.kind === 'cast' && inspector.querySelector('.cf-form');
        renderedId = form ? selection.id : null;
        if (!form) return;
        mark(form);
        if (!snapshot) return;
        const node = [...form.querySelectorAll('[data-cast-focus]')].find(control => control.getAttribute('data-cast-focus') === snapshot.key);
        if (!node || node.disabled || node.hidden) return;
        const text = node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(node.type));
        if (text && snapshot.keepValue && node.value !== snapshot.value) {
            node.value = snapshot.value;
            node.dispatchEvent(new win.Event('input', { bubbles: true }));
            // A value restored by script may not produce a native change if no further typing follows.
            let changed = false;
            node.addEventListener('change', () => { changed = true; }, { once: true });
            node.addEventListener('blur', () => { if (!changed) node.dispatchEvent(new win.Event('change', { bubbles: true })); }, { once: true });
        }
        node.focus({ preventScroll: true });
        if (snapshot.start !== null && snapshot.start !== undefined) node.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
        node.scrollTop = snapshot.top;
        node.scrollLeft = snapshot.left;
        inspector.parentElement.scrollTop = snapshot.inspectorTop;
        inspector.parentElement.scrollLeft = snapshot.inspectorLeft;
        win.scrollTo(snapshot.pageX, snapshot.pageY);
    };
    const destroy = () => {
        if (timer !== null) win.clearTimeout(timer);
        inspector.removeEventListener('change', onChange, true);
        inspector.removeEventListener('change', afterChange);
        win?.removeEventListener?.('pointerdown', onPointerDown, true);
        win?.removeEventListener?.('pointerup', onPointerUp, true);
        win?.removeEventListener?.('pointercancel', onPointerUp, true);
        win?.removeEventListener?.('blur', onBlur);
    };
    return { before, after, destroy };
}
