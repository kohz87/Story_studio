// Helpers the simulator's parts share: clones, deep equality, the failure shape, the text that names a step and the key of a
// reply's source. Pure.

export const clone = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const fail = (code, message, path = '') => ({ ok: false, errors: [{ code, path, message }] });
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);


export const TEXT = n => `Step ${n}.`;
export const sourceKey = source => source ? `${source.sid}/${source.swipeKey}/${source.evidence}` : '';
