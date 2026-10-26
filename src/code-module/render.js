// Fills a code module template (docs/PART5B_SPEC.md §3.3, §3.5). Block lines are replaced first, by their snippet text
// (inserted unrendered); then every inline placeholder is filled in one pass. Values are inserted once and never scanned
// again, so a value can never introduce a placeholder.

const BLOCK = /^\{\{@([A-Za-z][A-Za-z0-9]*)\}\}\n/gm;
const INLINE = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;
const LEFT = /\{\{@?[A-Za-z]/;

/** Fills a template: block lines first (their snippet text is inserted unrendered), then every inline placeholder in one pass. */
export function renderTemplate(template, values, blocks) {
    const withBlocks = template.replace(BLOCK, (match, name) => {
        if (!Object.hasOwn(blocks, name)) throw new Error(`Unknown block "${name}"`);
        return blocks[name];
    });
    const text = withBlocks.replace(INLINE, (match, name) => {
        if (!Object.hasOwn(values, name)) throw new Error(`Unknown placeholder "${name}"`);
        return values[name];
    });
    if (LEFT.test(text)) throw new Error('A placeholder was left unfilled');
    return text;
}
