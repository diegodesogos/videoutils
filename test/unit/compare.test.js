const test = require('node:test');
const assert = require('node:assert');
const { shouldAdjustDate } = require('../../src/utils/date');

test('Date Utils - shouldAdjustDate (comparison modes)', async (t) => {
    const filenameDate = new Date('2024-05-01T12:00:00Z');
    const metadataDateOld = new Date('2020-01-01T12:00:00Z');
    const metadataDateNew = new Date('2025-01-01T12:00:00Z');
    const metadataDateMatch = new Date('2024-05-01T12:00:00Z');

    await t.test('No mode - defaults to distinct (only true if mismatch)', () => {
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateOld, null), { isMismatch: true, shouldAdjust: true });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateMatch, null), { isMismatch: false, shouldAdjust: false });
    });

    await t.test('Mode "distinct" - returns true only if dates mismatch', () => {
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateMatch, 'distinct'), { isMismatch: false, shouldAdjust: false });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateOld, 'distinct'), { isMismatch: true, shouldAdjust: true });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, null, 'distinct'), { isMismatch: true, shouldAdjust: true });
    });

    await t.test('Mode "fileNameNewer" - returns true if filename is newer', () => {
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateOld, 'fileNameNewer'), { isMismatch: true, shouldAdjust: true });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateNew, 'fileNameNewer'), { isMismatch: true, shouldAdjust: false });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateMatch, 'fileNameNewer'), { isMismatch: false, shouldAdjust: false });
    });

    await t.test('Mode "fileNameOlder" - returns true if filename is older', () => {
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateNew, 'fileNameOlder'), { isMismatch: true, shouldAdjust: true });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateOld, 'fileNameOlder'), { isMismatch: true, shouldAdjust: false });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, metadataDateMatch, 'fileNameOlder'), { isMismatch: false, shouldAdjust: false });
    });

    await t.test('Handles missing metadata gracefully', () => {
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, null, 'fileNameNewer'), { isMismatch: true, shouldAdjust: false });
        assert.deepStrictEqual(shouldAdjustDate(filenameDate, null, 'fileNameOlder'), { isMismatch: true, shouldAdjust: false });
    });
});
