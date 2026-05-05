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
    const { compareDate, dryRun, syncFS } = options;
    const dir = path.resolve(targetDir);

    if (!fs.existsSync(dir)) {
        console.error(`Error: Folder not found at ${dir}`);
        return;
    }

    const files = fs.readdirSync(dir).filter(isVideoFile);
    console.log(`Scanning folder: ${dir}`);
    if (compareDate) console.log(`Filter Mode: ${compareDate}\n`);

    let scannedCount = files.length;
    let processedCount = 0;
    let skippedCount = 0;
    let mismatchCount = 0;
    let adjustedCount = 0;
    let syncedCount = 0;
    let currentIndex = 0;

    for (const file of files) {
        currentIndex++;
        const filePath = path.join(dir, file);
        const extracted = extractDateFromFilename(file);
        
        if (!extracted) {
            console.log(`[${currentIndex}/${scannedCount}] Skipping: ${file} (No valid date found in filename)`);
            skippedCount++;
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

        if (shouldAdjust) mismatchCount++;

        if (shouldAdjust) {
            console.log(`[${currentIndex}/${scannedCount}] Mismatch found (Meeting criteria): ${file}`);
            console.log(`  - Filename Date: ${iso}`);
            console.log(`  - Metadata Date: ${currentMetadataDate || 'None'}`);
        }

        if (!shouldAdjust) {
            let handled = false;
            if (syncFS && metaDateObj) {
                const isFsSynced = Math.abs(stat.mtime.getTime() - metaDateObj.getTime()) < 1000;
                if (!isFsSynced) {
                    handled = true;
                    if (dryRun) {
                        console.log(`[${currentIndex}/${scannedCount}] [DRY RUN] Would sync FS dates to Metadata Date: ${currentMetadataDate} for ${file}`);
                    } else {
                        console.log(`[${currentIndex}/${scannedCount}] Syncing FS dates to Metadata Date: ${currentMetadataDate} for ${file}`);
                        restoreFileDates(filePath, metaDateObj, metaDateObj, metaDateObj);
                        console.log(`  ✅ FS Synced.`);
                    }
                    syncedCount++;
                }
            }
            if (!handled) {
                console.log(`[${currentIndex}/${scannedCount}] OK (no changes needed): ${file}`);
            }
            continue;
        }

        if (dryRun) {
            console.log(`[${currentIndex}/${scannedCount}] [DRY RUN] Would adjust: ${file} -> Target Date: ${iso}`);
            adjustedCount++;
            continue;
        }

        console.log(`[${currentIndex}/${scannedCount}] Adjusting: ${file} -> Target Date: ${iso}`);
        adjustedCount++;

        const tempPath = getTempFilePath(filePath);

        await new Promise((resolve) => {
            ffmpeg(filePath)
                .outputOptions([
                    '-c', 'copy',
                    '-map', '0',
                    '-metadata', `creation_time=${iso}`
                ])
                .on('progress', (p) => {
                    if (p.percent) {
                        process.stdout.write(`[${currentIndex}/${scannedCount}] Progress: ${Math.floor(p.percent)}% \r`);
                    }
                })
                .on('end', () => {
                    process.stdout.write(' '.repeat(50) + '\r'); // clear progress line
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`\n  Error adjusting EXIF: ${err.message}`);
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
    console.log(`- Total files scanned: ${scannedCount}`);
    console.log(`- Files skipped (invalid filename): ${skippedCount}`);
    console.log(`- Files processed (valid date): ${processedCount}`);
    if (compareDate) {
        console.log(`- Files matching filter '${compareDate}': ${mismatchCount}`);
    } else {
        console.log(`- Files with date mismatch: ${mismatchCount}`);
    }
    console.log(`- Files adjusted (or would be adjusted): ${adjustedCount}`);
    if (syncFS) {
        console.log(`- Files with FS synced to EXIF (only): ${syncedCount}`);
    }
    console.log('\nAll operations finished.');
}

module.exports = adjustExifCommand;
