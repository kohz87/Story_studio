// npm run sync-kit -- --from <Story Block checkout>
//
// Copies Story Block's authoring kit (authoring-kit/: prompts, instructions, references, the checker) into
// authoring-kit/ here, so a creator who has Story Studio has the kit beside it. The copy is exactly the files Story Block
// has committed in that folder (never a creator's own work/ files), except that scripts/sb-root.mjs, the one line that says
// where Story Block's code is, points at vendor/story-block/ instead of the repository root: the checker in this copy runs
// against Studio's vendored Story Block, the same code Studio itself checks with.
//
// authoring-kit/VERSION names the Story Block commit it was copied from and records a hash of every file, so a test fails
// when the copy is edited by hand or drifts from its stamp. The folder is replaced as a whole. Plain Node, no dependencies.
// `--from` defaults to $STORY_BLOCK. The checkout must have the kit committed and unmodified, so the stamp is true.
// `npm run sync-sb` runs this as its last step.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT = 'authoring-kit';
export const SB_ROOT_FILE = 'scripts/sb-root.mjs';
export const SB_ROOT_LINE = "export const SB_V2 = new URL('../../src/v2/', import.meta.url);";
export const STUDIO_SB_ROOT_LINE = "export const SB_V2 = new URL('../../vendor/story-block/src/v2/', import.meta.url);";

const sha = data => createHash('sha256').update(data).digest('hex');

/** Every file of a kit folder as sorted relative paths, leaving out a creator's work/ files (only work/README.md belongs to the kit). */
export function kitFiles(dir) {
    const out = [];
    const walk = (folder, prefix) => {
        for (const name of readdirSync(folder).sort()) {
            const path = join(folder, name);
            const rel = prefix ? `${prefix}/${name}` : name;
            if (statSync(path).isDirectory()) walk(path, rel);
            else if (!rel.startsWith('work/') || rel === 'work/README.md') out.push(rel);
        }
    };
    walk(dir, '');
    return out.filter(rel => rel !== 'VERSION');
}

/** The lines of VERSION for a kit folder: the commit, then a hash for each file. */
export function stampOf(dir, commit) {
    const files = kitFiles(dir);
    return ['Story Block authoring kit', `commit ${commit}`, `rewritten ${SB_ROOT_FILE}`, `files ${files.length}`,
        ...files.map(rel => `${sha(readFileSync(join(dir, rel)))}  ${rel}`)].join('\n') + '\n';
}

/** Reads VERSION: { commit, rewritten, files: { path: hash } }. */
export function readStamp(text) {
    const files = {};
    let commit = null, rewritten = null;
    for (const line of text.split('\n')) {
        const hashed = /^([0-9a-f]{64})  (.+)$/.exec(line);
        if (hashed) files[hashed[2]] = hashed[1];
        else if (line.startsWith('commit ')) commit = line.slice(7);
        else if (line.startsWith('rewritten ')) rewritten = line.slice(10);
    }
    return { commit, rewritten, files };
}

function main() {
    const args = process.argv.slice(2);
    const at = args.indexOf('--from');
    const from = resolve(at >= 0 ? args[at + 1] ?? '' : process.env.STORY_BLOCK ?? '');
    const source = join(from, KIT);
    if (!existsSync(join(source, 'check.mjs'))) {
        console.error(`sync-kit: no authoring-kit in the Story Block checkout at ${from} (pass --from <path> or set STORY_BLOCK)`);
        process.exit(1);
    }
    const git = (...gitArgs) => execFileSync('git', ['-C', from, ...gitArgs], { encoding: 'utf8' });
    const commit = git('rev-parse', 'HEAD').trim();
    if (git('status', '--porcelain', '--', KIT).trim()) {
        console.error('sync-kit: the kit in that checkout has uncommitted changes; commit them first, so the stamp names a real commit');
        process.exit(1);
    }
    const tracked = git('ls-files', '-z', '--', KIT).split('\0').filter(Boolean).map(path => path.slice(KIT.length + 1));
    const target = resolve(KIT);
    rmSync(target, { recursive: true, force: true });
    for (const rel of tracked) {
        mkdirSync(dirname(join(target, rel)), { recursive: true });
        cpSync(join(source, rel), join(target, rel));
    }
    const rootFile = join(target, SB_ROOT_FILE);
    const original = readFileSync(rootFile, 'utf8');
    if (!original.includes(SB_ROOT_LINE)) {
        console.error(`sync-kit: ${SB_ROOT_FILE} no longer has the line this script rewrites; update scripts/sync-kit.mjs`);
        rmSync(target, { recursive: true, force: true });
        process.exit(1);
    }
    writeFileSync(rootFile, original.replace(SB_ROOT_LINE, STUDIO_SB_ROOT_LINE));
    writeFileSync(join(target, 'VERSION'), stampOf(target, commit));
    console.log(`sync-kit: ${KIT}/ from ${from} at ${commit.slice(0, 12)} (${kitFiles(target).length} files)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
