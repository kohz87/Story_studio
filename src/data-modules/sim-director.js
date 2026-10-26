// The sample "Story Director" a simulation runs beside the data module under test. Data modules read Story Director
// only through its published state contracts (`director.time` minutes, `checks.policy` actor identities); this owner
// publishes exactly those, from the scenario's sample actors and starting minute, on a disposable in-memory chat.
// Time moves the way the real owner's does: a narrated `! time` line changes the director domain in the same reply, so
// timers see a new prefix, not a stubbed answer. It rolls nothing and checks nothing; v1 data modules need neither.

const ID = /^ca_[a-z0-9]{8}$/;
const UNITS = { m: 1, h: 60, d: 1440 };

/** A stable SD-shaped actor ID for a sample character name ("Wessel" gives ca_wessel01); a given ca_ ID is kept. */
export function actorId(name, taken = []) {
    if (ID.test(name)) return name;
    const stem = `${String(name).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')}xxxxxx`.slice(0, 6);
    for (let n = 1; n < 100; n++) {
        const id = `ca_${stem}${String(n).padStart(2, '0')}`;
        if (!taken.includes(id)) return id;
    }
    return `ca_${stem}99`;
}

/** Sample actors from the scenario's names (or ca_ IDs): [{ id, name }] with distinct IDs. */
export function sampleActors(names) {
    const actors = [];
    for (const raw of Array.isArray(names) ? names : []) {
        const name = ID.test(raw) ? raw.slice(3) : String(raw).trim();
        if (!name) continue;
        const id = actorId(raw, actors.map(actor => actor.id));
        if (!actors.some(actor => actor.id === id)) actors.push({ id, name: name.slice(0, 40) });
    }
    return actors;
}

/** Minutes in a `! time` argument: "+6h", "+30m", "+2d" or a bare number of minutes. Null when it is not one. */
export function timeMinutes(text) {
    const match = /^\+?(\d{1,7})\s*([mhd]?)$/i.exec(String(text ?? '').trim());
    return match ? Number(match[1]) * UNITS[(match[2] || 'm').toLowerCase()] : null;
}

/** The owner module for Story Block's host: `minute` null leaves story time unset (data modules then wait). */
export function sampleDirector({ minute, actors }) {
    return {
        id: 'story-director', version: '2.0.0',
        domains: {
            director: { initial: () => ({ time: { minutes: Number.isSafeInteger(minute) ? minute : null } }) },
            checks: { initial: () => ({ policy: { actors: Object.fromEntries(actors.map(actor => [actor.id, { id: actor.id, name: actor.name, bonuses: {} }])) } }) },
        },
        commands: {},
        capture: {
            kinds: { time: { grammar: '! time +6h' } },
            apply(ctx, line) {
                const minutes = timeMinutes(line.name);
                if (minutes === null) return ctx.fail('REFUSED', `"${line.name}" is not a sample time step (use +30m, +6h or +2d).`);
                const time = ctx.draft('director').time;
                if (time.minutes === null) return ctx.fail('REFUSED', 'The sample story time is not set.');
                time.minutes += minutes;
                return { narrate: false };
            },
        },
        queries: { 'director.time': state => ({ ...state.domains.director.time }), 'checks.policy': state => ({ ...state.domains.checks.policy }) },
    };
}
