// A live preview of the narrator grammar a definition declares (DATA_MODULES.md §3, decision 6). Story Block
// generates the real grammar; when it exports a generator the adapter returns that text too. This preview shows the
// shape of each line, the module reference the narrator will use, and example lines expected to apply or be refused.
import { entries, list, own, isObject, expressionText, shortRef, moduleId } from './dm-model.js';
import { grammar as storyBlockGrammar, status } from './sb-adapter.js';

const DASH = '—';

/** The label's value domain as the narrator sees it. */
export function domainText(schema) {
    if (!isObject(schema)) return '<value>';
    if (schema.type === 'enum') return list(schema.values).map(String).join('|') || '<value>';
    if (schema.type === 'int') return Number.isInteger(schema.min) && Number.isInteger(schema.max) ? `${schema.min} to ${schema.max}` : '<whole number>';
    if (schema.type === 'bool') return 'true|false';
    if (schema.type === 'text') return '<text>';
    return '<value>';
}

function sampleValue(schema) {
    if (schema?.type === 'enum') return list(schema.values)[0] ?? 'value';
    if (schema?.type === 'int') return Number.isInteger(schema.min) && Number.isInteger(schema.max) ? Math.floor((schema.min + schema.max) / 2) : 1;
    if (schema?.type === 'bool') return 'true';
    return 'text';
}

function outOfRange(schema) {
    if (schema?.type === 'enum') return { value: 'not-listed', code: 'DM_LABEL', why: 'a value outside the declared list' };
    if (schema?.type === 'int' && Number.isInteger(schema.max)) return { value: schema.max + 1, code: 'DM_BOUNDS', why: 'a whole number above the declared maximum' };
    if (schema?.type === 'int' && Number.isInteger(schema.min)) return { value: schema.min - 1, code: 'DM_BOUNDS', why: 'a whole number below the declared minimum' };
    return null;
}

/** Human-readable effect, for reading the generated grammar and rules (not executed). */
export function effectText(effect) {
    if (!isObject(effect)) return String(effect);
    const target = () => list(effect.path).map(part => (Array.isArray(part) ? `{${expressionText(part)}}` : String(part))).join('.');
    switch (effect.op) {
        case 'set': return `set ${target()} to ${expressionText(effect.value)}`;
        case 'add': return `add ${expressionText(effect.value)} to ${target()}${effect.bounds === 'clamp' ? ' (clamped to its bounds)' : ''}`;
        case 'clamp': return `clamp ${target()} between ${expressionText(effect.min)} and ${expressionText(effect.max)}`;
        case 'reward': return `reward template ${effect.template}`;
        case 'offer': return `offer template ${effect.template} as ${effect.key}`;
        case 'award': return `award offer ${effect.offer}`;
        default: return `${effect.op}`;
    }
}

/** The fixed value a template's picker chooses, shown beside the template (display of the declared picker). */
export function pickedValue(range) {
    if (!isObject(range) || !Number.isInteger(range.min) || !Number.isInteger(range.max)) return null;
    if (range.pick === 'min') return range.min;
    if (range.pick === 'max') return range.max;
    if (range.pick === 'midpoint') return range.min + Math.floor((range.max - range.min) / 2);
    return null;
}

function kindPreview(document, module, ref, name, kind, actor) {
    const labels = entries(kind?.labels).map(([label, schema]) => ({ name: label, type: schema?.type ?? '?', domain: domainText(schema), schema }));
    const character = module?.scope === 'character';
    const op = typeof kind?.op === 'string' && kind.op ? kind.op : '?';
    const make = (reason, parts) => `${op} dm ${ref} ${DASH} ${reason} | kind: ${name}${character ? ` | who: ${parts.who ?? actor}` : ''}${parts.labels.map(([k, v]) => ` | ${k}: ${v}`).join('')}`;
    const good = labels.map(label => [label.name, sampleValue(label.schema)]);
    const generated = `${op} dm ${ref} ${DASH} <what happened> | kind: ${name}${character ? ' | who: <attached character>' : ''}${labels.map(label => ` | ${label.name}: ${label.domain}`).join('')}`;
    const refused = [];
    for (const label of labels) {
        const bad = outOfRange(label.schema);
        if (bad) refused.push({ line: make('what happened', { labels: good.map(([k, v]) => [k, k === label.name ? bad.value : v]) }), code: bad.code, why: `${label.name}: ${bad.why}` });
    }
    if (labels.length) {
        refused.push({ line: make('what happened', { labels: good.slice(1) }), code: 'DM_LABEL', why: `missing label ${labels[0].name}` });
        refused.push({ line: make('what happened', { labels: [...good, good[0]] }), code: 'DM_LABEL', why: `label ${labels[0].name} given twice` });
    }
    const once = list(kind?.oncePerReply).filter(item => typeof item === 'string');
    const conditions = [];
    if (own(kind, 'when')) conditions.push({ code: 'DM_CONDITION', when: expressionText(kind.when), message: typeof kind.refusal === 'string' ? kind.refusal : '' });
    return {
        name, op, line: generated, labels: labels.map(({ name: n, type, domain }) => ({ name: n, type, domain })),
        who: character, once,
        onceText: once.length ? `Once per reply for each ${once.join(' and ')}; a repeat in the same reply (a Continue too) is CLAIMED.` : 'Once per reply for this kind; a repeat in the same reply (a Continue too) is CLAIMED.',
        conditions, ui: kind?.ui === true,
        effects: list(kind?.effects).map(effectText),
        examples: { valid: [make('what happened', { labels: good })], refused },
        v11: own(kind, 'check'),
    };
}

/**
 * The generated narrator grammar for one definition: a line shape per kind using the short module reference when it
 * is unique in the pack, and example lines expected to apply or be refused. `actor` names the sample attached character.
 */
export function grammarPreview(document, module, { actor = 'Wessel' } = {}) {
    const ref = shortRef(document, module);
    const id = moduleId(document, module);
    const real = status().grammar ? storyBlockGrammar(document, module) : null;
    return {
        source: real ? 'story-block' : 'studio-preview',
        storyBlockText: typeof real === 'string' ? real : null,
        moduleId: id, ref, short: ref !== id, scope: module?.scope,
        kinds: entries(module?.kinds).map(([name, kind]) => kindPreview(document, module, ref, name, kind, actor)),
        templates: entries(module?.rewards).map(([name, template]) => ({
            name,
            values: entries(template?.values).map(([value, range]) => (isObject(range) && isObject(range.table)
                ? { name: value, binding: range.binding, table: entries(range.table).map(([key, branch]) => ({ key, min: branch?.min, max: branch?.max, pick: branch?.pick, picked: pickedValue(branch) })) }
                : { name: value, min: range?.min, max: range?.max, pick: range?.pick, picked: pickedValue(range) })),
            bindings: entries(template?.bindings).map(([binding, schema]) => ({ name: binding, domain: domainText(schema) })),
        })),
    };
}

/** Plain text of the preview, one block per kind, for copying into a card or a note. */
export function grammarText(preview) {
    return preview.kinds.map(kind => [`${kind.name}`, `  ${kind.line}`, `  ${kind.onceText}`].join('\n')).join('\n\n');
}
