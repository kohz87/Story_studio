// Pack edit history: bounded undo/redo stack controller (SPEC §4, pure snapshots).
import { inheritDrafts, inheritPortraits } from './model.js';

/**
 * Creates a bounded undo/redo history controller over immutable pack model snapshots.
 * Only the returned controller is stateful; individual edit results and models are pure.
 *
 * @param {object} initialModel Initial pack model snapshot.
 * @param {{ limit?: number }} [options] History configuration with positive integer limit (default 100).
 * @returns {{ current: object, canUndo: boolean, canRedo: boolean, commit: Function, revert: Function, undo: Function, redo: Function }}
 */
export function createHistory(initialModel, { limit = 100 } = {}) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
        throw new RangeError(`History limit must be a positive integer, got ${limit}`);
    }

    let currentModel = initialModel;
    const undoStack = [];
    let redoStack = [];
    // What the latest commit replaced, so `revert` can put the history back exactly: the redo entries it cleared, the oldest undo entry it pushed out.
    let last = null;

    return {
        get current() {
            return currentModel;
        },

        get canUndo() {
            return undoStack.length > 0;
        },

        get canRedo() {
            return redoStack.length > 0;
        },

        /**
         * Commits an edit result to history.
         * Successful edits record current snapshot to undo, advance current, and clear redo.
         * Failed edits are rejected without altering history state.
         */
        commit(editResult) {
            if (!editResult || !editResult.ok || !editResult.model) {
                return false;
            }

            last = { model: editResult.model, redo: redoStack, dropped: [] };
            undoStack.push(currentModel);
            if (undoStack.length > limit) {
                last.dropped.push(undoStack.shift());
            }
            inheritDrafts(editResult.model, currentModel);
            inheritPortraits(editResult.model, currentModel);
            currentModel = editResult.model;
            redoStack = [];
            return true;
        },

        /**
         * Takes back the latest commit as if it had never been made: no redo entry for it, and the redo entries it cleared are back.
         * Does nothing when anything has happened since (another commit, an undo or a redo).
         */
        revert() {
            if (!last || last.model !== currentModel) {
                return currentModel;
            }

            currentModel = undoStack.pop();
            undoStack.unshift(...last.dropped);
            redoStack = last.redo;
            last = null;
            return currentModel;
        },

        /**
         * Undoes the last edit, restoring the previous snapshot.
         * Returns current snapshot unchanged when undo is unavailable.
         */
        undo() {
            if (undoStack.length === 0) {
                return currentModel;
            }

            last = null;
            redoStack.push(currentModel);
            currentModel = undoStack.pop();
            return currentModel;
        },

        /**
         * Redoes the last undone edit.
         * Returns current snapshot unchanged when redo is unavailable.
         */
        redo() {
            if (redoStack.length === 0) {
                return currentModel;
            }

            last = null;
            undoStack.push(currentModel);
            if (undoStack.length > limit) {
                undoStack.shift();
            }
            currentModel = redoStack.pop();
            return currentModel;
        },
    };
}
