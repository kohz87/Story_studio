# Story Studio: Pack Engine and Developer Interface (Part 1)

Story Studio is the pack editor and creator kit for the Story Suite (the SillyTavern extensions: Story Block, the hub; RPG Battle; Story Director; and NPC State Delta). It creates, inspects, edits, and exports rules packs that suite modules load unchanged.

This document details the architecture, data models, editing operations, history management, developer tools, and validation rules established in Part 1 of Story Studio.

---

## 1. Overview and Scope

### 1.1 Scope of Part 1

Part 1 establishes the deterministic pack engine, immutable document model, and unstyled developer testing interface:

- **Shared Frozen Schema and Checker**: Imported directly from Story Block via `vendor/story-block/src/v2/packs/rules-v2.js`. Story Studio never duplicates or forks validation logic; Story Block remains the sole authority on pack validity.
- **Canonical Model**: Pure document loading, deep freezing, reference indexing, and deterministic canonical JSON serialization ([`src/model.js`](../src/model.js)).
- **Pure Editing Operations**: Graph-aware mutation primitives with full undo capabilities ([`src/edits.js`](../src/edits.js)).
- **Bounded History Controller**: Stateful snapshot-based undo/redo stack controller over immutable pack model snapshots ([`src/history.js`](../src/history.js)).
- **Unstyled Developer UI**: Standard-compliant DOM interface and headless smoke test harness ([`src/dev.js`](../src/dev.js), [`src/dev.html`](../src/dev.html)).
- **Test Fixtures**: Static and dynamic valid, invalid, and scenario packs ([`tests/fixtures/`](../tests/fixtures/)).

Part 2 adds the standalone local editor, built as one offline HTML file. See the [application guide](STUDIO_PART2.md) for screens, draft persistence, distribution, and browser verification. The engine and unstyled developer page described here remain available.

### 1.2 Progression Hierarchy and Pathway Graph

Story Studio enforces the rules-v2 progression graph defined in the Suite Contract:

- **Class Tiers and Skills**:
  - Class tiers span `0` to `3`. Tier 0 classes are root classes (`parent: null`).
  - Tiers 1 through 3 require `parent` referencing a class of tier `n - 1`. Cycles and orphan hierarchies are strictly rejected.
  - Every class defines exactly 3 unique skills (`skillsPerClass: 3`). Each skill is owned by exactly one class.
  - All leaf classes must be Tier 3 (advanced classes). Starter and intermediate classes (tiers 0–2) define base skills with no branching nodes.
- **Pathway Graph (24 Written + 12 Generated)**:
  - Each advanced (Tier 3) class defines 3 advanced skills.
  - Base forms have ID `pack.<packId>/<skill>-base`.
  - At each milestone (levels 40, 50, 60, 70, 80, 90), one eligible advanced skill takes its next step. A skill may take its second step at 50 while others have not taken their first; step 2 follows that skill's selected step 1. Story Studio checks the authored graph structure; runtime milestone progression, eligibility, and mastery belong to RPG Battle (RB).
  - **Step 1**: 3 forms per skill: 1 deterministic generated form (`-g`) and 2 written branches (`-a` and `-b`).
  - **Step 2**: 9 forms per skill: each of the 3 step-1 forms (`-g`, `-a`, `-b`) branches into its own `-g`, `-a`, and `-b` step-2 forms.
  - **Per Skill**: 8 written + 4 generated = 12 pathway forms.
  - **Per Advanced Class**: 24 written + 12 generated = 36 pathway forms.
  - **Exact Parentage**: The `fromForm` field explicitly names the exact parent form ID (including generated parent forms like `<skill>-base-g`).
  - **Slug Budget**: Skill slugs have a maximum length of 52 characters, leaving space under Story Block's 64-character slug limit for pathway step suffixes (e.g. `-base-g-a` is 9 characters).

### 1.3 Canonical Serialization and Hashing

Story Studio guarantees stable, deterministic pack serialization:

- **Array Preservation**: Authored order of arrays (classes, skills, branches, effects, transforms, loot, requirements, objectives) is strictly preserved.
- **Key Sorting**: Object keys are normalized to Unicode NFC and sorted alphabetically at every level.
- **Formatting**: Output is UTF-8 encoded with 2-space indentation and a terminating newline. Timestamps, machine-generated identifiers, expanded forms, and self-hashes are excluded from export.
- **Dual Hash Structure**:
  - `rulesHash`: The contract's H (rules fingerprint). A SHA-256 hash computed over the normalized authored rules manifest (`content.rules[0]`), owned definitions (`creatures`, `quests`, `shops`, `recipes`, etc.), the frozen schema, and engine constants. Modifying pack envelope metadata (e.g., pack name or description) preserves `rulesHash`.
  - `packHash`: A SHA-256 hash computed over the entire canonical pack document (envelope, currency, manifests, and content) alongside schema and constants. Changing the pack envelope name updates `packHash` while keeping `rulesHash` unchanged.
  - Neither hash uses a `.hash` alias. Both hashes evaluate to `null` if the pack is invalid.

