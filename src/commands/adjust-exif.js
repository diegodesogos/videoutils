const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getTempFilePath } = require('../utils/file');
const { extractDateFromFilename, restoreFileDates } = require('../utils/date');

async function adjustExifCommand(targetDir) {
    const dir = path.resolve(targetDir);

    if (!fs.existsSync(dir)) {
        console.error(`Error: Folder not found at ${dir}`);
        return;
    }

    const files = fs.readdirSync(dir).filter(isVideoFile);
    console.log(`Scanning folder: ${dir}`);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const extracted = extractDateFromFilename(file);
        
        if (!extracted) {
            console.log(`Skipping: ${file} (No valid date found in filename)`);
            continue;
        }

        const { iso, dateObj } = extracted;
        console.log(`Adjusting: ${file} -> Target Date: ${iso}`);

        const tempPath = getTempFilePath(filePath);

        await new Promise((resolve) => {
            ffmpeg(filePath)
                .outputOptions([
                    '-c', 'copy',
                    '-map', '0',
                    '-metadata', `creation_time=${iso}`
                ])
                .on('end', () => resolve())
                .on('error', (err) => {
                    console.error(`  Error adjusting EXIF: ${err.message}`);
                    resolve();
                })
                .save(tempPath);
        });

        if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, filePath);
        }

        restoreFileDates(filePath, dateObj, dateObj, dateObj);
        console.log(`  ✅ Done.`);
    }

    console.log('\nAll EXIF adjustments finished.');
}

module.exports = adjustExifCommand;
