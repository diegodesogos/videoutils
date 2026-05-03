const fs = require('fs');
const path = require('path');
const { isVideoFile } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');

function inspectCommand(targetDir, options = {}) {
    const { minDuration, minHeight } = options;
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

        const matchesDuration = minDuration ? (meta.duration / 60) >= parseFloat(minDuration) : true;
        const matchesHeight = minHeight ? meta.height >= parseInt(minHeight) : true;

        if (matchesDuration && matchesHeight) {
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

module.exports = inspectCommand;
