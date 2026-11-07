# Story Studio source codemap
Covers the `src/` files not already named in `AGENTS.md`, `AI-README.md`, `README.md` or `docs/**/*.md`; files already mapped there stay listed there.
Mapped 2026-11-07.

## src/
- `src/columns.js`: Adjustable rail and inspector divider widths, fitting rules, keyboard controls and local persistence.
- `src/dev.js`: Unstyled development editor that mounts pack open, edit, undo, redo, export and validation into a host element.
- `src/form-schema.js`: Host record schemas plus schema resolution, field validation and guarded change validation.
- `src/forms.js`: Generic record-form renderer with typed input parsing, defaults, reference controls and JSON editing.
- `src/gear-form.js`: Gear-field editor and helpers for slots, rarity budgets, stat validation and Story Block stat choices.
- `src/preview.js`: Sandboxed, script-disabled Story Block screen preview with offline resource guards and warnings.

## src/assets/empty/
- `src/assets/empty/no-pack.svg`: Empty-state folder drawing used when no pack is open; inlined by `src/assets/index.js`.
- `src/assets/empty/no-problems.svg`: Empty-state shield-with-check drawing used when Check finds no problems; inlined by `src/assets/index.js`.

## src/assets/icons/
- `src/assets/icons/app-mark.svg`: Rounded purple square with a four-point spark, used as the application mark.
- `src/assets/icons/cascade-remove.svg`: Line icon of a removed dependent branch for cascading-remove actions.
- `src/assets/icons/chevron-down.svg`: Down-chevron line icon for collapsible details and menus.
- `src/assets/icons/copy.svg`: Copy line icon for copy actions.
- `src/assets/icons/export-file.svg`: File-with-up-arrow line icon for exporting a pack.
- `src/assets/icons/kind-shops.svg`: Shop-front line icon for the Shops content kind.
- `src/assets/icons/logo-mark.svg`: Square-and-spark line mark used for Studio's header brand.
- `src/assets/icons/open-file.svg`: Open-folder line icon for opening a pack file.
- `src/assets/icons/redo.svg`: Curved-arrow line icon for redo actions.
- `src/assets/icons/undo.svg`: Curved-arrow line icon for undo actions.

## src/cast/
- `src/cast/focus.js`: Keeps the cast form's focus through a redraw: waits for a change or click to finish, then restores the field, draft, caret and scroll.
- `src/cast/data.js`: Pure cast-pack helpers for defaults, meters, portraits, card tags and checker-backed problem views.
- `src/cast/portrait.js`: Portrait naming, size sniffing, fitting and browser encoding within Story Block limits.
- `src/cast/skills.js`: Cast skill limits, labels, view defaults and new-skill helpers for the form.
- `src/cast/zip.js`: Deterministic pack zip writer: `pack.json` first, portrait files second, with optional raw deflate.

## src/data-modules/
- `src/data-modules/dm-edits.js`: Pure undoable data-module edits, checked through Story Block's adapter with capability handling.
- `src/data-modules/dm-model.js`: Shape-tolerant helpers for walking, addressing, cloning and formatting data-module records and expressions.
- `src/data-modules/expr.js`: Expression-editor helpers for operator choices, slot defaults, type hints and expression size.
- `src/data-modules/forms.js`: Pure draft builders and in-place operations for data-module records, schemas, effects and screens.
- `src/data-modules/grammar.js`: Narrator-grammar preview text from a data module, including fields, effects and example outcomes.
- `src/data-modules/refs.js`: Position-based index, rename and removal of typed references in data modules and presentations.
- `src/data-modules/simulator.js`: Simulator request/result contract plus pure scenario, reply and run-comparison helpers.

## src/screens/
- `src/screens/authoring.js`: Lorebook screens for World Info download and review/import of entries as pack drafts.
- `src/screens/cast.js`: Cast part: list and per-person dossier editor for portraits, meters, stages, secrets and skills.
- `src/screens/pack-settings.js`: Pack settings screen with JSON editors for host and content fields.
- `src/screens/presentation.js`: Screen and layout builder with record forms, template and widget tools, layout editing and live preview.
- `src/screens/problems.js`: Problem grouping and navigation plus the Check/export screen and the Problems drawer.
- `src/screens/records.js`: Shared record list, add form and cascading remove dialog with per-record problem display.
- `src/screens/timeline-ai.js`: Timeline writing panel and draft banner: build a prompt, read a pasted answer and manage drafts.

## src/screens/dm/
- `src/screens/dm/effects.js`: Data-module effect-list editor for operation fields, path targets and v1.1 refusals.
- `src/screens/dm/expression.js`: Structured data-module expression editor for operators, typed slots and malformed values.
- `src/screens/dm/panels.js`: Side panels for the checker verdict, narrator grammar, typed references and whole-record JSON.
- `src/screens/dm/present.js`: Data-module presentation editor for attached screens and layouts with an isolated preview.
- `src/screens/dm/schema.js`: Bounded controls for typed data-module field schemas: int, bool, enum, text and map.
- `src/screens/dm/sections.js`: Form sections for every data-module record area, editing the open draft until Apply.
- `src/screens/dm/sim.js`: Data-module simulator panel for sample replies, time steps, what-if replay and runtime results.

## src/timeline/
- `src/timeline/event.js`: Pure timeline event reading, grouping, labels and plain-language firing descriptions.
- `src/timeline/lasting.js`: Story Director lasting-change payloads, validation, capability helpers and timeline problem checks.
- `src/timeline/notes.js`: Non-blocking Timeline notes about conditions waiting on world events the pack never adds.

