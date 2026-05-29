const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadConfig, getProfile, validateProfile } = require('../../src/utils/profile');

test('Profile Utility', async (t) => {
    const mockConfigPath = path.join(__dirname, 'mock-config.json');
    
    t.before(() => {
        const mockConfig = {
            profiles: {
                'test-profile': [
                    { command: 'inspect', targetDirOrFile: './test' }
                ]
            }
        };
        fs.writeFileSync(mockConfigPath, JSON.stringify(mockConfig));
    });

    t.after(() => {
        if (fs.existsSync(mockConfigPath)) {
            fs.unlinkSync(mockConfigPath);
        }
    });

    await t.test('loadConfig should read and parse config file', () => {
        const config = loadConfig(mockConfigPath);
        assert.strictEqual(typeof config.profiles, 'object');
        assert.ok(config.profiles['test-profile']);
    });

    await t.test('loadConfig should throw error if file missing', () => {
        assert.throws(() => loadConfig('non-existent.json'), /Configuration file not found/);
    });

    await t.test('getProfile should return profile by name', () => {
        const config = { profiles: { 'p1': [{}] } };
        const profile = getProfile(config, 'p1');
        assert.ok(Array.isArray(profile));
    });

    await t.test('getProfile should throw error if profile missing', () => {
        const config = { profiles: {} };
        assert.throws(() => getProfile(config, 'missing'), /Profile "missing" not found/);
    });

    await t.test('validateProfile should catch missing parameters', () => {
        const invalidProfile = [{ command: 'convert' }]; // missing sourceDir, outputDir
        assert.throws(() => validateProfile(invalidProfile), /Missing "sourceDirOrFile"/);
    });

    await t.test('validateProfile should catch unknown commands', () => {
        const invalidProfile = [{ command: 'invalid' }];
        assert.throws(() => validateProfile(invalidProfile), /Unknown command "invalid"/);
    });

    await t.test('validateProfile should catch invalid options type', () => {
        const invalidProfile = [{ command: 'inspect', targetDirOrFile: '.', options: 'not-an-object' }];
        assert.throws(() => validateProfile(invalidProfile), /"options" must be an object/);
    });

    await t.test('validateProfile should catch unknown options', () => {
        const invalidProfile = [{ command: 'convert', sourceDirOrFile: '.', outputDir: '.', options: { unknown: true } }];
        assert.throws(() => validateProfile(invalidProfile), /Unknown option: "unknown"/);
    });

    await t.test('validateProfile should catch invalid compareDate values', () => {
        const invalidProfile = [{ command: 'adjust-exif', targetDirOrFile: '.', options: { compareDate: 'invalid' } }];
        assert.throws(() => validateProfile(invalidProfile), /Invalid compareDate value: "invalid"/);
    });

    await t.test('validateProfile should catch invalid aspectRatio values for remux', () => {
        const invalidProfile = [{ command: 'remux', targetDirOrFile: '.', options: { aspectRatio: 'invalid' } }];
        assert.throws(() => validateProfile(invalidProfile), /Invalid "aspectRatio" format/);
    });

    await t.test('validateProfile should pass for valid profile', () => {
        const validProfile = [
            { command: 'inspect', targetDirOrFile: '.' },
            { command: 'remux', targetDirOrFile: '.', options: { aspectRatio: '16:9' } }
        ];
        assert.doesNotThrow(() => validateProfile(validProfile));
    });
});
