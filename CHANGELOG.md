# Changelog

## 0.3.0

- The Events section is now the **Timeline**: events grouped by story year on the pack's calendar, with the events that follow one nested under it ("14 days later", "right after") and those with no date under "Any date · by place only". A Timeline/List switch keeps the plain list.
- The event form is built for authors: a name (the ID is saved from it), **On a date** / **After another event** / **Any time**, **Anywhere** / **Only in…** (searchable places and regions), the news the AI is told, **Lasting change: add to the chronicle**, a plain-words "When this fires" line, and an Advanced fold with the raw `when`, `after` and `then`. A condition Studio wrote reopens in the form; one written by hand is shown as such and kept byte for byte.
- **Lasting change** writes a `chronicle.lasting` step (Story Director) with the world event's name, state, place, factions, summary and Keep in mind. "At least N days after" another event counts from when that event's lasting change entered the chronicle, through Story Director's `chronicle.passed` query; it is offered only when the earlier event has one. The pack checker flags a lasting change outside Story Director's limits (a blank faction and unknown fields included, texts measured after trimming). A pack with a lasting change lists `chronicle-lasting` under `requires.capabilities`, so Story Block keeps it off, and says why, where Story Director's world-event support is missing; Problems says so. An event that others count days from waits until the story has a date (`time() != null`). Problems and the Timeline row warn about a wait for a world event no event adds.

## 0.2.0

- RPG Battle is no longer supported. Its rules packs cannot be imported; existing RPG Battle chats should stay on the previous versions.
- Studio edits ordinary worlds, including places, routes, calendar, weather, events and data modules, using Story Block 2.6's pack checker.
- The screen builder offers only what works in the suite: a new button no longer calls `inventory.grant` (refused from a button) but drops one of a list row's item, or waits for a command, and **Reader command** lists the commands a button may run. The query list drops `scene.map` and `party.pc`, which no suite module answers, and adds `scene.present`; a new screen starts on `scene.place`.
