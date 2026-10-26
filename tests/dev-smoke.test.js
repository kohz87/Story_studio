// Dev page Playwright smoke test: headless file-access verification (SPEC §5).

import test from 'node:test';
import assert from 'node:assert/strict';

import { smallRulesPack } from './fixtures/smallRulesPack.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { exportRulesV2, validateRulesPack } from '../vendor/story-block/src/v2/packs/rules-v2.js';

test('dev page smoke test in Chromium', async t => {
    let pwModulePath = process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright';
    if (pwModulePath.startsWith('/') && !pwModulePath.startsWith('file://')) {
        pwModulePath = pathToFileURL(pwModulePath).href;
    }

    let playwright = null;
    let importError = null;

    try {
        playwright = await import(pwModulePath);
    } catch (err) {
        importError = err;
        if (!process.env.STUDIO_PLAYWRIGHT_MODULE) {
            try {
                playwright = await import('playwright-core');
            } catch (err2) {
                importError = err2;
            }
        }
    }

    if (!playwright) {
        t.skip(`Playwright is not available: ${importError?.message || 'module not found'}`);
        return;
    }

    const chromium = playwright.chromium || playwright.default?.chromium || (typeof playwright.default?.launch === 'function' ? playwright.default : null);
    if (!chromium) {
        t.skip('Playwright chromium export is not available');
        return;
    }

    let chromiumExecutable = process.env.STUDIO_CHROMIUM_PATH;

    if (!chromiumExecutable) {
        const candidatePaths = [
            '/opt/pw-browsers/chromium/chrome-linux/chrome',
            '/opt/pw-browsers/chromium/chrome',
            '/opt/pw-browsers/chrome-linux/chrome',
            '/opt/pw-browsers/chrome',
        ];
        for (const cand of candidatePaths) {
            if (existsSync(cand)) {
                chromiumExecutable = cand;
                break;
            }
        }
    }

    if (!chromiumExecutable && typeof chromium.executablePath === 'function') {
        try {
            const bundled = chromium.executablePath();
            if (bundled && existsSync(bundled)) {
                chromiumExecutable = bundled;
            }
        } catch {
            // Bundled discovery unavailable
        }
    }

    if (!chromiumExecutable) {
        t.skip('Chromium executable not found (set STUDIO_CHROMIUM_PATH or install Chromium)');
        return;
    }

    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--allow-file-access-from-files', '--no-sandbox'],
            executablePath: chromiumExecutable,
        });
    } catch (err) {
        throw new Error(`Failed to launch Chromium at "${chromiumExecutable}": ${err.message}`);
    }

    let context;
    try {
        context = await browser.newContext({
            acceptDownloads: true,
        });
        const page = await context.newPage();

        const pageErrors = [];
        page.on('pageerror', err => {
            pageErrors.push(err);
        });

        const devHtmlPath = resolve('src/dev.html');
        const devHtmlUrl = pathToFileURL(devHtmlPath).href;
        await page.goto(devHtmlUrl);

        // Upload broken fixture and assert checker error
        const brokenPack = smallRulesPack();
        brokenPack.content.rules[0].classes[0].skills = ['s00'];

        await page.setInputFiles('#pack-file', {
            name: 'broken-fixture.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(brokenPack)),
        });

        await page.waitForSelector('#errors li');
        const errorsText = await page.textContent('#errors');
        assert.match(errorsText, /class-skills/);
        assert.match(errorsText, /content\.rules\[0\]\.classes\[0\]\.skills/);

        const isExportDisabled = await page.locator('#export-pack').isDisabled();
        assert.equal(isExportDisabled, true, 'Export button must be disabled for broken pack');

        // Load valid golden seed
        const goldenPack = smallRulesPack();

        await page.setInputFiles('#pack-file', {
            name: 'golden-seed.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(goldenPack)),
        });

        await page.waitForFunction(() => {
            const el = document.getElementById('pack-name');
            return el && el.value === 'Fixture';
        });

        const errorCount = await page.locator('#errors li').count();
        assert.equal(errorCount, 0, 'Validation errors must clear on valid pack load');

        const isExportEnabled = await page.locator('#export-pack').isEnabled();
        assert.equal(isExportEnabled, true, 'Export button must be enabled for valid pack');

        const contentsCount = await page.locator('#contents li').count();
        assert.ok(contentsCount > 0, 'Contents list must contain records');

        // Apply name edit, undo, redo
        const newName = 'Renamed Golden Pack';
        await page.fill('#pack-name', newName);
        await page.click('#apply-name');

        assert.equal(await page.inputValue('#pack-name'), newName);
        assert.equal(await page.locator('#undo').isEnabled(), true);

        await page.click('#undo');
        assert.equal(await page.inputValue('#pack-name'), 'Fixture');
        assert.equal(await page.locator('#redo').isEnabled(), true);

        await page.click('#redo');
        assert.equal(await page.inputValue('#pack-name'), newName);
        assert.equal(await page.locator('#undo').isEnabled(), true);
        assert.equal(await page.locator('#redo').isDisabled(), true);

        // Export and download the authored structure with only the requested edit.
        const downloadPromise = page.waitForEvent('download');
        await page.click('#export-pack');
        const download = await downloadPromise;

        const stream = await download.createReadStream();
        const downloadedChunks = [];
        for await (const chunk of stream) {
            downloadedChunks.push(chunk);
        }
        const exportedText = Buffer.concat(downloadedChunks).toString('utf8');

        assert.equal(exportedText, JSON.stringify({ ...goldenPack, name: newName }, null, 2) + '\n');
        assert.deepEqual(JSON.parse(exportedText), { ...goldenPack, name: newName });
        const expectedExport = exportRulesV2({ ...goldenPack, name: newName });
        assert.equal(expectedExport.ok, true, 'Shared exportRulesV2 should succeed');

        // Reopen downloaded file in page and verify both hashes on reopen
        await page.setInputFiles('#pack-file', {
            name: 'reopened-pack.json',
            mimeType: 'application/json',
            buffer: Buffer.from(exportedText),
        });

        await page.waitForFunction((expectedName) => {
            const el = document.getElementById('pack-name');
            return el && el.value === expectedName;
        }, newName);

        const reopenedErrorCount = await page.locator('#errors li').count();
        assert.equal(reopenedErrorCount, 0, 'Errors list must be clear after reopening exported pack');

        const isReopenedExportEnabled = await page.locator('#export-pack').isEnabled();
        assert.equal(isReopenedExportEnabled, true, 'Export button must be enabled after reopening exported pack');

        const reopenedValidation = validateRulesPack(exportedText);
        assert.equal(reopenedValidation.ok, true, 'Reopened pack must pass shared validation');
        assert.equal(reopenedValidation.rulesHash, expectedExport.rulesHash, 'reopened rulesHash must match canonical export');
        assert.equal(reopenedValidation.packHash, expectedExport.packHash, 'reopened packHash must match canonical export');

        assert.equal(pageErrors.length, 0, `Page errors encountered: ${pageErrors.map(e => e.message).join(', ')}`);
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
});
