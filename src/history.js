// Pack edit history: bounded undo/redo stack controller (SPEC §4, pure snapshots).

/**
 * Creates a bounded undo/redo history controller over immutable pack model snapshots.
 * Only the returned controller is stateful; individual edit results and models are pure.
 *
 * @param {object} initialModel Initial pack model snapshot.
 * @param {{ limit?: number }} [options] History configuration with positive integer limit (default 100).
 * @returns {{ current: object, canUndo: boolean, canRedo: boolean, commit: Function, undo: Function, redo: Function }}
 */
export function createHistory(initialModel, { limit = 100 } = {}) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
        throw new RangeError(`History limit must be a positive integer, got ${limit}`);
    }

    let currentModel = initialModel;
    const undoStack = [];
    const redoStack = [];

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

            undoStack.push(currentModel);
            if (undoStack.length > limit) {
                undoStack.shift();
            }
            currentModel = editResult.model;
            redoStack.length = 0;
            return true;
        },

        /**
         * Undoes the last edit, restoring the previous snapshot.
         * Returns current snapshot unchanged when undo is unavailable.
         */
        undo() {
            if (undoStack.length === 0) {
                return currentModel;
            }

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

            undoStack.push(currentModel);
            if (undoStack.length > limit) {
                undoStack.shift();
            }
            currentModel = redoStack.pop();
            return currentModel;
        },
    };
}
