// The portrait pictures of the open pack, kept in this browser (IndexedDB) so a reload brings them back with the project: the
// project itself is saved as text, which would not hold them. One record, replaced whole; nothing here is needed to work, so every
// call answers quietly when the browser has no IndexedDB or refuses it.

const DATABASE = 'story-studio';
const STORE = 'portraits';
const KEY = 'current';

function open(win) {
    return new Promise((resolve, reject) => {
        const factory = win?.indexedDB;
        if (!factory) { reject(new Error('No IndexedDB')); return; }
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function run(win, mode, action) {
    return open(win).then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => { db.close(); resolve(request?.result); };
        transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    }));
}

/** Keeps the pictures (a Map of name -> { bytes, type, width, height }); resolves true when they were stored. */
export async function saveHeld(win, held) {
    try {
        const items = [...held].map(([name, picture]) => ({ name, type: picture.type, width: picture.width, height: picture.height, bytes: picture.bytes }));
        await run(win, 'readwrite', store => store.put({ items }, KEY));
        return true;
    } catch { return false; }
}

/** The pictures kept, as a Map, or null when there are none or they cannot be read. */
export async function loadHeld(win) {
    try {
        const record = await run(win, 'readonly', store => store.get(KEY));
        if (!record || !Array.isArray(record.items)) return null;
        const held = new Map();
        for (const item of record.items) {
            if (typeof item?.name === 'string' && item.bytes instanceof Uint8Array) held.set(item.name, Object.freeze({ bytes: item.bytes, type: item.type, width: item.width, height: item.height }));
        }
        return held;
    } catch { return null; }
}

const IMAGE_KEY = 'card-image';
const DRAFT_KEY = 'card-draft';

// The Character card page's draft and picture are kept here, apart from the project's own save (session.js), so a large card can
// never stop the pack from being saved. Each resolves true when stored; `null` forgets it.

/** Keeps the card picture (PNG bytes) of the pack `packId`. */
export async function saveCardImage(win, packId, bytes) {
    try {
        await run(win, 'readwrite', store => (bytes ? store.put({ packId, bytes }, IMAGE_KEY) : store.delete(IMAGE_KEY)));
        return true;
    } catch { return false; }
}

/** The card picture kept, `{ packId, bytes }`, or null. */
export async function loadCardImage(win) {
    try {
        const record = await run(win, 'readonly', store => store.get(IMAGE_KEY));
        return typeof record?.packId === 'string' && record.bytes instanceof Uint8Array ? record : null;
    } catch { return null; }
}

/** Keeps the card draft (a JSON-safe object) of the pack `packId`. */
export async function saveCardDraft(win, packId, draft) {
    try {
        await run(win, 'readwrite', store => (draft ? store.put({ packId, draft, at: Date.now() }, DRAFT_KEY) : store.delete(DRAFT_KEY)));
        return true;
    } catch { return false; }
}

/** The card draft kept, `{ packId, draft }`, or null. */
export async function loadCardDraft(win) {
    try {
        const record = await run(win, 'readonly', store => store.get(DRAFT_KEY));
        return typeof record?.packId === 'string' && record.draft && typeof record.draft === 'object' ? { ...record, at: Number(record.at) || 0 } : null;
    } catch { return null; }
}