### 1.4 Seam Boundaries and Host Registration

- **Foreign References**: Only designated external references (canonical Story Director places `pl_xxxxxxxx`, NPC State Delta NPCs `np_xxxxxxxx`, and narrative threads `th_xxxxxxxx`) pass structural validation. Internal class, skill, form, branch, item, foe, and quest references must resolve within this rules pack; foreign pack internal references fail validation with `bad-ref`. Foreign qualified place IDs (`pack.<other>/<place>`) are the designated external-place exception. Diagnostics do not guarantee warnings on every external reference. Required unresolved runtime references block runtime eligibility; Story Studio does not query suite owners or external packs at authoring time.
- **Power Budgets and Scoring**:
  - `budgetOf()` is an exported compatibility stub that returns `null`.
  - `powerScore(form)` computes explicit power scores (combining effect metrics, target factors, and unit scores).
  - `generatePowerUp(form)` applies deterministic power upgrades (+20 power, +1 stat magnitude, or +1 condition round).
  - Budget closure validation verifies form scores against `classBudget` (`[12, 24, 36, 48]`) and `pathBudgetIncrement` (`12`).
- **Runtime Proofs and Provenance**: Story Studio does not implement runtime proof generation, event replay, or damage calculation interpreters; these run downstream in Story Director and RPG Battle. Authored legendary items in a rules pack are valid; extra injected provenance authoring metadata is rejected by the closed authoring schema. Runtime provenance verification and generated legendary enforcement are downstream RPG Battle (B3) responsibilities and are not validated or proven by Story Studio authoring tests.
- **Host Integration**: The `content.rules` manifest and `rb-rules-v2` capability have landed in vendored Story Block commit `b7f6ec57ec8f4290ad7dd9792ad4bdf5bfac77f5`. Story Studio checks packs directly against this vendored release. Any pack with a `content.rules` manifest must declare `rb-rules-v2` in `requires.capabilities`.

---

## 2. API Reference

### 2.1 Pack Model (`src/model.js`)

[`src/model.js`](../src/model.js) provides pure functions to open, validate, index, and export pack documents.

#### `openPack(jsonTextOrObject)`

Parses and validates a rules pack, returning a deep-frozen snapshot model.

```ts
// Illustrative type signature
function openPack(json: string | object): Readonly<{
    document: object | null;
    validation: {
        ok: boolean;
        errors: Array<{ code: string; path: string; message: string }>;
        warnings: Array<{ path: string; message: string }>;
    };
    references: Array<{
        kind: string;
        id: string;
        path: Array<string | number>;
        targetKind: string;
        targetId: string;
    }>;
    rulesHash: string | null;
    packHash: string | null;
}>;
```

- **Valid Packs**: Returns `document` populated with the canonical raw envelope, empty `validation.errors`, extracted typed `references`, and valid 64-character hex strings for `rulesHash` and `packHash`.
- **Invalid Packs**: When the pack fails validation but remains a safe plain object within structural limits, `document` preserves the authored structure with sorted keys for continued editing in Studio. `validation.ok` is `false`, `validation.errors` lists issues bounded by shared validation limits (`limits.errors`, up to 20), and both hashes are `null`.
- **Unsafe / Hostile Input**: Inputs with invalid JSON syntax, non-object roots, cyclic structures, property getters, prototype pollutions (`__proto__`), nesting exceeding depth 16, or payloads exceeding 512 KiB return `document: null`.

#### `exportPack(model)`

Serializes an open model to canonical raw envelope JSON text.

```ts
// Illustrative type signature
function exportPack(model: object): string;
```

- Rejects a model marked invalid, then revalidates its document through the shared exporter. It does not require a `validation` property to be present on an arbitrary supplied object (rejecting `model.validation.ok === false` when `validation` exists), then always revalidates its document through shared `exportRulesV2`. Normal `openPack` models always have `validation` and this is recommended usage.
- Runs the canonical export pipeline: validates the envelope, strips internal runtime wrapper fields from definition records (`id`, `pack`), preserves top-level `envelope.id`, shortens same-pack references to local slugs, preserves authored array ordering, and sorts object keys.
- Returns a UTF-8 JSON string indented with 2 spaces and ending in a newline (`\n`).
- **Errors**: Throws an `Error` containing an `errors` property (`err.errors`) if the model is missing, invalid, or fails canonical serialization.

