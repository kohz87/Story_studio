// Pure edits to ordinary pack records. Story Block validates each resulting snapshot.
// The edits live in src/edits/ (one group per file, each with its own header). This file re-exports them, so importers keep this path.
export { add, setRecords, renameId, remove } from './edits/record-ops.js';
export { setField } from './edits/field.js';
export { setSchemaField } from './edits/schema-field.js';
