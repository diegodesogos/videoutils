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

const convertCommand = require('../commands/convert');
const adjustExifCommand = require('../commands/adjust-exif');
const inspectCommand = require('../commands/inspect');

function validateProfile(profile) {
    if (!Array.isArray(profile)) {
        throw new Error('Profile must be an array of commands.');
    }

    const errors = [];
    profile.forEach((step, index) => {
        const stepNum = index + 1;
        if (!step.command) {
            errors.push(`Step ${stepNum}: Missing "command" property.`);
            return;
        }

        let commandErrors = [];
        switch (step.command) {
            case 'convert':
                commandErrors = convertCommand.validate(step);
                break;
            case 'adjust-exif':
                commandErrors = adjustExifCommand.validate(step);
                break;
            case 'inspect':
                commandErrors = inspectCommand.validate(step);
                break;
            default:
                errors.push(`Step ${stepNum}: Unknown command "${step.command}".`);
        }

        if (commandErrors.length > 0) {
            commandErrors.forEach(err => {
                errors.push(`Step ${stepNum} (${step.command}): ${err}`);
            });
        }
    });

    if (errors.length > 0) {
        throw new Error(`Configuration errors found:\n- ${errors.join('\n- ')}`);
    }
}

module.exports = {
    loadConfig,
    getProfile,
    validateProfile
};