#### `indexReferences(document)`

Traverses a pack document to locate and index all typed cross-references.

```ts
// Illustrative type signature
function indexReferences(document: object | null): Array<{
    kind: string;
    id: string;
    path: Array<string | number>;
    targetKind: string;
    targetId: string;
}>;
```

- Traverses the document in deterministic order and returns an array of reference descriptors.
- `path`: Segment array of strings and numeric indices locating the reference field (e.g., `['content', 'rules', 0, 'classes', 1, 'parent']`).
- Target kinds indexed:
  - `classes`: References to progression classes (e.g., class `parent`, quest class requirements, skill unit summons).
  - `skills`: References to rules-v2 base skills in `content.rules[0].skills` (e.g., class `skills`, branch `skill`, trainer `skills`, creature `skills`).
  - `forms`: References to skill forms (e.g., branch `fromForm`).
  - `items`: References to item definitions (e.g., item rule `def`, creature `loot`, quest collection objectives, shop `stock`, recipe `makes` and `materials`, start inventory `items`).
  - `places`: References to world locations (e.g., trainer `place`, quest `turnInPlace` and visit objectives, shop `place`, route endpoints).
  - `npcs`: References to character identities (e.g., quest `giver`). Preserves external NPC IDs (`np_xxxxxxxx` or external pack slugs); quest givers are never converted to creature IDs.
  - `events`: References to timeline event templates (e.g., trainer `eventTemplates`, event chaining).
  - `quests`: References to quest templates (e.g., quest prerequisite requirements, quest chains).
  - `threads`: References to narrative thread trackers.
  - `races`, `talents`: References defined within character presets.
  - `legacySkills`: References to legacy Story Block skills defined in `content.skills` (mapped to targetKind `'legacySkills'` to distinguish them from rules-v2 manifest skills in `content.rules[0].skills`).

#### `rulesV2Schema`

Re-exports the deeply frozen JSON Schema definition object for rules-v2 manifests and owned content.

---

### 2.2 Edit Operations (`src/edits.js`)

[`src/edits.js`](../src/edits.js) exports pure functions that take a model snapshot and return a new model snapshot along with an `undo` closure.

#### Common Edit Return Shapes

```ts
// Illustrative type signature
type EditSuccess = {
    ok: true;
    model: object; // New frozen snapshot model
    undo: () => object; // Returns the exact prior model instance
};

type EditRefusal = {
    ok: false;
    model: object; // Exact original model unchanged
    errors: Array<{ code: string; path: string; message: string }>;
    references?: Array<object>; // Present when record removal is refused due to inbound references
};
```

> [!IMPORTANT]
> A successful edit (`ok: true`) can yield a safe invalid draft (`model.validation.ok === false`) if the modification violates schema rules (such as leaving a class with only 2 skills). Always inspect `model.validation.ok` before attempting export.

#### Supported Kinds (`ALL_KINDS`)

Editing operations operate on supported collection strings categorized into:

- **Rules Collections (`RULES_KINDS`)**: Located in `content.rules[0]`:
  - `'classes'`, `'skills'`, `'branches'`, `'itemRules'`, `'trainers'`.
- **Story Block Content Collections (`SB_KINDS`)**: Located in `content`:
  - `'items'`, `'creatures'`, `'quests'`, `'shops'`, `'recipes'`, `'places'`, `'events'`, `'routes'`, `'races'`, `'talents'`, `'presets'`, `'legacySkills'` (where `'legacySkills'` accesses and edits `content.skills`).

#### `add(model, kind, record)`

Appends a cloned record to the designated collection.

```ts
// Illustrative type signature
function add(model: object, kind: string, record: object): EditSuccess | EditRefusal;
```

- Accepts local slugs or fully qualified IDs (`pack.<packId>/<slug>`).
- Validates the record as plain, bounded JSON without accessors or symbols.
- Rejects duplicate IDs within a collection. Classes, skills, branches, trainers, and the rules manifest share a namespace; host kinds such as places have separate namespaces. A class or skill may share a host record's slug.
- Prevents collisions with reserved or generated form IDs (`<skill>-base`, `<skill>-base-g`, `<skill>-base-a`, etc.).
- Written branches require derived slug alignment matching `${fromForm}-${choice}`.

#### `renameId(model, kind, id, nextId)`

Renames a record and re-links all inbound typed references atomically.

```ts
// Illustrative type signature
function renameId(model: object, kind: string, id: string, nextId: string): EditSuccess | EditRefusal;
```

