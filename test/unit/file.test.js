const test = require('node:test');
const assert = require('node:assert');
const { isVideoFile, getOutputFilePath, getTempFilePath } = require('../../src/utils/file');

test('File Utils - isVideoFile detects valid extensions', () => {
    assert.strictEqual(isVideoFile('video.mp4'), true);
    assert.strictEqual(isVideoFile('video.AVI'), true);
    assert.strictEqual(isVideoFile('document.txt'), false);
});

test('File Utils - getOutputFilePath enforces .mp4 extension', () => {
    assert.strictEqual(getOutputFilePath('test.avi', '/out'), '/out/test.mp4');
});

test('File Utils - getTempFilePath adds _tmp before extension', () => {
    assert.strictEqual(getTempFilePath('/dir/test.mp4'), '/dir/test_tmp.mp4');
});
