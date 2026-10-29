// Adjustable columns: the two dividers between the pack parts rail, the list and the inspector.
// The widths are the creator's own and live on this device only (localStorage); with no storage the defaults are used.
import { el } from './dom.js';

export const COLUMNS = Object.freeze({
    rail: Object.freeze({ title: 'Pack parts', label: 'Resize pack parts', controls: 'rail', def: 190, min: 150, max: 320, sign: 1 }),
    inspector: Object.freeze({ title: 'Inspector', label: 'Resize inspector', controls: 'inspector', def: 330, min: 280, max: 640, sign: -1 }),
});
export const LIST_MIN = 320;
export const DIVIDER_WIDTH = 12;
export const STEP = 16;
export const BIG_STEP = 64;
export const COLUMNS_KEY = 'story-studio-columns';

const WIDE_QUERY = '(min-width: 1101px)';
const STACK_QUERY = '(max-width: 600px)';

/** The widths as a plain object of whole pixels, each clamped to its column's range; anything else becomes the default. */
export function cleanWidths(value) {
    const out = {};
    for (const [name, column] of Object.entries(COLUMNS)) {
        const raw = value?.[name];
        out[name] = Number.isFinite(raw) ? Math.min(column.max, Math.max(column.min, Math.round(raw))) : column.def;
    }
    return out;
}

/**
 * What fits in `space` pixels. The list keeps LIST_MIN, so the rail and the inspector share what is left; `rail` and
 * `inspector` are the widths in use, `railMax` and `inspectorMax` how far each may go with the other where it is.
 * `space` 0 or less means "not measured yet" and leaves only the columns' own limits.
 */
export function fit(space, wanted, withInspector) {
    const { rail: R, inspector: I } = COLUMNS;
    const stored = cleanWidths(wanted);
    const free = space > 0 ? space - (withInspector ? 2 : 1) * DIVIDER_WIDTH - LIST_MIN : Infinity;
    const room = (column, cap) => Math.max(column.min, Math.min(column.max, cap));
    const rail = Math.min(stored.rail, room(R, free - (withInspector ? I.min : 0)));
    const inspector = withInspector ? Math.min(stored.inspector, room(I, free - rail)) : stored.inspector;
    return {
        rail, inspector,
        railMax: room(R, free - (withInspector ? inspector : 0)),
        inspectorMax: room(I, free - rail),
    };
}

/** The width a key asks for, or null for a key the divider does not use. Direction is +1 when the key widens the column. */
export function keyWidth(column, current, max, event) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const widen = column.sign > 0 ? 'ArrowRight' : 'ArrowLeft';
    const narrow = column.sign > 0 ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === widen) return current + step;
    if (event.key === narrow) return current - step;
    if (event.key === 'Home') return column.min;
    if (event.key === 'End') return max;
    if (event.key === 'Enter') return column.def;
    return null;
}

export function readWidths(win) {
    try {
        const raw = win?.localStorage?.getItem(COLUMNS_KEY);
        return cleanWidths(raw ? JSON.parse(raw) : null);
    } catch { /* Storage is optional. */ }
    return cleanWidths(null);
}

export function writeWidths(win, widths) {
    try { win?.localStorage?.setItem(COLUMNS_KEY, JSON.stringify(cleanWidths(widths))); } catch { /* Storage is optional. */ }
}

/** 'wide' (both dividers), 'mid' (rail divider; the inspector is an overlay) or 'stack' (no dividers). */
function layoutMode(win, wide, stack) {
    if (stack) return stack.matches ? 'stack' : wide?.matches ? 'wide' : 'mid';
    const width = win?.innerWidth;
    return !(width > 0) ? 'wide' : width <= 600 ? 'stack' : width <= 1100 ? 'mid' : 'wide';
}

function makeDivider(doc, name) {
    const column = COLUMNS[name];
    const divider = el(doc, 'div', '', {
        class: `divider divider-${name}`, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': column.label,
        'aria-controls': column.controls, tabindex: '0',
    });
    const badge = el(doc, 'span', '', { class: 'divider-badge', 'aria-hidden': 'true' });
    const tip = el(doc, 'span', '', { class: 'divider-tip', 'aria-hidden': 'true' });
    for (const note of [badge, tip]) note.append(doc.createTextNode(''), el(doc, 'small'));
    divider.append(el(doc, 'span', '', { class: 'grip', 'aria-hidden': 'true' }), badge, tip);
    return { divider, badge, tip };
}