- Accepts raw slugs or qualified same-pack IDs. Foreign IDs are rejected. Renames use the same namespaces as additions; reserved form IDs remain protected across all kinds.
- Skill renames rebase the entire skill graph: derived base form IDs, generated power-ups, written branch slugs, branch `fromForm` properties, and all inbound typed references across classes, trainers, and creatures.
- Enforces the 52-character slug length limit for skills before mutating.
- Branch renames must conform to parent and choice constraints (`${fromForm}-${choice}`).
- Cannot rename `itemRules` records directly; `itemRules` are keyed by `def` and track the corresponding `items` entry.
- Graph updates follow typed references rather than raw string search-and-replace, preserving authored display names and notes.

#### `remove(model, kind, id, { cascade = false } = {})`

Removes a record from its collection.

```ts
// Illustrative type signature
function remove(model: object, kind: string, id: string, options?: { cascade?: boolean }): EditSuccess | EditRefusal;
```

- **Non-Cascading (`cascade: false`)**: If any other record holds an inbound reference to this record, removal is refused with code `'referenced'`, returning the list of blocking references in `result.references`.
- **Cascading (`cascade: true`)**: Transitively calculates and deletes dependent records rather than just clearing field references:
  - Deleting a class deletes its owned skills, child classes, and their descendant classes.
  - Deleting a skill deletes its derived branches, its owning class, sibling skills owned by that class, and dependent descendant classes and skills.
  - Deleting an item deletes its matching `itemRules` entry, starting inventory entries, and any shops, recipes, quests, or foes consuming or referencing the item.
  - Deleting a branch deletes its descendant pathway branches.

> [!WARNING]
> Cascading removal can leave a safe invalid draft (`model.validation.ok === false`) reporting shared validation errors (for instance, if cascade pruning leaves required progression tiers incomplete or removes prerequisite records). Always inspect `model.validation.ok` before attempting export.

- Removing an `itemRule` record directly removes only the rule, leaving the `content.items` definition and all item consumers intact.

#### `moveClass(model, id, parentId)`

Moves a class to a new parent in the progression tree.

```ts
// Illustrative type signature
function moveClass(model: object, id: string, parentId: string | null): EditSuccess | EditRefusal;
```

- Passing `parentId: null` moves the class to Tier 0 (root).
- Passing a parent class ID moves the class to `parent.tier + 1`.
- Recalculates tiers for the target class and all its transitive descendants.
- Rejects operations that would create cycles or cause any descendant class to exceed Tier 3.

#### `setField(model, path, value)`

Sets or replaces a value at a structured path rooted in the document.

```ts
// Illustrative type signature
function setField(model: object, path: Array<string | number>, value: any): EditSuccess | EditRefusal;
```

- Traverses own properties and array indices. String numeric indices (e.g., `'0'`) and numbers (`0`) are treated identically.
- Rejects paths exceeding depth 32 or targeting prototype accessors.
- **Identity Protection**: Refuses direct modification or replacement of pack `id`, record `id` or `slug`, `def` in `itemRules`, or entire definition arrays. Use `renameId`, `add`, or `remove` instead.
- Identity-preserving replacements of individual records or ancestor objects are permitted if all contained identity keys remain unchanged.

---

### 2.3 History Controller (`src/history.js`)

[`src/history.js`](../src/history.js) provides a stateful undo/redo history manager over immutable pack model snapshots.

#### `createHistory(initialModel, { limit = 100 } = {})`

Instantiates a history controller initialized with an immutable pack model snapshot.

```ts
// Illustrative type signature
function createHistory(initialModel: object, options?: { limit?: number }): {
    readonly current: object;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    commit(editResult: { ok: boolean; model?: object }): boolean;
    undo(): object;
    redo(): object;
};
```

- `limit`: Maximum number of undo snapshots retained (positive integer, defaults to `100`). Throws a `RangeError` if non-positive or non-integer.
- `current`: Returns the active model snapshot.
- `commit(editResult)`:
  - Success requires both `editResult.ok` and an `editResult.model`. When both are present, pushes the previous model to the undo stack, updates `current` to `editResult.model`, clears the redo stack, and returns `true`.
  - Both valid and safe invalid drafts resulting from successful edits (`ok: true` with a model) are accepted and can be committed to history.
  - If `editResult.ok` is false/missing or `editResult.model` is missing, history remains unchanged and `commit` returns `false` (even if `ok: true`).
- `undo()`: Restores the previous model snapshot and returns it. If the undo stack is empty, returns `current` unchanged.
- `redo()`: Restores the next undone snapshot and returns it. If the redo stack is empty, returns `current` unchanged.

