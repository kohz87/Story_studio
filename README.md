# Story Studio 0.3.0

Story Studio is an offline pack editor and creator kit for Story Block, Story Director and NPC State Delta. Download [the standalone editor](dist/story-studio.html) and open it in a browser; it runs locally without a server.

RPG Battle is no longer supported. Its rules packs cannot be imported; existing RPG Battle chats should stay on the previous versions.

Open a pack to edit its places, routes, events (the Timeline), items, calendar and weather. Data modules have structured forms, a grammar preview and a simulator using Story Block's runtime. Studio checks packs with Story Block's own checker before export, and can also author screens, narrator cards and lorebooks. On the Timeline, **Write with an AI** builds a prompt from the open pack to paste into any AI chat and reads the answer back as draft events ([the prompt, with blanks](docs/AI_PROMPT.md)); Studio itself never calls an AI.

The [authoring kit](authoring-kit/README.md) contains prompts, reference material and a checker for drafting a pack from your own notes.

For development, use Node 24. Run `npm run sync-sb -- --from <Story Block checkout>` to synchronize the vendored runtime and kit, `npm run build` to rebuild the standalone editor, `npm run check` to check syntax, and `npm test` for the full suite including browser tests.

Licensed under [AGPL-3.0](LICENSE).
