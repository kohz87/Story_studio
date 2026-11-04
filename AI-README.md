# Story Studio: facts for AI assistants

Read this first if you are an assistant working in or about this repository. Human readers: see [README.md](README.md).
Rules for changing code are in [AGENTS.md](AGENTS.md).

## Purpose

- Story Studio 0.9.0 is an offline, single-file pack editor and creator kit for the Story Suite (SillyTavern extensions).
- It opens, edits, checks and exports world packs (`pack.json`, or a `.zip` with portraits). It is not an extension and not a reader.

## Suite map

| Part | Version | Owns |
|---|---|---|
| Story Block | 2.16.1 | The hub. State, packs and their checker, the reader's screens, the `<Changes>` line grammar, the module SDK. Install first. |
| Story Director | 2.9.1 | Clock, map and trips, quests and hooks, world events (the chronicle). Needs Story Block. |
| NPC State Delta | 1.7.1 | Dossiers: meters, stages, secrets, portraits. Needs Story Block. Optional. |
| Story Studio | 0.9.0 | This repo. Writes and checks packs. Standalone page. |

- Data flows one way: Studio writes a pack file; Story Block imports it (Settings, Tabs & Packs); Story Director and NPC State Delta read what Story Block holds. Nothing flows back to Studio.
- Studio uses Story Block only through `vendor/story-block/` (Story Block 2.22.0, commit c57512e). The pack checker is Story Block's own `validatePack`, so Studio and the game cannot disagree on what a valid pack is.
- Studio has no model, no keys and no network access at runtime.

## Install & requirements

- To use: download `dist/story-studio.html`, open it in a browser (a `file:` URL works). No server.
- To play a pack: Story Block (cast needs 2.15.0 or later; the 150 KB / 1200 px portraits need 2.16.0), plus Story Director and NPC State Delta if the pack uses them. A pack with a lasting change lists `chronicle-lasting` under `requires.capabilities` and needs Story Director with world-event support.
- To develop: Node 24. Dev dependencies: `esbuild` 0.25.11, `playwright` 1.64.1. Browser tests need Chromium (`STUDIO_CHROMIUM_PATH` selects one).
- Commands: `npm run check` (syntax of src, scripts, tests, vendor, authoring-kit), `npm test` (full suite, dot reporter), `npm run build` (rebuild `dist/story-studio.html`), `npm run sync-sb -- --from <Story Block checkout>` (vendored runtime, fixtures and kit), `npm run sync-kit -- --from <checkout>` (kit only), `npm start` (dev server on 127.0.0.1:8000, serves `src/` and `vendor/`).
- The built file is about 5.2 MB (a test caps it at 5.5 MB). It is one classic inline script; a static scan refuses any external reference.

## Concepts

- **Pack**: one JSON object (`pack.json`) with the top-level fields `id, version, name, author, description, requires, currency, economy, calendar, weather, content, start, layouts, screens, theme`. Any other key is refused.
- **Record / kind**: an entry in a `content` list. Kinds Studio edits as records: `places, routes, events, items, creatures, races, talents, presets, skills, cast`. Other content kinds (shops, recipes, quests, terms, ranks, crafts, markets, meterPresets, dataModules, rpg) are edited as JSON under Pack settings.
- **Model / snapshot**: `openPack(input)` returns a frozen document plus validation and a typed reference index. Edits return a new snapshot or a refusal. The author's document stays detached from the checker's normalized copy.
- **History**: `createHistory` keeps snapshots for Undo and Redo. Drafts and portraits travel with each snapshot.
- **Safe invalid draft**: a pack with problems that is still editable but cannot be exported.
- **Problems**: the checker's diagnostics, grouped. Each has a Go to button that opens the record and field.
- **Timeline**: the Events part. An event has `id`, `when` (a condition string), `cue` (what the narrator is told once), and optionally `once`, `after`, `then`. It has no name; the form's name is the id in words.
- **Condition**: the one shape `when` is written in. See "Reply format" below. A condition the form did not write opens as "Written by hand" and is kept byte for byte.
- **Lasting change**: a `then` step `chronicle.lasting` that puts a world event in Story Director's chronicle. "N days after" counts from when that entry entered the chronicle.
- **Draft (Timeline)**: an event from the AI helper, held beside the pack (not in the document, checks or export) until kept.
- **Cast**: `content.cast`, up to 64 hand-written people, each a prepared dossier for NPC State Delta, living off-screen until met (Story Director).
- **Secret**: a hidden note of a cast person, opening at a meter value (`meter` + `at`), on a story event (`when`), or both (whichever first).
- **Portrait**: an image file beside `pack.json`, named by a person's `portrait`; not part of the JSON.
- **Character card**: a Character Card V2 (JSON or PNG) built from the pack, with the pack, lore, portraits, status bar and recommended settings put in it.
- **Lorebook**: a SillyTavern World Info file built from the pack's records.
- **Data module**: a closed JSON definition in `content.dataModules`. Story Block checks and runs it; Studio authors it.
- **Code module**: a generated starter extension (zip) that registers with Story Block as a v2 module.
- **Authoring kit**: `authoring-kit/`, a copy of Story Block's kit (prompts, references, checker) for drafting packs with the creator's own AI.
- **Vendored**: `vendor/story-block/` is a synchronized copy. Never edit it by hand.

