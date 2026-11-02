# Story Studio: pack editor and creator kit

Story Studio edits world packs for Story Block and Story Director. It uses Story Block's own pack checker and
keeps the author's document detached from the checker's normalized runtime copy. The offline editor supports
places, routes, events, items, calendar, weather and data modules, plus the narrator, lorebook, screen and
code-module tools described below.

## Model, edits and history

`openPack(input)` returns a frozen document, validation results and an index of typed references. It rejects
unsafe or oversized input without executing getters. An untouched accepted text file exports byte for byte;
a modified valid document exports as JSON. Invalid safe drafts stay editable but cannot be exported.

`add`, `renameId`, `remove`, `setField` and `setSchemaField` return a new snapshot or a refusal. Rename follows
known references, and removal asks for an explicit cascade when other records depend on the target.
`createHistory` keeps snapshots for Undo and Redo. The development page in `src/dev.html` exercises the same
model and checker; the standalone editor is built with `npm run build`.

Use Node 24 and run `npm run check` and `npm test`. Browser tests need Chromium. Synchronize the runtime and
authoring kit with `npm run sync-sb -- --from <Story Block checkout>`; do not hand-edit those synchronized copies.
See [the application guide](STUDIO_PART2.md) and [the authoring kit](../authoring-kit/README.md).

## Timeline: events and lasting changes

The Events section is the Timeline (`src/screens/timeline.js`, form in `timeline-form.js`; the pure parts are under
`src/timeline/`). A pack event has an `id`, a `when` condition, the `cue` the AI is told once, and optionally `once`,
`after` and `then`; it has no name, so the form's name is the ID in words and renaming saves a new ID and moves
every `after` that points at it.

### The Timeline and the List

The Timeline groups events by the story year of their date on the pack's calendar (the year's era and number, and
"the story starts …" on the year the calendar starts in), sorted by date. An event that follows another (`after`)
sits indented under it, labelled "N days later" or "right after" (or with its own date when it has one). Events
without a date are listed last, under "Any date · by place only". Rows show the date, the name and chips (places and
regions, "once" or "every visit", "after: …"). The List switch shows today's plain list; both open the same form.
Packs and events load, show and export unchanged unless an event is edited.

### The condition

The form writes `when` in the one shape the pack's own events use, and reads it back (`src/timeline/condition.js`):

```
time() != null && time() >= <from> && time() < <until>        (a date, until optional)
time() != null                                                (no date; see below)
query('chronicle.passed', { name: '<world event>', minutes: <N> })   (at least N story minutes after it)
query('scene.place') != null && (query('scene.place').region == 'A' || query('scene.place').name == 'B')
```

joined with `&&`; no clause at all is `true`. An event with a Lasting change that another event counts days from
gets `time() != null &&` at the front (the form says "Waits until the story has a date"): Story Director stamps the
chronicle entry with the story's time when the event happens, and an entry stamped before the story has a date can
never have days pass after it. It is added and removed with the delay, in the same edit. A condition is read back only when writing what was read gives the
same text again, so anything else (another call, another order, other spacing) opens as "Written by hand: edit it
under Advanced" and is never rewritten by the form unless the author chooses "Use the form instead". A condition is
at most 500 characters (a pack's limit); the form says so when places make it longer.

Dates are story minutes on the pack's calendar (`src/timeline/calendar.js`): year 0, the first month, day 1, 00:00 is
minute 0; a pack calendar has no leap years, a pack without one runs on the Gregorian calendar with leap days.
Dawn, noon, dusk and midnight are 6:00, 12:00, 19:00 and 0:00, the Director's own. An "until" with no time of day
runs to the end of that day. A delay is days x 1440, hours x 60, months x the calendar's days per month x 1440 (the
common month length, else the rounded average; 30 without a calendar); it reads back in days, or in hours when that
is not whole days.

### Lasting change

