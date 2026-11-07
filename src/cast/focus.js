// Keep the Cast form's focus through a redraw, including the focus transition that commits a field on blur.

export function keepCastFocus({ doc, win, inspector, selection, render }) {
    const changing = new Map();
    let lastChange = null;
    let renderedId = null;
    let pending = null;
    let timer = null;
    let changeTimer = null;
    let pointerTimer = null;
    const pointers = new Set();
    // One restore listener pair per node; a second restore on the same node replaces the first.
    const restorers = new WeakMap();
    const live = new Set();

    const schedule = () => {
        if (!pending) return;
        if (pointers.size) {
            // A pointer release can be missed, so do not leave a redraw waiting indefinitely.
            if (pointerTimer === null) pointerTimer = win.setTimeout(() => {
                pointerTimer = null;
                pointers.clear();
                if (timer !== null) { win.clearTimeout(timer); timer = null; }
                render();
            }, 5000);
            return;
        }
        if (timer !== null) return;
        timer = win.setTimeout(() => { timer = null; render(); }, 0);
    };
    const onChange = event => {
        if (selection.kind !== 'cast' || !event.target.closest?.('.cf-form')) return;
        changing.set(event, { node: event.target, value: event.target.value });
        // A stopped change never reaches the inspector's bubble listener.
        if (changeTimer === null && win?.setTimeout) changeTimer = win.setTimeout(() => {
            changeTimer = null;
            changing.clear();
        }, 0);
    };
    const afterChange = event => {
        changing.delete(event);
        if (!changing.size && changeTimer !== null) { win.clearTimeout(changeTimer); changeTimer = null; }
    };
    const onPointerDown = event => {
        pointers.add(event.pointerId);
        if (timer !== null) { win.clearTimeout(timer); timer = null; }
        schedule();
    };
    const onPointerUp = event => { pointers.delete(event.pointerId); schedule(); };
    const onBlur = () => { pointers.clear(); schedule(); };
    inspector.addEventListener('change', onChange, true);
    inspector.addEventListener('change', afterChange);
    win?.addEventListener?.('pointerdown', onPointerDown, true);
    win?.addEventListener?.('pointerup', onPointerUp, true);
    win?.addEventListener?.('pointercancel', onPointerUp, true);
    win?.addEventListener?.('lostpointercapture', onPointerUp, true);
    win?.addEventListener?.('contextmenu', onBlur, true);
    win?.addEventListener?.('blur', onBlur);
    doc?.addEventListener?.('visibilitychange', onBlur);

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
        if (pointerTimer !== null) { win.clearTimeout(pointerTimer); pointerTimer = null; }
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
            restorers.get(node)?.();
            let changed = false;
            const onNodeChange = () => { changed = true; };
            const onNodeBlur = () => { remove(); if (!changed) node.dispatchEvent(new win.Event('change', { bubbles: true })); };
            const remove = () => {
                node.removeEventListener('change', onNodeChange);
                node.removeEventListener('blur', onNodeBlur);
                restorers.delete(node);
                live.delete(remove);
            };
            node.addEventListener('change', onNodeChange, { once: true });
            node.addEventListener('blur', onNodeBlur, { once: true });
            restorers.set(node, remove);
            live.add(remove);
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
        if (changeTimer !== null) win.clearTimeout(changeTimer);
        if (pointerTimer !== null) win.clearTimeout(pointerTimer);
        for (const remove of [...live]) remove();
        inspector.removeEventListener('change', onChange, true);
        inspector.removeEventListener('change', afterChange);
        win?.removeEventListener?.('pointerdown', onPointerDown, true);
        win?.removeEventListener?.('pointerup', onPointerUp, true);
        win?.removeEventListener?.('pointercancel', onPointerUp, true);
        win?.removeEventListener?.('lostpointercapture', onPointerUp, true);
        win?.removeEventListener?.('contextmenu', onBlur, true);
        win?.removeEventListener?.('blur', onBlur);
        doc?.removeEventListener?.('visibilitychange', onBlur);
    };
    return { before, after, destroy };
}
