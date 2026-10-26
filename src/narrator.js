// Story Block SPEC §4.4: copied line grammar and examples, not a new protocol.
export const CHANGE_GRAMMAR = `Write one <Changes> block at the end of a reply when something changed.
Use only kinds supplied by the installed Story Suite modules; leave out what did not change.
op kind Name[ — text][ | label: value]*, one per line.
op: + new or gained, - gone or lost, ~ changed, ! happened, ? asks code to decide (a check, a roll).
Names resolve through the owning module's alias index; do not invent IDs or unknown kinds.
Examples from Story Block's documented grammar:
<Changes>
+ item Moonveil Trout | qty: 1 | note: violet-streaked, from the lake
- item Rope | qty: 1
~ quest Granary Rats | step: the cellar is cleared
! event Dragon sighted — smoke over the eastern ridge
? check stealth — slipping past the gate guard | dc: hard
</Changes>`;

const text = value => typeof value === 'string' ? value : '';

export function narratorFields(pack) {
    const place = pack?.start?.scene?.place;
    const startPlace = text(place?.name) || text(place);
    const region = text(place?.region);
    const clock = pack?.calendar?.start;
    const startTime = clock ? [clock.year, clock.month, clock.day].filter(v => v !== undefined).join(' ') +
        (clock.hour !== undefined ? ` ${String(clock.hour).padStart(2, '0')}:${String(clock.minute ?? 0).padStart(2, '0')}` : '') +
        (pack.calendar.era ? ` ${pack.calendar.era}` : '') : '';
    const location = [startPlace, region].filter(Boolean).join(', ');
    const opening = location ? `You are at ${location}.` : 'Choose a starting place for this story.';
    return {
        name: `${text(pack?.name) || 'Pack'} — Narrator`,
        description: [`You narrate ${text(pack?.name) || 'this pack'} for {{user}}. Describe the world and its inhabitants, and leave {{user}}'s choices to them.`,
            text(pack?.description), CHANGE_GRAMMAR].filter(Boolean).join('\n\n'),
        personality: text(pack?.toneNotes) || text(pack?.tone),
        scenario: [location && `Start place: ${location}`, startTime && `Start time: ${startTime}`].filter(Boolean).join('\n'),
        first_mes: [opening, startTime && `It is ${startTime}.`, 'What do you do?'].filter(Boolean).join(' '),
        mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '',
        creator: text(pack?.author), character_version: text(pack?.version),
    };
}

export function narratorCard(pack, overrides = {}) {
    if (!pack || typeof pack !== 'object') throw new Error('Open a pack first');
    const data = narratorFields(pack);
    for (const key of Object.keys(data)) {
        if (Object.hasOwn(overrides, key)) {
            if (typeof overrides[key] !== 'string') throw new Error(`${key} must be text`);
            data[key] = overrides[key];
        }
    }
    return { spec: 'chara_card_v2', spec_version: '2.0', data: {
        ...data, alternate_greetings: [], tags: [], extensions: {},
    } };
}

export function exportNarrator(pack, overrides) {
    return JSON.stringify(narratorCard(pack, overrides), null, 2) + '\n';
}
