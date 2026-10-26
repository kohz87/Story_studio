// Builds the stand-in distribution (stub backend + the real Studio) into a temporary folder, once per test run.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let built;
export function stubDist() {
    if (built) return built;
    const dir = mkdtempSync(join(tmpdir(), 'studio-dm-stub-'));
    const out = join(dir, 'story-studio-stub.html');
    execFileSync(process.execPath, [resolve('scripts/build.mjs'), '--entry', 'tests/helpers/dm-stub-entry.js', '--out', out], { stdio: 'pipe' });
    built = { path: out, url: pathToFileURL(out).href };
    return built;
}
