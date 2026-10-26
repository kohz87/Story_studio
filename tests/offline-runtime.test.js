import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { offlineRuntime } from '../scripts/offline-runtime.mjs';
import { firstReference } from '../scripts/dist-scan.mjs';

test('bundled chat-file and branch defaults throw without reaching a request or module loader', async () => {
    const result = await build({
        stdin: {
            contents: `import { createChatFile } from './vendor/story-block/src/v2/chat-file.js';
                import { stBranch, stCreateBranch } from './vendor/story-block/src/v2/rewind.js';
                globalThis.offlineDefaults = { createChatFile, stBranch, stCreateBranch };`,
            resolveDir: fileURLToPath(new URL('../', import.meta.url)),
        },
        plugins: [offlineRuntime], bundle: true, format: 'esm', target: 'es2022',
        write: false, minify: true, legalComments: 'none',
    });
    const bundle = result.outputFiles[0].text;
    assert.equal(firstReference(bundle), null);
    let requests = 0, imports = 0;
    const sandbox = { fetch() { requests++; }, TextEncoder };
    await new Script(`(async()=>{${bundle}})()`, {
        importModuleDynamically() { imports++; throw new Error('Unexpected module load'); },
    }).runInNewContext(sandbox);
    const { createChatFile, stBranch, stCreateBranch } = sandbox.offlineDefaults;
    const file = createChatFile({ context: () => ({ getRequestHeaders: () => ({}) }) });
    const place = { chatId: 'offline', name: 'offline', avatar: 'offline.png' };
    await assert.rejects(file.read(place), /Chat-file requests are unavailable offline/);
    await assert.rejects(file.write(place, []), /Chat-file requests are unavailable offline/);
    await assert.rejects(stBranch({})(0), /no way to branch/);
    await assert.rejects(stCreateBranch({})(0), /no way to branch/);
    assert.equal(requests, 0);
    assert.equal(imports, 0);
});
