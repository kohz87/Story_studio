// The scaffold's files (docs/PART5B_SPEC.md §3.1, §3.3, §3.7, §6.2): the nine files Studio writes from the templates, the
// Story Block files it copies, and the zip of both. Pure: the same inputs always give the same bytes.

import { SB_STAMP, TEMPLATES, VENDOR_FILES } from './assets.js';
import { jsString, mdText, validateInputs } from './inputs.js';
import { renderTemplate } from './render.js';
import { zipStore } from './zip.js';

/** { values, blocks } for renderTemplate (3.3), from valid inputs. */
export function placeholders(inputs) {
    const values = {
        moduleId: inputs.moduleId,
        domain: inputs.domain,
        field: inputs.field,
        kind: inputs.kind,
        kindLabel: inputs.kindLabel,
        commandType: `${inputs.domain}.${inputs.command}`,
        queryName: `${inputs.domain}.${inputs.query}`,
        screenId: `${inputs.moduleId}/${inputs.domain}`,
        capability: inputs.capability,
        min: String(inputs.min),
        max: String(inputs.max),
        initial: String(inputs.initial),
        step: String(inputs.step),
        nameJs: jsString(inputs.name),
        descriptionJs: jsString(inputs.description),
        labelJs: jsString(inputs.label),
        actionJs: jsString(inputs.action),
        nameMd: mdText(inputs.name),
        descriptionMd: mdText(inputs.description),
        actionMd: mdText(inputs.action),
        screens: inputs.screen ? '[screen]' : '[]',
    };
    const blocks = {
        capabilities: inputs.capability !== '' ? TEMPLATES['capabilities.js.tmpl'] : '',
        capabilityRow: inputs.capability !== '' ? TEMPLATES['capability-row.md.tmpl'] : '',
        screenConst: inputs.screen ? TEMPLATES['screen-const.js.tmpl'] : '',
        screenRow: inputs.screen ? TEMPLATES['screen-row.md.tmpl'] : '',
    };
    return { values, blocks };
}

/** Node and browsers both have atob; the bytes are the decoded base64 text. */
export function fromBase64(text) {
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

/**
 * → { ok: true, inputs, files: [{ path, text }], copied: { count, stamp } } | { ok: false, errors }.
 * `files` are the nine written files of 3.1 in path order; `copied.count` is VENDOR_FILES.length and `copied.stamp` is
 * SB_STAMP. Does not decode VENDOR_FILES (it runs on every keystroke of the form).
 */
export function generateScaffold(raw) {
    const checked = validateInputs(raw);
    if (!checked.ok) return { ok: false, errors: checked.errors };
    const { inputs } = checked;
    const { values, blocks } = placeholders(inputs);
    const text = name => renderTemplate(TEMPLATES[name], values, blocks);
    const manifest = {
        display_name: inputs.name,
        loading_order: 30,
        requires: [],
        optional: [],
        dependencies: ['third-party/Story_block'],
        js: 'index.js',
        author: inputs.author,
        version: '0.1.0',
    };
    const pkg = {
        name: inputs.moduleId,
        version: '0.1.0',
        private: true,
        description: inputs.description,
        type: 'module',
        engines: { node: '>=22' },
        scripts: { test: 'node --test "tests/*.test.js"' },
    };
    const written = [
        ['.gitignore', text('gitignore.tmpl')],
        ['README.md', text('README.md.tmpl')],
        ['index.js', text('index.js.tmpl')],
        ['manifest.json', `${JSON.stringify(manifest, null, 4)}\n`],
        ['package.json', `${JSON.stringify(pkg, null, 2)}\n`],
        ['src/module.js', text('module.js.tmpl')],
        [`src/parts/${inputs.domain}.js`, text('part.js.tmpl')],
        ['tests/module.test.js', text('module.test.js.tmpl')],
        ['tests/vendor/README.md', text('vendor-README.md.tmpl')],
    ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return {
        ok: true,
        inputs,
        files: written.map(([path, body]) => ({ path, text: body })),
        copied: { count: VENDOR_FILES.length, stamp: SB_STAMP },
    };
}

/** → { ok: true, entries: [{ path, data: Uint8Array }] } (all files, unprefixed, in path order) | { ok: false, errors }. */
export function scaffoldEntries(raw) {
    const generated = generateScaffold(raw);
    if (!generated.ok) return generated;
    const encoder = new TextEncoder();
    const entries = generated.files.map(({ path, text }) => ({ path, data: encoder.encode(text) }));
    for (const [path, base64] of VENDOR_FILES) entries.push({ path, data: fromBase64(base64) });
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { ok: true, entries };
}

/** → { ok: true, bytes: Uint8Array, filename: `${moduleId}.zip` } | { ok: false, errors }: the entries under `${moduleId}/`. */
export function scaffoldZip(raw) {
    const result = scaffoldEntries(raw);
    if (!result.ok) return result;
    const { moduleId } = raw;
    const bytes = zipStore(result.entries.map(({ path, data }) => ({ path: `${moduleId}/${path}`, data })));
    return { ok: true, bytes, filename: `${moduleId}.zip` };
}
