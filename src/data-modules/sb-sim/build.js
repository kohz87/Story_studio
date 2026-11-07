// Building the sample world: the pack checked and installed on a disposable host, the data modules it needs pinned in order.
import { validatePack } from '../../../vendor/story-block/src/v2/packs/validate.js';
import { fail } from './util.js';
import { createSimulationHost } from './host.js';
import { sampleDirector } from '../sim-director.js';

function needed(definitions, target) {
    const order = [];
    const visit = definition => {
        if (!definition || order.includes(definition)) return;
        for (const entry of Object.values(definition.imports ?? {})) {
            if (entry?.query === 'dataModules.public') visit(definitions.find(item => item.id === entry.args?.module));
        }
        order.push(definition);
    };
    visit(target);
    return order;
}

export async function build(request, actors) {
    const { pack, module, scenario } = request;
    const verdict = validatePack(pack);
    if (!verdict.ok) return { error: { ok: false, errors: verdict.errors } };
    const definitions = verdict.pack.content.dataModules;
    const target = definitions.find(item => item.id === module);
    if (!target) return { error: fail('DM_SCHEMA', `The pack has no data module ${module}.`) };
    const minute = scenario.startMinute === null || scenario.startMinute === '' ? null : scenario.startMinute;
    if (minute !== null && !Number.isSafeInteger(minute)) return { error: fail('DM_BOUNDS', 'The starting story minute must be a whole number.', 'startMinute') };
    // Short scenarios still exercise checkpoints and trimmed receipts, with the same storeOptions as the testkit host.
    const host = await createSimulationHost({ modules: [sampleDirector({ minute, actors })], storeOptions: { checkpointEvery: 2, receiptKeep: 3 } });
    const installed = await host.packs.packs.install(pack);
    if (!installed.ok) { host.close(); return { error: fail(installed.code ?? 'REFUSED', installed.message ?? 'The pack could not be installed on the sample chat.') }; }
    for (const definition of needed(definitions, target)) {
        const offer = host.sdk.query('dataModules.setup').find(row => row.module === definition.id);
        if (!offer || offer.available === false) { host.close(); return { error: fail('DEPENDENCY_UNAVAILABLE', offer?.reason || `No offer for ${definition.id}.`) }; }
        const subjects = definition.scope === 'character' ? actors.map(actor => actor.id) : [];
        const pinned = await host.sdk.command('dm.pin', { module: definition.id, hash: offer?.hash, packHash: offer?.packHash, subjects });
        if (!pinned.ok) { host.close(); return { error: fail(pinned.code ?? 'REFUSED', pinned.message ?? `Could not pin ${definition.id}.`) }; }
    }
    return { host, target };
}
