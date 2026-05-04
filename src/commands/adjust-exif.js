const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getTempFilePath } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { 
    extractDateFromFilename, 
    restoreFileDates, 
    extractDateFromTags, 
    formatFfmpegDate,
    shouldAdjustDate
} = require('../utils/date');

async function adjustExifCommand(targetDir, options = {}) {
    const { compareDate, dryRun } = options;
    const dir = path.resolve(targetDir);

    if (!fs.existsSync(dir)) {
        console.error(`Error: Folder not found at ${dir}`);
        return;
    }

    const files = fs.readdirSync(dir).filter(isVideoFile);
    console.log(`Scanning folder: ${dir}`);
    if (compareDate) console.log(`Filter Mode: ${compareDate}\n`);

    let processedCount = 0;
    let mismatchCount = 0;
    let adjustedCount = 0;

    for (const file of files) {
        const filePath = path.join(dir, file);
        const extracted = extractDateFromFilename(file);
        
        if (!extracted) {
            console.log(`Skipping: ${file} (No valid date found in filename)`);
            continue;
        }

        processedCount++;
        const { iso, dateObj } = extracted;
        
        // Extract current metadata date
        const meta = getMetadata(filePath);
        const stat = fs.statSync(filePath);
        let currentMetadataDate = extractDateFromTags(meta.tags, stat);
        currentMetadataDate = formatFfmpegDate(currentMetadataDate);
        
        const filenameDateObj = dateObj;
        const metaDateObj = currentMetadataDate ? new Date(currentMetadataDate) : null;

        const { isMismatch, shouldAdjust } = shouldAdjustDate(filenameDateObj, metaDateObj, compareDate);

        if (isMismatch) mismatchCount++;

        if (shouldAdjust) {
            console.log(`Mismatch found (Meeting criteria): ${file}`);
            console.log(`  - Filename Date: ${iso}`);
            console.log(`  - Metadata Date: ${currentMetadataDate || 'None'}`);
        }

        if (!shouldAdjust) {
            continue;
        }

        if (dryRun) {
            console.log(`[DRY RUN] Would adjust: ${file} -> Target Date: ${iso}`);
            adjustedCount++;
            continue;
        }

        console.log(`Adjusting: ${file} -> Target Date: ${iso}`);
        adjustedCount++;

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

    console.log(`\nAdjustment Summary:`);
    console.log(`- Files processed: ${processedCount}`);
    console.log(`- Files with date mismatch: ${mismatchCount}`);
    console.log(`- Files adjusted (or would be adjusted): ${adjustedCount}`);
    console.log('\nAll operations finished.');
}

module.exports = adjustExifCommand;
