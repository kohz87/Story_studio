// Pack development interface: unstyled DOM creator kit viewer and editor (SPEC §5).

import { openPack, exportPack } from './model.js';
import { setSchemaField as setField } from './edits.js';
import { createHistory } from './history.js';
import { RULES_V2_LIMITS } from '../vendor/story-block/src/v2/packs/rules-v2.js';

const MAX_BYTES = RULES_V2_LIMITS.packBytes;

/**
 * Mounts the development editor interface into the provided root DOM element.
 * Returns a controller object with loadText and destroy methods.
 *
 * @param {Element} root Host container element.
 * @returns {{ loadText: (text: string | object) => object, destroy: () => void }}
 */
export function mountDev(root) {
    if (!root) {
        throw new Error('mountDev requires a root element');
    }

    const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
        throw new Error('mountDev requires an ownerDocument');
    }

    let currentModel = null;
    let history = null;
    let destroyed = false;
    let activeReadId = 0;

    while (root.firstChild) {
        root.removeChild(root.firstChild);
    }

    const fileContainer = doc.createElement('div');
    const fileLabel = doc.createElement('label');
    fileLabel.textContent = 'Pack file: ';
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'pack-file';
    fileInput.accept = '.json,application/json';
    fileLabel.appendChild(fileInput);
    fileContainer.appendChild(fileLabel);
    root.appendChild(fileContainer);

    const editContainer = doc.createElement('div');
    const nameLabel = doc.createElement('label');
    nameLabel.textContent = 'Pack name: ';
    const packNameInput = doc.createElement('input');
    packNameInput.type = 'text';
    packNameInput.id = 'pack-name';
    nameLabel.appendChild(packNameInput);
    editContainer.appendChild(nameLabel);

    const applyButton = doc.createElement('button');
    applyButton.type = 'button';
    applyButton.id = 'apply-name';
    applyButton.textContent = 'Apply';
    editContainer.appendChild(applyButton);

    const undoButton = doc.createElement('button');
    undoButton.type = 'button';
    undoButton.id = 'undo';
    undoButton.textContent = 'Undo';
    undoButton.disabled = true;
    editContainer.appendChild(undoButton);

    const redoButton = doc.createElement('button');
    redoButton.type = 'button';
    redoButton.id = 'redo';
    redoButton.textContent = 'Redo';
    redoButton.disabled = true;
    editContainer.appendChild(redoButton);

    const exportButton = doc.createElement('button');
    exportButton.type = 'button';
    exportButton.id = 'export-pack';
    exportButton.textContent = 'Export';
    exportButton.disabled = true;
    editContainer.appendChild(exportButton);
    root.appendChild(editContainer);

    const errorsHeading = doc.createElement('h2');
    errorsHeading.textContent = 'Validation Errors';
    root.appendChild(errorsHeading);

    const errorsList = doc.createElement('ul');
    errorsList.id = 'errors';
    errorsList.setAttribute('role', 'alert');
    errorsList.setAttribute('aria-live', 'polite');
    root.appendChild(errorsList);

    const contentsHeading = doc.createElement('h2');
    contentsHeading.textContent = 'Contents';
    root.appendChild(contentsHeading);

    const contentsList = doc.createElement('ul');
    contentsList.id = 'contents';
    root.appendChild(contentsList);

    function clearChildren(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function renderErrors(errors) {
        clearChildren(errorsList);
        if (!Array.isArray(errors)) return;
        for (const err of errors) {
            const li = doc.createElement('li');
            const code = typeof err?.code === 'string' ? err.code : 'error';
            const path = typeof err?.path === 'string' ? err.path : '';
            li.dataset.code = code;
            li.dataset.path = path;
            const pathPrefix = path ? ` ${path}:` : '';
            const msg = typeof err?.message === 'string' ? err.message : '';
            li.textContent = `${code}${pathPrefix} ${msg}`.trim();
            errorsList.appendChild(li);
        }
    }

    function addRecordItem(kind, record) {
        if (!record || typeof record !== 'object') return;
        const li = doc.createElement('li');
        li.dataset.kind = kind;
        const slug = typeof record.slug === 'string'
            ? record.slug
            : typeof record.id === 'string'
                ? record.id
                : typeof record.def === 'string'
                    ? record.def
                    : '';
        li.dataset.slug = slug;
        const name = typeof record.name === 'string' && record.name ? ` (${record.name})` : '';
        li.textContent = `${kind}: ${slug}${name}`;
        contentsList.appendChild(li);
    }

    function renderContents(document) {
        clearChildren(contentsList);
        if (!document || !document.content || typeof document.content !== 'object') {
            return;
        }

        const content = document.content;

        if (Array.isArray(content.rules) && content.rules[0] && typeof content.rules[0] === 'object') {
            const r = content.rules[0];
            const rulesKinds = ['classes', 'skills', 'branches', 'itemRules', 'trainers'];
            for (const kind of rulesKinds) {
                if (Array.isArray(r[kind])) {
                    for (const item of r[kind]) {
                        addRecordItem(kind, item);
                    }
                }
            }
        }

        const sbKinds = [
            'items', 'creatures', 'quests', 'shops', 'recipes',
            'places', 'routes', 'events', 'races', 'talents',
            'presets', 'skills'
        ];
        for (const kind of sbKinds) {
            if (Array.isArray(content[kind])) {
                for (const item of content[kind]) {
                    addRecordItem(kind, item);
                }
            }
        }
    }

    function resetControlsOnError(errors) {
        currentModel = null;
        history = null;
        packNameInput.value = '';
        undoButton.disabled = true;
        redoButton.disabled = true;
        exportButton.disabled = true;
        clearChildren(contentsList);
        renderErrors(errors);
    }

    function render() {
        const model = history ? history.current : currentModel;
        packNameInput.value = typeof model?.document?.name === 'string' ? model.document.name : '';
        undoButton.disabled = !history || !history.canUndo;
        redoButton.disabled = !history || !history.canRedo;

        const isValid = Boolean(model && model.document && model.validation && model.validation.ok);
        exportButton.disabled = !isValid;

        if (!model) {
            clearChildren(errorsList);
            clearChildren(contentsList);
            return;
        }

        if (!model.validation || !model.validation.ok) {
            renderErrors(model.validation?.errors || []);
        } else {
            clearChildren(errorsList);
        }

        renderContents(model.document);
    }

    function loadText(text) {
        if (destroyed) return null;
        activeReadId++;
        const model = openPack(text);
        history = createHistory(model);
        currentModel = history.current;
        render();
        return currentModel;
    }

    async function onFileChange(e) {
        if (destroyed) return;
        const file = e.target?.files?.[0];
        if (!file) return;

        activeReadId++;
        const currentReadId = activeReadId;

        if (file.size > MAX_BYTES) {
            resetControlsOnError([{
                code: 'too-large',
                path: '',
                message: `File size ${file.size} exceeds maximum limit of ${MAX_BYTES} bytes`,
            }]);
            return;
        }

        let text;
        try {
            text = await file.text();
        } catch (err) {
            if (destroyed || currentReadId !== activeReadId) return;
            resetControlsOnError([{
                code: 'file-read-error',
                path: '',
                message: `Failed to read file: ${err?.message || String(err)}`,
            }]);
            return;
        }

        if (destroyed || currentReadId !== activeReadId) return;
        loadText(text);
    }

    function onApplyName() {
        if (destroyed) return;
        const model = history ? history.current : currentModel;
        if (!model || !model.document) {
            renderErrors([{
                code: 'no-document',
                path: '',
                message: 'No document loaded to edit',
            }]);
            return;
        }

        const newName = packNameInput.value;
        const result = setField(model, ['name'], newName);
        if (!result.ok) {
            packNameInput.value = typeof model.document.name === 'string' ? model.document.name : '';
            renderErrors(result.errors || [{
                code: 'refused-edit',
                path: 'name',
                message: 'Edit refused',
            }]);
            return;
        }

        history.commit(result);
        currentModel = history.current;
        render();
    }

    function onUndo() {
        if (destroyed || !history || !history.canUndo) return;
        history.undo();
        currentModel = history.current;
        render();
    }

    function onRedo() {
        if (destroyed || !history || !history.canRedo) return;
        history.redo();
        currentModel = history.current;
        render();
    }

    function onExport() {
        if (destroyed) return;
        const model = history ? history.current : currentModel;
        if (!model || !model.document || !model.validation || !model.validation.ok) {
            return;
        }

        let text;
        try {
            text = exportPack(model);
        } catch (err) {
            renderErrors(err.errors || [{
                code: 'export-error',
                path: '',
                message: err.message || 'Export failed',
            }]);
            return;
        }

        if (typeof Blob === 'undefined') return;
        const blob = new Blob([text], { type: 'application/json' });
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const url = URL.createObjectURL(blob);
            const a = doc.createElement('a');
            a.href = url;
            const packId = (typeof model.document.id === 'string' && model.document.id) ? model.document.id : 'pack';
            a.download = `${packId}.json`;
            root.appendChild(a);
            a.click();
            root.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    fileInput.addEventListener('change', onFileChange);
    applyButton.addEventListener('click', onApplyName);
    undoButton.addEventListener('click', onUndo);
    redoButton.addEventListener('click', onRedo);
    exportButton.addEventListener('click', onExport);

    function destroy() {
        destroyed = true;
        fileInput.removeEventListener('change', onFileChange);
        applyButton.removeEventListener('click', onApplyName);
        undoButton.removeEventListener('click', onUndo);
        redoButton.removeEventListener('click', onRedo);
        exportButton.removeEventListener('click', onExport);
        clearChildren(root);
    }

    return {
        loadText,
        destroy,
    };
}

if (typeof document !== 'undefined') {
    const defaultRoot = document.getElementById('studio-dev');
    if (defaultRoot) {
        mountDev(defaultRoot);
    }
}
