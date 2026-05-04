const test = require('node:test');
const assert = require('node:assert');
const { matchesFilters } = require('../../src/utils/filter');

test('Filter Utils - additive filters (AND logic)', async (t) => {
    const meta = {
        duration: 120, // 2 mins
        height: 720,
        width: 1280
    };

    await t.test('No filters returns true', () => {
        assert.strictEqual(matchesFilters(meta, {}), true);
    });

    await t.test('Matches single duration filter', () => {
        assert.strictEqual(matchesFilters(meta, { minDuration: '1.5' }), true);
        assert.strictEqual(matchesFilters(meta, { minDuration: '2.5' }), false);
    });

    await t.test('Matches single height filter', () => {
        assert.strictEqual(matchesFilters(meta, { minHeight: '480' }), true);
        assert.strictEqual(matchesFilters(meta, { minHeight: '1080' }), false);
    });

    await t.test('Matches single resolution filter (width)', () => {
        assert.strictEqual(matchesFilters(meta, { minResolution: '1000' }), true);
        assert.strictEqual(matchesFilters(meta, { minResolution: '1500' }), false);
    });

    await t.test('Matches single resolution filter (WxH)', () => {
        assert.strictEqual(matchesFilters(meta, { minResolution: '1280x720' }), true);
        assert.strictEqual(matchesFilters(meta, { minResolution: '1920x1080' }), false);
    });

    await t.test('Filters are additive: true when ALL match', () => {
        // duration > 1, height > 480, resolution > 1000
        const options = {
            minDuration: '1',
            minHeight: '480',
            minResolution: '1000'
        };
        assert.strictEqual(matchesFilters(meta, options), true);
    });

    await t.test('Filters are additive: false when ANY fails', () => {
        // duration > 1 (true), height > 480 (true), resolution > 1500 (false)
        const options = {
            minDuration: '1',
            minHeight: '480',
            minResolution: '1500'
        };
        assert.strictEqual(matchesFilters(meta, options), false);

        // duration > 3 (false), height > 480 (true), resolution > 1000 (true)
        const options2 = {
            minDuration: '3',
            minHeight: '480',
            minResolution: '1000'
        };
        assert.strictEqual(matchesFilters(meta, options2), false);
    });
});
