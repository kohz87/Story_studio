# Story Studio: local pack editor

Download [dist/story-studio.html](../dist/story-studio.html) and open it in a browser. Studio runs locally
without a server or network requests. It edits world packs and provides tools for data modules, screens,
narrator cards, lorebooks and code modules.

## Editing

Open a JSON pack to edit places, routes, events, items and other supported records. Pack settings contain
calendar, weather and other host fields. Data modules have structured forms, a grammar preview and a
simulator backed by Story Block. Renaming a record updates known references, and removing a referenced record
requires an explicit cascade. Undo restores the prior snapshot. Problems group the checker's diagnostics
and can open the relevant record and field.

Safe invalid drafts remain editable. Studio checks the pack with its synchronized Story Block runtime before
export, and preserves the original bytes when an opened file has not changed. Drafts are stored on the device
when localStorage is available; export a pack file for a portable copy.

## Development and verification

Use Node 24. Synchronize Story Block with `npm run sync-sb -- --from <Story Block checkout>`, rebuild the
standalone page with `npm run build`, and run `npm run check` and `npm test`. Browser tests need Chromium;
`STUDIO_CHROMIUM_PATH` can select an installed executable. The test suite also exercises authoring through
the synchronized checker, export, history, reference edits and the offline browser.

See [the engine and tool reference](STUDIO.md), the [authoring kit](../authoring-kit/README.md), and
[assets and credits](ASSETS.md).