## Split files
- `src/edits/values.js`: Value checks for pack edits: plain JSON within Story Block's limits, cloned on the way, and the document clone.
- `src/edits/ids.js`: Record identity for edits: the pack's ID prefix, local IDs, identity keys and the kinds that carry identities.
- `src/edits/commit.js`: Edit results: a checked snapshot the pack checker accepts, or a refusal that leaves the model unchanged.
- `src/edits/lists.js`: Finds and writes records in a pack document: a kind's list, a value at a path, and a record by its ID.
- `src/edits/record-ops.js`: Record edits: add, replace a kind's records in place, rename an ID with its references, and remove with dependants.
- `src/edits/guards.js`: Identity guards for structural edits: replacing an ancestor or a definition collection may not drop an identity.
- `src/edits/field-path.js`: setField's path steps: checks the path an edit names and walks a copy down to the parent it changes.
- `src/edits/field.js`: setField: the guarded edit of one field at a structured path, refusing identity changes, unsafe keys and bad values.
- `src/edits/schema-field.js`: setSchemaField: the schema-checked field edit every UI commit uses, moving references when a record's name changes.
- `src/data-modules/sb-sim/util.js`: Helpers the simulator's parts share: clones, deep equality, the failure shape, step text and reply source keys.
- `src/data-modules/sb-sim/grammar.js`: The narrator grammar text Story Block puts in the prompt for a pinned data module.
- `src/data-modules/sb-sim/host.js`: The disposable Story Block host on a fake SillyTavern, and the quiet that keeps runtime console lines out of the author's console.
- `src/data-modules/sb-sim/build.js`: Sample world setup: the pack checked and installed on a disposable host, with the modules it needs pinned.
- `src/data-modules/sb-sim/play.js`: Playing a scenario on the sample host: steps as replies, Continues, time advances and edits made after the fact.
- `src/data-modules/sb-sim/read.js`: Reading the sample host: fields and timer cursors, changes between snapshots, card text and usage.
- `src/data-modules/sb-sim/trace.js`: Rebuilding simulated rows from saved records and surviving receipts: lines, refusals, changes and field state.
- `src/data-modules/sb-sim/replay.js`: Replay purity check: live state equals a fresh store's replay, with and without checkpoints.
- `src/timeline/ai-answer/values.js`: Value readers for answers: limits, record and text checks, folded names, character-counted cuts and descriptions.
- `src/timeline/ai-answer/json.js`: Finds the JSON in a pasted answer: the whole text, a code fence, or each bracketed value around the prose.
- `src/timeline/ai-answer/dates.js`: Reads dates in an answer's words as story minutes in the pack's calendar.
- `src/timeline/ai-answer/where.js`: Matches an answer's place names to the pack's regions, places and aliases, and reads an event's "where" list.
- `src/timeline/ai-answer/lasting-payload.js`: Reads an event's lasting change field by field, with a note for each field cut or left out.
- `src/timeline/ai-answer/read.js`: Reads an answer into draft events: IDs, "after" and delay, dates, places, and the drafts with their notes.
- `src/screens/dm/sections/shared.js`: Helpers the data-module form sections share: draft list and object access, the budget note, the expression context and the condition control.
- `src/screens/dm/sections/identity-state.js`: The data module's identity (slug, name, scope, IDs) and its state fields.
- `src/screens/dm/sections/imports.js`: The imports section: each alias with its adapter, mode and projection, or the module and export it reads from this pack.
- `src/screens/dm/sections/kinds.js`: The kinds section: each kind of line the narrator can write, with its labels, condition and effects.
- `src/screens/dm/sections/rules-timers.js`: Ordered rules (run after a line's effects) and timers (add to fields once per period of story time).
- `src/screens/dm/sections/rewards.js`: The rewards section: reward templates with bindings (the narrator picks), values (the code picks) and a condition.
- `src/screens/dm/sections/exports.js`: The exports section: the fields each export shares with other data modules through its named public view.
- `src/screens/dm/sections/migrations.js`: The migrations section: additive migrations between state versions, and the check of a draft against an earlier pack.
- `src/model/safe-clone.js`: Bounded, getter-safe cloning of pack data under Story Block's limits.
- `src/model/references.js`: Typed pack references in traversal order, with pack-local names resolved.
- `src/model/references/lookups.js`: Place, item, race, talent and legacy-skill lookup tables used by reference indexing.
- `src/screens/cast/pieces.js`: Shared Cast fieldsets, hints and Story Block problem notes.
- `src/screens/cast/preview.js`: Player-facing preview of the Cast secrets.
- `src/screens/cast/form.js`: Cast one-undo edits, nested value writes and labelled controls.
- `src/screens/cast/identity.js`: Cast names, aliases, appearance, background and key fields.
- `src/screens/cast/behaviour.js`: Cast personality, levers, mannerisms and player-relationship fields.
- `src/screens/cast/portrait.js`: Cast portrait field, image fitting and snapshot picture handling.
- `src/screens/cast/story.js`: Cast start, drawn-to, meter, stage and unmet-death fields.
- `src/screens/cast/skills.js`: Cast signature-skill rows, ordering and checker notes.
- `src/screens/cast/secrets.js`: Cast secret cards, opening rules and the player preview.
- `src/studio/chrome.js`: Studio page shell with header controls, workspace columns, inspector, notices and overlays.
- `src/studio/events.js`: Page-level unload, Escape and dropped-file listeners, attached and removed as a pair.
- `src/studio/open-file.js`: JSON and zip pack reading with size, portrait and stale-read guards.
