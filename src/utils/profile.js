const fs = require('fs');
const path = require('path');

function loadConfig(configPath) {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found at ${configPath}`);
    }

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        throw new Error(`Error parsing configuration file: ${err.message}`);
    }
}

function getProfile(config, profileName) {
    const profile = config.profiles && config.profiles[profileName];
    if (!profile) {
        throw new Error(`Profile "${profileName}" not found in configuration.`);
    }
    return profile;
}

module.exports = {
    loadConfig,
    getProfile
};
