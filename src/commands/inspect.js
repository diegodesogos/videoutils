const fs = require('fs');
const path = require('path');
const { isVideoFile } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { matchesFilters } = require('../utils/filter');

function inspectCommand(targetDirOrFile, options = {}) {
    const { minDuration, minHeight, minResolution } = options;
    const target = path.resolve(targetDirOrFile);
    
    if (!fs.existsSync(target)) {
        console.error(`Error: Not found at ${target}`);
        return;
    }

    const targetStat = fs.statSync(target);
    const isFile = targetStat.isFile();
    const dir = isFile ? path.dirname(target) : target;
    const files = isFile 
        ? (isVideoFile(target) ? [path.basename(target)] : [])
        : fs.readdirSync(dir).filter(isVideoFile);

    console.log(`Scanning: ${target} (isFile: ${isFile})\n`);

    let foundCount = 0;

    files.forEach(file => {
        const filePath = path.join(dir, file);
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
    const { targetDirOrFile, options } = params;
    const errors = [];

    if (!targetDirOrFile) {
        errors.push('Missing "targetDirOrFile"');
    } else if (!fs.existsSync(path.resolve(targetDirOrFile))) {
        errors.push(`Target not found: ${targetDirOrFile}`);
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
