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
- `src/screens/pack-settings.js`: Pack settings screen with the stat-formula picker and JSON editors for host and content fields.
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
