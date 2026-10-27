import { slugify } from '../vendor/story-block/src/v2/packs/validate.js';

// The key Story Block gives a record, kind by kind (validate.js records() and the rules checker):
// items, places, creatures, quests, shops, recipes and the legacy skills are keyed by `slug`, else by the slug of
// their name; races, talents and presets by `id` (or `slug`), else the slug of their name; events by `id` (or `slug`);
// routes by `slug`, else the slug of "from to kind"; markets by `type` or `tag`; item rules by `def`; classes, skills,
// branches and trainers by `slug`, which the rules checker requires. A record with no key reads as ''.
const BY_NAME = new Set(['items', 'places', 'creatures', 'quests', 'shops', 'recipes', 'legacySkills']);
const BY_ID = new Set(['races', 'talents', 'presets']);
const nameKey = record => (typeof record.name === 'string' ? slugify(record.name) : '');

export function identity(record, kind) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return '';
    if (BY_NAME.has(kind)) return record.slug ?? nameKey(record);
    if (BY_ID.has(kind)) return record.id ?? record.slug ?? nameKey(record);
    switch (kind) {
        case 'events': return record.id ?? record.slug ?? '';
        case 'routes': return record.slug ?? slugify(`${record.from ?? ''} ${record.to ?? ''} ${record.kind ?? ''}`);
        case 'markets': return record.type ?? record.tag ?? '';
        case 'itemRules': return record.def ?? '';
        case 'classes': case 'skills': case 'branches': case 'trainers': return record.slug ?? record.id ?? '';
        default: return record.slug ?? record.id ?? record.def ?? nameKey(record);
    }
}
