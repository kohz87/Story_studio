// Page-level Studio input: the unload guard, Escape for the Problems drawer, and pack files dropped on the page. The
// listeners are attached and removed as a pair around the mount's life, reading the context lazily because it is built after this.
export function createStudioEvents({ win, doc, problemsHost, getContext }) {
    const onBeforeUnload = (e) => {
        if (getContext().dirty) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    };
    const onKeyDown = (e) => {
        if (e.key === 'Escape' && problemsHost.childNodes.length > 0) {
            e.preventDefault?.();
            getContext().closeProblems(true);
        }
    };
    const onDragOver = (e) => {
        e.preventDefault();
    };
    const onDrop = (e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f) getContext().openFile(f);
    };

    return {
        attach() {
            win?.addEventListener?.('beforeunload', onBeforeUnload);
            win?.addEventListener?.('keydown', onKeyDown);
            win?.addEventListener?.('dragover', onDragOver);
            win?.addEventListener?.('drop', onDrop);
        },
        detach() {
            win?.removeEventListener?.('beforeunload', onBeforeUnload);
            win?.removeEventListener?.('keydown', onKeyDown);
            win?.removeEventListener?.('dragover', onDragOver);
            win?.removeEventListener?.('drop', onDrop);
        },
    };
}
