// Golden values: the small rules pack's hashes, and parity with Story Block on a byte order mark.

import test from 'node:test';
import assert from 'node:assert/strict';

import { openPack } from '../src/model.js';
import { validateRulesPack } from '../vendor/story-block/src/v2/packs/rules-v2.js';
import { smallRulesPack } from './fixtures/smallRulesPack.js';

const RULES_HASH = 'bbcf96a8f04da8e007c2fb3840a3939a1d30e3820ddcb48c3e4632186e816f5b';
const PACK_HASH = '19d91d55a09d3d21bf9ea865e1cadc63561a44be65745d61530046c39b718625';

test('the small rules pack opens with the golden hashes', () => {
    const model = openPack(smallRulesPack());
    assert.equal(model.validation.ok, true);
    assert.equal(model.rulesHash, RULES_HASH);
    assert.equal(model.packHash, PACK_HASH);
});

test('pack text with a leading byte order mark opens as Story Block accepts it', () => {
    const text = '﻿' + JSON.stringify(smallRulesPack());
    assert.equal(validateRulesPack(text).ok, true);
    const model = openPack(text);
    assert.equal(model.validation.ok, true);
    assert.equal(model.rulesHash, RULES_HASH);
    assert.equal(model.packHash, PACK_HASH);
});
