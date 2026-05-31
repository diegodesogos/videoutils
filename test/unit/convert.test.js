const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const convertCommand = require('../../src/commands/convert');

test('Convert Command - Validation', (t) => {
    // Mock fs.existsSync to allow validation to pass for existing files
    const mockExists = t.mock.method(fs, 'existsSync', (p) => {
        if (p.includes('valid_source') || p.includes('valid_output')) return true;
        return false;
    });

    // 1. Missing parameters
    assert.deepStrictEqual(convertCommand.validate({}), ['Missing "sourceDirOrFile"', 'Missing "outputDir"']);

    // 2. Non-existent source
    assert.deepStrictEqual(convertCommand.validate({
        sourceDirOrFile: 'non_existent',
        outputDir: 'valid_output'
    }), ['Source not found: non_existent']);

    // 3. Valid parameters
    assert.deepStrictEqual(convertCommand.validate({
        sourceDirOrFile: 'valid_source',
        outputDir: 'valid_output'
    }), []);

    // 4. Invalid options format
    assert.deepStrictEqual(convertCommand.validate({
        sourceDirOrFile: 'valid_source',
        outputDir: 'valid_output',
        options: 'not-an-object'
    }), ['"options" must be an object']);

    // 5. Unknown options
    assert.deepStrictEqual(convertCommand.validate({
        sourceDirOrFile: 'valid_source',
        outputDir: 'valid_output',
        options: { unknownOpt: true }
    }), ['Unknown option: "unknownOpt"']);

    // 6. Invalid aspect ratio
    assert.deepStrictEqual(convertCommand.validate({
        sourceDirOrFile: 'valid_source',
        outputDir: 'valid_output',
        options: { aspectRatio: 'invalid' }
    }), ['Invalid "aspectRatio" format: "invalid". Valid format is "W:H" (e.g., "16:9") or "default".']);

    // 7. Valid aspect ratio
    assert.deepStrictEqual(convertCommand.validate({
        sourceDirOrFile: 'valid_source',
        outputDir: 'valid_output',
        options: { aspectRatio: '16:9' }
    }), []);
});
