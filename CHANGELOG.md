# Changelog

## 0.5.0

- **Cast.** A new part beside People / creatures for a pack's hand-written people (Story Block 2.15.0 or later). Each
  person's form follows the game: who they are (name, other names, one line, look, voice, personality, background),
  a portrait (any picture, shrunk in the browser to a WebP of 64 KB or less, with its size shown), where their story
  starts (a place from this pack, routine, goal), what draws them to the party, their relationship at the start
  (meters, stages, your own fields), whether they may die before they are met, and up to eight secrets — each opening at
  a meter value or on a story event — with a preview of what a player sees: the opened ones and a blank bar for the rest.
- **Export as one .zip** (pack.json and a portraits folder), or pack.json alone; **Open pack** takes the .zip back. The
  check lists the cast, the portraits, the starting places and the secrets.
- Studio's own copy of Story Block is now 2.15.0, so its checks match the game.

## 0.4.0

- **Write with an AI** on the Timeline. Studio builds a prompt from the open pack (the calendar and the story's start, regions and places, names from the lorebook, the events already there) and your idea, to copy or save and paste into any AI chat; Studio never calls an AI or the network. Paste the answer back and **Check it** reads it (a code fence or sentence around it, one event instead of a list, and names in any case are fine) and says, event by event, whether it is ready or needs a look, in plain words: a place or region the pack lacks, a date before the story starts or one that cannot be read, an unknown month, an "after" that names nothing or whose earlier event has no lasting change, news over 500 characters, a lasting change outside Story Director's limits, an ID already taken. Each event is written the way the event form writes it.
- Events from an AI are added as **drafts**: on the Timeline with a "draft" chip and a dashed outline, kept in the project (they survive a reload and undo like other edits), and left out of the exported pack and of Problems until kept. Open a draft to change it in the usual form; **Keep**, **Discard** and **Keep all** each take one undo step, and a draft that needs a look cannot be kept until it is fixed.
- A draft's warnings stay with the field they are about: fixing a place no longer clears a missing earlier event or a dropped delay, and a warning about something left out has its own button ("Right after is fine") to say it is meant. A date, place, end, "once" or lasting change of the wrong kind is a warning, not a quiet "any time" or "anywhere". A name with a carriage return or other control character is refused instead of writing a condition Story Block cannot read. An "after" naming an event that both the pack and the answer have follows the answer's own, and says so. A draft and an event with the same ID can both be opened, renamed, kept and discarded, and **+ Add event** no longer reuses a draft's ID. A pasted answer is limited to 200,000 characters and its fields are bounded; if the browser cannot save the project with new drafts they are not added, and you are told. The prompt stays within 24,000 characters whatever the pack holds (places, then events, then lore names, then regions are cut, and the note says what), and the answer is found after a citation like [1] in the text around it.
- [docs/AI_PROMPT.md](docs/AI_PROMPT.md) is the same prompt with blanks to fill in by hand.

## 0.3.0

- The Events section is now the **Timeline**: events grouped by story year on the pack's calendar, with the events that follow one nested under it ("14 days later", "right after") and those with no date under "Any date · by place only". A Timeline/List switch keeps the plain list.
- The event form is built for authors: a name (the ID is saved from it), **On a date** / **After another event** / **Any time**, **Anywhere** / **Only in…** (searchable places and regions), the news the AI is told, **Lasting change: add to the chronicle**, a plain-words "When this fires" line, and an Advanced fold with the raw `when`, `after` and `then`. A condition Studio wrote reopens in the form; one written by hand is shown as such and kept byte for byte.
- **Lasting change** writes a `chronicle.lasting` step (Story Director) with the world event's name, state, place, factions, summary and Keep in mind. "At least N days after" another event counts from when that event's lasting change entered the chronicle, through Story Director's `chronicle.passed` query; it is offered only when the earlier event has one. The pack checker flags a lasting change outside Story Director's limits (a blank faction and unknown fields included, texts measured after trimming). A pack with a lasting change lists `chronicle-lasting` under `requires.capabilities`, so Story Block keeps it off, and says why, where Story Director's world-event support is missing; Problems says so. An event that others count days from waits until the story has a date (`time() != null`). Problems and the Timeline row warn about a wait for a world event no event adds.

## 0.2.0

- RPG Battle is no longer supported. Its rules packs cannot be imported; existing RPG Battle chats should stay on the previous versions.
- Studio edits ordinary worlds, including places, routes, calendar, weather, events and data modules, using Story Block 2.6's pack checker.
- The screen builder offers only what works in the suite: a new button no longer calls `inventory.grant` (refused from a button) but drops one of a list row's item, or waits for a command, and **Reader command** lists the commands a button may run. The query list drops `scene.map` and `party.pc`, which no suite module answers, and adds `scene.present`; a new screen starts on `scene.place`.