Ticking **Add to Story Director's chronicle** puts `{ "command": "chronicle.lasting", "payload": { name, state,
place?, factions?, summary?, keep? } }` in `then`, beside any other steps. Limits (Story Director refuses more, so
the pack checker flags them in Problems): name 80, state looming, ongoing or resolved, summary 240, place 80, at
most 4 factions of 80 (none blank), keep true or false, and no other field; texts are measured after trimming, as
Story Director does. Story Director records which event wrote the entry; the story's own `world` lines can add to
its summary but not change its name or state.

Needs Story Director with world-event support; without it, this pack will not turn on and Story Block says why.
While any event has a Lasting change the pack lists `chronicle-lasting` under `requires.capabilities` (every edit
keeps that list right, and drops the name when no event has one), and Problems has a line saying so.

"N days after" is offered only when the earlier event has a lasting change, because the days count from when that
entry went into the chronicle; renaming the world event moves the events that count from it in the same edit. The
"When this fires" line says "N days after “X” happens" (the real date depends on when X happens). Problems, and the
event's row in the Timeline, warn when a condition waits for a world event that no event of the pack adds (the
Lasting change was removed or renamed by hand); the event then never happens unless the story adds that world event
itself. Under Where, regions are matched against the region the story names for the place, which can differ from the
region of the pack's place.

### Writing events with an AI

Studio never calls an AI or the network. **✦ Write with an AI** (beside **+ Add event**, opening in the inspector)
builds a prompt for the writer to paste into a chat of their own (`src/timeline/ai-prompt.js`, pure): the pack's
calendar and start, regions, the names in its lorebook, its existing events, the answer format and rules, the writer's
idea (at most 2,000 characters) and the full place list last. The same pack and idea give the same text; it is held to
24,000 characters in all by cutting, in this order, the place list (sub-places first), the events already there (their
count stays), the lore names, the regions and, last, months of the calendar, never the answer format, the rules or the
idea; the fold says what was cut, with the counts.
`docs/AI_PROMPT.md` is the prompt with blanks.

The answer is read by `src/timeline/ai-answer.js` (pure): tolerant of a code fence or text around the JSON, of one
event instead of a list and of month, region, place and alias names in any case; strict about what it writes. Each
event becomes the spec the event form uses (`writeCondition`, the lasting change's own limits through `checkLasting`,
the date guard through `settleGuards`), so a draft is what the form would have written. What cannot be written (an
unreadable date or month, an "after" that names no event, a delay on an earlier event with no lasting change) is left
out and said in the draft's notes; a field of the wrong kind (a date that is a number, `where` an object, `once` a
string) is a note too, never a quiet "any time", "anywhere" or once. A pasted answer is read up to 200,000 characters,
at most 30 places per event, news is cut at 500 characters (and says so), and nothing in it is ever turned into text
blindly. The rest is checked live by `draftProblems` (`src/timeline/drafts.js`).

A note belongs to the one field it is about (the date, the end, the event it follows, the delay, the places, "once", the
news, the lasting change) and lasts while that field is as it was read, so fixing one field never answers another; the
missing earlier event stays until the draft follows an event that exists. A note about something left out can be set
aside with its own button ("Right after is fine", "Not dated is fine", …), one undo step. An "after" that names an event
both the pack and the answer have follows the answer's own and says so.

A draft is `{ record, notes, seen }` (a note is `{ kind, text, seen, ack? }`) held beside the open project's snapshot (`draftsOf`/`withDrafts` in `model.js`): it
is no part of the document, the pack checker, Problems or the export. Snapshots made by an edit inherit their
predecessor's drafts (in `createHistory.commit`), so drafts follow undo and redo, are saved with the project in the
browser's draft slot and come back after a reload. The event form edits a draft through the pack with its drafts as
events after its own (`combinedModel`); the result is split back into drafts, so the pack's events are not touched
until **Keep**, which adds the event, settles the guard of the event it follows and refuses a result the pack checker
would flag. Adding drafts, Keep, Discard and Keep all are one edit each.

## Cast: the people of a pack

The **Cast** part (in the rail beside People / creatures) edits `content.cast`: people the story meets, each a prepared
dossier. The list shows a portrait, one line, where they start and chips (secrets, drawn to, portrait size). The form
follows the approved mockup: Who they are, Portrait, Where their story starts, Drawn to, Relationship at the start
(meter preset, starting values, stages, own fields), Before they are met, and up to eight Secrets with the player-view
preview (a blank bar and the rule for each hidden secret; an event's words are never shown). Every limit is Story
Block's (`CAST_LIMITS`, `PORTRAIT_LIMITS`, `ZIP_LIMITS`) and every problem message is the checker's own, shown under the
field and in the Problems list, whose "Go to" finds the field. Edits are single undo steps; a new person's key follows
their name until they are named once.

Portraits are image files beside the pack, not part of `pack.json`. Choosing one shrinks it in the browser (canvas, WebP)
until it is within Story Block's `PORTRAIT_LIMITS` (bytes, and `side` pixels on its long side, 600 where the vendored Story Block names none); a WebP, PNG or JPEG that already fits is kept as it is. The
pictures travel with each snapshot of the pack (`portraitsOf`, `withPortraits` in `src/model.js`), so Undo and Redo
bring them back with the edit that changed them, and the browser keeps the current set in IndexedDB so a reload brings
them back (`src/portrait-store.js`; without IndexedDB only the reload loses them).

**Check / export** lists the cast and portrait results (limits, pictures held, a place nobody can find, a missing
voice). A pack with a cast exports one `.zip` (`pack.json`, then `portraits/<file>` for each picture the cast names;
written in the browser with `CompressionStream`, stored when deflate does not help, no dependency) and, beside it,
"Export pack.json only". Open pack takes that `.zip` too, through Story Block's own reader
(`vendor/story-block/src/v2/packs/bundle.js`), so Studio and the game refuse the same zips.

## Part 3: character cards and lorebooks

Open `dist/story-studio.html` directly from disk and open the pack you are editing. The three authoring screens
run locally, inside that same file. No service, connection, runtime dependency, external image or installed
lorebook is consulted. Card/lorebook downloads do not mark unsaved pack edits as saved. Pack export continues
to use Story Block's checker and the existing lossless export path.

### Narrator card

Select **Narrator card**. Studio derives the name, description, creator and version from pack metadata,
the opening location from `start.scene.place`, and the opening date/time from `calendar.start` and its era.
The first message opens at that location and invites the reader to act. Missing location/time metadata is not
invented; a missing place is shown as a warning. The card's scenario and first message can be edited independently.

Edit **Card name**, **Description and Changes instruction**, **Tone notes**, **Start place and time**, and
**First message**. Additional card fields expose example messages, creator notes, system prompt, post-history
instructions, creator and character version. Tone notes use the V2 `personality` field; the current host pack
schema has no dedicated tone field, so ordinary packs start with empty tone notes. A safe draft's `toneNotes`
or text `tone`, when present, supplies that default. The JSON preview updates as you type.

The card name must contain non-whitespace text. Both JSON and PNG downloads show an `export-error`
notice and produce no file while the name is blank. Enter a name to enable a successful export.

**Download card JSON** exports `chara_card_v2`, version `2.0`, with the mandatory V2 fields, empty alternate
greetings/tags and an empty extensions object. **Download card PNG** contains the exact same UTF-8 JSON,
base64-encoded in a `chara` PNG `tEXt` chunk before `IEND`. The 128 × 192 book cover, stored DEFLATE scanlines,
checksums and metadata are produced locally without a canvas, compression library or network. The cover is
a placeholder; custom avatar import is outside this part. Identical pack data and edits yield identical JSON
and PNG bytes, with no timestamps or random IDs.

The default description copies the line shape, operators and five examples from
[Story Block SPEC §4.4](https://github.com/kohz87/Story_block/blob/708e2ae986361f1aa1ed27617c4957f95efe4343/docs/v2/SPEC.md#44-the-change-line-grammar):
`op kind Name[ — text][ | label: value]*`. It requests one `<Changes>` block at the end of a reply when
something changed and only kinds supplied by installed suite modules. The examples demonstrate syntax;
they do not add those example records to the pack or lorebook. Per-module kind instructions still come
from the installed suite. No new change-line protocol is introduced.

Card edits survive navigation during the current session. **Reset card from pack** discards overrides and
uses the current metadata again. Opening another pack or reloading the page clears card edits. Download the
card before closing; card edits are separate from the pack's saved draft and Undo history.

The output follows the [Character Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)
and SillyTavern's [PNG metadata reader](https://github.com/SillyTavern/SillyTavern/blob/release/src/character-card-parser.js).
Import the JSON or PNG through SillyTavern's character importer.

### Lorebook export

Select **Lorebook**, inspect the per-record previews, then **Download World Info JSON**. Import this file
through SillyTavern's World Info editor. The native `entries` object follows SillyTavern's
[World Info implementation](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/world-info.js).

Studio emits one entry per record in `content.places`, `content.factions`, `content.npcs`, `content.creatures`
and `content.items`, in that fixed kind order and each collection's authored order. Keys are the record name
followed by distinct aliases. Content consists of labeled string fields, string arrays and nested text fields,
sorted by field name; a place's region is included. IDs, pack wrappers and aliases are excluded from content,
and numeric mechanics are not turned into invented prose. References are never followed. Quest givers,
start-scene names, installed lorebooks, other packs and external NPC references do not create extra entries.

Entries use sequential numeric UIDs/display indices, keyword activation, order 100, insertion before the
character, probability 100%, whole-word matching and no recursion. Each has a `story_studio` kind hint in
`extensions`, used only to suggest a draft type on reimport. Empty packs export an empty `entries` object;
malformed records produce a visible export refusal rather than silently disappearing.

The pinned host schema has no dedicated `factions` or `npcs` content collections. If they exist in a safe
invalid draft, this lorebook exporter includes their authored text; the ordinary pack checker still reports
those unsupported collections. Studio does not alter the vendored schema or fabricate lore for absent records.

### World Info import and draft review

Select **Import lorebook** and choose a World Info JSON file. The importer accepts a native `entries` object
or array, up to 1,000 entries and 2 MiB of UTF-8 JSON; a leading byte order mark is accepted. Parsing creates
review drafts only. Nothing changes in the pack until **Accept draft** is clicked for that entry.

For each entry, inspect the source comment and choose **Place**, **NPC / creature**, or **Item**. Edit its
name, record ID, aliases, text and (for a place) region. A primary key supplies the initial name, falling back
to the comment when absent. Secondary primary keys become aliases. The full content is kept as draft text;
Studio does not execute scripts, expand macros, or apply World Info activation settings. A Studio kind hint
suggests the matching type; otherwise the default is Place and the author chooses. There is no semantic
classifier or automatic merge.

**Accept draft** adds one record through the existing edit/history engine. Places get neutral coordinates
`0, 0`; items start as common, stackable goods with value 0. Duplicate IDs are refused, leaving the existing
record untouched. Long text, names, aliases and region values are refused under host limits; text is never
silently shortened. In particular, place/item note text must fit 500 characters. Edit the draft explicitly or
skip it. Malformed entries have individual visible refusals; valid neighboring entries remain reviewable.
Malformed/unsafe/oversized files show an import refusal and preserve the current pack and review queue.

NPCs use narrative `content.creatures` drafts with name, aliases and note. Accepted entries use the same
checker as the rest of the pack and can be undone.

**Skip entry** leaves the pack alone. The decision list retains accepted/skipped/refused states and refusal
messages; select a refused entry to edit and retry. Decisions record review actions, so Undo restores the pack
without rewriting that decision history. Opening another pack or reloading clears the review queue; accepted
pack edits remain in the normal saved draft and can be undone/redone during the session. All imported labels,
comments and text are rendered through text nodes or form values, including HTML-like input.

### Verification

`npm run -s build` rebuilds the single-file distribution. Run `npm run -s check` and `npm run -s test:dot`
before committing. The Ersveil source fixture is unchanged. Reviewed golden exports live in
[`tests/golden/ersveil-narrator.json`](../tests/golden/ersveil-narrator.json) and
[`tests/golden/ersveil-world-info.json`](../tests/golden/ersveil-world-info.json); tests compare exact bytes.
PNG tests independently check chunk CRCs, inflate the image and decode the UTF-8 card metadata. Tests cover
determinism, local-only records, all import types, refusal isolation, duplicate protection and unchanged packs.

[`tests/authoring-browser.test.js`](../tests/authoring-browser.test.js) exercises all three flows from the
distribution on a `file:` URL, blocks every other request, checks literal hostile-text rendering and collects
page/console errors. It also checks that the browser decodes the PNG, that imported drafts undo correctly,
and that card/lorebook export does not clear unsaved pack edits. Screenshots are written to the ignored
`artifacts/part-3/narrator-card.png`, `artifacts/part-3/lorebook.png` and `artifacts/part-3/lore-import.png`.
Set `STUDIO_SCREENSHOTS_DIR` to change that directory, or `STUDIO_CHROMIUM_PATH` to use an existing browser.

## Known issues

- Narrator card drafts disappear on page reload; download the card before reloading.
- Lorebook review decisions stay “accepted” after Undo removes the accepted record from the pack.
- Switching presentation records silently discards unapplied form drafts.
- Packs cannot supply per-module settings defaults.


## Part 4: settings defaults and screen builder

**Settings defaults** shows the pack boundary for each suite module. The pinned Story Block importer
accepts **zero per-module settings defaults**: `PACK_FIELDS` contains no `settings`, `defaults`,
`settingsDefaults`, or `moduleSettings` transport. Consequently there are no pack-settable module setting
names, types, ranges or host defaults to list. The screen makes this explicit for Story Block,
Story Director and NPC State Delta, and displays the importer's `UNKNOWN_FIELD` refusals for proposed JSON.
Checking a request never changes the document, history, saved draft or export. Reader-only settings cannot
be shipped by renaming them, adding an extension field, or embedding executable code.

Existing pack-supported economy, currency, calendar, weather, start state and other world fields
continue to be editable under **Pack settings** and the existing record editors. For example, the supported
`economy.scale` is a number from 0.001 to 1000, default 1; it affects built-in money defaults across the
suite and is distinct from the reader's settings object. Part 4 adds no new pack schema or module settings.

The first card of **Pack settings**, "Stat formula", sets which formula the story plays on (`content.rpg.formula`):
Reader's choice (the field is absent and the reader decides), Standard or Classic. It writes through the same edit
pipeline as every other screen (Undo, Redo, Check, export). The other `content.rpg` fields (`skillSets`, `numbers`)
are kept, an empty `content.rpg` is dropped, and the JSON card for `content.rpg` stays below it.

The vendored host and the authoring kit are synchronized from Story Block using the documented transport.

### Author screens and layouts

Select **Screen builder**, then **Screens** or **Layouts**. Choose an existing record, or **New screen** /
**New layout**. Screen ids may name a module screen to restyle it, such as `example-module/overview`.
New screens bind `data.place` to Story Block's `scene.place` for their initial `q.place.name` template.
All ten host `SCREEN_FIELDS` are covered:

| Field | Editor |
|---|---|
| `id` | Text; checked by the importer, including pack-local duplicates. |
| `title`, `icon` | Text; the importer checks the 80-character bound. |
| `mounts` | Checkboxes for `tab`, `screen`, `card`, `hud`, `dialog`. Existing duplicates/order remain until explicitly edited. |
| `template` | Live HTML-template source with an element and widget palette. |
| `layout` | JSON plus a form for the layout nodes. |
| `css` | CSS source, using host scoping/filtering in preview. |
| `theme` | Custom-property JSON. |
| `data` | Named-query JSON plus a documented-query palette and alias/args controls. |
| `steps` | Dialog-step JSON; **Preview source** switches between the screen and each step. |

Optional fields stay omitted until edited; **Omit** removes a field explicitly. **Whole record JSON**
retains unknown keys and gives a repair path for shapes the form cannot represent. Use **Use record JSON**
to transfer that text into the form draft. No unknown key or malformed value is silently dropped.

**Apply screen** / **Apply layout** validates the complete candidate pack with the vendored `validatePack`.
A refusal shows the host's exact code/path/message and preserves the previous pack, Undo/Redo and saved
backup. Invalid JSON fields also block Apply. **Discard draft** returns to the saved record.
**Delete record** removes that record in one history step. Successful applies/deletes use normal history,
autosave, dirty tracking and pack export. Opening a different record, discarding, Undo/Redo, or loading
another pack resets its form draft. Form drafts and sample data are session-only until Apply; they are
not included in exported packs or automatically restored after reload.

The node form uses the host's `NODE_TYPES` catalogue: `box`, `row`, `col`, `grid`, `text`, `meter`, `list`,
`image`, `badge`, `button`, `tabs`, `when`, plus the 18 standard widget types. Choose a node, change its
type/fields, add children/pages, or use **Use node JSON** for an arbitrary node. Changing a type explicitly
replaces that selected node; other nodes remain as authored. JSON fields handle bindings, props, payloads
and theme tokens. A new `button` in a list's item drops one of the row's item (`inventory.drop`, the list
starting on `inventory.items`); elsewhere it has no command until one is chosen. **Reader command** offers only
the commands a reader's button may run in the suite (`UI_COMMANDS`: drop, equip, unequip a row's item); a
command that makes items or money, such as `inventory.grant`, is refused from a button and is not offered.
Another module's command is typed into the node's `command`. All top-level layout object keys remain available through whole-record JSON.

Pack validation accepts `layouts` as a list of safe plain objects, and a screen's `layout` as a safe plain
object. It does **not** enforce the renderer's node schema. The builder preserves that distinction:
**Accepted by Story Block** describes importer acceptance; preview warnings can still explain an unknown
node, missing root, unknown widget or other renderer restriction. Those warnings do not block an otherwise
host-valid export. Similarly, template compiler warnings never become extra pack-validation errors.

### Preview and palettes

The preview first runs Story Block's `validateScreen` and `resolveData`, then its `createScreenRenderer`.
Runtime screen refusals (including duplicate template/layout bodies and cyclic or unknown aliases)
leave the preview empty and show the host's diagnostics, independently of pack-importer acceptance.
The renderer owns the layout envelope (`{ id: screen.id, root, theme }`), layout validation and
`layoutEvaluator`, which receives the original state document and requires a boolean `true` result.
Nested layout metadata is ignored exactly as in the host. Standalone layout records are given a local
screen wrapper with their id and a tab mount. Template rendering uses the host's binding scope. This includes
`data-if`, array/record `data-each` with index names, `{{ }}` interpolation, own-property path lookup,
helpers, `data-bind`, bound attributes/variables/classes, widget props, draft inputs and dialog-step templates.
The host's strict sanitizer and rendering budgets apply. Malformed expressions produce host warnings.
No author JavaScript is evaluated.

The template palette provides plain elements, condition/repeat fields, every standard `ss.*` widget,
and the queries the suite's modules answer (`QUERIES`, under the module that answers each; a test checks
Story Block's against the vendored host). Widget prop types/defaults come directly
from each vendored widget's `props`. Query names, owners and descriptions appear in the picker. A query
alias already in `data` is visibly refused; it is never overwritten. Other module widgets and query names
can be authored in source/JSON without an extra Studio allow-list; an unavailable widget reports a preview
warning. The palettes are examples, not a claim to include every installed module's private registry.

**Sample data JSON** contains `state` (the full state document with `domains`), `draft`, `settings`, `ops`
and `queries` (results keyed by query name). Only the screen's declared `data` bindings populate `q`;
sample `q` values are ignored, and a missing binding reads blank as it does in Story Block. The host
resolves alias dependencies and substitutes arguments. Arguments are authored/exported unchanged; the
offline query stub supplies one answer per query name, independent of args, or null when absent.
Bindings read sample data only.
Money/time use the host's deterministic fallback formatters, rather than simulating installed modules.
Malformed sample JSON shows a local refusal and retains the last valid sample.

Preview lives in a separate iframe document with scripts disabled. Templates are compiled with the host's
strict allow-list, then constructed through DOM methods and text nodes. The iframe isolates author CSS
from the editor. A guard on its DOM resource writes rejects external `src`/`href`, including dynamic
bindings, SVG images and widget portraits, before the browser can request them. Raster data images and
fragment references are local. Resource-bearing inline styles/variables are omitted; a stylesheet containing
resource loaders is omitted as a whole with a warning. Authored source remains unchanged. Links cannot
navigate, forms cannot submit, and game commands return a visible **Preview only** refusal. Widgets may
edit the local draft, but no game, module, network connection or host application is invoked.

### Preservation and proof

Unedited source text, including the Ersveil fixture, still exports byte for byte. Presentation edits preserve
all unrelated raw authored subtrees, omitted defaults, key spelling/order and array order. Undo returns
the exact prior snapshot and original source bytes. Preview, settings probes, card/lorebook export and
refused applies never edit the pack. The single offline HTML has no network loader, dependency on sibling
checkouts or runtime build step, and uses no HTML injection APIs or executable expressions.

[`tests/presentation.test.js`](../tests/presentation.test.js) compares accept/refuse results and exact
error arrays against the vendored importer for every screen field, code/name/id limits, loops, steps,
CSS/theme safety, open layout objects, and unsupported settings transports. It also covers Ersveil
preservation/history and escaped palette snippets. Some importer-accepted inputs are intentionally only
renderer warnings (e.g. an encoded attribute spelling); preview still sanitizes them.

[`tests/presentation-browser.test.js`](../tests/presentation-browser.test.js) runs against the committed
single-file distribution on a `file:` URL at 1280px and 390px. It checks actual host rendering, widgets,
conditions/loops, literal hostile data, resource suppression before requests, inactive commands, palette
and step controls, refusals, layouts, history, reload and byte-identical Ersveil exports. Every unexpected
request and every page/console error fails the test. These tests run in `npm test` with the existing
parts 2.5/3 browser suites; none are skipped when a browser is missing.

[`tests/preview-parity-browser.test.js`](../tests/preview-parity-browser.test.js) drives both the vendored
host registry/mount/renderer and Studio's preview in a real browser. It compares missing/declared query
bindings, duplicate bodies, cyclic/unknown aliases, strict layout conditions with the original state,
and layout envelope id/root/theme handling despite empty or unknown nested metadata. Each case also
checks pack-importer acceptance, zero unexpected requests and zero page/console errors.

From a lone clone: `npm ci`, `npx playwright install chromium` (or set `STUDIO_CHROMIUM_PATH` to an existing
Chromium), `npm run -s check`, then `npm test`. A clean clone already contains the built distribution and
vendored host. For a reproducible rebuild, run `npm run -s build` twice and compare the SHA-256 of
`dist/story-studio.html` and `src/assets/drawings.js`; finally run `git diff --check`.

## Part 5a: data module authoring

**Data modules** (content navigation, between Screen builder and Narrator card) edits `content.dataModules`, the
closed JSON definitions described in Story Block's `docs/v2/DATA_MODULES.md` (§8 and the approved decisions win over
anything earlier in that document). Studio edits and explains; Story Block checks and runs.

### One schema, in Story Block

All data-module knowledge reaches Studio through one adapter, [`src/data-modules/sb-adapter.js`](../src/data-modules/sb-adapter.js),
over [`sb-backend.js`](../src/data-modules/sb-backend.js), which imports only vendored Story Block code:

| Need | Story Block code used |
|---|---|
| Verdict on every candidate and on Apply/export | `validatePack`, the importer with its data-module checker |
| Controls, key lists, operator arities, adapters, pickers | `DM_DESCRIPTORS` |
| Budgets shown beside the forms; code explanations | `DM_LIMITS`, `DM_DIAGNOSTICS` |
| Additive migration comparison | `validateDataMigration` on two checked definitions |
| Narrator grammar text | `grammarFor` of the data-module part, on a pin built from the checked definition |
| Simulator (store, bus, capture, timers, replay) | the runtime itself: `createRuntime`, the real store and command bus on a fake SillyTavern (`testkit/fake-st.js`), the data-module part and interpreter |

Studio contains no validator and no interpreter. The forms are built from the descriptors, so a limit, an operator or
a key Story Block adds or drops follows after the next `npm run sync-sb`. What stays in Studio is presentation only:
control grouping, slot types for choosing a control and the labels in [`hints.js`](../src/data-modules/hints.js).
`sync-sb` also copies Story Block's data-module fixtures (the two worked examples and one refusal vector per `DM_*`
code) into `vendor/story-block-fixtures/`, so the parity tests run from a lone clone. The vendored runtime is the
finished `stage6/data-modules` runtime; `vendor/story-block/VERSION` names the commit.

A copy that cannot check data modules (an older sync) shows "This needs Story Block with data-modules-v1", keeps the
record as a safe invalid draft and never claims a pass. A copy with the checker but no runtime shows "This needs Story
Block with the data-modules runtime" in the Simulator and has no generated grammar; the preview then reads the
declarations itself. Both states are reached in tests with a clearly named test-only backend
(`tests/helpers/dm-backends.js`, built into a separate page by `dm-waiting-dist.js`); neither is in `src/`.

### The forms

One draft record per module edits in place; Story Block's verdict (its exact codes, paths, messages and order, at most
20) is shown live after each change and again on **Apply module**, which is a single undoable edit. A refused Apply
leaves the pack and its history untouched, shows the standard refusal notice and keeps the draft. A draft survives
switching sections, modules and screens for as long as its saved record is unchanged.

Sections: identity/version/scope; typed fields (int, bool, enum, text, map with fixed keys) with bounds and defaults;
imports from the published adapters only (Story Director minutes and actors, another data module's named export);
local kinds (line op, typed labels, once-per-reply claims, `when` with refusal text, effects); rules; reward templates
(value ranges with min/max/midpoint pickers or a range table per enum binding, bindings, effects, offer condition);
timers; exports; additive migrations; screens and layouts. Names that are renamed or removed go through the typed
reference index (below), never a text replace. Studio offers no v1.1 feature: checks (`check:`, the `check` expression)
and `grantCoin`/`grantItem`/`grantXp` are shown only to be refused. Story Block's checker already refuses them with
its own "needs data-modules v1.1" diagnostic and that exact verdict is shown; only a copy that cannot check at all gets
Studio's fixed refusal of the same words.

**Expression editor.** An expression is never typed as text. Each operator has a picker with fixed arity and typed
slots (field path with map key, line label, reward binding or value, import alias and field, literals typed by slot,
nested expressions). A value the forms cannot represent (an unknown operator, a wrong-arity array) is shown with a
warning, not dropped.

**Record JSON.** The whole record, including keys the forms do not show, lists those keys under "Not shown in the
forms". *Use record JSON* replaces the draft with what you typed; unknown keys stay in the draft (and in Story Block's
verdict) until you remove them, and a record that is not a JSON object never reaches the draft.

**Narrator grammar.** Beside the forms, each kind shows its line shape using decision 6's short module reference
(the bare slug) when the slug is unique in the pack and the full `pack.<id>/<slug>` ID otherwise, its once-per-reply
rule, its labels, its refusal condition, a valid example (with *Use in simulator*) and lines that must be refused
(`DM_LABEL`/`DM_BOUNDS`). Above them the text Story Block itself generates for the module is shown. Uniqueness is
judged within the pack; Story Block judges it among a chat's active pins.

**References.** Targets are module, export, field, map key, reward template, import alias, line label, binding and
reward value. The index records each reference by position (a path into the pack and how to rewrite it), including the
bindings in this pack's screens and layouts. Rename rewrites every position and Remove is refused while anything still
refers to the target, listing where. An enum value that spells a field name is not a reference.

**Migrations.** *Add a field with a migration* adds a field and its adjacent additive step. *Check against an earlier
version* takes the previously published pack JSON and asks Story Block (`validateDataMigration` on the two checked
definitions) whether the draft is an additive migration of it, returning Story Block's exact diagnostics, so an
incompatible change is explained before export.

**Screens.** Pack screens and layouts attach to a module as copies, a generated starter screen binds every field
through `dataModules.view`, and the preview reuses Part 4's isolated, script-disabled renderer with sample data from
the module's defaults. Module presentation mounts only with the module's pin (Story Block).

### Simulator

[`sb-sim.js`](../src/data-modules/sb-sim.js) builds a whole Story Block host on a disposable in-memory chat, installs the
candidate pack (the saved pack with the open draft substituted), pins the module as Setup does (dependencies from the
same pack first, attached characters for a character module) and plays the scenario's replies through the real capture
path. Inputs: attached characters, starting story minute, and the steps: a reply (`<Changes>` text), a Continue of the
reply above, or a time advance (narrated as `! time +Nm`). Output per step: parsed lines, refusals with Story Block's
code and reason, notes such as "Requested -60; applied -6 (0/100)", field changes, the reply-card text and timer
cursors; for the run, final fields, budget usage and a comparison of the live state with a cold rebuild from the saved
chat, both with saved checkpoints and with later checkpoints stripped, including the reported Problems. Short scenarios
use the real store options `checkpointEvery: 2` and `receiptKeep: 3`, matching the testkit contract. *Delete*, *Re-read*
(edit then Story Block's re-read), *Swipe* (the latest reply) and *Reload* (reopen the saved
chat) show what Story Block does, including blocks it skips with `REPLAY_PREREQUISITE`; each reports which steps
changed status. **Each what-if starts from the scenario as written** (the baseline saved by *Run simulation*), rather
than building on the previous what-if. Delete, Re-read, swipe and reload are independent comparisons with that baseline.
Studio derives trace rows from the current host Sources, capture results and surviving receipts,
composes net field diffs for display, and checks final-state cold replay equality without claiming per-line diffs or
host-authored card text. Step boundaries use each receipt's revision operation position, including the reply's
afterCapture and beforeGenerate timer hooks. Each boundary is a separate immutable copy of fields and timer cursors;
a Continue never changes an earlier step's snapshot.

The vendored runtime is the finished `stage6/data-modules` at `be84639` (see `vendor/story-block/VERSION`). Pinning reads
`dataModules.setup` and passes its `module`, `hash` and `packHash` to `dm.pin`, with attached actor IDs as `subjects`.
Snapshots use `dataModules.view`; cross-module imports are resolved by the runtime's `dataModules.public` projection.
The host also exposes `dataModules.offers`, `dataModules.presentation` and `dataModules.actors`, and the reader commands
`dm.attach`, `dm.act` and `dm.migrate`. Scenario lines go through normal capture; Studio never calls internal `dm.capture`
or `dm.tick` directly. The simulator actions remain Delete, Re-read, Swipe and Reload.

Conditions are recorded as answers in this runtime. Deleting example A's second gain retracts its +3 and title, while
the later Watch loss stays active because its rule answer is unchanged. Deleting the first gain makes only the second
gain inactive (`REPLAY_PREREQUISITE`); Watch still reaches -5. A condition that changes its answer invalidates its action.
The unpinned `dm` capture kind is undeclared (`UNKNOWN_KIND`), as are other kinds or queries with `enabled: false`.

Every write now witnesses its original destination, including no-op sets, clamped adds and clamps; repeated writes keep
the original prefix witness. Clock and actor imports remain live prerequisites even in recorded mode. Public imports
witness export and subject availability, and modules with eligibility expressions also witness projected public values
(including eligibility reached through writes or reward bindings). The simulator delegates all these decisions to the
runtime; its regression tests delete source replies and assert the resulting fields, inactive actions and cold replay.

There is still no data-module `hooks.replyCard` or card-text query in the finished runtime. `summaryOf` is the current
state for the prompt tail, not a reply's changes. Studio therefore composes the reply-card field diff and uses the exact
runtime refusal reasons and clamp notes. `testkit.createHost({ storeOptions })` still uses computed dynamic imports for
the store and command bus: they survive bundling and fail the distribution's loader scan. The simulator retains the
small static host wiring around the real `createRuntime`, store and bus. Tests compare it with `createHost` at the same
checkpoint/receipt thresholds and prove the computed imports still survive bundling; remove the duplicate when that changes.

Story Director's story time and actors are published, state-only contracts the data modules read. Studio is offline and
has no Story Director, so the simulation registers a small sample owner of exactly those two projections
([`sim-director.js`](../src/data-modules/sim-director.js)): a narrated `! time` line moves its clock inside the same
reply, so timers see a new prefix rather than a stubbed answer. It rolls nothing and checks nothing, which v1 modules do
not need; the seed is kept in the scenario for v1.1 checks. A simulation never edits the pack or history, prints no
Story Block warnings to the console, and is repeatable.

The runtime is bundled into the page, which grows the single file to about 1.4 MB. Story Block's `sdk.js` awaits an
optional import at module level, which a classic script cannot do, so `scripts/build.mjs` bundles as ESM, drops the
entry's unused trailing export, wraps the code in an async function and proves by compiling (not running) it that it
is a classic script. The page is still one inline classic script. The static scan of the finished page
([`scripts/dist-scan.mjs`](../scripts/dist-scan.mjs), run by the build and by `tests/build.test.js`) has no exemptions.
Before bundling, [`scripts/offline-runtime.mjs`](../scripts/offline-runtime.mjs) replaces the chat-file request and branch
loader defaults with throwing offline shims; synchronized vendor files remain untouched. Tests invoke each default and
prove it throws without a request or module load. The scan rejects any remaining network or loader reference, including
executable bypasses. The page also has `connect-src 'none'`, and browser tests fail on any request.

### Guarantees kept

An untouched pack, data modules included, exports its original bytes; Apply and Undo restore them. The build is
deterministic (build twice, same hash), the page makes no requests, and every piece of author text reaches the page as
`textContent`, a form value or an attribute value. Every rejected edit goes through the shared refusal helper.

### Tests

- [`data-modules-forms`](../tests/data-modules-forms.test.js), `-edits`, `-refs`, `-grammar`: forms, drafts, typed
  references, grammar and v1.1 handling.
- [`data-modules-adapter`](../tests/data-modules-adapter.test.js): the adapter returns Story Block's objects, the
  waiting states, the migration comparison.
- [`data-modules-parity`](../tests/data-modules-parity.test.js): for both Story Block worked examples and every
  refusal vector, Studio's verdict (open, edit, check) equals the importer's, with exact error arrays, and the
  limit boundaries agree. The finished checker's label-data and closed `dm.act` template payload cases run through
  the same paths. The upstream `unused-baseline.json` is a replay trace, kept beside the fixtures but not opened as a pack.
- [`data-modules-simulator`](../tests/data-modules-simulator.test.js): the simulation on the real runtime reproduces
  the design's numbers (example A Guild 0, 3, 6 with the title and Watch -5; example B 12/0, 16/2, 0/2, the 59/60/61
  minute boundaries and remainders), refusals (`DM_LABEL`, `CLAIMED`), delete/Re-read/Swipe/Reload what-ifs,
  `REPLAY_PREREQUISITE`, two modules in one pack, request errors, no side effects and repeatability.
- [`data-modules-witnesses`](../tests/data-modules-witnesses.test.js): deleting source replies retracts no-op writes
  and rewards, clock-gated kinds/rules/rewards and public eligibility in both import modes, including eligibility through a write;
  repeated writes retain their original prefix. Every scenario also checks cold replay.
- [`data-modules-browser`](../tests/data-modules-browser.test.js): the shipped page at 1280px and 390px, plus the
  waiting-state page. Both worked examples are authored end to end through the forms and expression editor (screens
  through the JSON repair view) and the exported modules equal Story Block's fixtures exactly; then the real simulator
  runs them in the page. Also unknown-key drafts, refused Apply, v1.1 refusals, typed rename/remove with Undo,
  cross-module imports, migrations, hostile text, the simulator controls, and zero requests or page errors.

### Known issues (part 5a)

- The sample Story Director publishes only time and actor identities. A pack needing another owner's data (Story
  Director checks, coin, items, experience) is v1.1 and refused.
- A step's field changes are the net change of the reply; two writes to one field in one reply show as one.
- Short-reference uniqueness is judged within the pack; the host judges it among a chat's active pins.
- Setup (enable, attach, migrate) and the replay engine are Story Block's; Studio authors definitions only.
- There is no undo inside an unapplied draft; *Discard draft* drops all of it, and Undo after Apply reverses the whole edit.
- Screens in a module are copies. Editing the pack screen afterwards does not update the module's copy.

## Part 5b: code modules

The **Code module** section (rail, after Data modules) writes a starter SillyTavern extension that is a real Story Suite v2
module. The author fills one form, downloads a zip, runs `git init` and `npm test` in the unzipped folder, installs it and
grows it. Everything runs in the page: no network, no model call. The section works with or without a pack open and never
reads or changes the pack, its history, its saved draft or its dirty state. The draft is session-only, like the narrator card.

What the form makes (`src/code-module/`, `src/screens/code-module.js`):

- **Inputs.** The 18 keys of part 5b section 3.2 and their rules: identifiers narrower than Story Block's, display text
  limited to letters, digits, spaces and a few marks, whole numbers from -1000000 to 1000000, and the reserved names of
  Story Block and the other Story Suite modules. Every message and rule is copied from section 5. Tests:
  `tests/code-module-inputs.test.js` (every bound on both sides, the exact error list of each named case, reserved names,
  forbidden Name characters, `jsString` and `mdText`), `tests/code-module-templates.test.js` (the 21 SHA-256 values of
  section 4.3).
- **Nine written files:** `.gitignore`, `README.md`, `index.js`, `manifest.json`, `package.json`, `src/module.js`,
  `src/parts/<state name>.js`, `tests/module.test.js`, `tests/vendor/README.md`. They are rendered from eleven templates in
  `src/code-module/templates/`. Tests: `tests/code-module-generate.test.js` (the golden inputs give the nine golden files
  byte for byte, compared with `Buffer.compare`; the variants leave no placeholder), `tests/code-module-render.test.js`
  (`renderTemplate` refuses unknown names and keeps values unscanned).
- **The module it writes** registers with Story Block through `StoryBlock.ready`, declares one state field with a
  validator, one narrator line (its number cut by code), one guarded command, one query, an optional tab screen and an
  optional capability. Its own six tests pass in a temp folder for the golden inputs and two variants, and for the golden
  scaffold unpacked from the zip. Tests: `tests/code-module-run.test.js`. On Studio's vendored Story Block host it registers
  with no problem, warning or refusal, its line is cut and claimed once per reply, its guard holds live and goes off when
  the reply it needed is deleted, and a guard that asks an undeclared query fails the command with Story Block's sentence.
  Tests: `tests/code-module-host.test.js`.
- **Copied Story Block files.** `tests/vendor/story-block/` holds Story Block's testkit and the runtime it imports, taken from
  Studio's own vendored copy (`vendor/story-block/`, Story Block 2.5.0, commit `899a3ee`), with `VERSION`, `package.json`, and
  `tests/vendor/LICENSE-story-block` (Studio's root `LICENSE`, AGPL-3.0). `tests/vendor/README.md` says how to refresh them.
  The copied set is 128 files: the 125-file testkit closure plus `VERSION`, `package.json` and the licence. The generated module
  `src/code-module/assets.js` is written by `scripts/code-module-assets.mjs` (also called by `scripts/build.mjs`) and is checked
  against the generator by `tests/code-module-assets.test.js`; the CI artifact check covers it.
- **The zip.** Entries are STORED, sorted by path, with fixed times and attributes, so the same inputs always give the same
  bytes. The writer refuses bad paths, duplicate paths, more than 65,535 entries and 4 GiB or more. Tests:
  `tests/code-module-zip.test.js` (every field of section 3.9 read back, CRC-32 equal to `zlib.crc32`, the refusals,
  determinism). `unzip -t` and `python3 -m zipfile -t` both accept a sample zip written by the writer (checked by hand while writing M3). Those two checks are manual and are not part of `npm test`.
- **Timing.** On the golden inputs `generateScaffold` took 0.17 ms and `scaffoldZip` 292 ms in Node 22 when measured for M5 (the
  spec records about 1.1 s under full-suite load). The tests assert under 50 ms and under 5 s; the logged target for the zip is 2 s.
  Test: `tests/code-module-generate.test.js`.
- **The section in the page.** The form, the live file list, the part-file viewer, the per-field errors, "Ready" and "Not ready",
  and the notice bar on a refused Download are built with `createElement` and `textContent` only. Focus stays in a field while
  typing. A download leaves the pack's Undo and the header Export button as they were. Tests:
  `tests/code-module-browser.test.js` (at 1280 and 390 px; the existing browser suites pass unchanged).
- **Size.** The single-file build grows from 1,396,934 bytes to 4,576,312 bytes (about 4.6 MB), and still passes the
  static scan with no exemptions. Tests: `tests/build.test.js` (one classic script, scan clean, two builds identical, and under
  5 MB: `assert.ok(Buffer.byteLength(html) < 5_000_000)`).
  The golden zip is about 2.4 MB, with 9 written and 128 copied entries.

Proof, by file: `tests/code-module-templates.test.js`, `-inputs`, `-zip`, `-assets`, `-generate`, `-render`, `-run`, `-host`
and `-browser`, all in `npm test`. None of them skips when Chromium is missing.

Known issues (part 5b, the answers to section 11 and the limits that remain):

- The single file is about 4.6 MB (section 11.1, accepted as recommended). It still opens from disk and stays one offline file.
- The zip carries Story Block's AGPL-3.0 testkit under `tests/vendor/` with its licence and the Phosphor MIT notice, and
  leaves the module's own licence to the author (section 11.2, accepted). The README the scaffold ships says so.
- The starter has one state field, one narrator line, one command and one query (section 11.3, accepted). Several fields and
  parts are left to a later part; the scaffold's README says how to add a part.
- Drafts are not kept across reloads, and generating from a data module is not offered (section 1.2).
- The copied testkit is Story Block 2.4.0. Refresh it with `npm run sync-sb` and regenerate `src/code-module/assets.js`
  (`node scripts/code-module-assets.mjs`); the generated tests then check the new copy.
- The scaffold's own tests need Node 22 or later. Its `tests/vendor/` is not run by `npm test`.

## Draft with your own AI (the authoring kit)

Studio has no AI page, takes no keys and makes no requests. A creator who wants an AI to draft a pack from their lore uses
their own coding agent or chat with the **authoring kit** in `authoring-kit/`: prompts for each step of a rules pack and of a
data module, standing instructions for the agent (`AGENTS.md`), the format references, and a checker. Start at
[`authoring-kit/README.md`](../authoring-kit/README.md). A pack the kit's checker accepts opens in Studio, and a pack Studio
accepts passes the kit's checker: both run Story Block's own `validatePack`.

- **Where it comes from.** The kit lives in Story Block (`authoring-kit/`) and is copied here by `npm run sync-kit`. Nothing in it
  is edited by hand. `authoring-kit/VERSION` names the Story Block commit and lists the SHA-256 of every file; the copy is exactly
  the files Story Block has committed in that folder. `authoring-kit/work/` is the creator's (lore and drafts): the sync never
  removes or overwrites anything in it and copies nothing from Story Block's `work/` except its README.
- **One rewritten line.** The kit's scripts find Story Block's code through `authoring-kit/scripts/sb-root.mjs`. In Story Block that
  is the repository's `src/v2/`; the sync rewrites that one line so the copy here runs against `vendor/story-block/`, the same code
  Studio checks with. `authoring-kit/check.mjs` therefore agrees with Studio's Problems list by construction.
- **In the page.** The empty editor and Pack settings each show one line of text, "Draft with your own AI: see
  authoring-kit/README.md in this download or repository." It is plain text (`src/draft-hint.js`): no link, no request.
- **Tests.** [`authoring-kit`](../tests/authoring-kit.test.js) fails when the copy drifts from its stamp (a changed, added or
  removed file), when the stamp is not a commit, when the checker disagrees with Studio's own verdict on the kit's example
  packs, when `reference/LIMITS.md` or the schema differs from the vendored Story Block, or when the hint is missing or
  not offline. Story Block's own test checks the original (prompts quote Story Block's current numbers, the references equal
  what it ships).
