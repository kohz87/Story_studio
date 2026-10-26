// Replace the host-only defaults before bundling; the synchronized vendor files stay untouched.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaults = new Map([
    [fileURLToPath(new URL('../vendor/story-block/src/v2/chat-file.js', import.meta.url)), {
        source: '(...args) => globalThis.fetch(...args)', count: 1,
        stub: "() => { throw new Error('Chat-file requests are unavailable offline.'); }",
    }],
    [fileURLToPath(new URL('../vendor/story-block/src/v2/rewind.js', import.meta.url)), {
        source: 'path => import(path)', count: 2,
        stub: "() => { throw new Error('Branch module loading is unavailable offline.'); }",
    }],
]);

export const offlineRuntime = {
    name: 'offline-runtime',
    setup(builder) {
        builder.onLoad({ filter: /\/(?:chat-file|rewind)\.js$/ }, async ({ path }) => {
            const replacement = defaults.get(path);
            if (!replacement) return;
            const contents = await readFile(path, 'utf8');
            // A vendor update must be reviewed instead of silently retaining a host capability.
            if (contents.split(replacement.source).length - 1 !== replacement.count) {
                throw new Error(`Offline default changed in ${path}`);
            }
            return { contents: contents.replaceAll(replacement.source, replacement.stub), loader: 'js' };
        });
    },
};
