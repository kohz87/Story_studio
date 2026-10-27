// Writes a generated source file (src/assets/drawings.js, src/code-module/assets.js) without ever showing a reader a half-written file.
// The tests run scripts/build.mjs while other test files import those sources; a plain writeFile truncates the file first, so an import
// that landed in that moment saw an empty module and its test file failed. The text is written only when it differs from what is
// there (a build of unchanged sources touches nothing), and then to a sibling file that is renamed over the target in one step.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

export function writeGenerated(path, text) {
    try { if (readFileSync(path, 'utf8') === text) return false; } catch { /* not there yet */ }
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, text);
    renameSync(temporary, path);
    return true;
}
