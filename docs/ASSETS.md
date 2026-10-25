# Studio assets (SVG)

The icons and illustrations for the pack editor screens (part 2). Files are in `src/assets/icons/` and `src/assets/empty/`;
`src/assets/index.js` exports the same markup as strings so the single-file build can inline it. The mocks are in the suite
notes (`studio-mocks/`); the look is the glass themes, Nunito, accent `#7b6cf0`.

## Rules every file follows

- Hand-written, minimal paths; coordinates rounded to one decimal place. No `<style>`, scripts, `foreignObject`, images,
  fonts, links or external references. No `<title>`: the UI supplies the label, and every file is `aria-hidden="true"`.
- Line icons: 24x24 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.8"`, round caps and joins, so the
  theme colours them. The only literal colour anywhere is `#7b6cf0`, in the app mark and the empty-state accent.
- `tests/assets.test.js` checks all of this, and that each string in `index.js` is its file. If you edit an SVG, update the
  string in `index.js` to match (the test names the file that differs).
- `index.js` holds markup, not DOM nodes. Studio does not parse HTML at runtime (no `innerHTML`, no `DOMParser`), so the
  build inlines these strings into the page; the file's `xmlns` is there for use as a standalone file (favicon).

## Drawn for Studio

| Asset (`ASSETS` key) | Use | Size |
| --- | --- | --- |
| `logo-mark` | Studio logo, line version, in the header | 24 |
| `app-mark` | App mark and favicon: accent tile, spark cut out of it (`fill-rule="evenodd"`, so the page shows through); the only filled icon | 64 (reads at 16) |
| `tier-0`, `tier-1`, `tier-2`, `tier-3` | Tier badge beside a class name. Told apart by shape and number: circle 0, square 1, hexagon 2, shield 3 | 24 (use at 16-20) |
| `form-written` | A form the creator writes: pencil on a line | 24 |
| `form-generated` | A form Story Block generates, read-only: padlock | 24 |
| `form-base` | The base skill: bolt on a base line | 24 |
| `kind-classes` | Left rail: classes (three stacked layers, one per tier step) | 24 |
| `kind-shops` | Left rail: shops | 24 |
| `kind-trainers` | Left rail: trainers | 24 |
| `budget` | Power budget meter | 24 |
| `cascade-remove` | Remove with everything that depends on it: a branch with a cut | 24 |
| `undo`, `redo` | History buttons; mirror images of each other | 24 |
| `open-file` | Open a pack file | 24 |
| `export-file` | Export a pack file | 24 |
| `no-pack` | Empty state, no pack open (folder with a plus) | 160x120 |
| `no-problems` | Empty state, nothing to fix (shield with a check) | 160x120 |

`kind-classes`, `kind-shops`, `kind-trainers`, `undo` and `redo` use the same paths as the inline icons in the mocks, so the
screens match them. The empty states are line art in `currentColor` with the accent on the plus, the check and the spark;
no gradients, no text.

Check the drawings at 16, 20 and 24 px in the dark (`#151827` / `#f1f2f8`) and light (`#e8e6f3` / `#23253a`) themes
whenever one changes; they were drawn to stay legible at 16 px.

## Reused from Story Block

Story Block's icon set (Phosphor Icons 2.1.1, MIT) is in the vendored copy at
`vendor/story-block/src/v2/view/icons/` (`set.js`, `index.js`). These Studio marks are taken from it by id, not drawn and not
copied: `SB_ICONS` in `src/assets/index.js` maps each Studio name to the id, and the test checks each id exists. Render them
with that module's `svgIcon(doc, id)` (viewBox 256, `fill="currentColor"`, so the theme colours them).

| Studio mark | Story Block id |
| --- | --- |
| `kind-skills` | `ph-lightning` |
| `kind-items` | `ph-package` |
| `kind-foes` | `ph-skull` |
| `kind-places` | `ph-map-pin` |
| `kind-quests` | `ph-scroll` |
| `kind-more` | `ph-dots-three-outline` |
| `warning` (problem) | `ph-warning` |
| `ready` (check) | `ph-check-circle` |

Available in the set but not used, because drawn Studio marks fit their role better: `ph-lock-simple` (the generated-form
mark is one of a set of three form marks drawn together) and `ph-arrow-counter-clockwise` (Story Block has no clockwise
counterpart, and undo and redo must mirror each other). Story Block has no icon for open file or export file (`ph-download-simple`
is a download, not an export).

Phosphor is MIT licensed, copyright (c) 2023 Phosphor Icons. Story Block keeps the notice in its `ICONS-CREDITS.md`, which is
not part of the vendored copy. The single-file build inlines these icons, so the build's notices need to carry that licence.
Note too that Phosphor's icons are 256-unit filled outlines while Studio's are 1.8-stroke lines, so the two look slightly
different side by side in the left rail.

The complete Phosphor MIT notice is in [`src/credits.txt`](../src/credits.txt) and the built file's expandable credits.
The build converts the trusted SVG sources to `src/assets/drawings.js`; the app draws those descriptors using
`createElementNS`, including the selected Phosphor paths. There is no runtime markup parser or external asset request.
