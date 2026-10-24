# Story Studio

The pack editor and creator kit for the Story Suite, a set of SillyTavern extensions (Story Block, RPG Battle, Story
Director, NPC State Delta). A creator builds a pack (a rules pack first: classes, skills, branches, items, foes), Studio
checks it while they work, previews it, and exports a pack file the modules load unchanged.

Status: part 1, the engine (open and export, edits with undo, a plain dev page). The screens come later.

## Layout

- `src/`: Studio's own code.
- `vendor/story-block/`: a copy of Story Block's v2 runtime (the pack checker, the widgets), made by
  `npm run sync-sb -- --from <Story Block checkout>`. Never edited by hand; `VERSION` names its commit.
- `tests/`: `node:test` tests (`npm test`, `npm run test:dot`); `npm run check` syntax-checks everything.

## Licence

AGPL-3.0, as Story Block, whose code Studio bundles. See LICENSE.