/**
 * Builds the two dividers and keeps the workspace's --rail-w and --insp-w, the dividers' aria values and the stored
 * widths in step. `inspectorShown()` says whether the inspector column exists on this screen.
 */
export function createColumns({ doc, win, workspace, inspectorShown }) {
    let stored = readWidths(win);
    let drag = null;
    const wide = win?.matchMedia?.(WIDE_QUERY);
    const stack = win?.matchMedia?.(STACK_QUERY);
    const parts = { rail: makeDivider(doc, 'rail'), inspector: makeDivider(doc, 'inspector') };

    const measure = () => {
        const mode = layoutMode(win, wide, stack);
        const withInspector = mode === 'wide' && inspectorShown();
        return { mode, ...fit(workspace.clientWidth || 0, stored, withInspector) };
    };

    const label = (name, now, max) => {
        const column = COLUMNS[name];
        const { badge, tip } = parts[name];
        const title = `${column.title} ${now} px`;
        badge.childNodes[0].textContent = title;
        badge.childNodes[1].textContent = `${column.min} to ${max}. Arrow keys resize.`;
        tip.childNodes[0].textContent = title;
        tip.childNodes[1].textContent = `Drag. Double-click resets to ${column.def}.`;
    };

    function refresh() {
        const now = measure();
        parts.inspector.divider.hidden = !inspectorShown();
        workspace.style?.setProperty?.('--rail-w', `${now.rail}px`);
        workspace.style?.setProperty?.('--insp-w', `${now.inspector}px`);
        for (const [name, max] of [['rail', now.railMax], ['inspector', now.inspectorMax]]) {
            const { divider } = parts[name];
            divider.setAttribute('aria-valuenow', now[name]);
            divider.setAttribute('aria-valuemin', COLUMNS[name].min);
            divider.setAttribute('aria-valuemax', max);
            label(name, now[name], max);
        }
        return now;
    }

    function setWidth(name, value, save) {
        const now = measure();
        const max = name === 'rail' ? now.railMax : now.inspectorMax;
        stored = { ...stored, [name]: Math.min(max, Math.max(COLUMNS[name].min, Math.round(value))) };
        refresh();
        if (save) writeWidths(win, stored);
    }

    for (const name of Object.keys(COLUMNS)) {
        const column = COLUMNS[name];
        const { divider } = parts[name];
        divider.addEventListener('keydown', event => {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            const now = measure();
            const target = keyWidth(column, now[name], name === 'rail' ? now.railMax : now.inspectorMax, event);
            if (target === null) return;
            event.preventDefault();
            setWidth(name, target, true);
        });
        divider.addEventListener('dblclick', () => setWidth(name, column.def, true));
        divider.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            divider.focus?.({ preventScroll: true });
            drag = { name, from: event.clientX, width: measure()[name], id: event.pointerId };
            try { divider.setPointerCapture?.(event.pointerId); } catch { /* A synthetic pointer cannot be captured. */ }
            workspace.classList.add('is-dragging');
        });
        divider.addEventListener('pointermove', event => {
            if (drag?.name !== name) return;
            setWidth(name, drag.width + column.sign * (event.clientX - drag.from), false);
        });
        const finish = () => {
            if (drag?.name !== name) return;
            drag = null;
            workspace.classList.remove('is-dragging');
            writeWidths(win, stored);
        };
        divider.addEventListener('pointerup', finish);
        divider.addEventListener('pointercancel', finish);
        divider.addEventListener('lostpointercapture', finish);
    }

    const onResize = () => refresh();
    win?.addEventListener?.('resize', onResize);
    wide?.addEventListener?.('change', onResize);
    stack?.addEventListener?.('change', onResize);

    return {
        railDivider: parts.rail.divider,
        inspectorDivider: parts.inspector.divider,
        refresh,
        destroy() {
            win?.removeEventListener?.('resize', onResize);
            wide?.removeEventListener?.('change', onResize);
            stack?.removeEventListener?.('change', onResize);
        },
    };
}
