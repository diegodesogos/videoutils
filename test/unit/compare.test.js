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

    await t.test('Heuristics', async (t2) => {
        const preciseFile = new Date('2024-05-01T10:30:00Z');
        const suspiciousFile = new Date('2024-05-01T12:00:00Z');
        const preciseMeta = new Date('2024-05-01T10:30:00Z');
        const suspiciousMeta = new Date('2024-05-01T12:00:00Z');
        const epochZeroMeta = new Date('1970-01-01T00:00:00Z');
        const diffMoreThanDayFile = new Date('2024-05-03T12:00:00Z');

        await t2.test('Missing or Epoch Zero metadata bypasses mode and adjusts (applyHeuristics: true)', () => {
            assert.deepStrictEqual(shouldAdjustDate(preciseFile, null, 'fileNameOlder', true), { isMismatch: true, shouldAdjust: true, heuristicApplied: 'epoch-zero' });
            assert.deepStrictEqual(shouldAdjustDate(preciseFile, epochZeroMeta, 'distinct', true), { isMismatch: true, shouldAdjust: true, heuristicApplied: 'epoch-zero' });
        });

        await t2.test('Midnight/Noon precision - filename suspicious, metadata precise (diff < 24h)', () => {
            assert.deepStrictEqual(shouldAdjustDate(suspiciousFile, preciseMeta, 'distinct', true), { isMismatch: true, shouldAdjust: false, syncToMetadata: true, heuristicApplied: 'precise-metadata' });
        });

        await t2.test('Midnight/Noon precision - filename precise, metadata suspicious (diff < 24h)', () => {
            assert.deepStrictEqual(shouldAdjustDate(preciseFile, suspiciousMeta, 'distinct', true), { isMismatch: true, shouldAdjust: true, heuristicApplied: 'precise-filename' });
        });

        await t2.test('Midnight/Noon precision - skipped if both precise', () => {
            assert.deepStrictEqual(shouldAdjustDate(preciseFile, preciseMeta, 'distinct', true), { isMismatch: false, shouldAdjust: false });
        });
        
        await t2.test('Midnight/Noon precision - skipped if both suspicious', () => {
            assert.deepStrictEqual(shouldAdjustDate(suspiciousFile, suspiciousMeta, 'distinct', true), { isMismatch: false, shouldAdjust: false });
        });

        await t2.test('Midnight/Noon precision - skipped if diff >= 24h', () => {
            assert.deepStrictEqual(shouldAdjustDate(diffMoreThanDayFile, preciseMeta, 'distinct', true), { isMismatch: true, shouldAdjust: true });
        });
    });
});
