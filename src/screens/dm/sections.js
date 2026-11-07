// The Data modules form sections. Each takes the section context S:
//   { doc, studio, draft, document, packId, touch(), redraw(), refuse(errors), rename(target, name), remove(target) }
// and draws into `host`. They edit the draft record in place; nothing reaches the pack until Apply.
// The sections live in ./sections/ (one group per file, each with its own header); this file re-exports them, so importers keep this path.
import { MOUNTS } from '../../data-modules/hints.js';
import { status } from '../../data-modules/sb-adapter.js';
export { identity, fields } from './sections/identity-state.js';
export { imports } from './sections/imports.js';
export { kinds } from './sections/kinds.js';
export { rules, timers } from './sections/rules-timers.js';
export { rewards } from './sections/rewards.js';
export { exportsSection } from './sections/exports.js';
export { migrations } from './sections/migrations.js';

export { MOUNTS, status };
