const test = require('node:test');
const assert = require('node:assert');
const { extractDateFromFilename, formatFfmpegDate } = require('../../src/utils/date');

test('Date Utils - extractDateFromFilename handles basic date', () => {
    const res = extractDateFromFilename('2005-01-22 Viaje.avi');
    assert.strictEqual(res.iso, '2005-01-22T12:00:00Z');
});

test('Date Utils - extractDateFromFilename handles date and time', () => {
    const res = extractDateFromFilename('2007-12-07_192638.mpg');
    assert.strictEqual(res.iso, '2007-12-07T19:26:38Z');
});

test('Date Utils - extractDateFromFilename handles multiple dates by picking the last one', () => {
    const res = extractDateFromFilename('2005-01-22 al 2005-02-02- Patagonia_Patagonia-2005-01-22 Viaje_012.AVI');
    assert.strictEqual(res.iso, '2005-01-22T12:00:00Z');
});

test('Date Utils - formatFfmpegDate formats legacy EXIF date correctly', () => {
    assert.strictEqual(formatFfmpegDate('2003:08:02 10:40:48'), '2003-08-02T10:40:48Z');
    assert.strictEqual(formatFfmpegDate('2003-08-02T10:40:48Z'), '2003-08-02T10:40:48Z');
});
