// npm run sync-sb -- --from <Story Block checkout>
//
// Copies Story Block's v2 runtime (the pack checker in src/v2/packs/, the widgets in src/v2/view/, and what they import)
// into vendor/story-block/, using Story Block's own scripts/sync-testkit.mjs so both copy the same files the same way.
// Studio imports Story Block only from vendor/story-block/. VERSION there names the commit it was copied from.
// The folder is replaced as a whole. Plain Node, no dependencies. `--from` defaults to $STORY_BLOCK.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--from');
const from = resolve(at >= 0 ? args[at + 1] ?? '' : process.env.STORY_BLOCK ?? '');
const script = join(from, 'scripts', 'sync-testkit.mjs');
if (!existsSync(script)) {
    console.error(`sync-sb: no Story Block checkout at ${from} (pass --from <path> or set STORY_BLOCK)`);
    process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'studio-sync-'));
try {
    execFileSync(process.execPath, [script, scratch, '--from', from], { stdio: 'inherit' });
    const target = resolve('vendor', 'story-block');
    rmSync(target, { recursive: true, force: true });
    mkdirSync(resolve('vendor'), { recursive: true });
    cpSync(join(scratch, 'tests', 'vendor', 'story-block'), target, { recursive: true });
    // The checker's shipped fixtures (valid packs and one refusal vector per DM_* code) travel with the vendored copy,
    // so parity tests can run from a lone clone. They are data, never edited here.
    const fixtures = join(from, 'tests', 'v2', 'data-modules', 'fixtures');
    const fixtureTarget = resolve('vendor', 'story-block-fixtures', 'data-modules');
    rmSync(resolve('vendor', 'story-block-fixtures'), { recursive: true, force: true });
    if (existsSync(fixtures)) cpSync(fixtures, fixtureTarget, { recursive: true });
    console.log(`sync-sb: vendor/story-block from ${from}`);
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
