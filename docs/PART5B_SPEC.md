# Story Studio Part 5b: code-module scaffolding (implementation spec)

Status: proposed. Docs only; nothing here is implemented yet. Branch `spec/part-5b`.

A pack author who outgrows data modules (Story Block `docs/v2/DATA_MODULES.md`) fills one form in Studio's new
**Code module** section and downloads a zip: a starter SillyTavern extension that is a real Story Suite v2 module. It
registers with Story Block's sdk, declares a state domain with a validator, a narrator line (capture kind), a command
with a replay guard, a query the guard may ask on replay, an optional screen and an optional capability, and it ships
a copy of Story Block's testkit with tests that pass. The author unzips it, runs `git init` and `npm test`, installs it
into SillyTavern and grows it.

This spec is written to be implemented milestone by milestone (section 9) by someone who has not read the Story Block
code. Every exact text the implementation needs is in this document **and** in byte-exact files next to it:

- `docs/part5b/templates/*.tmpl`: the eleven templates (section 3.6), to be copied unchanged into `src/code-module/templates/`.
- `docs/part5b/golden-inputs.json` and `docs/part5b/golden/lantern-oil/**.golden`: the golden example (section 4).

When the text printed in this document and one of those files differ, **the file wins** (its SHA-256 is in section 4.3).
Copy the files with `cp`, never by retyping them.

Contents: 1 Scope · 2 Contracts relied on · 3 The scaffold · 4 Golden example · 5 Validation and refusals ·
6 Studio modules and APIs · 7 UI · 8 Proof · 9 Milestones · 10 Risks and reviewer checks · 11 Open questions.

---

## 1. Scope

### 1.1 In scope

- A pure generator in `src/code-module/`: inputs → validation → the scaffold's files → a deterministic STORE-only zip.
- The Story Block files the scaffold needs for its tests, embedded in the single-file build from Studio's own vendored
  copy (`vendor/story-block/`), with a VERSION stamp.
- A **Code module** section in Studio (rail entry, form, live file list with the generated text, refusals through the
  existing `applyEdit` helper, **Download zip**).
- Tests: golden bytes, determinism, validation and escaping, the zip format, the scaffold's own `npm test` run in a temp
  folder, and a registration/replay test of the scaffold on Story Block's real host.

### 1.2 Out of scope

- Any change to Story Block, RPG Battle or Story Director, or to `vendor/story-block/` by hand.
- Several state fields, several parts, features, settings, widgets, hooks other than `replayGuard`, prompt context.
  The README the scaffold ships says how to add them.
- Keeping code-module drafts across reloads (session only, like the narrator card).
- Generating from a data module (a "convert this data module to code" button): a later part.

### 1.3 Baseline (read before M0)

| Repository | Commit this spec was checked against |
|---|---|
| Story Studio | `studio/part-5a` at `68ea1a10409883353f5f81b0a9a097a2f720cd03` (part 5a, data modules; not yet merged) |
| Story Block | `main` at `076764b786296a93d1e9812e0c8b69955a7e243d` (version 2.1.0) |
| RPG Battle | `main` at `1e01275` |
| Story Director | `main` at `8233c89` |

Part 5b starts **after part 5a is merged into Studio's `main`**. All Studio line numbers below are part 5a's. Story
Block line numbers are `076764b`'s.

Part 5a vendors Story Block `be846390` whose VERSION says 2.0.0 and whose registry does not know `capabilities`. The
scaffold declares `requires: { storyBlock: '>=2.1.0' }` and `capabilities`, so **M0 re-syncs Studio's vendored copy to
Story Block 2.1.0** (`076764b` or later). This was tried while writing the spec: after `npm run sync-sb -- --from
<Story Block 076764b>` every Node test of part 5a passed except the committed-build comparison, which passes again
after `npm run build`. A generated scaffold run against the 2.0.0 copy fails with "needs Story Block ≥ 2.1.0".

### 1.4 Rules that hold for every milestone (Studio `AGENTS.md`)

- Plain ES modules, no new dependencies, no network at runtime. Story Block only through `vendor/story-block/`.
- DOM through `createElement`/`createElementNS` and `textContent` only (no `innerHTML`, `insertAdjacentHTML`,
  `outerHTML`, `DOMParser`, `eval`, `new Function`).
- `npm run -s check` and `npm run -s test:dot` pass before every commit; `git diff --check` is clean.
- Match the surrounding code's comment density and idiom. No model or tool names in files or commit messages.
- Work only on the branch you were given; never push to `main`, never force-push, never open or merge a PR.

---

## 2. Contracts relied on

Every behaviour the scaffold depends on, with where it is defined. "SB" is Story Block at `076764b`; "ST5a" is Studio
at `68ea1a1`.

### 2.1 Module definition and registration (Story Block)

| Contract | Where |
|---|---|
| Known definition fields, including `replayQueries` and `capabilities`; any other field is a warning | SB `src/v2/registry.js:56`, `:343-375` (`definitionWarnings`) |
| Module id `^[a-z0-9][a-z0-9._-]*$`; domain `^[a-z][a-zA-Z0-9_-]*$`; command and query names `^[a-z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*$`; capture kind `^[a-z][a-z0-9_-]*$` | SB `src/v2/registry.js:65-69` |
| `capabilities`: a list of at most 32 slugs | SB `src/v2/registry.js:61`, `:170-176`; MODULES.md:41-45; PACKS.md:64 |
| Slug rule `^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$` (exported `SLUG`); host capabilities `rb-rules-v2`, `data-modules-v1` (`HOST_CAPABILITIES`) | SB `src/v2/packs/limits.js:146`, `:39` |
| Domain: `initial()` returns a plain-JSON object; `validate` and `counters` optional; the host's `savepoints` domain is refused | SB `src/v2/registry.js:178-198` |
| Commands may not start with `capture.` or `module.` | SB `src/v2/registry.js:200-209` |
| `replayQueries` must name the module's own queries | SB `src/v2/registry.js:216-226` |
| Capture: `kinds` with a one-line `grammar` each, one `apply(ctx, line)` | SB `src/v2/registry.js:227-252` |
| Screens need an id like `module/name` | SB `src/v2/registry.js:319-325` |
| `requires.storyBlock` refuses a module on an older host ("needs Story Block ≥ x") | SB `src/v2/registry.js:450-455`; SPEC.md:760-770 |
| A name another module already owns refuses the whole module | SB `src/v2/registry.js:456-466` |
| `sdk.registerModule(def)`; a late module gets its `initial()` slices | SB `src/v2/sdk.js:506-515`; SPEC.md §2.6 (216-222) |
| `sdk.modules()` shows `capabilities` and `status` | SB `src/v2/sdk.js:609-626` |
| `globalThis.StoryBlock = { apiVersion: 2, version, ready, sdk }` | SB `index.js:41`; SPEC.md §3.1 (228-236) |
| Every id-like key (`id`, `…Id`, `…_id`) must hold a well-formed id | SB `src/v2/ops.js:565-566` |
| Part layout (`domains`, `commands`, `queries`, `kinds`, hooks…) merged into one definition | SB MODULES.md §A (13-40) |

### 2.2 Commands, capture, replay (Story Block)

| Contract | Where |
|---|---|
| `validate(slice)` → list of sentences; any error rejects the whole command | SB SPEC.md §2.5 (207-214) |
| Handlers: `ctx.read`, `ctx.draft` (own domains only), `ctx.claim`, `ctx.fail`, `ctx.query`; synchronous, pure apart from `ctx`; a result may carry `problem` | SB SPEC.md §3.2 (254-309) |
| A change line runs as a `story` command; `ctx.carrier.sid` identifies the reply; key per-reply things on it | SB SPEC.md §4.2 (395-427) |
| Line grammar `op kind Name[ — text][ | label: value]*`; labels are lower-cased; a name is required | SB SPEC.md §4.4 (443-458); `src/v2/capture.js:684-714` |
| Counters: a number kept as a count replays as a move, so a middle delete takes back only its own reply's change | SB SPEC.md §2.2; `domain.counters`, `src/v2/registry.js:186-188` |
| `ctx.replayGuard(guard, recorded)`: the guard's owner must be the calling module, which must have `hooks.replayGuard`; `recorded` is plain JSON | SB `src/v2/commands.js:503-517`; REPLAY.md:37-42 |
| A Guard is `{ owner, version: 2, epoch, rulesHash, inputHash, predicate }` | SB `src/v2/replay.js:159-170` |
| `ctx.hash`, `ctx.source`, `ctx.epoch` | SB REPLAY.md:43-47, 355-357 |
| **The replay rule.** On replay a guard is asked with the state before its block, `recorded`, `payload`, `hash`, and a `query` limited to the module's own `replayQueries` plus `story.evidence`; any other query and `receipts()` throw, which fails the guard closed. The same check runs when the block is first stored, so a guard that would break the rule fails the command at once. | SB REPLAY.md:55-69; `src/v2/commands.js:171-199` (`replayTools`), `:205-228` (`replayGuardCheck`) |
| A guarded block whose guard fails is kept but inactive (`REPLAY_PREREQUISITE` in `store.problems()`) | SB REPLAY.md:98-135; `src/v2/store.js:1673-1685` |
| The guard hook answers `{ ok: true }` or `{ ok: false, reason }`; anything else fails closed | SB REPLAY.md:48-54 |

### 2.3 Screens (Story Block)

| Contract | Where |
|---|---|
| Screen definition: `id`, `title`, `icon`, `mounts`, `template`, `css`, `data` | SB SPEC.md §13.1 (1104-1119); TEMPLATES.md:1-20 |
| `{{ expr }}` text, `data-if`, `data-command` + `data-payload` (cause `ui`) | SB TEMPLATES.md §2 (78-91), §2.2 (110-123) |
| `validateScreen(def)` → list of errors | SB `src/v2/view/screens.js:91` |
| `compileTemplate(html)` → `{ nodes, warnings }` | SB `src/v2/view/template/index.js:48` |
| Template text decodes character references before `{{ }}` is read, so author text containing `{`, `}` or `&` cannot be made inert by escaping. This is why display text may not contain them (section 5.2). | SB `src/v2/view/template/html.js:33-40` |

### 2.4 Testkit (Story Block)

| Contract | Where |
|---|---|
| Testkit entry exports `createHost`, `createFakeContext`, … | SB `testkit/index.js:1-8` |
| `createHost({ modules })` → `{ st, registry, store, sdk, send, swipe, head, close, … }`; it imports `../src/v2/store.js` and `../src/v2/commands.js` by computed path | SB `testkit/host.js:14-20`, `:39-93` |
| Fake chat: `st.send`, `st.generate('swipe')`, `st.deleteMessage(index)` | SB `testkit/fake-st.js:232-300` |
| `store.rebuild()` drops caches and replays from the records | SB `src/v2/store.js:2478-2493` |
| How modules vendor the testkit: `tests/vendor/story-block/`, roots `testkit/`, `src/v2/`, `src/id.js`, the import regex, the VERSION format | SB `scripts/sync-testkit.mjs:19-21`, `:30-53`, `:93` |

### 2.5 Models for the scaffold's shape

| What | Where |
|---|---|
| A separate extension that registers through `StoryBlock.ready` only; manifest `dependencies: ["third-party/Story_block"]` | SB `examples/fishing/index.js`, `examples/fishing/manifest.json`, `examples/fishing/README.md:10-17` |
| One definition merged from parts; a name two parts claim is refused; `replayGuard` dispatched to the part that answers | RPG Battle `src/v2/module.js:1-40`, `:216-245`, `:504-512` |
| A small real part with a domain, kinds, `replayQueries` and a `replayGuard` hook | RPG Battle `src/v2/death/index.js:21-36` |
| A guard that reads only the state, its declared queries and `info.recorded`, then compares `inputHash` | RPG Battle `src/v2/death/guard.js:42-70` |
| The minimal guard construction (`owner`, `version: 2`, `epoch`, `rulesHash: null`, `inputHash: ctx.hash(...)`) | SB `tests/v2/helpers/guarded.js:43-56` |

### 2.6 Studio (part 5a)

| Contract | Where |
|---|---|
| Working rules | ST5a `AGENTS.md:1-14` |
| `applyEdit(ctx, result)`: a result with `ok: false` re-renders, restores the selection and shows `code: message` lines in the notice bar | ST5a `src/apply-edit.js:4-18`; used as `refuse(errors) { applyEdit(ctx, { ok: false, errors }); }` at `src/screens/dm/index.js:83` |
| `downloadFile(ctx, payload, filename, type)`: Blob + object URL, never marks the pack exported | ST5a `src/export.js:4-24` |
| `crc32(data)` (bitwise, table-free) in the PNG writer | ST5a `src/card-png.js:14-21` |
| `readInt(raw)`: a whole number stays a number, anything else stays text | ST5a `src/screens/dm/ui.js:15-18` |
| Rail entries and the screens that hide the inspector | ST5a `src/studio.js:284`, `:291` |
| Screen dispatch | ST5a `src/screens/index.js:12-17` |
| Single-file build: drawings regenerated, bundle, URL escaping, verbatim scan | ST5a `scripts/build.mjs:34`, `:40-46`, `:50`, `:52-53` |
| The scan, with no exemptions (`NETWORK`, `LOADERS`, `firstReference`) | ST5a `scripts/dist-scan.mjs:1-9`; `tests/build.test.js:10-18`, `:50-67` |
| Offline shims for the vendored chat-file and branch loaders | ST5a `scripts/offline-runtime.mjs` |
| Vendoring through Story Block's own sync script | ST5a `scripts/sync-sb.mjs:24-29` |
| Browser test plumbing (file URL, every request aborted and counted, errors collected) | ST5a `tests/helpers/dm-browser.js:11-42` |
| CI: diff check, `npm test`, build, committed-artifact check, scan | ST5a `.github/workflows/ci.yml` |
| Theme tokens and base rules; the two-column authoring workspace | ST5a `src/studio.css:1-4`, `:195-202` |

---

## 3. The scaffold

### 3.1 File tree

For the golden inputs (section 4). `<domain>` is the State name input. All paths are relative to the scaffold's root
folder, which is the module id (`lantern-oil/`) inside the zip.

```
lantern-oil/
  .gitignore                              template gitignore.tmpl
  README.md                               template README.md.tmpl
  index.js                                template index.js.tmpl
  manifest.json                           JSON, section 3.7
  package.json                            JSON, section 3.7
  src/module.js                           template module.js.tmpl
  src/parts/<domain>.js                   template part.js.tmpl
  tests/module.test.js                    template module.test.js.tmpl
  tests/vendor/README.md                  template vendor-README.md.tmpl
  tests/vendor/LICENSE-story-block        copy of Studio's LICENSE (AGPL-3.0 text, identical to Story Block's)
  tests/vendor/story-block/VERSION        written, section 3.8
  tests/vendor/story-block/package.json   copy of vendor/story-block/package.json
  tests/vendor/story-block/<125 files>    the testkit and what it imports, section 3.8
```

