# Writing timeline events with an AI

Studio can build this prompt for you: open the **Timeline**, choose **✦ Write with an AI**, write your idea and copy
the prompt it makes from the open pack (its calendar, regions, places, names and events). Studio never talks to an AI
itself. This page is the same prompt with blanks, for when you want to write it by hand, or use it before a pack is open.

1. Fill in each [BLANK] below, then paste the whole text into any AI chat.
2. Copy the AI's answer (the JSON list).
3. In Studio, on the Timeline, choose **✦ Write with an AI**, then **Next: paste the answer**, paste it and choose
   **Check it**. Studio says, event by event, whether it is ready or needs a look, and adds the events as **drafts**.
   A draft sits on the Timeline with a dashed outline, stays out of the exported pack, and is kept or discarded one
   by one. You can open a draft and change it in the usual event form first.

An answer can be wrapped in a code fence or a sentence, can be a single event instead of a list, and may write month,
region and place names in any case. Everything else is checked: dates, places and regions, lengths and the limits of
a lasting change.

## The prompt

```text
You are helping a writer plan hidden world events for the Story Suite pack "[YOUR PACK NAME]". Players never see these events; when one happens, the story's narrator is told its news once.

CALENDAR: [NUMBER] months: [MONTH NAMES, in order; add "(N days)" after each if the months differ in length]. Years are [ERA, for example CY]. The story starts [MONTH DAY, ERA YEAR, TIME like 6:40]. Times of day: dawn, noon, dusk, midnight, or an exact time like 18:30.
REGIONS: [THE REGION NAMES YOUR PLACES USE, separated by commas]
PLACES: listed at the end.
FACTIONS AND NAMES: [FACTIONS, PEOPLE AND OTHER NAMES THE STORY USES, separated by commas, or delete this line]
EVENTS ALREADY IN THE PACK: [EACH EVENT AS: NAME (DATE or "after OTHER EVENT"; PLACES; "lasting change: NAME" if it has one), separated by " · ", or "none"]

ANSWER with a JSON list only, one object per event:
{ "name": "...",
  "when": { "on": "[MONTH] 4, [ERA] [YEAR], dawn" } | { "after": "<event name>", "days": 14 } | "any time",
  "until": "<date>"?,  "where": "anywhere" | ["<region or place from the lists>", ...],
  "news": "<what the narrator is told, up to 500 characters, in the world's voice>",
  "once": true,
  "lasting": { "name": "...", "state": "looming|ongoing|resolved", "place": "...", "factions": ["..."], "summary": "...", "keep": false }? }

RULES:
- Use only the month names above, and only the regions and places listed. Write every date as in the example.
- Dates are on or after the story start. Instead of "days" an "after" delay may be given in "hours" or "months".
- An "after" event must name an event in the pack or in your list, and that earlier event needs a "lasting" (a change that stays in the world): the delay counts from when it happens.
- A "lasting" has a name of at most 80 characters, a summary of at most 240, and at most 4 factions. Set "keep" to true for at most two changes the narrator should keep in mind on every reply.
- Keep each news short and concrete, written as what the narrator is told, never as a plot summary.
- Never explain outside the JSON.

THE WRITER'S IDEA:
[WRITE YOUR IDEA HERE, up to 2,000 characters]

PLACES: [EVERY PLACE NAME THE EVENTS MAY USE, separated by commas]
```

## What each part of the answer means

- **name**: becomes the event's ID (`the-emperor-of-highmark-dies`). A name that is already taken gets a number after it.
- **when**: `{ "on": … }` is a date and time of day; `{ "after": …, "days" | "hours" | "months": N }` is at least that long
  after another event's lasting change entered the chronicle; `"any time"` is any reply. **until** ends it.
- **where**: `"anywhere"`, or regions and places of the pack (a region covers all its places).
- **news**: what the narrator is told, once, when the event happens (at most 500 characters).
- **once**: true (the default) for an event that happens one time.
- **lasting**: a world change that stays in Story Director's chronicle: a name, `looming`, `ongoing` or `resolved`, and
  optionally a place, up to four factions, a summary and `keep` (mentioned on every reply; at most two at a time).
  It needs Story Director with world-event support.