---

### 2.4 Developer Interface (`src/dev.js`, `src/dev.html`)

[`src/dev.js`](../src/dev.js) provides a minimal, dependency-free development interface.

#### `mountDev(root)`

Mounts the development tool into a container DOM element.

```ts
// Illustrative type signature
function mountDev(root: Element): {
    loadText(textOrObject: string | object): object | null;
    destroy(): void;
};
```

- **Automatic Mounting**: When loaded in a browser where `document` is defined, `dev.js` automatically mounts to an element with ID `studio-dev` (`document.getElementById('studio-dev')`).
- **DOM Safety**: Constructs interface elements using `createElement` and `textContent` exclusively. No HTML string injection or template parsing is used.
- **Interface Elements**:
  - `#pack-file`: `<input type="file" accept=".json,application/json">` for loading packs. Enforces a 512 KiB size check before initiating reading.
  - `#pack-name`: `<input type="text">` displaying and editing the pack name.
  - `#apply-name`: `<button>` applying the updated name via `setField(model, ['name'], value)`.
  - `#undo`: `<button>` triggering history undo.
  - `#redo`: `<button>` triggering history redo.
  - `#export-pack`: `<button>` exporting the canonical JSON file. Disabled whenever the pack is invalid (`!model.validation.ok`).
  - `#errors`: `<ul role="alert" aria-live="polite">` listing validation and system errors with `data-code` and `data-path` attributes.
  - `#contents`: `<ul>` listing records grouped by kind and slug/name.
- **Public Methods**:
  - `loadText(textOrObject)`: Opens the pack, resets the history controller with the new model, invalidates any pending asynchronous file reads by advancing the sequence counter, renders the interface, and returns the active snapshot model. Returns `null` if called after `destroy()`.
  - `destroy()`: Detaches all event listeners, clears root DOM nodes, and flags the controller as destroyed so pending async reads are discarded.

#### Running the Development Page

Run the unstyled developer interface directly from the repository root:

```bash
chromium --allow-file-access-from-files "file://$PWD/src/dev.html"
```

Alternatively, host the repository root using a local static server:

```bash
python3 -m http.server 8000
# Open http://localhost:8000/src/dev.html
```

> [!NOTE]
> The developer interface is a zero-build, plain ES module DOM tool. It requires no build step, provides no styled creator screens, and performs no runtime network fetch or server API requests.

**Workflow Guide**:

1. **Load Pack**: Click **Choose File** (`#pack-file`) and select a rules pack JSON file (enforces a 512 KiB limit).
2. **Inspect Errors & Contents**: If validation fails, `#errors` displays diagnostic codes and paths, and `#export-pack` is disabled. If valid or an editable draft, `#contents` displays the list of records grouped by kind and slug/name.
3. **Edit Pack Name**: Update the pack name in `#pack-name` and click **Apply** (`#apply-name`) to apply the change via `setField`.
4. **Undo / Redo**: Use **Undo** (`#undo`) and **Redo** (`#redo`) to step through edit snapshots in history.
5. **Export Pack**: Click **Export** (`#export-pack`) to download the canonical JSON file (`<packId>.json`). Export is disabled whenever the model is invalid (`!model.validation.ok`).

---

## 3. Error Codes and Limit Boundaries

### 3.1 Rules v2 Error Codes (`RULES_V2_ERROR_CODES`)

Exported from `vendor/story-block/src/v2/packs/rules-v2.js`:

