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
- **Problems and Export**: Review live Story Block validation diagnostics, jump directly to problem fields with "Go to", verify rules and pack fingerprints, and export canonical pack files byte-identical to the game engine.
- **Session & Offline Safety**: Automatic draft saving to `localStorage` (with graceful fallback when storage is denied), unsaved change protection, and strict DOM safety with zero runtime network requests.

## Development and Build

Use Node.js 24. Run npm ci and npx playwright install --with-deps chromium before testing.
Browser tests are required and open the built file directly from disk.

- `npm start`: Serves `src/` for local development.
- `npm run build`: Bundles the standalone single-file application into `dist/story-studio.html`.
- `npm run check`: Syntax-checks all project scripts and test modules.
- `npm test` or `npm run test:dot`: Runs the complete test suite under `tests/` using `node:test`, including Playwright browser tests.

## Layout

- `src/`: Studio source code, UI screens, components, assets, and styles.
- `dist/`: Committed single-file application (`story-studio.html`).
- `vendor/story-block/`: Synchronized copy of Story Block v2 runtime (pack checker, schema, icons). Never edited by hand.
- `tests/`: Automated unit, integration, fixture, safety, and Playwright browser tests.
- `docs/`: Architecture and specification documentation (`STUDIO.md`, `STUDIO_PART2.md`).

## Licence

AGPL-3.0-only, matching Story Block. Phosphor Icons are licensed under MIT. See `LICENSE` and credits in `dist/story-studio.html`.