Nine files are **written** (rendered); 128 are **copied** (at the 2.1.0 baseline: 125 code files, `package.json`,
`VERSION`, the licence). There is no `LICENSE` for the module itself: the licence is the author's choice and the
README says so. There is no `style.css` (the screen's CSS lives in its definition).

### 3.2 Inputs

The generator takes one plain object with exactly these 18 keys (any other key is refused, section 5). The form labels
are the UI's labels and the `label` used in refusal messages.

| Key | Form label | Type | Rule (section 5 has the exact checks) | Golden |
|---|---|---|---|---|
| `moduleId` | Module id | string | Story Block `SLUG`; not a reserved module id | `lantern-oil` |
| `name` | Name | string | display text, 1–40 | `Lantern Oil` |
| `description` | Description | string | display text, 1–160 | `Counts the oil left in the party's lantern.` |
| `author` | Author | string | display text, 0–60 (may be empty) | `Example Author` |
| `capability` | Capability | string | empty, or `SLUG` and not reserved | `lantern-oil` |
| `domain` | State name | string | `^[a-z][a-z0-9]{1,23}$`; not reserved | `lantern` |
| `field` | Field | string | `^[a-z][a-zA-Z0-9]{0,23}$`; not reserved | `oil` |
| `label` | Field label | string | display text, 1–24 | `Oil` |
| `min` | Minimum | number | whole, −1000000…1000000 | `0` |
| `max` | Maximum | number | whole, −1000000…1000000, above `min` | `20` |
| `initial` | Start value | number | whole, `min`…`max` | `10` |
| `step` | Most a line may change it | number | whole, 1…`max − min` | `5` |
| `kind` | Line kind | string | `^[a-z][a-z0-9]{1,23}$`; not reserved | `oil` |
| `kindLabel` | Line label | string | `^[a-z]{1,16}$` | `change` |
| `command` | Command | string | `^[a-z][a-zA-Z0-9]{0,31}$` (the full name is `<domain>.<command>`) | `pour` |
| `action` | Button label | string | display text, 1–32 | `Pour out one` |
| `query` | Query | string | `^[a-z][a-zA-Z0-9]{0,31}$`, not equal to `command` (full name `<domain>.<query>`) | `oil` |
| `screen` | Add a tab screen | boolean | | `true` |

"display text, a–b" means: the display-text rule of section 5.2, and a length from a to b **code points**.

The identifier rules are deliberately narrower than Story Block's (section 2.1) so that each identifier is safe, with no
escaping, in every place it is written: a JS single-quoted string, a JSON string, a Markdown code span, a file path, an
HTML attribute and a JSON Pointer segment.

### 3.3 Placeholders and the values that fill them

Inline placeholders are `{{name}}` with no spaces (a letter, then letters or digits). Story Block's own template
bindings in the generated screen are written `{{ q.value.value }}` **with spaces**, so they never match.

| Placeholder | Value | Context it appears in | Escaping |
|---|---|---|---|
| `{{moduleId}}` | `moduleId` | JS string, Markdown code span, path, comment | none (validated identifier) |
| `{{domain}}` | `domain` | JS string, Markdown, path, comment | none |
| `{{field}}` | `field` | JS string, Markdown, comment | none |
| `{{kind}}` | `kind` | JS string, Markdown, comment | none |
| `{{kindLabel}}` | `kindLabel` | JS string, Markdown, comment | none |
| `{{commandType}}` | `` `${domain}.${command}` `` | JS string, Markdown, comment | none |
| `{{queryName}}` | `` `${domain}.${query}` `` | JS string, Markdown, comment | none |
| `{{screenId}}` | `` `${moduleId}/${domain}` `` | JS string, Markdown | none |
| `{{capability}}` | `capability` (only used inside the capability blocks) | JS string, Markdown | none |
| `{{min}}`, `{{max}}`, `{{initial}}`, `{{step}}` | `String(n)` (e.g. `-5`) | JS number literal, Markdown, comment | none (validated safe integers) |
| `{{nameJs}}`, `{{descriptionJs}}`, `{{labelJs}}`, `{{actionJs}}` | `jsString(text)` | a whole JS string literal, quotes included | `jsString` (3.4) |
| `{{nameMd}}`, `{{descriptionMd}}`, `{{actionMd}}` | `mdText(text)` | Markdown prose | `mdText` (3.4) |
| `{{screens}}` | `'[screen]'` when `screen`, else `'[]'` | JS expression | generator constant |

Block placeholders are a whole line `{{@name}}` (no indentation, nothing else on the line). The line, with its line
break, is replaced by the block's text, which is either `''` or a rendered snippet template ending in `\n`.

| Block | Text when on | Text when off | Used in |
|---|---|---|---|
| `{{@capabilities}}` | `capabilities.js.tmpl` | `''` (on when `capability !== ''`) | `module.js.tmpl` |
| `{{@capabilityRow}}` | `capability-row.md.tmpl` | `''` | `README.md.tmpl` |
| `{{@screenConst}}` | `screen-const.js.tmpl` | `''` (on when `screen`) | `part.js.tmpl` |
| `{{@screenRow}}` | `screen-row.md.tmpl` | `''` | `README.md.tmpl` |

Display text appears in generated **JavaScript only once per value**, as one exported constant
(`MODULE_NAME`, `DESCRIPTION`, `LABEL`, `ACTION`); every other use reads the constant. Display text never appears in a
comment. In JSON files it goes through `JSON.stringify`. In Markdown it goes through `mdText`.

### 3.4 Escapers (exact)

```js
// A JS single-quoted string literal for `text`, quotes included. Validation already refuses everything this escapes
// except the apostrophe; the rest is defence in depth.
export function jsString(text) {
    return `'${text.replace(/[\\'\u0000-\u001f\u007f\u2028\u2029]/g, c => (c === '\\' ? '\\\\' : c === "'" ? "\\'" : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))}'`;
}