| Error Code | Meaning / Cause |
|---|---|
| `envelope-unknown` | Unknown field present in the pack envelope, unexpected kind in `content`, or unexpected property in any nested closed schema definition (`additionalProperties: false`). |
| `bad-capability` | Malformed or invalid capability slug listed in `requires.capabilities`. |
| `unsafe-markup` | Text contains `<` or `>`, character reference equivalents, unsafe script-like HTML tags, or forbidden URI schemes (`javascript:`, non-raster `data:`). Raster `data:image/...` URLs pass shared safety checks. |
| `unsafe-key` | Object contains prototype-polluting or reserved keys (`__proto__`, `constructor`, `prototype`). |
| `control-character` | Text contains unescaped ASCII control characters (excluding accepted normalized linebreaks `\n`, `\r` and tabs `\t`), or an object key contains any ASCII control character. |
| `dup-id` | Duplicate identifier collision within a collection or the shared rules namespace, or against reserved form IDs. |
| `tier-chain` | Violation of class progression rules: Tier 0 with parent, Tier > 0 without parent, non-consecutive tier steps, cycles, or non-Tier-3 leaves. |
| `class-skills` | Class does not define exactly 3 unique skills, or a skill is orphaned or assigned to multiple classes. |
| `branch-graph` | Branch count mismatch, incorrect step-1/step-2 choice structure, or `fromForm` not referencing the exact parent form. |
| `numeric-range` | Value out of allowable range (e.g., skill slug length > 52, stats outside 1–99, power outside 1–1000). |
| `bad-transform` | Invalid transform operator, effect array index out of bounds, or incompatible transform operation. |
| `bad-effect` | Malformed effect object, invalid operator, invalid target, or element/damageType incompatibility. |
| `mp-sp-conflict` | Physical forms must have MP 0; non-physical forms must have SP 0. |
| `numeric-only-branch` | Written branch alters only numerical quantities without introducing a behavioral change. |
| `budget-closure` | Form power score exceeds the authorized tier or pathway step budget. |
| `bad-ref` | Reference target does not resolve within the pack or represents an illegal cross-pack internal link. |
| `too-large` | Structural limit exceeded (file size, tree depth, key count, array length, string length, or resolved forms). |
| `item-rule-mismatch` | Count of `itemRules` does not match `content.items` 1:1, or allowed slots/hands do not align with item equipment kind. |
| `bad-xp-per-level` | `constants.xpPerLevel` is not a safe integer between 10 and 10,000 divisible by 10. |
| `bad-schema` | Malformed JSON syntax, non-object pack structure, or schema definition failure. |
| `step-limit` | Form pathway step exceeds the maximum allowed step (step > 2). |
| `bad-form` | Malformed form structure passed to `powerScore`. |
| `bad-rules` | Invalid parent form or closure failure during `generatePowerUp`. |
| `MISSING_CAPABILITY` | Story Block host code: pack with `content.rules` does not declare `rb-rules-v2` in `requires.capabilities`. |

### 3.2 Edit Operation Error Codes

Returned by functions in `src/edits.js`:

| Error Code | Meaning / Cause |
|---|---|
| `bad-model` | The provided model snapshot is missing, null, or has an invalid document. |
| `unsupported-kind` | The target collection kind is not supported in `ALL_KINDS`. |
| `bad-container` | Target collection container is missing or not an array. |
| `bad-value` | Provided record or field value is non-JSON, cyclic, or exceeds depth/size limits. |
| `missing-id` | Record to be added is missing its primary identity property (`slug`, `id`, or `def`). |
| `bad-id` | Identifier syntax is invalid or empty. |
| `bad-ref` | Target ID belongs to a foreign pack, or renamed ID attempts to move to a foreign pack, or parent class ID is unresolved/foreign. |
| `numeric-range` | Numeric property or identifier length out of bounds (e.g. skill slug length > 52 characters before mutation). |
| `dup-id` | Attempted addition or rename causes an ID collision with existing records or reserved form IDs. |
| `bad-branch-id` | Branch slug does not match its expected `${fromForm}-${choice}` derivation. |
| `not-found` | Target record to rename, remove, or move does not exist in the collection. |
| `referenced` | Cannot remove record without `cascade: true` because inbound references exist. |
| `identity-field` | Direct modification of identity fields (`slug`, `id`, `def`) or direct replacement of collections is forbidden. |
| `tier-chain` | Moving a class causes a cycle, invalid parent tier, or tier exceeding Tier 3. |
| `bad-path` | Field path is invalid, empty, exceeds depth 32, or traverses non-existent parent nodes. |
| `unsafe-key` | Path segment contains forbidden property names (`__proto__`, `constructor`, `prototype`). |
| `bad-index` | Path segment targeting an array is not a valid non-negative integer. |
| `out-of-bounds` | Attempted to set an array index beyond the array length or directly set array `length`. |
| `unsafe-edit` | Edit generated a document that fails safety limits when creating the snapshot model. |

> [!NOTE]
> Underlying Story Block host validation uppercase error codes (such as `BAD_FIELD`, `UNKNOWN_KIND`, `UNKNOWN_FIELD`, `UNKNOWN_REF`, `MISSING_CAPABILITY`) may be returned when validating legacy envelope sections. Story Studio preserves these codes as reported by the checker without lowercasing or translation.

### 3.3 Developer Page Status Codes

The developer page preserves engine diagnostics and uses these fallback codes:

| Error Code | Meaning / Cause |
|---|---|
| `file-read-error` | Reading the selected file failed. |
| `no-document` | A name edit was attempted without an open document. |
| `refused-edit` | An edit was refused without specific engine errors. |
| `export-error` | Export threw without specific engine errors. |

### 3.4 Boundary Limits

Story Studio enforces limits defined across Story Block and the Suite Contract:

