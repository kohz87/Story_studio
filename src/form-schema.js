import { ITEM_KINDS, RARITIES, SKILL_TYPES, SKILL_TARGETS, LIMITS, RECORD_LIMITS, SLUG, ITEM_CARRY, EVENT_LIMITS } from '../vendor/story-block/src/v2/packs/limits.js';

export const HOST_SCHEMAS = {
    items: {
        type: 'object',
        required: ['name', 'slug', 'kind', 'rarity'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            slug: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug, pattern: SLUG.source },
            kind: { enum: ITEM_KINDS, default: 'goods' },
            rarity: { enum: RARITIES, default: 'common' },
            value: { type: 'integer', minimum: 0, default: 0 },
            stack: { type: 'boolean', default: true },
            slot: { oneOf: [{ type: 'null' }, { type: 'string', maxLength: RECORD_LIMITS.word }] },
            carry: { type: 'integer', minimum: ITEM_CARRY.min, maximum: ITEM_CARRY.max },
            aliases: { type: 'array', items: { type: 'string', maxLength: LIMITS.name } },
            tags: { type: 'array', items: { type: 'string', maxLength: RECORD_LIMITS.word } },
            stats: { type: 'object' },
            effect: { type: 'object' },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
        },
    },
    creatures: {
        type: 'object', required: ['name', 'slug'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            slug: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug, pattern: SLUG.source },
            aliases: { type: 'array', items: { type: 'string', maxLength: LIMITS.name } },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
        },
    },
    places: {
        type: 'object',
        required: ['name', 'slug', 'x', 'y'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            slug: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug, pattern: SLUG.source },
            x: { type: 'number', default: 0 },
            y: { type: 'number', default: 0 },
            region: { type: 'string', maxLength: LIMITS.name, default: '' },
            kind: { type: 'string', maxLength: LIMITS.name, default: '' },
            layer: { type: 'string', maxLength: LIMITS.name, default: '' },
            market: { oneOf: [{ type: 'null' }, { type: 'string', maxLength: RECORD_LIMITS.word }] },
            hidden: { type: 'boolean', default: false },
            secret: { type: 'boolean', default: false },
            tags: { type: 'array', items: { type: 'string', maxLength: RECORD_LIMITS.word } },
            aliases: { type: 'array', items: { type: 'string', maxLength: LIMITS.name } },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
        },
    },
    events: {
        type: 'object',
        required: ['id', 'when', 'cue'],
        properties: {
            id: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug, pattern: SLUG.source },
            when: { type: 'string', minLength: 1, maxLength: EVENT_LIMITS.when },
            cue: { type: 'string', minLength: 1, maxLength: EVENT_LIMITS.cue },
            once: { type: 'boolean', default: true },
            after: { oneOf: [{ type: 'null' }, { type: 'string', maxLength: RECORD_LIMITS.slug }] },
            then: { type: 'array', items: { type: 'object', required: ['command'], properties: { command: { type: 'string', maxLength: LIMITS.name }, payload: { type: 'object' } } } },
        },
    },
    routes: {
        type: 'object',
        required: ['slug', 'from', 'to', 'kind'],
        properties: {
            slug: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug },
            from: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            to: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            kind: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.word, default: 'road' },
            km: { oneOf: [{ type: 'null' }, { type: 'number', minimum: 0 }] },
            hours: { oneOf: [{ type: 'null' }, { type: 'number', minimum: 0 }] },
            corridor: { type: 'string', maxLength: LIMITS.name, default: '' },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
        },
    },
    races: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
            id: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug },
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
            stats: { type: 'object' },
            tags: { type: 'array', items: { type: 'string', maxLength: RECORD_LIMITS.word } },
        },
    },
    talents: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
            id: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug },
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
            stats: { type: 'object' },
            tags: { type: 'array', items: { type: 'string', maxLength: RECORD_LIMITS.word } },
        },
    },
    presets: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
            id: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug },
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
            race: { oneOf: [{ type: 'null' }, { type: 'string', maxLength: LIMITS.name }] },
            talents: { type: 'array', items: { type: 'string', maxLength: LIMITS.name } },
            skills: { type: 'array', items: { type: 'string', maxLength: LIMITS.name } },
            points: { type: 'object', properties: { STR: { type: 'integer', minimum: 0 }, VIT: { type: 'integer', minimum: 0 }, AGI: { type: 'integer', minimum: 0 }, DEX: { type: 'integer', minimum: 0 }, INT: { type: 'integer', minimum: 0 }, LUK: { type: 'integer', minimum: 0 }, CHA: { type: 'integer', minimum: 0 } } },
        },
    },
    legacySkills: {
        type: 'object',
        required: ['name', 'slug', 'type', 'target'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            slug: { type: 'string', minLength: 1, maxLength: RECORD_LIMITS.slug },
            type: { enum: SKILL_TYPES, default: 'physical' },
            stat: { oneOf: [{ type: 'null' }, { enum: ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'] }] },
            target: { enum: SKILL_TARGETS, default: 'one' },
            element: { oneOf: [{ type: 'null' }, { type: 'string', maxLength: RECORD_LIMITS.element }] },
            tags: { type: 'array', items: { type: 'string', maxLength: RECORD_LIMITS.word } },
            note: { type: 'string', maxLength: RECORD_LIMITS.note, default: '' },
        },
    },
};

// How a form names the variants of a union whose `$defs` entries have a clear meaning (a quest is either closed or open).
export const VARIANT_LABELS = Object.freeze({});

export function resolveSchema(schema, defs = {}, seen = new Set()) {
    if (!schema || typeof schema !== 'object') return schema;
    if (schema.$ref) {
        const refKey = schema.$ref.replace(/^#\/\$defs\//, '');
        if (seen.has(refKey)) return schema;
        const target = defs?.[refKey];
        if (target) {
            seen.add(refKey);
            const { $ref, ...rest } = schema;
            return resolveSchema({ ...target, ...rest, defName: refKey }, defs, new Set(seen));
        }
    }
    const out = Array.isArray(schema) ? [] : {};
    for (const [k, v] of Object.entries(schema)) {
        if (k === 'properties' && v && typeof v === 'object') {
            const props = {};
            for (const [pk, pv] of Object.entries(v)) props[pk] = resolveSchema(pv, defs, new Set(seen));
            out.properties = props;
        } else if (k === 'items' && v && typeof v === 'object') {
            out.items = resolveSchema(v, defs, new Set(seen));
        } else if (k === 'oneOf' && Array.isArray(v)) {
            out.oneOf = v.map(item => resolveSchema(item, defs, new Set(seen)));
        } else if (v && typeof v === 'object') {
            out[k] = resolveSchema(v, defs, new Set(seen));
        } else {
            out[k] = v;
        }
    }
    return out;
}

export function schemaForKind(kind) {
    return HOST_SCHEMAS[kind] ? resolveSchema(HOST_SCHEMAS[kind]) : null;
}

export function schemaForRecord(kind) {
    return schemaForKind(kind);
}

export function referenceTarget(kind, path, record) {
    const segs = Array.isArray(path) ? path.map(String) : String(path).split('.');
    const last = segs[segs.length - 1];
    const prev = segs[segs.length - 2];

    if (kind === 'presets') {
        if (last === 'race') return 'races';
        if (prev === 'talents' && /^\d+$/.test(last)) return 'talents';
        if (prev === 'skills' && /^\d+$/.test(last)) return 'legacySkills';
    }
    if (kind === 'recipes') {
        if (last === 'makes') return 'items';
        if (last === 'item' && (prev === 'materials' || segs.includes('materials'))) return 'items';
    }
    if (kind === 'shops') {
        if (last === 'place') return 'places';
        if (last === 'item' && segs.includes('stock')) return 'items';
    }
    if (kind === 'creatures') {
        if (prev === 'skills' && /^\d+$/.test(last)) return 'skills';
        if (last === 'def' && (prev === 'loot' || segs.includes('loot'))) return 'items';
    }
    if (kind === 'events' && last === 'after') return 'events';
    if (kind === 'routes' && (last === 'from' || last === 'to')) return 'places';
    if (kind === 'quests') {
        if (last === 'turnInPlace') return 'places';
        if (last === 'giver') return 'npcs';
        if (last === 'thread') return 'threads';
        if (last === 'foe') return 'creatures';
        if (last === 'place') return 'places';
        if (last === 'template') return 'quests';
        if (last === 'previous' || last === 'next') return 'quests';
        if (prev === 'classes' && /^\d+$/.test(last)) return 'classes';
        if (last === 'def' || last === 'item') return 'items';
    }
    if (last === 'def' || last === 'makes') return 'items';
    if (last === 'place' || last === 'from' || last === 'to') return 'places';
    if (last === 'foe') return 'creatures';
    return null;
}

export function validateField(input, value) {
    const schema = resolveSchema(input) || {};
    const refuse = message => ({ ok: false, code: 'bad-value', message });
    if (schema.oneOf && !schema.oneOf.some(part => validateField(part, value).ok)) return refuse('Value does not match an allowed variant');
    if (schema.const !== undefined && !Object.is(schema.const, value)) return refuse('Value must match the fixed value');
    if (schema.enum && !schema.enum.some(entry => Object.is(entry, value))) return refuse('Choose an allowed value');
    if (schema.not && validateField(schema.not, value).ok) return refuse('Value is excluded by the schema');
    if (schema.type) {
        const correct = schema.type === 'null' ? value === null
            : schema.type === 'array' ? Array.isArray(value)
                : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
                    : schema.type === 'integer' ? Number.isSafeInteger(value)
                        : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
                            : typeof value === schema.type;
        if (!correct) return refuse(`Expected ${schema.type}`);
    }
    if (typeof value === 'number') {
        if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return refuse('Number is outside the allowed bounds');
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return refuse('Number must exceed the lower bound');
        if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return refuse('Number must be below the upper bound');
        if (schema.multipleOf !== undefined && !Number.isInteger(value / schema.multipleOf)) return refuse('Number must be an allowed multiple');
    }
    if (typeof value === 'string') {
        const length = [...value].length;
        if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return refuse('Text is outside the allowed length');
        if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return refuse('Text does not match the required pattern');
    }
    if (Array.isArray(value)) {
        if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return refuse('List is outside the allowed length');
        if (schema.uniqueItems && new Set(value.map(entry => JSON.stringify(entry))).size !== value.length) return refuse('List entries must be unique');
        for (const entry of value) {
            const result = validateField(schema.items, entry);
            if (!result.ok) return result;
        }
    } else if (value !== null && typeof value === 'object') {
        for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return refuse(`Missing required field: ${key}`);
        for (const [key, entry] of Object.entries(value)) {
            if (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key)) return refuse(`Unknown field: ${key}`);
            const result = validateField(schema.properties?.[key], entry);
            if (!result.ok) return result;
        }
    }
    return { ok: true };
}

export function matchesVariant(schema, value) {
    if (schema.oneOf) return schema.oneOf.some(s => matchesVariant(s, value));
    if (schema.const !== undefined) return Object.is(schema.const, value);
    if (schema.enum) return schema.enum.some(v => Object.is(v, value));
    if (schema.type === 'null') return value === null;
    if (schema.type === 'array') return Array.isArray(value);
    if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(schema.properties || {}).every(([k, s]) => s.const === undefined
            || (!Object.hasOwn(value, k) && !schema.required?.includes(k)) || Object.is(value[k], s.const));
    if (schema.type === 'integer') return Number.isInteger(value);
    return typeof value === schema.type;
}

/** Validates a replacement and its enclosing lists before any edit or draft change. */
export function validateChange(input, current, path, value) {
    const schema = resolveSchema(input) || {};
    if (!path.length) return validateField(schema, value);
    if (schema.oneOf) {
        const active = schema.oneOf.find(part => matchesVariant(part, current));
        if (!active) return { ok: false, code: 'bad-value', message: 'Initialize the variant first' };
        return validateChange(active, current, path, value);
    }
    const [key, ...rest] = path;
    const child = schema.type === 'array' ? schema.items : schema.properties?.[key];
    const checked = validateChange(child, current?.[key], rest, value);
    if (!checked.ok) return checked;
    if (schema.type === 'array') {
        const next = JSON.parse(JSON.stringify(current));
        let parent = next;
        for (const part of path.slice(0, -1)) parent = parent[part];
        parent[path.at(-1)] = value;
        return validateField(schema, next);
    }
    return checked;
}
