import { worldPack } from './world.js';

/** Two people as Story Block's cast format has them: one with everything, one with only what is required. */
export function castEntries() {
    return [
        {
            id: 'fenna', name: 'Fenna', aliases: ['the ferrywoman'], about: 'Runs the night ferry between Haven and Mill.',
            look: 'Late thirties, wiry, a tar-stained coat.', voice: 'Dry and unhurried.', personality: 'Patient, watchful.',
            history: 'Lost her husband to the weir in 598.', portrait: 'fenna.webp',
            start: { place: 'Haven', goal: 'Find out who opened the weir.', routine: 'Works the night ferry from dusk.' },
            drawnTo: ['the weir', 'a flood on the river'],
            meters: { preset: 'companion', trust: 10 },
            stages: [{ id: 'regular', name: 'Regular passenger', needs: [{ meter: 'trust', at: 20 }] }],
            fields: { Trade: 'Night ferry' },
            secrets: [
                { title: 'Her husband’s debt', text: 'He owed the smugglers.', meter: 'trust', at: 20 },
                { title: 'The weir night', text: 'She was paid to look away.', meter: 'trust', at: 60 },
                { title: 'Who paid her', text: 'The guild’s treasurer.', when: 'the party finds the weir ledger' },
            ],
        },
        { id: 'sera', name: 'Sera', about: 'A river scout hunting her brother’s killer.', look: 'Mid twenties, lean, copper hair.', start: { place: 'Mill', goal: 'Find the killer.' } },
    ];
}

export function castPack(options = {}) {
    const pack = worldPack(options);
    pack.content.cast = options.cast ?? castEntries();
    return pack;
}