Editing imports slug and ID patterns from `rulesV2Schema`, slug limits from `RULES_V2_LIMITS`, and tiers, choices, and pathway steps from `RULES_V2_PROGRESSION`.
The separate 52-character skill-slug limit is still private in Story Block. The lead needs to export it, for example as `RULES_V2_LIMITS.skillSlug`, before Studio can remove its remaining local constant. No vendored files are edited for this follow-up.

| Metric | Boundary Limit | Scope / Details |
|---|---|---|
| Raw Pack Size | `512 KiB` (524,288 bytes) | Maximum byte size for raw JSON text or objects. |
| Tree Depth | `16` | Maximum allowed nesting depth for objects and arrays. |
| Object Keys | `200` | Maximum number of own enumerable keys per object. |
| Array Elements | `1,000` | Maximum number of items in any array. |
| String Length | `4,000` | Maximum UTF-16 code units per string value. |
| Identifier Slugs | `64` chars (max 52 for skills) | Lowercase alphanumeric with single hyphens (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). |
| Branches Limit | `1,000` | Maximum written branches allowed per rules manifest. |
| Item Rules Limit | `1,000` | Maximum item rules allowed per rules manifest. |
| Trainers Limit | `100` | Maximum trainers allowed per rules manifest. |
| Expanded Forms | `2,048` | Maximum resolved forms in a ruleset (covers 40 classes / 27 advanced = 1,092 forms). |
| Resolved Ruleset | `2 MiB` (2,097,152 bytes) | Maximum byte size for a fully expanded, resolved ruleset. |

---

## 4. Usage Example

The following runnable Node ESM script demonstrates loading a pack, inspecting validation, performing an edit with history, testing undo/redo, and exporting canonical JSON.

```js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openPack, exportPack } from './src/model.js';
import { setField } from './src/edits.js';
import { createHistory } from './src/history.js';

// 1. Read pack text from disk
const fixturePath = resolve('tests/fixtures/valid-pack.json');
const rawJsonText = readFileSync(fixturePath, 'utf8');

// 2. Open pack and check initial validation
const initialModel = openPack(rawJsonText);

if (!initialModel.validation.ok) {
    console.error('Pack validation failed:', initialModel.validation.errors);
    process.exit(1);
}

console.log('Opened pack successfully:');
console.log('  Pack Name: ', initialModel.document.name);
console.log('  Rules Hash:', initialModel.rulesHash);
console.log('  Pack Hash: ', initialModel.packHash);
console.log('  References:', initialModel.references.length);

// 3. Initialize undo/redo history controller
const history = createHistory(initialModel, { limit: 50 });

// 4. Perform an edit: rename the pack envelope
const editResult = setField(history.current, ['name'], 'Renamed Suite Pack');

if (!editResult.ok) {
    console.error('Edit refused:', editResult.errors);
    process.exit(1);
}

// 5. Commit edit to history
history.commit(editResult);
console.log('\nCommitted edit:');
console.log('  Updated Name:', history.current.document.name);
console.log('  Can Undo:    ', history.canUndo);
console.log('  Can Redo:    ', history.canRedo);

// 6. Test undo and redo
history.undo();
console.log('\nAfter undo:');
console.log('  Current Name:', history.current.document.name);
console.log('  Can Redo:    ', history.canRedo);

history.redo();
console.log('\nAfter redo:');
console.log('  Current Name:', history.current.document.name);

// 7. Verify model validity and export canonical JSON
if (history.current.validation.ok) {
    const exportedJsonText = exportPack(history.current);
    console.log('\nExported canonical JSON successfully:');
    console.log('  Bytes:    ', Buffer.byteLength(exportedJsonText, 'utf8'));
    console.log('  Pack Hash:', history.current.packHash);
} else {
    console.error('Cannot export invalid draft:', history.current.validation.errors);
}
```

---

## 5. Verification and Testing

### 5.1 Test Suite Commands

Run the test suite from the repository root:

- **Syntax Verification**:
  ```bash
  npm run -s check
  ```
  Runs `node --check` against every JavaScript and ESM file in `src/`, `scripts/`, `tests/`, and `vendor/`.
- **Full Test Suite**:
  ```bash
  npm run -s test:dot
  ```
  Executes all Node test files under `tests/` using the dot reporter.
- **Targeted Test Execution**:
  ```bash
  node --test tests/model.test.js
  node --test tests/edits.test.js
  node --test tests/history.test.js
  node --test tests/dev.test.js
  node --test tests/fixtures.test.js
  node --test tests/dev-smoke.test.js
  ```

### 5.2 Fixture Coverage

