# Story Studio: local pack editor

Download [dist/story-studio.html](../dist/story-studio.html) and double-click it. The application runs from disk
with no server, runtime dependencies, font downloads, or network requests. It edits rules packs; character cards,
screen building, settings defaults, and assisted authoring are outside Part 2.

The application uses Story Block's vendored schema and checker. All document changes pass through
[src/edits.js](../src/edits.js), and history holds immutable engine snapshots. The
[engine reference](STUDIO.md) describes the editing API and validation boundaries.

## Editing

- The top bar edits the pack's name and shows the short rules fingerprint, Undo/Redo, Open, Problems, Export,
  and theme controls. Dark is the fallback theme; system preferences apply until a theme is chosen.
- Classes appear in tier 0–3 columns. Their inspector edits names, IDs, parents, and skill assignments.
  ID renames update typed references and show their count. Each class needs exactly three skills.
  Removal opens a native dialog listing the cascade, including derived forms. One Undo restores it.
- Advanced skills show a base form and twelve pathway forms in three columns. Eight pathway forms are written
  and four are generated. Written forms and the base are editable; generated forms have dashed borders,
  locks, and a read-only explanation. Power meters show the shared checker's budgets and budget-closure errors.
  Lower-tier skills appear in a list.
- Items, foes, places, quests, shops, trainers, and More kinds use schema-driven controls. Internal references
  use ID selectors. Place, NPC, and thread references allow external IDs and offer local suggestions.
  The form descriptors live in [src/form-schema.js](../src/form-schema.js).
- Problems are grouped by the checker's error code. Go to selects the record and focuses its field.
  The Check / export screen shows both full fingerprints, counts, diagnostics, and the download filename.

The inspector becomes an overlay drawer at widths up to 1100px, including 1024px. Close inspector returns focus to
the workspace. The cascade dialog supports Escape and keyboard focus containment through the native dialog element.
Controls use native buttons, inputs, labels, and visible focus indicators.

## Open, drafts, and export

Open a JSON pack with Open pack or drop a file onto the window. Leading byte order marks are accepted.
Files above 512 KiB are refused before reading. Unsafe input reports diagnostics and preserves the current draft.

Safe drafts may be invalid. They autosave to localStorage under the key story-studio-draft, including their dirty flag.
Storage access is guarded: blocked, unavailable, corrupt, and oversized storage does not prevent editing in memory.
Local storage belongs to the browser and file location; exporting a pack is the portable backup.

Unexported edits trigger the browser's close warning. Undo back to the opened or exported snapshot clears the dirty
state. Check / export enables downloads only when the shared checker accepts the document. Downloads contain exactly
exportPack(model) as UTF-8 JSON, including its final newline. No UI metadata or generated forms are appended.

The rulesHash fingerprints the rules; packHash fingerprints the whole pack. Envelope metadata changes can preserve
the rules fingerprint while changing the whole-pack fingerprint. Invalid drafts have neither fingerprint.

## Development and verification

Use Node.js 24:

    npm ci
    npx playwright install --with-deps chromium
    npm start

The development server opens Studio at http://127.0.0.1:8000. The separate unstyled developer page remains at
src/dev.html. Build the offline application with npm run build. Pinned development dependencies bundle the
classic inline script, styles, and icons into the committed HTML file.

    npm run -s check
    npm test
    npm run build
    git diff --exit-code -- dist/story-studio.html src/assets/drawings.js

Browser tests in [tests/studio-browser.test.js](../tests/studio-browser.test.js) are mandatory. They open the built file
from file://, block and count subresource requests, and check both themes at 1280 and 1024px. They cover rename
references, exact cascade preview and undo, broken class repair and problem focus, canonical download bytes and
golden hashes, skill paths, reference controls, hostile input, denied storage, labels, target sizes, and contrast.
STUDIO_CHROMIUM_PATH optionally selects an installed Chromium executable. Missing browser support fails the built
application tests. The older developer-page smoke test retains its optional environment discovery.

CI installs dependencies and Chromium, checks syntax and behavior, rebuilds the application, checks committed build
drift, and scans the built file for runtime network and unsafe DOM APIs. Runtime DOM construction uses
createElement/createElementNS and textContent. The build embeds a restrictive Content Security Policy.

## Credits

Story Studio and the bundled Story Block runtime are AGPL-3.0-only. The built file includes a Credits and licences
section with Phosphor's MIT notice. See [docs/ASSETS.md](ASSETS.md) and [src/credits.txt](../src/credits.txt).
The font stack is Nunito, system-ui, sans-serif; no external font is loaded.