## Studio features (where each lives in the UI)

- **Open pack**: header button, or drop a file on the page. Takes `.json` and `.zip`. Limit: one pack file 512 KB.
- **Pack name, Undo, Redo, fingerprint** (`pack - <8 hex>`): header.
- **Problems (N)**: header button; opens a drawer titled "Problems - checked by Story Block".
- **Records** (Places, Routes, Timeline, Items, People / creatures, Cast, Races, Talents, Presets; Skills under "More kinds"): parts list, list in the middle, form in the inspector. Rename follows known references; removal with dependents asks for a cascade.
- **Timeline**: Timeline / List switch; `+ Add event`; event form (On a date / After another event / Any time; Anywhere / Only in...; news; Lasting change; "When this fires" line; Advanced fold with raw `when`, `after`, `then`).
- **Write with an AI** (Timeline): step 1 builds a prompt (Copy prompt, Save as .txt), step 2 reads the pasted answer (Check it), results become drafts with Keep, Discard, Keep all.
- **Cast**: `+ Add person`; sections Who they are, Portrait, Where their story starts, Drawn to, Relationship at the start, Before they are met, Secrets (up to 8, with a player-view preview).
- **Pack settings**: first card is Stat formula (Reader's choice, Standard, Classic; writes `content.rpg.formula`); then one JSON card per other pack field.
- **Settings defaults**: states that Story Block's importer accepts zero per-module settings defaults; checking a proposal never changes the pack.
- **Screen builder**: Screens and Layouts; all ten screen fields; live preview; Apply screen / Apply layout validate the whole candidate pack.
- **Data modules**: forms from Story Block's descriptors, expression editor, Simulator on the real runtime, Apply module (one undo step).
- **Code module**: one form (18 inputs), live file list, Download zip. Works with or without a pack open and never changes the pack.
- **Character card**: edit every card field, Pick a card…, Change… / Remove the image, tick what goes in the card, Download card PNG / JSON, Reset card from pack. Saved with the pack.
- **Lorebook**: per-record preview, Download World Info JSON. **Import lorebook**: entries become drafts to Accept or Skip.
- **Check / export**: status, counts, Cast check, Problems, file name, fingerprint, what is inside, the zip listing, Export .zip / Export pack.json only (cast packs) or Export pack file.
- **Theme** button and draggable dividers (screens wider than 1100 px): per-browser conveniences.

## Settings

Studio has no settings screen. Its choices:

| Name | What it does | Default |
|---|---|---|
| Theme (`story-studio-theme`) | `dark` or `light`. | The browser's colour-scheme preference; dark if none. |
| Column widths (`story-studio-columns`) | Parts list 150-320 px, inspector 280-640 px, wide screens only. | 190 and 330 px. |
| Timeline view | Timeline or List. | Timeline. |
| Stat formula (`content.rpg.formula`) | Pack field. `standard` or `classic`; absent means the reader chooses. | Absent (Reader's choice). |
| Export file name | Name offered on Check / export. | `<id>.json`; `<id>-<version>.zip` for a pack with a cast. |
| Pack `economy.scale` | Number 0.001 to 1000, multiplies money defaults across the suite. | 1 |
| Reader settings | Cannot be shipped by a pack; the checker refuses unknown fields. | n/a |

## Data the model sees

Studio itself sends nothing to any model. What it writes for a model to read later:

- **Event `cue`** (up to 500 characters): told to the narrator once, when the event happens.
- **Character card**: `description` (includes the `<Changes>` instruction and its examples), `personality` (tone notes), `scenario` (start place and time), `first_mes`. Chosen by the creator and imported through SillyTavern's character importer.
- **Lorebook**: one World Info entry per place, faction, NPC / creature and item; keyword activation, order 100, before the character, probability 100%, whole-word matching, no recursion.
- **The AI-helper prompt**: text the creator copies to a chat of their own. Built from the calendar and start, regions, lore names, existing events, the answer format, the idea (up to 2,000 characters) and the place list; held to 24,000 characters (cuts, in order: place list, events, lore names, regions, calendar months; never the format, rules or idea).
- **Never sent**: keys, tokens, chats, personas, the pack to any server. There are no network requests. A secret's preview shows a blank bar and the meter rule; an event's words are never shown there.

## Reply format the model writes

Studio reads one model output: the answer to its own Timeline prompt. It also writes the `<Changes>` grammar into the narrator card.

Answer to the Timeline prompt (shape from `docs/AI_PROMPT.md`; the two examples are illustrative; a JSON list; a code fence or sentence around it, one object instead of a list, and any-case month, region and place names are tolerated; up to 200,000 characters):

```json
{ "name": "The emperor of Highmark dies",
  "when": { "on": "Goldwane 4, CY 604, dawn" },
  "where": "anywhere",
  "news": "Bells ring from every tower of the capital.",
  "once": true,
  "lasting": { "name": "Succession crisis", "state": "looming", "place": "Highmark Capital", "factions": ["Imperial Court"], "summary": "Three houses claim the throne.", "keep": false } }
```

```json
{ "name": "Grain convoy arrives",
  "when": { "after": "The emperor of Highmark dies", "days": 14 },
  "where": ["Bluewatch Village"],
  "news": "A convoy of grain wagons rolls in under guard." }
```

Rules the answer must meet: months, regions and places from the prompt's lists; dates on or after the story start; `after` names an event that has a `lasting` change; `news` at most 500 characters; `lasting.name` at most 80, `summary` at most 240, at most 4 factions, `state` one of `looming`, `ongoing`, `resolved`; at most 30 places per event. Each event is checked and marked ready or needs a look.

Condition grammar Studio writes into `when` (joined with `&&`; no clause is `true`; at most 500 characters):

```
time() != null && time() >= <from> && time() < <until>
time() != null
query('chronicle.passed', { name: '<world event>', minutes: <N> })
query('scene.place') != null && (query('scene.place').region == 'A' || query('scene.place').name == 'B')
```

Change-line grammar copied into the narrator card (Story Block SPEC section 4.4; Studio adds no protocol):

```
<Changes>
+ item Moonveil Trout | qty: 1 | note: violet-streaked, from the lake
- item Rope | qty: 1
~ quest Granary Rats | step: the cellar is cleared
! event Dragon sighted - smoke over the eastern ridge
? check stealth - slipping past the gate guard | dc: hard
</Changes>
```

Line form: `op kind Name[ - text][ | label: value]*`. Ops: `+` new, `-` gone, `~` changed, `!` happened, `?` asks code to decide.

## Pack format pointers

Studio reads and writes the pack format Story Block defines. Depth: [authoring-kit/reference/PACK-FORMAT.md](authoring-kit/reference/PACK-FORMAT.md), [authoring-kit/reference/LIMITS.md](authoring-kit/reference/LIMITS.md), [authoring-kit/reference/DATA-MODULES-FORMAT.md](authoring-kit/reference/DATA-MODULES-FORMAT.md). Limits are read from `vendor/story-block/src/v2/packs/limits.js`, never copied into Studio.

- **Pack**: `id` (lowercase words and dashes, at most 40), `version` (semver), `name` (80), `requires`, `calendar`, `weather`, `currency`, `economy`, `start`, `content`, `screens`, `layouts`, `theme`. `pack.json` at most 512 KB, strings at most 4,000 characters.
- **Place**: `name, slug, aliases, region, kind, layer, x, y, note, hidden, market, tags`. **Route**: `slug, from, to, kind, km, hours, corridor, note`.
- **Event**: `id, when (500), cue (500), once, after, then (8 steps)`.
- **Cast person**: `id, name (80), aliases (8), about (300), look (600), voice (300), personality (600), history (1200), portrait, start {place (80), goal (200), routine (200)}, drawnTo (6, each 80), meters, stages, fields (6), secrets (8), canDieUnmet`. A secret: `title (60), text (300), meter + at, or when (120)`. Plain text only: no `<`, `>`, `{`, `}`.
- **Portraits**: JPEG, PNG or WebP picked up to 10 MB; stored at most 150 KB and 1200 px long side (WebP); at most 32 per pack; name `^[A-Za-z0-9][A-Za-z0-9_-]{0,58}\.(webp|png|jpe?g)$`.
- **Zip**: `pack.json` plus `portraits/<file>`; at most 40 entries; unzipped by Story Block's own reader (`vendor/story-block/src/v2/packs/bundle.js`).
- **Calendar**: `era (24), months (60, each name 40 and days 400), start {year, month, day, hour, minute}, holidays (60)`. Without a calendar the story runs on the Gregorian calendar.
- **Lasting step** in an event's `then`: `{ "command": "chronicle.lasting", "payload": { name (80), state, place? (80), factions? (4 x 80), summary? (240), keep? } }`, no other field.
- **Screens**: ten fields `id, title, icon, mounts, template, layout, css, theme, data, steps`; mounts `tab, screen, card, hud, dialog`.

A real place, route and event from the Ersveil sample pack (`tests/fixtures/ersveil-open-world.json`):

```json
{ "name": "Highmark Capital", "aliases": ["Highmark"], "region": "Highmark Empire", "kind": "capital", "x": 15, "y": -5, "tags": ["river"] }
{ "from": "Black Iron Riverhold", "to": "Oxbow Court", "kind": "river", "km": 390, "corridor": "Grand Vein River" }
{ "id": "bluewatch-guild-board", "when": "time() != null && time() >= 316931440 && query('scene.place') != null && (query('scene.place').name == 'Bluewatch Village / Guild Office' || query('scene.place').name == 'Bluewatch Village')", "cue": "..." }
```

## Commands/queries

Studio registers no commands or queries (it is not a module). What it names, for module authors:

- **Screen builder queries** (`QUERIES` in `src/screen-authoring.js`; names only, answered from sample JSON in the preview): `scene.place`, `scene.present`, `director.time`, `director.threads`, `director.thread`, `inventory.items`, `inventory.wallet`, `inventory.economy`, `npc.present`, `npc.dossier`, `npc.known`, `npc.portrait`, `packs.list|content|markets|crafts|calendar|weather|economy|item|start`, `events.status`.
- **Reader commands a button may run** (`UI_COMMANDS`): `inventory.drop`, `inventory.equip`, `inventory.unequip`. A command that makes items or money (`inventory.grant`, `wallet.receive`) is refused from a button and not offered. Another module's command is typed by hand.
- **Timeline**: writes the step `chronicle.lasting` (Story Director) and reads the query `chronicle.passed` for "N days after".
- **Code module output**: registers with Story Block through `StoryBlock.ready`; declares one state field with a validator, one narrator line, one guarded command, one query, an optional tab screen and an optional capability. Reserved names: `fishing-activity, npc-state-delta, story-block, story-director, story-studio`, plus Story Block's own domains and prefixes.
- **Studio's own JS** (tests and tools): `openPack`, `add`, `renameId`, `remove`, `setField`, `setSchemaField` (`src/model.js`, `src/edits.js`), `createHistory` (`src/history.js`), `mountStudio(root)` returns the context used by screens (`src/studio.js`).

## Storage

Studio has no per-chat state. Everything lives in the browser that opened the page.

- `localStorage` `story-studio-draft`: `{ version: 1, document, sourceText, dirty, drafts?, card? }` (`card`: `{ packId, draft, image }`, the Character card page's draft; its picture is in IndexedDB), written after each edit. A reload restores the pack from it. Capped at six times the pack limit.
- IndexedDB store `portraits`: the cast's pictures, so a reload brings them back. Without IndexedDB only the pictures are lost.
- `localStorage` `story-studio-theme`, `story-studio-columns`.
- Session only (lost on reload): code module form, lorebook review queue and decisions, screen and data-module form drafts before Apply.
- Every storage call is wrapped; the page works with storage blocked.
- A pack opened and not changed exports byte for byte. Exporting marks the pack saved.

## File map

| Path | Purpose |
|---|---|
| `dist/story-studio.html` | The built standalone page (committed). |
| `src/studio.js`, `src/index.html`, `src/studio.css` | Page shell, header, parts list, open/export wiring. |
| `src/model.js`, `src/edits.js`, `src/history.js`, `src/apply-edit.js`, `src/records.js`, `src/identity.js` | Pack model, edits, undo/redo, record kinds and keys. |
| `src/screens/` | One file per screen: records, timeline, timeline-ai, cast, pack-settings, presentation, authoring, code-module, problems; `dm/` for data modules. |
| `src/timeline/` | Pure parts of the Timeline: condition, calendar, lasting change, AI prompt and answer, drafts. |
| `src/cast/` | Cast data and checks, portrait fitting, zip writer. |
| `src/data-modules/` | Adapter to Story Block's data-module checker, forms, expression editor, simulator. |
| `src/code-module/` | Starter-module generator: inputs, templates, zip writer, generated assets. |
| `src/narrator.js`, `src/card.js`, `src/card-png.js`, `src/card-image.js`, `src/lorebook.js`, `src/screens/character-card.js` | Character card (fields, checklist, PNG/JSON writer and reader) and World Info export and import. `vendor/story-block-examples/` holds the copied status-bar script. |
| `src/session.js`, `src/portrait-store.js`, `src/export.js` | Saved project, portrait storage, downloads. |
| `src/assets/` | Icons and empty-state drawings (SVG); see `docs/ASSETS.md`. |
| `vendor/story-block/` | Synchronized Story Block runtime and checker. Do not edit. |
| `vendor/story-block-fixtures/` | Synchronized data-module fixtures. |
| `authoring-kit/` | Synchronized kit; `work/` is the creator's space and is never overwritten. |
| `scripts/` | `build.mjs`, `check.mjs`, `serve.mjs`, `sync-sb.mjs`, `sync-kit.mjs`, `dist-scan.mjs`, `offline-runtime.mjs`. |
| `tests/` | `node:test` suites (model, forms, timeline, cast, data modules, code module, browser flows, build, goldens) and `fixtures/`. |
| `docs/` | `STUDIO.md` (engine and tool reference), `STUDIO_PART2.md` (application guide), `AI_PROMPT.md` (event prompt with blanks), `ASSETS.md`, `PART5B_SPEC.md`, `images/` (README pictures). |

Code rules (from `AGENTS.md`): plain ES modules, DOM only through `createElement` / `createElementNS` and `textContent` (no `innerHTML`, `DOMParser`, `eval`, `new Function`), no network calls, no model or tool names in files, no keys or secrets.

## Limits & known follow-ups

- Code module and lorebook review drafts disappear on reload.
- Lorebook review decisions stay "accepted" after Undo removes the accepted record.
- Switching presentation records discards unapplied form drafts.
- Packs cannot supply per-module settings defaults (Story Block's importer has no field for them).
- Data modules: Story Block's v1.1 features (checks, `grantCoin`, `grantItem`, `grantXp`) are shown only to be refused. A step's field changes are the net change of the reply.
- Code module: the starter has one state field, one line, one command and one query. The zip carries Story Block's AGPL-3.0 testkit under `tests/vendor/`; the module's own licence is left to the author. Its copied testkit follows the vendored Story Block; refresh with `npm run sync-sb`.
- The pack checker, not Studio, decides validity; a limit Story Block changes arrives with the next `npm run sync-sb`.
- `docs/STUDIO.md` part 5b still quotes older Story Block numbers for the copied testkit; `vendor/story-block/VERSION` is the source of truth.
- RPG Battle is not supported; its rules packs cannot be imported.
- Studio never calls an AI. Drafting with an AI is done by the creator outside Studio.

## Version

- Story Studio 0.9.0 (`package.json`, `CHANGELOG.md`). Vendored Story Block 2.22.0 (commit c57512e); authoring kit stamped with the same commit.
- Suite today: Story Block 2.22.0, Story Director 2.10.0, NPC State Delta 1.10.0, Story Studio 0.9.0.
- Licence: AGPL-3.0-only. Phosphor Icons (MIT) are bundled; the notice is in `src/credits.txt` and the built page.
