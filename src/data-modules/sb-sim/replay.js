// Replay purity: a simulated chat's live state must equal a fresh store's replay of its saved records, with and without checkpoints.
import { createStore } from '../../../vendor/story-block/src/v2/store.js';
import { createCommandBus } from '../../../vendor/story-block/src/v2/commands.js';
import { clone, same } from './util.js';

// Compare fresh stores over saved records, both with their checkpoints and with every later checkpoint removed,
// as Story Block's replay-purity tests do. The first carrier retains the initial state (including the sample actors).
export function replayEqual(host) {
    const live = host.head();
    const problems = store => store.problems().map(({ index, block, code }) => [index, block ?? null, code ?? null]);
    return [false, true].every(strip => {
        const chat = clone(host.ctx.chat);
        if (strip) {
            const first = chat.findIndex(message => !message.is_user && message.extra?.storySuite);
            chat.forEach((message, index) => {
                if (index === first) return;
                for (const holder of [message.extra, ...(message.swipe_info ?? []).map(swipe => swipe.extra)]) {
                    if (!holder?.storySuite) continue;
                    delete holder.storySuite.checkpoint;
                    delete holder.storySuite.covers;
                    delete holder.storySuite.coverHash;
                }
            });
        }
        const validate = (state, names) => names.flatMap(name => host.registry.validator(name)?.(state.domains?.[name], state) ?? []);
        const store = createStore({ chat: () => chat, save: async () => {}, validate, scratch: name => host.registry.scratch(name) });
        createCommandBus({ store, registry: host.registry, settings: host.settings });
        store.ensureInitial(host.registry.initialState());
        return same(store.head(), live) && same(problems(store), problems(host.store));
    });
}