// Markdown prose: a backslash before each character that could start Markdown or HTML. Display text never contains
// one (section 5.2), so for valid input this returns the text unchanged.
export function mdText(text) {
    return text.replace(/[\\`*_{}[\]<>#|&]/g, c => `\\${c}`);
}
```

`jsString("Counts the oil left in the party's lantern.")` is `'Counts the oil left in the party\'s lantern.'`.

### 3.5 Rendering (exact)

```js
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
```

Values are inserted once and never scanned again, so a value can never introduce a placeholder. Block snippets are
inserted before the inline pass, so their own placeholders are filled. `blocks` values are template texts (or `''`).

### 3.6 Template texts

Byte-exact copies are in `docs/part5b/templates/`. Each ends with exactly one line break and has no trailing spaces.

#### `gitignore.tmpl` → `.gitignore`

```text
node_modules/
```

#### `index.js.tmpl` → `index.js`

```js
// The {{moduleId}} module for SillyTavern: a Story Suite v2 module. It uses nothing from Story Block but its public sdk
// (globalThis.StoryBlock.ready, Story Block docs/v2/SPEC.md §3.1 and §6).

import { createModule, MODULE_NAME } from './src/module.js';

/** Registers the module once Story Block is up. Without Story Block v2 it says so once and stays off. */
export function start(host = globalThis.StoryBlock) {
    if (!host?.ready || typeof host.ready.then !== 'function') {
        console.warn(`[${MODULE_NAME}] Story Block v2 is needed; this module stays off.`);
        return Promise.resolve(null);
    }
    return host.ready
        .then(sdk => sdk.registerModule(createModule()))
        .catch(error => {
            console.error(`[${MODULE_NAME}] Could not register with Story Block:`, error);
            return null;
        });
}

// SillyTavern loads this file as an extension; the tests import it without starting it.
if (globalThis.SillyTavern) start();
```

#### `module.js.tmpl` → `src/module.js`

```js
// The {{moduleId}} module: the one module definition Story Block registers (Story Block docs/v2/SPEC.md §6), put
// together from its parts (docs/v2/MODULES.md §A). To add a part, write src/parts/<name>.js the way the
// first one is written and list it in PARTS.
//
// - domains, commands, queries, capture kinds and screens: every part's as they are; a name two parts
//   claim is a mistake, refused here before Story Block ever sees it.
// - capture: one apply that hands each line to the part that owns its kind.
// - replayGuard: each part answers the guards it made and gives undefined for the rest; a guard no part
//   answers fails closed.

import { part as mainPart } from './parts/{{domain}}.js';

export const MODULE_ID = '{{moduleId}}';
export const MODULE_NAME = {{nameJs}};
export const VERSION = '0.1.0';
export const DESCRIPTION = {{descriptionJs}};
const PARTS = [mainPart];

export function createModule() {
    const domains = {};
    const commands = {};
    const queries = {};
    const kinds = {};
    const screens = [];
    const replayQueries = [];
    const claim = (table, name, what) => {
        if (Object.hasOwn(table, name)) throw new Error(`${MODULE_NAME}: two parts claim the ${what} "${name}".`);
    };
    for (const part of PARTS) {
        for (const [name, domain] of Object.entries(part.domains ?? {})) { claim(domains, name, 'domain'); domains[name] = domain; }
        for (const [type, handler] of Object.entries(part.commands ?? {})) { claim(commands, type, 'command'); commands[type] = handler; }
        for (const [name, query] of Object.entries(part.queries ?? {})) { claim(queries, name, 'query'); queries[name] = query; }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) { claim(kinds, kind, 'capture kind'); kinds[kind] = spec; }
        for (const screen of part.screens ?? []) {
            if (screens.some(other => other.id === screen.id)) throw new Error(`${MODULE_NAME}: two parts claim the screen "${screen.id}".`);
            screens.push(screen);
        }
        replayQueries.push(...(part.replayQueries ?? []));
    }
    const guards = PARTS.map(part => part.replayGuard).filter(fn => typeof fn === 'function');
    return {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        description: DESCRIPTION,
        requires: { storyBlock: '>=2.1.0' },
{{@capabilities}}
        domains,
        commands,
        queries,
        replayQueries,
        capture: {
            kinds: Object.fromEntries(Object.entries(kinds).map(([kind, spec]) => [kind, { grammar: spec.grammar }])),
            apply(ctx, line) {
                const spec = kinds[line?.kind];
                if (!spec) ctx.fail('INVALID', `${MODULE_NAME} has no "${line?.kind}" line.`);
                return spec.apply(ctx, line);
            },
        },
        hooks: {
            replayGuard(view, info) {
                for (const guard of guards) {
                    const answer = guard(view, info);
                    if (answer !== undefined) return answer;
                }
                return { ok: false, reason: `${MODULE_NAME} does not know this guard.` };
            },
        },
        screens,
    };
}
```

#### `capabilities.js.tmpl` (block `capabilities`)

```js
        capabilities: ['{{capability}}'],
```

#### `part.js.tmpl` → `src/parts/<domain>.js`

```js
// The {{domain}} part of the {{moduleId}} module (Story Block docs/v2/MODULES.md §A): its state, its narrator
// line, one command, one query and the replay guard of that command. Story Studio wrote it as a starting
// point: change the rules freely and keep the shape.
//
// State (this module is its only writer):   {{domain}} = { {{field}}: a whole number from {{min}} to {{max}} }
// Narrator line:   ~ {{kind}} Name — what happened | {{kindLabel}}: +N or -N
//   Code sets the number: the change is cut to {{step}} either way, the result stays from {{min}} to {{max}}, and only the
//   first such line of a reply counts.
// Command (the reader's action):   {{commandType}} { amount }   takes `amount` away and is refused when there
//   is not that much. It is guarded (docs/v2/REPLAY.md): on replay it applies only while the state before
//   it still has that much.
// Query:   {{queryName}} → { value, min, max }   (reads the state alone, so the guard may ask it on replay)

export const MODULE_ID = '{{moduleId}}';
export const DOMAIN = '{{domain}}';
export const FIELD = '{{field}}';
export const LABEL = {{labelJs}};
export const MIN = {{min}};
export const MAX = {{max}};
export const INITIAL = {{initial}};
export const STEP = {{step}};
export const KIND = '{{kind}}';
export const KIND_LABEL = '{{kindLabel}}';
export const COMMAND = '{{commandType}}';
export const ACTION = {{actionJs}};
export const QUERY = '{{queryName}}';
export const SCREEN = '{{screenId}}';

const isWhole = value => Number.isSafeInteger(value);
const sliceOf = state => state?.domains?.[DOMAIN] ?? initial();
// A name from the story as one short line: spaces folded, cut at 40 characters (whole code points).
const flat = text => [...String(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, 40).join('');

export function initial() {
    return { [FIELD]: INITIAL };
}

// docs/v2/SPEC.md §2.5: any error rejects the whole command, and nothing is saved.
export function validate(slice) {
    if (!slice || typeof slice !== 'object') return [`The ${LABEL} record is damaged.`];
    const value = slice[FIELD];
    if (!isWhole(value)) return [`${LABEL} is not a whole number.`];
    if (value < MIN || value > MAX) return [`${LABEL} must stay from ${MIN} to ${MAX}.`];
    return [];
}

// ---- the narrator line (docs/v2/SPEC.md §4.2, §4.4) ---------------------------------------------------

// Runs as a story command. The story proposes a change; code cuts it, keeps the value in range and lets one
// line count per reply (the claim is keyed on the reply's sid, so a swipe or a Re-read starts afresh).
export function applyLine(ctx, line) {
    const written = String(line?.labels?.[KIND_LABEL] ?? '').trim();
    if (!/^[+-]?\d{1,9}$/.test(written)) ctx.fail('INVALID', `Write the change as a whole number, like "| ${KIND_LABEL}: +1".`);
    const reply = ctx.carrier?.sid ?? ctx.reply?.sid ?? null;
    if (!reply) ctx.fail('INVALID', `There is no reply to keep this ${KIND} line on.`);
    if (!ctx.claim(`${MODULE_ID}:${reply}:${KIND}`)) ctx.fail('CLAIMED', `Only the first ${KIND} line of a reply counts.`);
    const asked = Number(written);
    const slice = ctx.draft(DOMAIN);
    const before = slice[FIELD];
    const after = Math.max(MIN, Math.min(MAX, before + Math.max(-STEP, Math.min(STEP, asked))));
    slice[FIELD] = after;
    const result = { summary: `${flat(line?.name) || LABEL}: ${LABEL} ${before} → ${after}.`, narrate: false, data: { before, after } };
    if (after - before !== asked) result.problem = `${LABEL} changed by ${after - before}, not ${asked}: a line moves it by ${STEP} at most and keeps it from ${MIN} to ${MAX}.`;
    return result;
}

// ---- the command and its replay guard (docs/v2/SPEC.md §3.2, docs/v2/REPLAY.md) -----------------------

// The guard a block carries: what must still hold on replay, hashed with the reply it is stored on.
function guardOf(hash, epoch, source, predicate, inputs) {
    return { owner: MODULE_ID, version: 2, epoch, rulesHash: null, inputHash: hash({ predicate, inputs, source }), predicate };
}

export function command(ctx, payload = {}) {
    const amount = payload?.amount;
    if (!isWhole(amount) || amount < 1 || amount > MAX - MIN) ctx.fail('INVALID', `Say how much ${LABEL} to take, a whole number from 1 to ${MAX - MIN}.`);
    const slice = ctx.draft(DOMAIN);
    const before = slice[FIELD];
    if (before - amount < MIN) ctx.fail('NOT_ENOUGH', `There is not that much ${LABEL}: ${before} now.`);
    ctx.replayGuard(guardOf(ctx.hash, ctx.epoch, ctx.source, { kind: COMMAND, amount }, { enough: true }), { before });
    slice[FIELD] = before - amount;
    return { summary: `${LABEL}: ${before} → ${before - amount}.`, narrate: true, data: { before, after: before - amount } };
}

// Asked on replay with the state before the block (the replay rule, docs/v2/REPLAY.md "Guards are pure"): it
// reads that state through this module's own replay query, the guard and what the command recorded; never
// settings, the clock, another module or receipts. Undefined for a guard another part made.
export function replayGuard(view, info) {
    const guard = info?.guard;
    if (guard?.predicate?.kind !== COMMAND) return undefined;
    const amount = guard.predicate.amount;
    const now = view.query(QUERY);
    const enough = isWhole(amount) && isWhole(now?.value) && now.value - amount >= MIN;
    if (guardOf(view.hash, guard.epoch, info.source, guard.predicate, { enough }).inputHash === guard.inputHash) return { ok: true };
    return { ok: false, reason: `There is no longer ${amount} ${LABEL} to take: ${now?.value} now, ${info?.recorded?.before} when it was done.` };
}

// ---- the query and the screen (docs/v2/SPEC.md §6, §13; docs/v2/TEMPLATES.md) -------------------------

export function read(state) {
    return { value: sliceOf(state)[FIELD], min: MIN, max: MAX };
}

{{@screenConst}}
export const part = {
    domains: { [DOMAIN]: { initial, validate, counters: [FIELD] } },
    commands: { [COMMAND]: command },
    queries: { [QUERY]: read },
    replayQueries: [QUERY],
    kinds: { [KIND]: { grammar: `~ ${KIND} Name — what happened | ${KIND_LABEL}: +N or -N`, apply: applyLine } },
    replayGuard,
    screens: {{screens}},
};
```

#### `screen-const.js.tmpl` (block `screenConst`)

```js
// A tab and game-view screen. Its text is fixed; the numbers come from the query (q.value).
export const screen = {
    id: SCREEN,
    title: LABEL,
    icon: 'fa-cube',
    mounts: ['tab', 'screen'],
    data: { value: { query: QUERY } },
    template: [
        '<section class="ss-glass box">',
        `  <p class="ss-label">${LABEL}</p>`,
        '  <p class="value"><b>{{ q.value.value }}</b> / {{ q.value.max }}</p>',
        `  <button data-command="${COMMAND}" data-payload='{"amount":1}' data-if="q.value.value > q.value.min">${ACTION}</button>`,
        '</section>',
    ].join('\n'),
    css: '.box { padding: 12px; } .value b { font-size: 1.4em; }',
};

```

#### `module.test.js.tmpl` → `tests/module.test.js`

```js
// The {{moduleId}} module on a real Story Block host: the testkit vendored in tests/vendor/story-block/ (Story Block
// docs/v2/SPEC.md §10) runs the whole host on a fake SillyTavern. `npm test` runs this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './vendor/story-block/testkit/index.js';
import { definitionProblems, definitionWarnings } from './vendor/story-block/src/v2/registry.js';
import { validateScreen } from './vendor/story-block/src/v2/view/screens.js';
import { compileTemplate } from './vendor/story-block/src/v2/view/template/index.js';
import { createModule, MODULE_ID } from '../src/module.js';
import { start } from '../index.js';
import { COMMAND, DOMAIN, FIELD, INITIAL, KIND, KIND_LABEL, MAX, MIN, QUERY, STEP } from '../src/parts/{{domain}}.js';

const lineOf = change => `~ ${KIND} Test — a test line | ${KIND_LABEL}: ${change > 0 ? '+' : ''}${change}`;
const replyWith = (...lines) => `The story goes on.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const valueOf = host => host.head().domains[DOMAIN][FIELD];
// What a full replay from the first reply gives must be what the live host holds (docs/v2/SPEC.md §2.2).
function assertRebuildIsLive(host) {
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
}
const guardProblems = host => host.store.problems().filter(problem => /may ask on replay|replayGuard/.test(`${problem.why} ${problem.message}`));

async function hostWithModule() {
    return createHost({ modules: [createModule()] });
}

test('the definition is one Story Block accepts, with no field it does not know', () => {
    const def = createModule();
    assert.deepEqual(definitionProblems(def), []);
    assert.deepEqual(definitionWarnings(def), []);
    for (const screen of def.screens) {
        assert.deepEqual(validateScreen(screen), [], screen.id);
        assert.deepEqual(compileTemplate(screen.template).warnings, [], screen.id);
    }
});

test('it registers through StoryBlock.ready and is ready, with nothing refused', async () => {
    const host = await createHost();
    try {
        await start({ ready: Promise.resolve(host.sdk) });
        assert.equal(host.registry.has(MODULE_ID), true);
        assert.deepEqual(host.registry.refusals(), []);
        const entry = host.sdk.modules().find(item => item.id === MODULE_ID);
        assert.equal(entry.status, 'ready');
        assert.deepEqual(host.sdk.query(QUERY), { value: INITIAL, min: MIN, max: MAX });
    } finally {
        host.close();
    }
});

test('a narrator line moves the value by code, once a reply, and replays the same', async () => {
    const host = await hostWithModule();
    try {
        await host.send('Go on.', replyWith(lineOf(STEP + 1), lineOf(1)));
        const expected = Math.max(MIN, Math.min(MAX, INITIAL + STEP));
        assert.equal(valueOf(host), expected);
        assertRebuildIsLive(host);
        await host.swipe('The story goes on another way.');
        assert.equal(valueOf(host), INITIAL, 'a swipe without the line takes its change back');
        assertRebuildIsLive(host);
    } finally {
        host.close();
    }
});

test('the command takes away, refuses what is not there and leaves the state as it was', async () => {
    const host = await hostWithModule();
    try {
        await host.send('Go on.', replyWith(lineOf(-STEP)));
        await host.send('Go on.', replyWith(lineOf(STEP)));
        const before = valueOf(host);
        const too = await host.sdk.command(COMMAND, { amount: before - MIN + 1 });
        assert.equal(too.ok, false);
        assert.equal(valueOf(host), before);
        const done = await host.sdk.command(COMMAND, { amount: 1 });
        assert.equal(done.ok, true, done.message);
        assert.equal(valueOf(host), before - 1);
        assertRebuildIsLive(host);
    } finally {
        host.close();
    }
});

test('the guard keeps a command off once the change it needed is deleted, and obeys the replay rule', async () => {
    const host = await hostWithModule();
    try {
        await host.send('Go on.', replyWith(lineOf(-STEP)));
        const low = valueOf(host);
        await host.send('Go on.', replyWith(lineOf(STEP)));
        const high = valueOf(host);
        assert.ok(high > low);
        await host.send('Go on.', 'Nothing changes.');
        const done = await host.sdk.command(COMMAND, { amount: high - MIN });
        assert.equal(done.ok, true, done.message);
        assert.equal(valueOf(host), MIN);
        assertRebuildIsLive(host);
        assert.deepEqual(guardProblems(host), []);

        // The reply that raised the value goes: the command no longer has what it took, so it stays off.
        await host.st.deleteMessage(4);
        assert.equal(valueOf(host), low);
        assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
        assertRebuildIsLive(host);
        assert.equal(valueOf(host), low);
    } finally {
        host.close();
    }
});

test('the replay guard asks only its own replay queries', () => {
    const def = createModule();
    const asked = [];
    const state = { v: 2, meta: { rev: 1, claims: {} }, domains: { [DOMAIN]: { [FIELD]: MAX } } };
    const view = Object.freeze({
        state,
        hash: value => JSON.stringify(value),
        query(name, args) {
            asked.push(name);
            if (!def.replayQueries.includes(name)) throw new Error(`"${name}" is not a query a guard may ask on replay`);
            return def.queries[name](state, args);
        },
    });
    const source = { sid: 'sr_aaaaaaaa', swipeKey: 'sw_aaaaaaaa', evidence: 'ev_aaaaaaaa', ordinal: 0 };
    const predicate = { kind: COMMAND, amount: 1 };
    const guard = { owner: MODULE_ID, version: 2, epoch: 'ep_00000000', rulesHash: null, inputHash: view.hash({ predicate, inputs: { enough: true }, source }), predicate };
    assert.deepEqual(def.hooks.replayGuard(view, { guard, source, recorded: { before: MAX } }), { ok: true });
    assert.ok(asked.length > 0);
    for (const name of asked) assert.ok(def.replayQueries.includes(name), name);
    assert.equal(def.hooks.replayGuard(view, { guard: { ...guard, predicate: { kind: 'other' } }, source }).ok, false);
});
```

#### `README.md.tmpl` → `README.md`

````markdown
# {{nameMd}}

**What it does:** {{descriptionMd}}

A starter module for **Story Block v2** (Story Suite for SillyTavern), made by Story Studio. It is its own
SillyTavern extension and talks to Story Block only through Story Block's public sdk
(`globalThis.StoryBlock.ready`). It needs Story Block 2.1.0 or later.

## Install

1. Put this folder into SillyTavern as a third-party extension, next to Story Block:
   `public/scripts/extensions/third-party/{{moduleId}}/` (Story Block is `third-party/Story_block`).
   Or push it to a git repository of your own and use SillyTavern's **Install extension** with its URL.
2. Reload SillyTavern. `manifest.json` names Story Block as a dependency, so SillyTavern loads it first.
   Without Story Block v2 the module logs one line and stays off.

## What it adds

| Part | Name | What it does |
|---|---|---|
| State | domain `{{domain}}`, field `{{field}}` | A whole number from {{min}} to {{max}}, starting at {{initial}}. Only this module writes it. |
| Narrator line | `~ {{kind}}` | `~ {{kind}} Someone — what happened \| {{kindLabel}}: +{{step}}` moves it by at most {{step}}; only the first such line of a reply counts. |
| Command | `{{commandType}}` | The reader's action `{ amount }`: takes that much away, refused when there is not that much. Guarded on replay. |
| Query | `{{queryName}}` | `{ value, min, max }`, read from the state alone. |
{{@screenRow}}
{{@capabilityRow}}

## Files

- `manifest.json`: the SillyTavern extension; it depends on `third-party/Story_block`.
- `index.js`: waits for `StoryBlock.ready`, then registers the module.
- `src/module.js`: the module definition, put together from its parts.
- `src/parts/{{domain}}.js`: the part with everything listed above.
- `tests/module.test.js`: tests on a real Story Block host (the vendored testkit).
- `tests/vendor/`: Story Block's testkit and runtime, copied by Story Studio (see `tests/vendor/README.md`).

## Tests

Node.js 22 or later, no install step:

```
npm test
```

The tests register the module on a whole Story Block host running on a fake SillyTavern: the definition
is accepted, a narrator line is applied by code and replays the same, the command is refused when it
should be, and the replay guard keeps a command off once the change it needed is deleted.

## Growing it

- Story Block's rules for modules: `docs/v2/SPEC.md` §0, §2.2 and §6, and `docs/v2/MODULES.md` §A and §F.
  In short: code sets the numbers and the story only proposes; handlers are synchronous and use `ctx`
  alone (no `Math.random`, no `Date.now()`, no model calls); replay must give what the live story gave;
  buttons are for bookkeeping, never for story actions.
- A command whose result depends on an earlier reply attaches a replay guard (`docs/v2/REPLAY.md`). On
  replay a guard may read only the state before its block, what the command recorded, `story.evidence`
  and the queries the module lists in `replayQueries`.
- An optional mechanic is a feature (`docs/v2/MODULES.md` §F100).
- More parts: write `src/parts/<name>.js` like the first one and add it to `PARTS` in `src/module.js`.
- Refresh the testkit after updating Story Block: from a Story Block checkout,
  `npm run sync-testkit -- <this folder>`.

## Licence

Choose a licence for your module and add a `LICENSE` file. The copy of Story Block in `tests/vendor/`
keeps its own licence (AGPL-3.0-only); see `tests/vendor/README.md`.
````

#### `screen-row.md.tmpl` (block `screenRow`)

```markdown
| Screen | `{{screenId}}` | A tab with the value and a **{{actionMd}}** button. |
```

#### `capability-row.md.tmpl` (block `capabilityRow`)

```markdown
| Capability | `{{capability}}` | A pack can list it in `requires.capabilities` to need this module. |
```

#### `vendor-README.md.tmpl` → `tests/vendor/README.md`

The MIT block is lines 4–23 of Studio's `src/credits.txt`, verbatim (a test checks it).

````markdown
# Story Block, copied for the tests

`story-block/` holds Story Block's testkit (`testkit/index.js`) and every file of Story Block's runtime the
testkit imports, copied by Story Studio from its own copy of Story Block. `story-block/VERSION` names the
Story Block version and commit they come from. Only the tests import them; SillyTavern never loads them.

Do not edit them. To refresh them after updating Story Block, run `npm run sync-testkit -- <this module's folder>`
in a Story Block checkout: it replaces `story-block/` with a full copy and leaves this file and
`LICENSE-story-block` as they are.

## Licences

Story Block is licensed AGPL-3.0-only; the licence text is in `LICENSE-story-block`.

`story-block/src/v2/view/icons/set.js` holds path data from Phosphor Icons 2.1.1, under the MIT licence:

```
MIT License
Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
````

### 3.7 JSON files (exact)

```js
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
files['manifest.json'] = `${JSON.stringify(manifest, null, 4)}\n`;   // 4 spaces, like Story Block's manifest
files['package.json'] = `${JSON.stringify(pkg, null, 2)}\n`;         // 2 spaces, like Story Block's package.json
```

Key order is exactly as written. `loading_order` 30 is after Story Block's 25 (SB `manifest.json`). The test script
quotes its glob so Node expands it (Node 22 and later), which also works where npm runs `cmd.exe`.

### 3.8 The copied Story Block files (the vendored testkit)

The scaffold needs the testkit and every runtime file it imports: `createHost` builds the whole host. The files come
from **Studio's own vendored copy** (`vendor/story-block/`), never from a Story Block checkout, so Studio and the
scaffold always test against the same Story Block. The set is the import closure of three roots, computed with the
import regex of Story Block's sync script (SB `scripts/sync-testkit.mjs:21`):

```js
export const TESTKIT_ROOTS = Object.freeze(['testkit/index.js', 'src/v2/store.js', 'src/v2/commands.js']);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

/** The files of `vendorDir` the testkit needs, as sorted '/'-separated paths relative to it. Node only (scripts). */
export function testkitFiles(vendorDir) {
    const seen = new Set();
    const queue = [...TESTKIT_ROOTS];
    while (queue.length) {
        const rel = queue.shift();
        if (seen.has(rel)) continue;
        const abs = join(vendorDir, rel);
        if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`code module: ${rel} is not in ${vendorDir}`);
        seen.add(rel);
        if (!/\.m?js$/.test(rel)) continue;
        for (const match of readFileSync(abs, 'utf8').matchAll(IMPORT)) {
            const target = posix.normalize(posix.join(posix.dirname(rel), match[1]));
            if (target.startsWith('..') || !existsSync(join(vendorDir, target))) continue;
            queue.push(target);
        }
    }
    return [...seen].sort();
}
```

(`join` from `node:path`, `posix` from `node:path`, `existsSync`/`statSync`/`readFileSync` from `node:fs`.) The two
extra roots are there because `testkit/host.js` imports the store and the command bus by a computed path that the
regex cannot see (SB `testkit/host.js:14`); today `runtime.js` imports them statically too, so the roots only make the
set robust. At the baseline the closure is **125 files, 2,312,881 bytes**; this spec checked that the golden scaffold's
tests pass with exactly these files (and fail without the 2.1.0 re-sync).

What the scaffold gets under `tests/vendor/`:

| Path in the scaffold | Content |
|---|---|
| `tests/vendor/story-block/<path>` for each closure path | the vendored file's bytes |
| `tests/vendor/story-block/package.json` | `vendor/story-block/package.json`'s bytes (`{ "private": true, "type": "module" }`) |
| `tests/vendor/story-block/VERSION` | `versionText` below |
| `tests/vendor/LICENSE-story-block` | Studio's root `LICENSE` bytes (the AGPL-3.0 text; byte-identical to Story Block's `LICENSE`) |
| `tests/vendor/README.md` | rendered from `vendor-README.md.tmpl` (what this is, how to refresh it, the licences) |

```js
/** The scaffold's VERSION: the first two lines of the vendored VERSION, then what was copied. */
export function versionText(vendorDir, count) {
    const lines = readFileSync(join(vendorDir, 'VERSION'), 'utf8').split('\n');
    if (!/^Story Block \S+$/.test(lines[0]) || !/^commit \S+$/.test(lines[1])) throw new Error('code module: vendor/story-block/VERSION is not "Story Block <version>" then "commit <sha>"');
    return `${lines[0]}\n${lines[1]}\nfiles ${count}\nmatrix none\n`;
}
```

At the baseline it is:

```
Story Block 2.1.0
commit 076764b786296a93d1e9812e0c8b69955a7e243d
files 125
matrix none
```

It keeps Story Block's four-line format (SB `scripts/sync-testkit.mjs:93`); `matrix none` because the matrix runner is
not part of the closure. The licence and README sit beside `story-block/`, not in it, so an author who later refreshes
with Story Block's own `npm run sync-testkit -- <folder>` (which replaces `story-block/` whole) keeps them.

#### How the files reach the offline build

The single file cannot read `vendor/` at run time, and the closure's text contains `fetch(`, `import(` and URLs, which
the scan refuses with no exemptions (ST5a `scripts/dist-scan.mjs`). So a generator writes one committed module,
`src/code-module/assets.js`, holding the templates as JSON strings and every copied file as **base64** (the base64
alphabet cannot form any scanned pattern). It is regenerated by `scripts/build.mjs` before bundling, exactly like
`src/assets/drawings.js`, and a test fails when the committed file differs from what the generator makes now.

`scripts/code-module-assets.mjs` exports `TESTKIT_ROOTS`, `testkitFiles`, `versionText` and:

```js
/** The full text of src/code-module/assets.js for the checkout at `root` (default: the current directory). */
export function codeModuleAssets(root = '.') {
    const templateDir = join(root, 'src', 'code-module', 'templates');
    const vendorDir = join(root, 'vendor', 'story-block');
    const templates = {};
    for (const name of readdirSync(templateDir).filter(name => name.endsWith('.tmpl')).sort()) templates[name] = readFileSync(join(templateDir, name), 'utf8');
    const list = testkitFiles(vendorDir);
    const head = readFileSync(join(vendorDir, 'VERSION'), 'utf8').split('\n');
    const stamp = { version: head[0].slice('Story Block '.length), commit: head[1].slice('commit '.length), files: list.length };
    const pairs = [
        ['tests/vendor/LICENSE-story-block', readFileSync(join(root, 'LICENSE'))],
        ['tests/vendor/story-block/VERSION', Buffer.from(versionText(vendorDir, list.length), 'utf8')],
        ['tests/vendor/story-block/package.json', readFileSync(join(vendorDir, 'package.json'))],
        ...list.map(path => [`tests/vendor/story-block/${path}`, readFileSync(join(vendorDir, path))]),
    ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '// Generated by scripts/code-module-assets.mjs from src/code-module/templates/, vendor/story-block/ and LICENSE. Do not edit.\n'
        + `export const TEMPLATES = Object.freeze(${JSON.stringify(templates, null, 4)});\n`
        + `export const SB_STAMP = Object.freeze(${JSON.stringify(stamp)});\n`
        + 'export const VENDOR_FILES = Object.freeze([\n'
        + pairs.map(([path, bytes]) => `    [${JSON.stringify(path)}, ${JSON.stringify(Buffer.from(bytes).toString('base64'))}],\n`).join('')
        + ']);\n';
}
```

Run as a script (`node scripts/code-module-assets.mjs`) it writes `src/code-module/assets.js`. `scripts/build.mjs`
imports `codeModuleAssets` and writes the file right after `drawings.js` (ST5a `scripts/build.mjs:34`).

Measured while writing this spec: `assets.js` is about 3.16 MB, and a build that bundles it is **4,557,997 bytes**
(the part 5a build is 1,396,934 bytes) and passes the scan unchanged. See open question 1.

### 3.9 The zip (exact)

The zip holds every file of 3.1 under the root folder `<moduleId>/`, sorted by the scaffold-relative path in
JavaScript's default string order (code units). No directory entries. Every entry is STORED (method 0), so the writer
needs no compressor; CRC-32 is Studio's existing `crc32` (ST5a `src/card-png.js:14-21`, exported in M3). All numbers
are little-endian.

Local file header, then the data, for each entry:

| Offset | Size | Value |
|---|---|---|
| 0 | 4 | `0x04034b50` |
| 4 | 2 | version needed `10` |
| 6 | 2 | flags `0x0800` (names are UTF-8) |
| 8 | 2 | method `0` |
| 10 | 2 | time `0x0000` (00:00:00) |
| 12 | 2 | date `0x0021` (1980-01-01) |
| 14 | 4 | CRC-32 of the data |
| 18 | 4 | compressed size = data length |
| 22 | 4 | uncompressed size = data length |
| 26 | 2 | name length (UTF-8 bytes) |
| 28 | 2 | extra length `0` |
| 30 | n | name |

Central directory entry, for each entry in the same order:

| Offset | Size | Value |
|---|---|---|
| 0 | 4 | `0x02014b50` |
| 4 | 2 | version made by `0x031e` (Unix, 3.0) |
| 6 | 2 | version needed `10` |
| 8 | 2 | flags `0x0800` |
| 10 | 2 | method `0` |
| 12 | 2 | time `0x0000` |
| 14 | 2 | date `0x0021` |
| 16 | 4 | CRC-32 |
| 20 | 4 | compressed size |
| 24 | 4 | uncompressed size |
| 28 | 2 | name length |
| 30 | 2 | extra length `0` |
| 32 | 2 | comment length `0` |
| 34 | 2 | disk number `0` |
| 36 | 2 | internal attributes `0` |
| 38 | 4 | external attributes `0x81a40000` (regular file, mode 0644) |
| 42 | 4 | offset of its local header |
| 46 | n | name |

End of central directory: `0x06054b50`, disk `0`, central-directory disk `0`, entries on this disk, total entries,
central directory size, central directory offset, comment length `0` (22 bytes).

The writer refuses (throws) a path that is empty, starts with `/`, contains `\`, a `.` or `..` segment, an empty
segment, or a character outside `[A-Za-z0-9._-]` in a segment; a duplicate path; more than 65,535 entries; and a total
size at or above 4 GiB. Every scaffold path passes (checked for the 125 closure paths at the baseline).

**Determinism.** Inputs, templates and `VENDOR_FILES` fully determine the bytes: no clock, no random number, fixed
attributes, a fixed order. The same inputs give the same zip bytes on every run, in Node and in the browser. The zip's
bytes change when the vendored Story Block changes (a re-sync), so the tests compare structure and contents, never a
fixed hash of the whole zip.

At the baseline the golden zip is about 2.40 MB, 137 entries; `unzip -t` reports no errors, and `npm test` inside the
unzipped folder passes (6 tests).

### 3.10 Why the module looks like this

- **One domain, one writer, counters.** The field is declared in `counters` so a middle delete takes back only its own
  reply's change (SPEC §2.2); `validate` keeps it whole and in range (SPEC §2.5).
- **Code sets the number.** The narrator line proposes a signed change; code cuts it to `step`, clamps it to
  `min…max`, and lets one line per reply count through a claim keyed on the reply's `sid` (SPEC §4.2: per-reply
  things are keyed on the sid; a swipe or Re-read starts on a state without the claim). A cut change returns a
  `problem` sentence, which Story Block lists as `LIMITED` (SPEC §3.2).
- **The guard.** The command's outcome depends on earlier replies (it needs `amount` to be there), so it attaches a
  guard: predicate `{ kind: <command>, amount }`, inputs `{ enough: true }`, `inputHash = hash({ predicate, inputs,
  source })` with the block's source, `recorded = { before }`. On replay the hook asks only its own replay query, works
  out `enough` from the state before the block, and compares hashes; `recorded.before` is only used for the reason
  text. It never reads settings, the clock, other modules or receipts (REPLAY.md:55-69). The module merges guards the
  way RPG Battle does: each part answers the guards it made and `undefined` for the rest; none answering fails closed.
- **The query** reads the state alone, so it is a valid `replayQueries` entry (REPLAY.md:64-69).
- **The screen** has fixed template text. Display text enters it only through the `LABEL` and `ACTION` constants,
  whose allowed characters are inert in HTML text (no `<`, `&`, `{`, `}`, `"`). Numbers come from the query through
  `{{ q.value.… }}`. Its one button is bookkeeping (taking an amount away), not a story action (SPEC §0; the suite's
  "no buttons for story actions" rule).
- **No auto-start under Node.** `index.js` starts only when `globalThis.SillyTavern` exists, so the tests import it
  without side effects and call `start(host)` themselves; a dynamic `import()` would also trip Studio's scan.

---

## 4. Golden example

### 4.1 Inputs (`docs/part5b/golden-inputs.json`, copied to `tests/fixtures/code-module/golden-inputs.json`)

```json
{
  "moduleId": "lantern-oil",
  "name": "Lantern Oil",
  "description": "Counts the oil left in the party's lantern.",
  "author": "Example Author",
  "capability": "lantern-oil",
  "domain": "lantern",
  "field": "oil",
  "label": "Oil",
  "min": 0,
  "max": 20,
  "initial": 10,
  "step": 5,
  "kind": "oil",
  "kindLabel": "change",
  "command": "pour",
  "action": "Pour out one",
  "query": "oil",
  "screen": true
}
```

`EXAMPLE_INPUTS` in `src/code-module/inputs.js` is this object (a test checks `deepEqual`); the form starts with it.

### 4.2 Expected written files

Byte-exact copies are in `docs/part5b/golden/lantern-oil/`, each path with `.golden` appended (so Studio's test glob
and syntax check never pick them up). They move to `tests/golden/code-module/lantern-oil/` in M1.

#### `.gitignore`

```text
node_modules/
```

#### `manifest.json`

```json
{
    "display_name": "Lantern Oil",
    "loading_order": 30,
    "requires": [],
    "optional": [],
    "dependencies": [
        "third-party/Story_block"
    ],
    "js": "index.js",
    "author": "Example Author",
    "version": "0.1.0"
}
```

#### `package.json`

```json
{
  "name": "lantern-oil",
  "version": "0.1.0",
  "private": true,
  "description": "Counts the oil left in the party's lantern.",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "node --test \"tests/*.test.js\""
  }
}
```

#### `index.js`

```js
// The lantern-oil module for SillyTavern: a Story Suite v2 module. It uses nothing from Story Block but its public sdk
// (globalThis.StoryBlock.ready, Story Block docs/v2/SPEC.md §3.1 and §6).

import { createModule, MODULE_NAME } from './src/module.js';

/** Registers the module once Story Block is up. Without Story Block v2 it says so once and stays off. */
export function start(host = globalThis.StoryBlock) {
    if (!host?.ready || typeof host.ready.then !== 'function') {
        console.warn(`[${MODULE_NAME}] Story Block v2 is needed; this module stays off.`);
        return Promise.resolve(null);
    }
    return host.ready
        .then(sdk => sdk.registerModule(createModule()))
        .catch(error => {
            console.error(`[${MODULE_NAME}] Could not register with Story Block:`, error);
            return null;
        });
}

// SillyTavern loads this file as an extension; the tests import it without starting it.
if (globalThis.SillyTavern) start();
```

#### `src/module.js`

```js
// The lantern-oil module: the one module definition Story Block registers (Story Block docs/v2/SPEC.md §6), put
// together from its parts (docs/v2/MODULES.md §A). To add a part, write src/parts/<name>.js the way the
// first one is written and list it in PARTS.
//
// - domains, commands, queries, capture kinds and screens: every part's as they are; a name two parts
//   claim is a mistake, refused here before Story Block ever sees it.
// - capture: one apply that hands each line to the part that owns its kind.
// - replayGuard: each part answers the guards it made and gives undefined for the rest; a guard no part
//   answers fails closed.

import { part as mainPart } from './parts/lantern.js';

export const MODULE_ID = 'lantern-oil';
export const MODULE_NAME = 'Lantern Oil';
export const VERSION = '0.1.0';
export const DESCRIPTION = 'Counts the oil left in the party\'s lantern.';
const PARTS = [mainPart];

export function createModule() {
    const domains = {};
    const commands = {};
    const queries = {};
    const kinds = {};
    const screens = [];
    const replayQueries = [];
    const claim = (table, name, what) => {
        if (Object.hasOwn(table, name)) throw new Error(`${MODULE_NAME}: two parts claim the ${what} "${name}".`);
    };
    for (const part of PARTS) {
        for (const [name, domain] of Object.entries(part.domains ?? {})) { claim(domains, name, 'domain'); domains[name] = domain; }
        for (const [type, handler] of Object.entries(part.commands ?? {})) { claim(commands, type, 'command'); commands[type] = handler; }
        for (const [name, query] of Object.entries(part.queries ?? {})) { claim(queries, name, 'query'); queries[name] = query; }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) { claim(kinds, kind, 'capture kind'); kinds[kind] = spec; }
        for (const screen of part.screens ?? []) {
            if (screens.some(other => other.id === screen.id)) throw new Error(`${MODULE_NAME}: two parts claim the screen "${screen.id}".`);
            screens.push(screen);
        }
        replayQueries.push(...(part.replayQueries ?? []));
    }
    const guards = PARTS.map(part => part.replayGuard).filter(fn => typeof fn === 'function');
    return {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        description: DESCRIPTION,
        requires: { storyBlock: '>=2.1.0' },
        capabilities: ['lantern-oil'],
        domains,
        commands,
        queries,
        replayQueries,
        capture: {
            kinds: Object.fromEntries(Object.entries(kinds).map(([kind, spec]) => [kind, { grammar: spec.grammar }])),
            apply(ctx, line) {
                const spec = kinds[line?.kind];
                if (!spec) ctx.fail('INVALID', `${MODULE_NAME} has no "${line?.kind}" line.`);
                return spec.apply(ctx, line);
            },
        },
        hooks: {
            replayGuard(view, info) {
                for (const guard of guards) {
                    const answer = guard(view, info);
                    if (answer !== undefined) return answer;
                }
                return { ok: false, reason: `${MODULE_NAME} does not know this guard.` };
            },
        },
        screens,
    };
}
```

#### `src/parts/lantern.js`

```js
// The lantern part of the lantern-oil module (Story Block docs/v2/MODULES.md §A): its state, its narrator
// line, one command, one query and the replay guard of that command. Story Studio wrote it as a starting
// point: change the rules freely and keep the shape.
//
// State (this module is its only writer):   lantern = { oil: a whole number from 0 to 20 }
// Narrator line:   ~ oil Name — what happened | change: +N or -N
//   Code sets the number: the change is cut to 5 either way, the result stays from 0 to 20, and only the
//   first such line of a reply counts.
// Command (the reader's action):   lantern.pour { amount }   takes `amount` away and is refused when there
//   is not that much. It is guarded (docs/v2/REPLAY.md): on replay it applies only while the state before
//   it still has that much.
// Query:   lantern.oil → { value, min, max }   (reads the state alone, so the guard may ask it on replay)

export const MODULE_ID = 'lantern-oil';
export const DOMAIN = 'lantern';
export const FIELD = 'oil';
export const LABEL = 'Oil';
export const MIN = 0;
export const MAX = 20;
export const INITIAL = 10;
export const STEP = 5;
export const KIND = 'oil';
export const KIND_LABEL = 'change';
export const COMMAND = 'lantern.pour';
export const ACTION = 'Pour out one';
export const QUERY = 'lantern.oil';
export const SCREEN = 'lantern-oil/lantern';

const isWhole = value => Number.isSafeInteger(value);
const sliceOf = state => state?.domains?.[DOMAIN] ?? initial();
// A name from the story as one short line: spaces folded, cut at 40 characters (whole code points).
const flat = text => [...String(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, 40).join('');

export function initial() {
    return { [FIELD]: INITIAL };
}

// docs/v2/SPEC.md §2.5: any error rejects the whole command, and nothing is saved.
export function validate(slice) {
    if (!slice || typeof slice !== 'object') return [`The ${LABEL} record is damaged.`];
    const value = slice[FIELD];
    if (!isWhole(value)) return [`${LABEL} is not a whole number.`];
    if (value < MIN || value > MAX) return [`${LABEL} must stay from ${MIN} to ${MAX}.`];
    return [];
}

// ---- the narrator line (docs/v2/SPEC.md §4.2, §4.4) ---------------------------------------------------

// Runs as a story command. The story proposes a change; code cuts it, keeps the value in range and lets one
// line count per reply (the claim is keyed on the reply's sid, so a swipe or a Re-read starts afresh).
export function applyLine(ctx, line) {
    const written = String(line?.labels?.[KIND_LABEL] ?? '').trim();
    if (!/^[+-]?\d{1,9}$/.test(written)) ctx.fail('INVALID', `Write the change as a whole number, like "| ${KIND_LABEL}: +1".`);
    const reply = ctx.carrier?.sid ?? ctx.reply?.sid ?? null;
    if (!reply) ctx.fail('INVALID', `There is no reply to keep this ${KIND} line on.`);
    if (!ctx.claim(`${MODULE_ID}:${reply}:${KIND}`)) ctx.fail('CLAIMED', `Only the first ${KIND} line of a reply counts.`);
    const asked = Number(written);
    const slice = ctx.draft(DOMAIN);
    const before = slice[FIELD];
    const after = Math.max(MIN, Math.min(MAX, before + Math.max(-STEP, Math.min(STEP, asked))));
    slice[FIELD] = after;
    const result = { summary: `${flat(line?.name) || LABEL}: ${LABEL} ${before} → ${after}.`, narrate: false, data: { before, after } };
    if (after - before !== asked) result.problem = `${LABEL} changed by ${after - before}, not ${asked}: a line moves it by ${STEP} at most and keeps it from ${MIN} to ${MAX}.`;
    return result;
}

// ---- the command and its replay guard (docs/v2/SPEC.md §3.2, docs/v2/REPLAY.md) -----------------------

// The guard a block carries: what must still hold on replay, hashed with the reply it is stored on.
function guardOf(hash, epoch, source, predicate, inputs) {
    return { owner: MODULE_ID, version: 2, epoch, rulesHash: null, inputHash: hash({ predicate, inputs, source }), predicate };
}

export function command(ctx, payload = {}) {
    const amount = payload?.amount;
    if (!isWhole(amount) || amount < 1 || amount > MAX - MIN) ctx.fail('INVALID', `Say how much ${LABEL} to take, a whole number from 1 to ${MAX - MIN}.`);
    const slice = ctx.draft(DOMAIN);
    const before = slice[FIELD];
    if (before - amount < MIN) ctx.fail('NOT_ENOUGH', `There is not that much ${LABEL}: ${before} now.`);
    ctx.replayGuard(guardOf(ctx.hash, ctx.epoch, ctx.source, { kind: COMMAND, amount }, { enough: true }), { before });
    slice[FIELD] = before - amount;
    return { summary: `${LABEL}: ${before} → ${before - amount}.`, narrate: true, data: { before, after: before - amount } };
}

// Asked on replay with the state before the block (the replay rule, docs/v2/REPLAY.md "Guards are pure"): it
// reads that state through this module's own replay query, the guard and what the command recorded; never
// settings, the clock, another module or receipts. Undefined for a guard another part made.
export function replayGuard(view, info) {
    const guard = info?.guard;
    if (guard?.predicate?.kind !== COMMAND) return undefined;
    const amount = guard.predicate.amount;
    const now = view.query(QUERY);
    const enough = isWhole(amount) && isWhole(now?.value) && now.value - amount >= MIN;
    if (guardOf(view.hash, guard.epoch, info.source, guard.predicate, { enough }).inputHash === guard.inputHash) return { ok: true };
    return { ok: false, reason: `There is no longer ${amount} ${LABEL} to take: ${now?.value} now, ${info?.recorded?.before} when it was done.` };
}

// ---- the query and the screen (docs/v2/SPEC.md §6, §13; docs/v2/TEMPLATES.md) -------------------------

export function read(state) {
    return { value: sliceOf(state)[FIELD], min: MIN, max: MAX };
}

// A tab and game-view screen. Its text is fixed; the numbers come from the query (q.value).
export const screen = {
    id: SCREEN,
    title: LABEL,
    icon: 'fa-cube',
    mounts: ['tab', 'screen'],
    data: { value: { query: QUERY } },
    template: [
        '<section class="ss-glass box">',
        `  <p class="ss-label">${LABEL}</p>`,
        '  <p class="value"><b>{{ q.value.value }}</b> / {{ q.value.max }}</p>',
        `  <button data-command="${COMMAND}" data-payload='{"amount":1}' data-if="q.value.value > q.value.min">${ACTION}</button>`,
        '</section>',
    ].join('\n'),
    css: '.box { padding: 12px; } .value b { font-size: 1.4em; }',
};

export const part = {
    domains: { [DOMAIN]: { initial, validate, counters: [FIELD] } },
    commands: { [COMMAND]: command },
    queries: { [QUERY]: read },
    replayQueries: [QUERY],
    kinds: { [KIND]: { grammar: `~ ${KIND} Name — what happened | ${KIND_LABEL}: +N or -N`, apply: applyLine } },
    replayGuard,
    screens: [screen],
};
```

#### `tests/module.test.js`

```js
// The lantern-oil module on a real Story Block host: the testkit vendored in tests/vendor/story-block/ (Story Block
// docs/v2/SPEC.md §10) runs the whole host on a fake SillyTavern. `npm test` runs this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './vendor/story-block/testkit/index.js';
import { definitionProblems, definitionWarnings } from './vendor/story-block/src/v2/registry.js';
import { validateScreen } from './vendor/story-block/src/v2/view/screens.js';
import { compileTemplate } from './vendor/story-block/src/v2/view/template/index.js';
import { createModule, MODULE_ID } from '../src/module.js';
import { start } from '../index.js';
import { COMMAND, DOMAIN, FIELD, INITIAL, KIND, KIND_LABEL, MAX, MIN, QUERY, STEP } from '../src/parts/lantern.js';

const lineOf = change => `~ ${KIND} Test — a test line | ${KIND_LABEL}: ${change > 0 ? '+' : ''}${change}`;
const replyWith = (...lines) => `The story goes on.\n\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const valueOf = host => host.head().domains[DOMAIN][FIELD];
// What a full replay from the first reply gives must be what the live host holds (docs/v2/SPEC.md §2.2).
function assertRebuildIsLive(host) {
    const live = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), live);
}
const guardProblems = host => host.store.problems().filter(problem => /may ask on replay|replayGuard/.test(`${problem.why} ${problem.message}`));

async function hostWithModule() {
    return createHost({ modules: [createModule()] });
}

test('the definition is one Story Block accepts, with no field it does not know', () => {
    const def = createModule();
    assert.deepEqual(definitionProblems(def), []);
    assert.deepEqual(definitionWarnings(def), []);
    for (const screen of def.screens) {
        assert.deepEqual(validateScreen(screen), [], screen.id);
        assert.deepEqual(compileTemplate(screen.template).warnings, [], screen.id);
    }
});

test('it registers through StoryBlock.ready and is ready, with nothing refused', async () => {
    const host = await createHost();
    try {
        await start({ ready: Promise.resolve(host.sdk) });
        assert.equal(host.registry.has(MODULE_ID), true);
        assert.deepEqual(host.registry.refusals(), []);
        const entry = host.sdk.modules().find(item => item.id === MODULE_ID);
        assert.equal(entry.status, 'ready');
        assert.deepEqual(host.sdk.query(QUERY), { value: INITIAL, min: MIN, max: MAX });
    } finally {
        host.close();
    }
});

test('a narrator line moves the value by code, once a reply, and replays the same', async () => {
    const host = await hostWithModule();
    try {
        await host.send('Go on.', replyWith(lineOf(STEP + 1), lineOf(1)));
        const expected = Math.max(MIN, Math.min(MAX, INITIAL + STEP));
        assert.equal(valueOf(host), expected);
        assertRebuildIsLive(host);
        await host.swipe('The story goes on another way.');
        assert.equal(valueOf(host), INITIAL, 'a swipe without the line takes its change back');
        assertRebuildIsLive(host);
    } finally {
        host.close();
    }
});

test('the command takes away, refuses what is not there and leaves the state as it was', async () => {
    const host = await hostWithModule();
    try {
        await host.send('Go on.', replyWith(lineOf(-STEP)));
        await host.send('Go on.', replyWith(lineOf(STEP)));
        const before = valueOf(host);
        const too = await host.sdk.command(COMMAND, { amount: before - MIN + 1 });
        assert.equal(too.ok, false);
        assert.equal(valueOf(host), before);
        const done = await host.sdk.command(COMMAND, { amount: 1 });
        assert.equal(done.ok, true, done.message);
        assert.equal(valueOf(host), before - 1);
        assertRebuildIsLive(host);
    } finally {
        host.close();
    }
});

test('the guard keeps a command off once the change it needed is deleted, and obeys the replay rule', async () => {
    const host = await hostWithModule();
    try {
        await host.send('Go on.', replyWith(lineOf(-STEP)));
        const low = valueOf(host);
        await host.send('Go on.', replyWith(lineOf(STEP)));
        const high = valueOf(host);
        assert.ok(high > low);
        await host.send('Go on.', 'Nothing changes.');
        const done = await host.sdk.command(COMMAND, { amount: high - MIN });
        assert.equal(done.ok, true, done.message);
        assert.equal(valueOf(host), MIN);
        assertRebuildIsLive(host);
        assert.deepEqual(guardProblems(host), []);

        // The reply that raised the value goes: the command no longer has what it took, so it stays off.
        await host.st.deleteMessage(4);
        assert.equal(valueOf(host), low);
        assert.ok(host.store.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
        assertRebuildIsLive(host);
        assert.equal(valueOf(host), low);
    } finally {
        host.close();
    }
});

test('the replay guard asks only its own replay queries', () => {
    const def = createModule();
    const asked = [];
    const state = { v: 2, meta: { rev: 1, claims: {} }, domains: { [DOMAIN]: { [FIELD]: MAX } } };
    const view = Object.freeze({
        state,
        hash: value => JSON.stringify(value),
        query(name, args) {
            asked.push(name);
            if (!def.replayQueries.includes(name)) throw new Error(`"${name}" is not a query a guard may ask on replay`);
            return def.queries[name](state, args);
        },
    });
    const source = { sid: 'sr_aaaaaaaa', swipeKey: 'sw_aaaaaaaa', evidence: 'ev_aaaaaaaa', ordinal: 0 };
    const predicate = { kind: COMMAND, amount: 1 };
    const guard = { owner: MODULE_ID, version: 2, epoch: 'ep_00000000', rulesHash: null, inputHash: view.hash({ predicate, inputs: { enough: true }, source }), predicate };
    assert.deepEqual(def.hooks.replayGuard(view, { guard, source, recorded: { before: MAX } }), { ok: true });
    assert.ok(asked.length > 0);
    for (const name of asked) assert.ok(def.replayQueries.includes(name), name);
    assert.equal(def.hooks.replayGuard(view, { guard: { ...guard, predicate: { kind: 'other' } }, source }).ok, false);
});
```

#### `README.md`

````markdown
# Lantern Oil

**What it does:** Counts the oil left in the party's lantern.

A starter module for **Story Block v2** (Story Suite for SillyTavern), made by Story Studio. It is its own
SillyTavern extension and talks to Story Block only through Story Block's public sdk
(`globalThis.StoryBlock.ready`). It needs Story Block 2.1.0 or later.

## Install

1. Put this folder into SillyTavern as a third-party extension, next to Story Block:
   `public/scripts/extensions/third-party/lantern-oil/` (Story Block is `third-party/Story_block`).
   Or push it to a git repository of your own and use SillyTavern's **Install extension** with its URL.
2. Reload SillyTavern. `manifest.json` names Story Block as a dependency, so SillyTavern loads it first.
   Without Story Block v2 the module logs one line and stays off.

## What it adds

| Part | Name | What it does |
|---|---|---|
| State | domain `lantern`, field `oil` | A whole number from 0 to 20, starting at 10. Only this module writes it. |
| Narrator line | `~ oil` | `~ oil Someone — what happened \| change: +5` moves it by at most 5; only the first such line of a reply counts. |
| Command | `lantern.pour` | The reader's action `{ amount }`: takes that much away, refused when there is not that much. Guarded on replay. |
| Query | `lantern.oil` | `{ value, min, max }`, read from the state alone. |
| Screen | `lantern-oil/lantern` | A tab with the value and a **Pour out one** button. |
| Capability | `lantern-oil` | A pack can list it in `requires.capabilities` to need this module. |

## Files

- `manifest.json`: the SillyTavern extension; it depends on `third-party/Story_block`.
- `index.js`: waits for `StoryBlock.ready`, then registers the module.
- `src/module.js`: the module definition, put together from its parts.
- `src/parts/lantern.js`: the part with everything listed above.
- `tests/module.test.js`: tests on a real Story Block host (the vendored testkit).
- `tests/vendor/`: Story Block's testkit and runtime, copied by Story Studio (see `tests/vendor/README.md`).

## Tests

Node.js 22 or later, no install step:

```
npm test
```

The tests register the module on a whole Story Block host running on a fake SillyTavern: the definition
is accepted, a narrator line is applied by code and replays the same, the command is refused when it
should be, and the replay guard keeps a command off once the change it needed is deleted.

## Growing it

- Story Block's rules for modules: `docs/v2/SPEC.md` §0, §2.2 and §6, and `docs/v2/MODULES.md` §A and §F.
  In short: code sets the numbers and the story only proposes; handlers are synchronous and use `ctx`
  alone (no `Math.random`, no `Date.now()`, no model calls); replay must give what the live story gave;
  buttons are for bookkeeping, never for story actions.
- A command whose result depends on an earlier reply attaches a replay guard (`docs/v2/REPLAY.md`). On
  replay a guard may read only the state before its block, what the command recorded, `story.evidence`
  and the queries the module lists in `replayQueries`.
- An optional mechanic is a feature (`docs/v2/MODULES.md` §F100).
- More parts: write `src/parts/<name>.js` like the first one and add it to `PARTS` in `src/module.js`.
- Refresh the testkit after updating Story Block: from a Story Block checkout,
  `npm run sync-testkit -- <this folder>`.

## Licence

Choose a licence for your module and add a `LICENSE` file. The copy of Story Block in `tests/vendor/`
keeps its own licence (AGPL-3.0-only); see `tests/vendor/README.md`.
````

#### `tests/vendor/README.md`

````markdown
# Story Block, copied for the tests

`story-block/` holds Story Block's testkit (`testkit/index.js`) and every file of Story Block's runtime the
testkit imports, copied by Story Studio from its own copy of Story Block. `story-block/VERSION` names the
Story Block version and commit they come from. Only the tests import them; SillyTavern never loads them.

Do not edit them. To refresh them after updating Story Block, run `npm run sync-testkit -- <this module's folder>`
in a Story Block checkout: it replaces `story-block/` with a full copy and leaves this file and
`LICENSE-story-block` as they are.

## Licences

Story Block is licensed AGPL-3.0-only; the licence text is in `LICENSE-story-block`.

`story-block/src/v2/view/icons/set.js` holds path data from Phosphor Icons 2.1.1, under the MIT licence:

```
MIT License
Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
````

### 4.3 SHA-256 of the spec's files

| File in `docs/part5b/` | SHA-256 |
|---|---|
| `golden-inputs.json` | `0b961eca7105cb0f6a7fc8aa83b971ff2d54dd535affa28f0639c877ad11419f` |
| `golden/lantern-oil/.gitignore.golden` | `4d56952b0fb13bf8f9b6c13a6d4c34a075bac3af447636a1df4335d7576e2f97` |
| `golden/lantern-oil/README.md.golden` | `a917a085e84f1290c6fa9520b440a35d5da040b020725cb8989ebe90bcc7b2dd` |
| `golden/lantern-oil/index.js.golden` | `b8bcb33664348a2f528fec6a883757212e1e3bab1c80db609a2aebf789256057` |
| `golden/lantern-oil/manifest.json.golden` | `50395097f8c5bde0c56375a7adbab92df0ec4c12590131e43927ae02a706d812` |
| `golden/lantern-oil/package.json.golden` | `001472b0d1ab6c21140932ccd9a5debc0a55ae48de05565bc71d9b6fb1a80760` |
| `golden/lantern-oil/src/module.js.golden` | `7543e5c7fa006ed8d5f4941f911a86bcba508fcdcd38c2d24c87ea990d762d2c` |
| `golden/lantern-oil/src/parts/lantern.js.golden` | `6f9044bc60029d98b4649cf938a2025542e965370839b4cb817b4042ee82d7b2` |
| `golden/lantern-oil/tests/module.test.js.golden` | `e1f28ee62a7860e4c3bc159735dd83eb56b9229fd2c44272b3cb4a4ca435369d` |
| `golden/lantern-oil/tests/vendor/README.md.golden` | `ed5eb30368ec4e0f9209892b5dea53fd42a94de992e0480030b391a1cba35c24` |
| `templates/README.md.tmpl` | `6f8359ca65f00d04a266be9b26f4c1ec106f2f7f343fcaf7f37ceed3150d9a77` |
| `templates/capabilities.js.tmpl` | `b0a14a036f525984260b647f1cf9bfb2cbcdcac5e39645b9d7c4534dd4985d4f` |
| `templates/capability-row.md.tmpl` | `377066533d5bb8dfe109f49198e680458c77bf7f4abd0cbf2842a9a630dd9f7b` |
| `templates/gitignore.tmpl` | `4d56952b0fb13bf8f9b6c13a6d4c34a075bac3af447636a1df4335d7576e2f97` |
| `templates/index.js.tmpl` | `365c3fe0a2981361a0712643eef2113819fe77113aa041ce396bb0b02254695e` |
| `templates/module.js.tmpl` | `b619f8fdee3a2672bf50fc1a20fe4987c69b9dd7590c9f54af7023bbbd354bf1` |
| `templates/module.test.js.tmpl` | `9923be2069229aa290e40dabc7217e69b1178adb38dee6fabc5f7d3c13e98813` |
| `templates/part.js.tmpl` | `a6f759ca0f5c7049685208b46adb0657342c87d57dae8dbc5c5bbb0d5c09e8ab` |
| `templates/screen-const.js.tmpl` | `6e79eef7aa7f1c69096119e73742635f11b67a3c0f76d22a7d9cba91a9150293` |
| `templates/screen-row.md.tmpl` | `886cc41617f74c97b56d27a43aca24fe6a73870fb3726c65d2a6c76170982c7f` |
| `templates/vendor-README.md.tmpl` | `ed5eb30368ec4e0f9209892b5dea53fd42a94de992e0480030b391a1cba35c24` |

The copied files of the golden scaffold are checked against `vendor/story-block/`, `LICENSE` and `versionText`
(section 8), not against fixed hashes, because they change with every re-sync.

---

## 5. Validation and refusals

### 5.1 Function

`validateInputs(raw)` → `{ ok: true, inputs }` (a frozen copy holding exactly the 18 keys) or `{ ok: false, errors }`.
Each error is `{ code, field, message }`. Fields are checked in the order of the table in 3.2; **each field reports at
most its first failing rule**; the range rules run only when all four numbers are valid; the `query`/`command` clash
runs only when both passed their own rules. `raw` that is not a plain object gives one error
`{ code: 'bad-type', field: '', message: 'The code module form is not an object.' }`.

### 5.2 The display-text rule

A display text is a string that

1. equals `text.normalize('NFC')` (else `unsafe-text`, second message below);
2. matches `^[\p{L}\p{M}\p{N} ',.!?:;()\-\u2013\u2014\u2019]*$` with the `u` flag: letters, marks, digits, the space,
   and `' , . ! ? : ; ( ) -`, en dash, em dash and the right single quote. No `<`, `>`, `&`, `"`, `{`, `}`, backtick,
   backslash, `|`, `#`, `*`, `_`, `[`, `]`, control characters, line breaks or invisible format characters;
3. has no leading or trailing space (`text === text.trim()`);
4. has a length in code points (`[...text].length`) within the field's bounds.

Why so narrow: the same text goes into JS strings, JSON, Markdown and, through `LABEL`/`ACTION`, a Story Block screen
template, whose parser decodes character references before reading `{{ }}` (SB `html.js:33-40`), so `{` cannot be
escaped there. Refusing the few dangerous characters is simpler and safer than five escapers.

### 5.3 Rules, codes and messages (exact)

`{label}` is the form label of 3.2; `{value}` is the refused value (already known to match the field's pattern, so it is
an identifier). Messages are shown with `textContent` only.

| Field(s) | Check, in order | Code | Message |
|---|---|---|---|
| any | key not in the 18 | `unknown-field` | `"{key}" is not a code module field.` (`field` = the key) |
| text fields | `typeof value !== 'string'` | `bad-type` | `{label} has the wrong type.` |
| `min`, `max`, `initial`, `step` | not a safe integer from −1000000 to 1000000 (a string is refused here too) | `bad-number` | `{label} must be a whole number from -1000000 to 1000000.` |
| `screen` | `typeof value !== 'boolean'` | `bad-type` | `{label} has the wrong type.` |
| required text (all but `author`, `capability`) | `value === ''` | `required` | `{label} is needed.` |
| display text | not NFC | `unsafe-text` | `{label} has a character in decomposed form; type it again.` |
| display text | fails the pattern or has leading/trailing space | `unsafe-text` | `{label} may use only letters, digits, spaces and the marks ' ’ , . ! ? : ; ( ) - – —.` |
| display text | too long | `too-long` | `{label} is longer than {max} characters.` |
| `moduleId` | `!SLUG.test(value)` | `bad-slug` | `{label} must be lowercase words joined by "-", like "lantern-oil", at most 64 characters.` |
| `moduleId` | in `RESERVED_MODULE_IDS` | `reserved` | `{label} "{value}" is taken by Story Block or another Story Suite module.` |
| `capability` (when not empty) | `!SLUG.test(value)` | `bad-slug` | same as `moduleId` |
| `capability` | in `HOST_CAPABILITIES`, `RESERVED_MODULE_IDS` or `RESERVED_NAMES` | `reserved` | `{label} "{value}" is taken by Story Block or another Story Suite module.` |
| `domain` | `!/^[a-z][a-z0-9]{1,23}$/` | `bad-name` | `{label} must be a lowercase letter, then 1 to 23 lowercase letters or digits.` |
| `domain` | in `RESERVED_NAMES` | `reserved` | `{label} "{value}" is taken by Story Block or another Story Suite module.` |
| `field` | `!/^[a-z][a-zA-Z0-9]{0,23}$/` | `bad-name` | `{label} must be a lowercase letter, then up to 23 letters or digits.` |
| `field` | `value === 'id'` or ends with `Id` | `reserved` | `{label} "{value}" would have to hold a record id; choose another name.` |
| `field` | in `RESERVED_FIELDS` | `reserved` | `{label} "{value}" is a name every JavaScript object already has; choose another.` |
| `kind` | `!/^[a-z][a-z0-9]{1,23}$/` | `bad-name` | `{label} must be a lowercase letter, then 1 to 23 lowercase letters or digits.` |
| `kind` | in `RESERVED_KINDS` | `reserved` | `{label} "{value}" is taken by Story Block or another Story Suite module.` |
| `kindLabel` | `!/^[a-z]{1,16}$/` | `bad-name` | `{label} must be 1 to 16 lowercase letters.` |
| `command`, `query` | `!/^[a-z][a-zA-Z0-9]{0,31}$/` | `bad-name` | `{label} must be a lowercase letter, then up to 31 letters or digits.` |
| `query` | `query === command` | `clash` | `Query must not be the same as Command.` |
| `max` | `max <= min` | `bad-range` | `Maximum must be above Minimum.` |
| `initial` | `initial < min \|\| initial > max` | `bad-range` | `Start value must be from Minimum to Maximum.` |
| `step` | `step < 1 \|\| step > max - min` | `bad-range` | `Most a line may change it must be from 1 to Maximum minus Minimum.` |

Length bounds: `name` 40, `description` 160, `author` 60, `label` 24, `action` 32.

### 5.4 Reserved names (exact lists)

```js
export const RESERVED_MODULE_IDS = Object.freeze(['fishing-activity', 'npc-state-delta', 'rpg-battle', 'story-block', 'story-director', 'story-studio']);
// Domains and command/query prefixes of Story Block (core), RPG Battle (with its pinned-rules parts) and Story Director
// at the baseline. The state name is also the scaffold's command and query prefix, so both kinds of name are here.
export const RESERVED_NAMES = Object.freeze([
    'arc', 'assist', 'atlas', 'bestiary', 'capture', 'chatter', 'checks', 'chronicle', 'combat', 'craft', 'creation',
    'death', 'director', 'dm', 'domains', 'effects', 'events', 'gear', 'inventory', 'item', 'items', 'journal', 'meta',
    'module', 'npc', 'packs', 'party', 'progress', 'quest', 'quests', 'return', 'rules', 'savepoint', 'savepoints',
    'scene', 'state', 'story', 'threads', 'time', 'trade', 'training', 'wallet', 'world',
]);
// Capture kinds of the same three modules at the baseline.
export const RESERVED_KINDS = Object.freeze([
    'agenda', 'beat', 'check', 'chatter', 'choice', 'clock', 'coin', 'craft', 'dm', 'effect', 'encounter', 'event',
    'faction', 'hook', 'intervention', 'item', 'join', 'landmark', 'leave', 'lethal', 'loot', 'market', 'place',
    'present', 'quest', 'recipe', 'refine', 'repair', 'rest', 'route', 'secret', 'skill', 'time', 'use', 'weather',
    'world', 'wound', 'xp',
]);
export const RESERVED_FIELDS = Object.freeze(['constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'prototype', 'toLocaleString', 'toString', 'valueOf']);
```

These lists are a snapshot. The real guard is M7's host test, which registers generated modules next to Story Block's
core module; a clash with Story Block there fails the test. A clash with an installed RPG Battle or Story Director that
added a name later is caught by Story Block itself at registration, with a plain sentence (SB `registry.js:456-466`).

---

## 6. Studio modules and APIs

New files (all plain ES modules; the ones under `src/` run in the browser and in Node):

| File | Exports |
|---|---|
| `src/code-module/templates/*.tmpl` | the eleven templates (copied from `docs/part5b/templates/`) |
| `scripts/code-module-assets.mjs` | `TESTKIT_ROOTS`, `testkitFiles(vendorDir)`, `versionText(vendorDir, count)`, `codeModuleAssets(root)`; as a script, writes `src/code-module/assets.js` |
| `src/code-module/assets.js` | generated: `TEMPLATES`, `SB_STAMP` (`{ version, commit, files }`), `VENDOR_FILES` (`[[path, base64]]`, sorted) |
| `src/code-module/inputs.js` | `INPUT_KEYS`, `LABELS`, `LIMITS`, `EXAMPLE_INPUTS`, `DISPLAY_TEXT`, the four reserved lists, `jsString`, `mdText`, `validateInputs` |
| `src/code-module/render.js` | `renderTemplate(template, values, blocks)` (3.5) |
| `src/code-module/zip.js` | `zipStore(entries)` (3.9) |
| `src/code-module/generate.js` | `placeholders(inputs)`, `generateScaffold(raw)`, `scaffoldEntries(raw)`, `scaffoldZip(raw)`, `fromBase64(text)` |
| `src/screens/code-module.js` | `renderCodeModule(ctx)` |

Changed files: `src/card-png.js` (export `crc32`, nothing else), `scripts/build.mjs` (write `assets.js`),
`src/screens/index.js`, `src/studio.js`, `src/studio.css`, `.github/workflows/ci.yml` (committed-artifact check),
`docs/STUDIO.md`, `README.md`.

### 6.1 `inputs.js`

```js
import { HOST_CAPABILITIES, SLUG } from '../../vendor/story-block/src/v2/packs/limits.js';

export const INPUT_KEYS = Object.freeze(['moduleId', 'name', 'description', 'author', 'capability', 'domain', 'field', 'label', 'min', 'max', 'initial', 'step', 'kind', 'kindLabel', 'command', 'action', 'query', 'screen']);
export const LABELS = Object.freeze({
    moduleId: 'Module id', name: 'Name', description: 'Description', author: 'Author', capability: 'Capability',
    domain: 'State name', field: 'Field', label: 'Field label', min: 'Minimum', max: 'Maximum', initial: 'Start value',
    step: 'Most a line may change it', kind: 'Line kind', kindLabel: 'Line label', command: 'Command', action: 'Button label',
    query: 'Query', screen: 'Add a tab screen',
});
export const LIMITS = Object.freeze({ name: 40, description: 160, author: 60, label: 24, action: 32 });
export const NUMBER_LIMIT = 1000000;
export const DISPLAY_TEXT = /^[\p{L}\p{M}\p{N} ',.!?:;()\-\u2013\u2014\u2019]*$/u;
export const EXAMPLE_INPUTS = Object.freeze({ /* exactly docs/part5b/golden-inputs.json */ });
```

`validateInputs` follows 5.1–5.3 exactly.

### 6.2 `generate.js`

```js
/** { values, blocks } for renderTemplate (3.3), from valid inputs. */
export function placeholders(inputs)

/**
 * → { ok: true, inputs, files: [{ path, text }], copied: { count, stamp } } | { ok: false, errors }.
 * `files` are the nine written files of 3.1 in path order; `copied.count` is VENDOR_FILES.length (128 at the baseline)
 * and `copied.stamp` is SB_STAMP. Does not decode VENDOR_FILES (it runs on every keystroke of the form).
 */
export function generateScaffold(raw)

/** → { ok: true, entries: [{ path, data: Uint8Array }] } (all 137 files, unprefixed, path order) | { ok: false, errors }. */
export function scaffoldEntries(raw)

/** → { ok: true, bytes: Uint8Array, filename: `${moduleId}.zip` } | { ok: false, errors }: zipStore of the entries under `${moduleId}/`. */
export function scaffoldZip(raw)

/** base64 → bytes with atob (present in browsers and Node). */
export function fromBase64(text)
```

The written-file table:

| Path | Made from |
|---|---|
| `.gitignore` | `gitignore.tmpl` |
| `README.md` | `README.md.tmpl` |
| `index.js` | `index.js.tmpl` |
| `manifest.json` | 3.7 |
| `package.json` | 3.7 |
| `src/module.js` | `module.js.tmpl` |
| `src/parts/${domain}.js` | `part.js.tmpl` |
| `tests/module.test.js` | `module.test.js.tmpl` |
| `tests/vendor/README.md` | `vendor-README.md.tmpl` |

Text is encoded with `new TextEncoder()` (UTF-8, no BOM).

---

## 7. UI

### 7.1 Where

- `src/studio.js:284`: add `['code-module', 'Code module']` right after `['data-modules', 'Data modules']`.
- `src/studio.js:291`: add `'code-module'` to the list of selections that hide the inspector.
- `src/screens/index.js`: as the **first** statement of `renderScreen`, `if (ctx.selection.kind === 'code-module') { renderCodeModule(ctx); return; }`.
  The section works with or without an open pack; it never reads or changes the pack, history, saved draft or dirty
  state.
- The draft lives in `ctx.codeModule` (`ctx.codeModule ??= { draft: { ...EXAMPLE_INPUTS }, selected: null }`), not in
  `ctx.authoring`, so opening another pack keeps it. It is session-only (lost on reload), like narrator-card edits.

### 7.2 Layout (see the mockups)

`main` gets, in order:

1. `h1` "Code module".
2. `p.muted`: "Start a SillyTavern extension that is a real Story Suite module: Studio writes its files, a copy of
   Story Block's testkit and tests that pass. Download the zip, then git init, install it and grow it. Your work stays
   on this device."
3. `div.presentation-workspace.code-module-workspace` with two sections:
   - `section.stack[aria-label="Module form"]` with five `fieldset`s, each with a `legend`:
     **Module** (Module id, Name, Description as a 2-row textarea, Author, Capability), **State** (State name, Field,
     Field label, then `div.cm-numbers` with Minimum, Maximum, Start value, Most a line may change it), **Narrator line**
     (Line kind, Line label, `p.muted` "The narrator writes, and code decides the number:", and `pre#cm-line-example`
     showing `~ <kind> Someone — what happened | <kindLabel>: +<step>`), **Command and query** (Command and Query each
     inside `span.cm-prefixed` after a `span.mono[aria-hidden=true]` showing `<domain>.`; Button label), **Screen** (the
     checkbox).
   - `section.stack[aria-label="Files"]`: `h2` "Files"; `pre#cm-validation[role=status]`; `div.row` with
     `button.primary#cm-download` (export-file icon + "Download zip") and `button#cm-reset` ("Reset to example");
     then either the file list and viewer (valid) or `p.muted#cm-files-empty` "Fix the marked fields to see the files."
     (invalid).

Every control is built with `field(doc, label, control)` (ST5a `src/dom.js`) and has `aria-label` equal to its label
and the id below. Number boxes use `inputmode="numeric"` and `readInt` (ST5a `src/screens/dm/ui.js:15`) so a non-number
reaches the validator as text and is refused there.

| Input | id | Input | id |
|---|---|---|---|
| Module id | `cm-module-id` | Maximum | `cm-max` |
| Name | `cm-name` | Start value | `cm-initial` |
| Description | `cm-description` | Most a line may change it | `cm-step` |
| Author | `cm-author` | Line kind | `cm-kind` |
| Capability | `cm-capability` | Line label | `cm-kind-label` |
| State name | `cm-domain` | Command | `cm-command` |
| Field | `cm-field` | Button label | `cm-action` |
| Field label | `cm-label` | Query | `cm-query` |
| Minimum | `cm-min` | Add a tab screen | `cm-screen` |

Author and Capability have the placeholder "optional".

### 7.3 Live preview

- Every `input` event writes the control's value into `ctx.codeModule.draft` and schedules a refresh 120 ms later
  (the Data modules pattern: one pending timer, replaced on each event; `src/screens/dm/index.js:104-109`). The form is
  not rebuilt while typing, so focus and caret stay put.
- A refresh runs `generateScaffold(draft)` and updates only the Files section, the `<domain>.` prefixes, the example
  line and the per-field errors:
  - **valid**: `#cm-validation` gets `data-ok="true"` and the text
    `Ready: ${files.length} files written by Studio, ${copied.count} copied from Story Block ${stamp.version} (commit ${stamp.commit.slice(0, 7)}).`;
    `ul.cm-files[aria-label="Files in the zip"]` gets one `li > button[aria-pressed]` per written file (its path as
    text) and a last `li.cm-copied`: `tests/vendor/LICENSE-story-block and tests/vendor/story-block/: ${copied.count} files copied from Story Block ${stamp.version} (commit ${short}). Not shown.`;
    then `h3.mono#cm-file-name` and `pre#cm-file[tabindex=0][aria-labelledby=cm-file-name]` with the selected file's
    text. The selection defaults to `src/parts/<domain>.js` and is kept by path while it exists.
  - **invalid**: `data-ok="false"`, the text `Not ready (${n} problem${n === 1 ? '' : 's'}):` followed by one line
    `- ${message}` per error; the list and viewer are replaced by `#cm-files-empty`.
  - Each field with an error gets `aria-invalid="true"`, `aria-describedby="<id>-error"` and a
    `small.cm-error#<id>-error` with the message inside its label; fields without an error lose all three.
- **Download zip** runs `scaffoldZip(ctx.codeModule.draft)` (cancelling a pending refresh and refreshing first):
  - refused: `applyEdit(ctx, { ok: false, errors: result.errors.map(({ code, message }) => ({ code, message })) })`,
    the existing helper; the notice bar shows `code: message` per line (for example
    `unsafe-text: Field label may use only letters, digits, spaces and the marks ' ’ , . ! ? : ; ( ) - – —.`), the
    screen re-renders from the kept draft, nothing is downloaded and the pack is untouched;
  - accepted: `downloadFile(ctx, result.bytes, result.filename, 'application/zip')` (ST5a `src/export.js:4`); it does
    not mark the pack exported.
- **Reset to example** sets the draft to a copy of `EXAMPLE_INPUTS` and re-renders.

### 7.4 Guarantees kept

- **XSS:** every author value reaches the page only as a form value or `textContent` (the viewer shows generated
  text, which contains the author's text). No `innerHTML` or markup parsing. The browser test types hostile text and
  checks no element was created from it.
- **Keyboard:** native inputs and buttons in DOM order; the file list is buttons with `aria-pressed`; the viewer is
  focusable so its scroll can be moved with the keys; no custom key handlers. Download is reachable and works with
  Tab and Enter.
- **Offline:** generation and the zip happen in the page; the download uses a Blob URL as every other Studio download.
  The built file still has one classic inline script, the same CSP, and passes the unchanged scan.
- **Narrow screens:** the section fits 390 px without horizontal page scrolling (the 5a narrow-screen check); the
  viewer scrolls inside itself (`white-space: pre`).
- **Targets:** every button and input keeps Studio's 44 px minimum.

### 7.5 Mockups

`docs/mockups/part5b/code-module-desktop.html` (1280 px) and `docs/mockups/part5b/code-module-phone.html` (390 px):
static, self-contained, Studio's own tokens and rules, the rules of 7.6, and two states each (A: the example, valid,
with the file list and the part file; B: a refused Field label with the per-field error, "Not ready" and the notice
bar). They are proposals for approval; the implementation follows this section where they differ.

### 7.6 CSS to append to `src/studio.css` (exact)

```css
.code-module-workspace fieldset{border:1px solid var(--border);border-radius:14px;background:var(--card);box-shadow:var(--shadow);padding:12px;margin:0;display:flex;flex-direction:column;gap:10px;min-width:0}
.code-module-workspace legend{font-size:15px;font-weight:800;padding:0 6px;color:var(--text)}
.cm-numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}
.cm-prefixed{display:flex;align-items:center;gap:6px;min-width:0}.cm-prefixed .mono{color:var(--muted);white-space:nowrap}
.cm-error{color:var(--danger-text);font-size:12px;font-weight:600}
.code-module-workspace [aria-invalid=true]{border-color:var(--danger)}
.cm-check{flex-direction:row;align-items:center;gap:10px;color:var(--text);font-size:14px}.cm-check input{width:24px;height:24px;min-height:24px}
#cm-line-example{margin:0;padding:8px 10px;background:var(--field);border:1px solid var(--border);border-radius:10px}
#cm-validation{margin:0}#cm-validation[data-ok=true]{color:var(--good)}#cm-validation[data-ok=false]{color:var(--warn-text)}
.cm-files{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.cm-files button{width:100%;text-align:left;font-family:ui-monospace,monospace;font-weight:400;font-size:13px;overflow-wrap:anywhere;border-color:transparent}
.cm-copied{color:var(--muted);font-size:12px;padding:8px 10px;border:1px dashed var(--border);border-radius:10px;overflow-wrap:anywhere}
#cm-download{display:inline-flex;align-items:center;gap:8px}
#cm-file{max-height:420px;overflow:auto;white-space:pre;overflow-wrap:normal;margin:0;padding:12px;background:var(--field);border:1px solid var(--border);border-radius:10px;font-size:12px;line-height:1.45}
.code-module-workspace textarea{font-family:inherit;min-height:64px}
@media(min-width:1101px){.code-module-workspace>section[aria-label="Files"]{position:sticky;top:0}}
```

---

## 8. Proof

All of these run in `npm test` (no skips when Chromium is missing, as in parts 3–5a).

| Test file | What it proves |
|---|---|
| `tests/code-module-templates.test.js` (M1) | The templates and goldens are the spec's bytes; every template uses only the placeholders of 3.3; no trailing spaces, one final line break; `firstReference(text) === null` for every template and golden (so they can live unencoded in the bundle); the golden JS files parse (`node --check` in a temp folder that holds the golden `package.json`). |
| `tests/code-module-inputs.test.js` (M2) | Every rule and message of section 5, both sides of every bound, the reserved lists, NFC, `jsString`/`mdText` on hostile strings (round trip through `vm` for `jsString`), `EXAMPLE_INPUTS` equals the golden inputs. |
| `tests/code-module-zip.test.js` (M3) | Byte layout of 3.9 read back by a small reader in the test; CRC-32 equals `zlib.crc32`; empty zip; refused paths; determinism; `crc32` is the PNG writer's. |
| `tests/code-module-assets.test.js` (M4) | The committed `assets.js` equals `codeModuleAssets()`; the closure, VERSION text and `SB_STAMP`; every `VENDOR_FILES` entry decodes to the vendored bytes; the licence equals `LICENSE`; `firstReference(assetsText) === null`. |
| `tests/code-module-generate.test.js` (M5) | The golden inputs give the nine golden files byte for byte; `scaffoldEntries` lists 9 + `VENDOR_FILES.length` paths in order; same inputs → identical zip bytes (twice in one process); option variants (no screen, no capability, empty author) render without leftover placeholders; refused inputs return the errors of section 5 and no files. |
| `tests/code-module-run.test.js` (M6) | The golden scaffold and two variants, written to temp folders from `scaffoldEntries`, pass their own `npm test`; the golden one is also written by unpacking `scaffoldZip`'s bytes with the test reader. |
| `tests/code-module-host.test.js` (M7) | On Studio's vendored real host: the generated module registers with no problems, warnings or refusals; its line captures, is cut and claimed once per reply, and replays (rebuild == live) across a swipe; its command's guard holds live, turns the block off after the needed reply is deleted (`REPLAY_PREREQUISITE`), and asks only `replayQueries`; a deliberately broken guard (an undeclared query) makes the command fail with Story Block's replay-rule sentence. |
| `tests/code-module-browser.test.js` (M8) | From `dist/story-studio.html` at 1280 and 390 px: open the section, see "Ready", the file list and the part file text; edit a field and see the viewer update; a refused field shows the per-field error, "Not ready" and, on Download, the notice text; a valid Download's bytes equal `scaffoldZip(EXAMPLE_INPUTS).bytes`; hostile text creates no elements; keyboard-only Download; zero requests, zero page or console errors; no horizontal overflow at 390 px; every control labelled. |

---

## 9. Milestones

Each milestone is one focused session. Start each from the previous one's commit. "Done when" lists what the reviewer
runs. Every milestone ends with `npm run -s check`, `npm run -s test:dot` and `git diff --check` clean, one commit,
and no file outside its list changed.

### M0: Baseline on Story Block 2.1.0

- Precondition: `studio/part-5a` is merged into `main`; branch off it.
- Run `npm run sync-sb -- --from <Story Block checkout at 076764b or later main>`, then `npm run build`.
- Files: `vendor/story-block/**`, `vendor/story-block-fixtures/**`, `dist/story-studio.html`, `src/assets/drawings.js`
  (only if the build changed it). Nothing under `vendor/` by hand.
- Done when: `head -2 vendor/story-block/VERSION` prints `Story Block 2.1.0` (or later) and the commit; `grep -n
  "'capabilities'" vendor/story-block/src/v2/registry.js` finds the known-keys line; full suite and browser suites
  pass; the build is reproducible (two builds, same SHA-256).

### M1: Templates and golden fixture

- Copy `docs/part5b/templates/*.tmpl` → `src/code-module/templates/`; `docs/part5b/golden/lantern-oil/` →
  `tests/golden/code-module/lantern-oil/`; `docs/part5b/golden-inputs.json` → `tests/fixtures/code-module/golden-inputs.json`.
  Use `cp -r`; check the SHA-256 list of 4.3.
- Add `tests/code-module-templates.test.js`. It holds its own copy of the placeholder names (`moduleId, domain, field,
  kind, kindLabel, commandType, queryName, screenId, capability, min, max, initial, step, nameJs, descriptionJs, labelJs,
  actionJs, nameMd, descriptionMd, actionMd, screens`) and block names (`capabilities, capabilityRow, screenConst,
  screenRow`); asserts the eleven template names; each template's placeholders ⊆ those lists, and every name in the lists
  is used somewhere; text rules; `firstReference` null (import from `scripts/dist-scan.mjs`); the golden tree written
  to a temp folder (paths without `.golden`) passes `node --check` for each `.js` file.
- Done when: the new test passes; `sha256sum` of the copied files matches 4.3; nothing else changed.

### M2: Inputs, validation and escaping

- Add `src/code-module/inputs.js` (6.1, 5, 3.4) and `tests/code-module-inputs.test.js`.
- Required cases at least: the golden inputs pass; for every key, one value just inside and one just outside each
  bound; `Oil <b>`, `Oil{{ x }}`, `a"b`, `a\nb`, `é` (decomposed é), a leading space, `x`.repeat(41) for Name;
  `story-block`, `Lantern`, `-a`, `a--b`, 65 characters for Module id; `id`, `ownerId`, `toString`, `Oil` for Field;
  `item` for Line kind; `Change` for Line label; `query === command`; `min === max`; `initial` outside; `step` 0 and
  `max-min+1`; `"5"` for Minimum (`bad-number`); an extra key; a non-object. Each asserts the exact `{ code, field,
  message }` list. `jsString` of the text made of a backslash, an apostrophe, a double quote, a line feed, U+2028 and `</script>`
  evaluates (with `vm.runInNewContext`) back to the same text.
- Done when: the test passes; `validateInputs(EXAMPLE_INPUTS).ok` is true; error order matches 5.1.

### M3: Zip writer

- `src/card-png.js`: change `function crc32` to `export function crc32` (line 14), nothing else. Add `src/code-module/zip.js`
  (`zipStore`, 3.9) importing `crc32` from `../card-png.js`, and `tests/code-module-zip.test.js` with a reader
  (`readZip(bytes) → [{ path, data, crc, header fields }]`) that walks the EOCD → central directory → local headers and
  checks every field of 3.9.
- Done when: the test passes; `zlib.crc32(data) === crc32(data)` for 3 inputs; writing the same entries twice gives
  equal bytes; the PNG golden tests still pass; `unzip -t` on a test zip written to a temp folder reports no errors
  (reviewer, by hand).

### M4: Assets pipeline

- Add `scripts/code-module-assets.mjs` (3.8; as a script it writes `src/code-module/assets.js` and prints its size),
  call `codeModuleAssets()` from `scripts/build.mjs` right after the `drawings.js` write, commit the generated
  `src/code-module/assets.js`, add it to the CI "Verify committed build artifact" `git diff --exit-code` line, and add
  `tests/code-module-assets.test.js`.
- Nothing imports `assets.js` from `src/` yet, so the dist does not change in this milestone.
- Done when: the test passes; `node scripts/code-module-assets.mjs` twice leaves `git status` clean; at the baseline
  `SB_STAMP` is `{ version: '2.1.0', commit: '076764b…', files: 125 }` and `VENDOR_FILES.length === 128`.

### M5: Generator

- Add `src/code-module/render.js` (3.5), `src/code-module/generate.js` (6.2) and `tests/code-module-generate.test.js`.
- Done when: the golden test passes byte for byte; determinism and variant tests pass; `generateScaffold` with the golden
  inputs takes under 50 ms in Node (no base64 decoding); `scaffoldZip` under 2 s.

### M6: The scaffold runs its own tests

- Add `tests/helpers/code-module.js` (`writeScaffold(dir, entries)`, `readZip(bytes)` moved here from M3's test,
  `npmCommand()` → `'npm'` or `'npm.cmd'` on Windows) and `tests/code-module-run.test.js`.
- Variants: the golden inputs; `{ ...golden, moduleId: 'cold-tally', name: 'Cold', domain: 'chill', field: 'degrees', label: 'Degrees', min: -5, max: 5, initial: -5, step: 10, kind: 'chill', kindLabel: 'by', command: 'warm', query: 'now', action: 'Warm up', screen: false, capability: '', author: '' }`;
  `{ ...golden, moduleId: 'hearts3', name: 'Garðar’s — tally (old)', description: 'Ünïcode: ok; yes! (really) – fine?', domain: 'hearts', field: 'left', label: 'Hearts', min: 0, max: 3, initial: 3, step: 1, kind: 'heart', kindLabel: 'n', command: 'lose', query: 'count', action: 'Lose one', screen: true }`.
  (All three were run while writing this spec: 6 of 6 tests pass in each.)
- Each runs `spawnSync(npmCommand(), ['test'], { cwd, encoding: 'utf8', timeout: 120000 })` and asserts exit status 0
  and `# pass 6` / `# fail 0` in the output. Temp folders are removed in `finally`.
- Done when: the test passes locally and in CI (CI has npm); total time under 30 s.

### M7: Registration and replay on Story Block's host

- Add `tests/code-module-host.test.js`. Write the golden scaffold (and the `cold-tally` variant) to temp folders, import
  their `src/module.js` and part with `import(pathToFileURL(...).href)`, and use Studio's vendored
  `vendor/story-block/testkit/index.js` and `registry.js`:
  1. `definitionProblems(def)` and `definitionWarnings(def)` are `[]`; with `console.warn` recorded around
     `createHost({ modules: [def] })`, nothing mentions the module; `registry.refusals()` is `[]`;
     `sdk.modules()` shows it `ready` with the declared capability.
  2. Capture: one reply with two lines of the kind, `+(step + 1)` then `+1` → the value is
     `Math.max(min, Math.min(max, initial + step))` (the first line cut to `step`, the second not used);
     `store.rebuild()` gives a deep-equal head; a swipe without the lines takes the change back; rebuild again equal.
  3. Guard, replay rule: wrap `def.hooks.replayGuard` before registering so it records every query name its `view.query`
     is asked; run the lower / raise / empty-reply / command / delete-reply-4 sequence of the generated test; assert the
     guard was asked at least once, every name asked is in `def.replayQueries` or is `story.evidence`, the value after the
     delete is the lowered one, `store.problems()` has a `REPLAY_PREREQUISITE`, and rebuild equals live.
  4. Negative control: generate the golden scaffold, replace `const now = view.query(QUERY);` in its part with
     `const now = view.query('scene.place') ?? view.query(QUERY);`, write and import it, register, send a reply, run the
     command: it fails and its message matches `/is not a query a guard may ask on replay/`.
- Done when: the test passes; reverting the wrapper assertion (asserting a forbidden name) makes it fail (reviewer).

### M8: The Code module section

- Add `src/screens/code-module.js` (7.1–7.4), wire it in `src/screens/index.js` and `src/studio.js`, append 7.6 to
  `src/studio.css`, run `npm run build` (the dist now holds `assets.js`; expect about 4.5 MB), and add
  `tests/code-module-browser.test.js` using `tests/helpers/dm-browser.js` (`withPage`, `SHIPPED`).
- Done when: the browser test passes at 1280 and 390 px; the existing browser suites pass unchanged; `tests/build.test.js`
  passes (one script, scan clean, reproducible build); the screen matches the mockups' structure.

### M9: Docs

- `docs/STUDIO.md`: a "Part 5b: code modules" section (what the section makes, the inputs, the files, the vendored
  testkit and its licence, determinism, the proof tests, the dist size) and the known issues of 11 that remain.
  `README.md`: one line for the new section. Mark this spec "Implemented in <commit>" at its top.
- Done when: every claim in the new docs is backed by a test or a file named there; links resolve.

---

## 10. Risks and the reviewer's checks

| Milestone | Risk | Check the reviewer runs |
|---|---|---|
| all | Hand edits under `vendor/`; unrelated files changed | `git diff --stat <base>` lists only the milestone's files; `git diff <base> -- vendor/` empty after M0 |
| all | Model or tool names, secrets | `git grep -n -i -E "<model names>\|api[_-]?key\|token" -- . ':!vendor'` on the diff |
| M0 | The re-sync changes host behaviour Studio's tests rely on | full `npm test` including browser suites; the data-modules parity tests; compare `vendor/story-block/VERSION` |
| M1 | Templates retyped instead of copied (an em dash or quote changed) | `sha256sum` against 4.3; `cmp` each file with `docs/part5b/` |
| M1 | A golden JS file picked up by the test glob or syntax check | the goldens end in `.golden`; `npm test` output has no `lantern-oil` test names |
| M2 | A rule loosened "to make a test pass"; messages paraphrased | diff `inputs.js` regexes and messages against section 5 character by character |
| M2 | NFC or code-point length done with `.length` | the decomposed-é and astral-character cases |
| M3 | Wrong endianness, sizes or offsets that `unzip` tolerates | the test reader checks every field; `unzip -t`; `python3 -m zipfile -t` if present |
| M4 | `assets.js` hand-edited or stale after a sync | regenerate and `git diff --exit-code src/code-module/assets.js`; CI line added |
| M4 | Raw text with scanned patterns in the bundle | `firstReference(assets text)` is null; the dist scan passes in M8 |
| M5 | Byte drift in rendering (CRLF, trailing newline, BOM) | golden comparison is `Buffer.compare`, not string trim; `file` on outputs shows LF |
| M5 | Non-determinism (object key order, `Date`, `Math.random`) | `git grep -n -E "Date|Math.random|performance.now" src/code-module` empty; double-generation test |
| M6 | The scaffold passes only because a test was weakened | the generated test file equals its golden; `# pass 6` asserted |
| M6 | Temp folders leak or tests hang | `finally` cleanup; `timeout` on `spawnSync` |
| M7 | The replay-rule test passes vacuously (guard never asked) | asked-count > 0 asserted; negative control fails the command |
| M8 | `innerHTML`/markup from author text; the form rebuilt on each key (focus lost) | grep the new screen for forbidden APIs; browser test types into a field and checks `document.activeElement` stays |
| M8 | The dist grows or breaks the scan; offline guarantees regress | build test; request counter at zero; CSP unchanged |
| M8 | Download marks the pack exported or edits history | browser test: dirty pack stays dirty, Undo unchanged after a download |
| M9 | Docs claim more than the tests prove | each docs paragraph names its test |

---

## 11. Open questions (with recommended answers)

1. **Single-file size.** Embedding the testkit (2.3 MB as base64, 3.16 MB) grows `dist/story-studio.html` from about
   1.4 MB to about 4.6 MB. *Recommended:* accept it; the file still opens instantly from disk and stays one offline
   file. The alternative (a zip without the testkit and a README step to run Story Block's `sync-testkit`) breaks
   "passing tests out of the box".
2. **Licence of the vendored testkit.** The zip carries Story Block's AGPL-3.0 code under `tests/vendor/` with its
   licence text and the Phosphor MIT notice, and leaves the module's own licence to the author. *Recommended:* keep
   that; the tests only import the testkit, and SillyTavern never loads it.
3. **One field per module.** The starter has one whole-number field, one line, one command, one query. *Recommended:*
   keep it for 5b (the golden stays small and the tests exact); grow to several fields in a later part, after authors
   have used it.
