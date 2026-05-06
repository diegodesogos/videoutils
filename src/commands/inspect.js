const fs = require('fs');
const path = require('path');
const { isVideoFile } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { matchesFilters } = require('../utils/filter');

function inspectCommand(targetDir, options = {}) {
    const { minDuration, minHeight, minResolution } = options;
    const absolutePath = path.resolve(targetDir);
    
    if (!fs.existsSync(absolutePath)) {
        console.error(`Error: Folder not found at ${absolutePath}`);
        return;
    }

    const files = fs.readdirSync(absolutePath);
    console.log(`Scanning: ${absolutePath}\n`);

    let foundCount = 0;

    files.forEach(file => {
        if (!isVideoFile(file)) return;

        const filePath = path.join(absolutePath, file);
        const meta = getMetadata(filePath);
        if (!meta) return;

        const stat = fs.statSync(filePath);

        if (matchesFilters(meta, options)) {
            foundCount++;
            console.log(`File: ${file}`);
            console.log(`  Codec: ${meta.codec} | Res: ${meta.width}x${meta.height} | Duration: ${(meta.duration / 60).toFixed(2)} mins`);
            
            console.log(`  FS Created : ${stat.birthtime.toISOString()}`);
            console.log(`  FS Modified: ${stat.mtime.toISOString()}`);
            if (meta.tags && Object.keys(meta.tags).length > 0) {
                console.log(`  Internal Metadata:`);
                for (const [key, value] of Object.entries(meta.tags)) {
                    if (value.length > 150) continue; // Skip huge binary tags
                    console.log(`    - ${key}: ${value}`);
                }
            }
            console.log('-----------------------------------------------------------------');
        }
    });

    console.log(`Total matches found: ${foundCount}`);
}

function validate(params) {
    const { targetDir, options } = params;
    const errors = [];

    if (!targetDir) {
        errors.push('Missing "targetDir"');
    } else if (!fs.existsSync(path.resolve(targetDir))) {
        errors.push(`targetDir not found: ${targetDir}`);
    }

    if (options) {
        if (typeof options !== 'object') {
            errors.push('"options" must be an object');
        } else {
            const validOptions = ['minDuration', 'minHeight', 'minResolution'];
            Object.keys(options).forEach(key => {
                if (!validOptions.includes(key)) {
                    errors.push(`Unknown option: "${key}"`);
                }
            });
            // Additional basic value validation could go here if needed
        }
    }

    return errors;
}

module.exports = inspectCommand;
module.exports.validate = validate;
