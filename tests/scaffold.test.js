// The scaffold: the scripts the CI runs exist, and nothing ships a dependency (Studio is plain ES modules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package.json: the check, test and sync scripts, no dependencies', () => {
    for (const name of ['check', 'test', 'test:dot', 'sync-sb']) assert.ok(pkg.scripts?.[name], name);
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.dependencies, undefined);
});
