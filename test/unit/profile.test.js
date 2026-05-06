const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadConfig, getProfile } = require('../../src/utils/profile');

test('Profile Utility', async (t) => {
    const mockConfigPath = path.join(__dirname, 'mock-config.json');
    
    t.before(() => {
        const mockConfig = {
            profiles: {
                'test-profile': [
                    { command: 'inspect', targetDir: './test' }
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
});
