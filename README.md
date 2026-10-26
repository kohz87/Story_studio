# Story Studio

The pack editor and creator kit for the Story Suite, a set of SillyTavern extensions (Story Block, RPG Battle, Story
Director, NPC State Delta). A creator builds a pack (a rules pack first: classes, skills, branches, items, foes), Studio
checks it while they work, previews it, and exports a pack file the modules load unchanged.

Story Studio is a standalone, local application. It ships as a single file (`dist/story-studio.html`) that works completely
offline from `file://` with no server and no network access.

Download [dist/story-studio.html](dist/story-studio.html) and double-click it to start.

## Screens and Capabilities

- **Classes**: View the 4-tier class progression tree, inspect classes, re-parent with cycle protection, manage the 3 required skills per class, and remove classes with an exact cascade preview and full undo.
- **Skill Paths**: Explore tier-3 skill progression across a base and 12 pathway forms in 3 columns, distinguishing 8 written editable pathway forms from 4 generated read-only forms with live power budget meters. Lower-tier classes display skills as a clean list.
- **Other Pack Kinds**: Edit items, creatures/foes, places, quests, shops, recipes, trainers, routes, events, and presets with schema-driven forms and reference pickers.
- **Data modules**: Author data-defined modules (typed fields, narrator kinds, rules, rewards, timers, exports, additive migrations, screens) with a structured expression editor, a live narrator grammar preview, typed reference rename/remove and a simulator panel. Story Block's checker gives every verdict and its own runtime runs the simulator.
- **Code module**: Write a starter SillyTavern extension that is a real Story Suite v2 module: a form makes nine files, a copy of Story Block's testkit and tests that pass, downloaded as one zip.
- **Problems and Export**: Review live Story Block validation diagnostics, jump directly to problem fields with "Go to", verify rules and pack fingerprints, and export authored pack files the game engine accepts unchanged.
- **Session & Offline Safety**: Automatic draft saving to `localStorage` (with graceful fallback when storage is denied), unsaved change protection, and strict DOM safety with zero runtime network requests.

## Draft with your own AI

Studio has no AI of its own. To have an AI draft a pack from your lore, use your own coding agent or chat with the
[authoring kit](authoring-kit/README.md): prompts, instructions, references and a checker you run on your own machine.
Put your lore in `authoring-kit/work/lore/`, let your agent follow `AGENTS.md`, check with
`node check.mjs work/pack.json` in that folder until it prints OK, then open the file here.

## Development and Build

Use Node.js 24. Run npm ci and npx playwright install --with-deps chromium before testing.
Browser tests are required and open the built file directly from disk.

- `npm start`: Serves `src/` for local development.
- `npm run sync-kit -- --from <Story Block checkout>`: Copies Story Block's authoring kit into `authoring-kit/` (`npm run sync-sb` does it too).
- `npm run build`: Bundles the standalone single-file application into `dist/story-studio.html`.
- `npm run check`: Syntax-checks all project scripts and test modules.
- `npm test` or `npm run test:dot`: Runs the complete test suite under `tests/` using `node:test`, including Playwright browser tests.

## Layout

- `src/`: Studio source code, UI screens, components, assets, and styles.
- `dist/`: Committed single-file application (`story-studio.html`).
- `vendor/story-block/`: Synchronized copy of Story Block v2 runtime (pack checker, data-module checker, schema, icons), with its data-module fixtures in `vendor/story-block-fixtures/`. Never edited by hand.
- `tests/`: Automated unit, integration, fixture, safety, and Playwright browser tests.
- `authoring-kit/`: Synchronized copy of Story Block's authoring kit (prompts, agent instructions, references, checker) with a `VERSION` stamp (`npm run sync-kit`). Never edited by hand.
- `docs/`: Architecture and specification documentation (`STUDIO.md`, `STUDIO_PART2.md`).

## Licence

AGPL-3.0-only, matching Story Block. Phosphor Icons are licensed under MIT. See `LICENSE` and credits in `dist/story-studio.html`.