Test fixtures in [`tests/fixtures/`](../tests/fixtures/) provide thorough verification:

- `valid-pack.json`: Complete valid fixture with 4 tiers, 12 skills, 24 branches, equipment rules, foes, quests, shops, recipes, and places (does not contain start inventory).
- `broken-bad-ref.json`: Static broken fixture triggering `'bad-ref'` via dangling skill references, repairable by restoring the reference.
- `broken-tier-chain.json`: Static broken fixture triggering `'tier-chain'` via non-consecutive tier jumps, repairable by restoring the parent tier link.
- **Fixture Builders and Helpers**:
  - `smallRulesPack`: Generates minimal valid 4-tier rules packs with 12 skills and 24 branches.
  - `makeEveryKindPack`: Generates rich packs covering five effect ops, physical/magic damage, pet/summon units, nine transform ops, seven stat labels, 2H/dual-slot gear, trainer events, and typed quest/shop/recipe records (does not populate races, talents, presets, or routes).
  - `makeValidExtendedPack`: Generates valid packs with equipment rules, foes, quests, shops, recipes, places, and trainers.
  - `makeBrokenPack`: Generates 37 targeted upstream invalid fixture cases with stable error codes (does not alone cover all Suite Contract §10 D categories; oversized graph/file, generated legendary metadata, and parent cases are handled in extra cases).
  - `extra-cases.js`: Dedicated builders for exact parent errors (`missing-parent`, `wrong-skill-parent`, `wrong-step-parent`, `generated-parent-mismatch`), descendant numeric closure boundaries, generated item ID collisions, oversized file (>512 KiB) and graph (>1,000 branches) size limits, XP divisibility, and missing `rb-rules-v2` capabilities.
  - `editScenarios`: Suite of 8 mutation scenarios verifying multi-step edits, cascading removals, renames, and history rollbacks.
- **Suite Coverage**: The combined `fixtures.test.js` suite (upstream cases + extra cases + static packs) covers all Suite Contract §10 D invalid categories, rather than either single fixture builder covering all categories alone.

### 5.3 Headless Browser Smoke Testing

[`tests/dev-smoke.test.js`](../tests/dev-smoke.test.js) verifies [`src/dev.html`](../src/dev.html) in headless Chromium:

- **Development Dependency**: Playwright is pinned in package.json. Run npm ci and npx playwright install --with-deps chromium. The older developer-page runner retains optional discovery and skips if unavailable; the built-application browser tests in studio-browser.test.js require a working browser and never skip.
- **Environment Overrides**:
  - `STUDIO_PLAYWRIGHT_MODULE`: File path or file URL to the Playwright module entry file (e.g., `/path/to/playwright/index.mjs` or `file:///path/to/playwright/index.mjs`; must point to the module entry file, not a directory).
  - `STUDIO_CHROMIUM_PATH`: Executable path for Chromium (e.g., `/path/to/chromium` or `/usr/bin/chromium`).
- **Generic Runner Command**:
  ```bash
  STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs STUDIO_CHROMIUM_PATH=/path/to/chromium node --test tests/dev-smoke.test.js
  ```
- **Execution and Failure Semantics**:
  - When Playwright or Chromium is unconfigured and absent, the test calls `t.skip()` with a descriptive note.
  - When configured, browser launch failures throw an error and fail the test. The test harness listens for `page.on('pageerror')` and asserts that `pageErrors` is empty (it does not listen to console events, so `console.error` by itself does not fail). Any test assertion failure or uncaught page error fails the test.
  - Automated smoke testing executes against real headless Chromium.
- **Browser Execution Notes**:
  - Running directly against `file://` URLs requires Chromium's `--allow-file-access-from-files` flag (configured automatically in `dev-smoke.test.js`).
  - Alternatively, a standard local static server (e.g., `python3 -m http.server`) can serve the directory. The application itself has no server or fetch requirements.

---

## 6. Vendoring Workflow

Story Studio maintains strict alignment with Story Block:

```bash
npm run sync-sb -- --from /tmp/s1work/Story_block
```

- **Mechanism**: [`scripts/sync-sb.mjs`](../scripts/sync-sb.mjs) invokes Story Block's `scripts/sync-testkit.mjs` to synchronize the runtime pack checker and views directly into `vendor/story-block/`.
- **Commit Pinning**: `vendor/story-block/VERSION` records the exact Story Block commit:
  ```text
  Story Block 2.0.0-beta.2
  commit b7f6ec57ec8f4290ad7dd9792ad4bdf5bfac77f5
  files 163
  matrix 1
  ```
- **Integrity Rule**: Files under `vendor/story-block/` are never edited manually.
