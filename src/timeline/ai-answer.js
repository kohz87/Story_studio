// Reading an AI's answer into draft events (pure).
//
// Tolerant of what a chat adds around the answer (a code fence, a sentence before or after, one event instead of a list,
// months, regions and places in any case) and strict about everything it writes: each event becomes the same spec the event
// form uses and is written with `writeCondition`, so a draft is what the form would have written. What cannot be written
// (a date that cannot be read, an earlier event that is not there, a delay with nothing to count from) is left out of the
// event and said in words in the draft's notes, each tied to the field it is about; what is only wrong once written (a place
// the pack lacks, a date before the story, news too long, a lasting change outside Story Director's limits) is found by
// `draftProblems`, as it is for any draft. A field of the wrong kind is a note too, never a quiet default. Nothing here
// turns an unknown value into text (it could throw), and every size is bounded before it is looked at. Sizes count Unicode
// characters (a dragon is one, though it takes two UTF-16 units), a cut never splits one, and a text that is cut says so.
export { MAX_EVENTS, readAnswer } from './ai-answer/read.js';
export { PASTE_LIMIT, findEvents } from './ai-answer/json.js';
export { readMoment } from './ai-answer/dates.js';
