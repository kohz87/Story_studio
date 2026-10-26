// Builds the waiting-state page (no runtime, test-only) into a temporary folder, once per test run.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let built;
export function waitingDist() {
    if (built) return built;
    const dir = mkdtempSync(join(tmpdir(), 'studio-dm-waiting-'));
    const out = join(dir, 'story-studio-waiting.html');
    execFileSync(process.execPath, [resolve('scripts/build.mjs'), '--entry', 'tests/helpers/dm-waiting-entry.js', '--out', out], { stdio: 'pipe' });
    built = { path: out, url: pathToFileURL(out).href };
    return built;
}
