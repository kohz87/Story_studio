// Syntax-checks every shipped module (everything under src/, scripts/ and tests/, the vendored Story Block copy included).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (name === 'node_modules') return [];
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') || path.endsWith('.mjs') ? [path] : [];
    });
}

for (const file of [...walk('src'), ...walk('scripts'), ...walk('tests'), ...walk('vendor')]) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('syntax ok');
