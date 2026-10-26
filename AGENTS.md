# Working in Story Studio

Story Studio is the pack editor and creator kit of the Story Suite (SillyTavern extensions: Story Block, the hub;
RPG Battle; Story Director; NPC State Delta). It edits and checks packs and exports pack files the modules load unchanged.

- Plain ES modules, no build step, no dependencies, no network calls at runtime.
- Story Block is used only through `vendor/story-block/` (`npm run sync-sb -- --from <Story Block checkout>`); never edit
  the vendored copy, and never copy Story Block code by hand. The pack checker is Story Block's, so Studio and the game
  can never disagree on what a valid pack is.
- `authoring-kit/` is a synchronized copy of Story Block's kit (`npm run sync-kit -- --from <Story Block checkout>`, or `sync-sb`, which runs
  it); never edit it by hand. Its README names the agent tools it works with; that is intended and the one exception to the rule on tool
  names below.
- DOM through createElement / createElementNS and textContent only: no innerHTML, insertAdjacentHTML, outerHTML,
  DOMParser, eval or new Function.
- Tests with `node:test` under `tests/`; `npm run -s check` and `npm run -s test:dot` pass before every commit.
- Match the surrounding code: its comment density, naming and idiom (Story Block's `src/v2/` is the model).
- No model or tool names in files or commit messages. No keys, tokens or secrets anywhere.
- Work only on the branch you were given. Never push to `main`, never force-push, never open or merge a PR: the suite's
  lead does that after review.
