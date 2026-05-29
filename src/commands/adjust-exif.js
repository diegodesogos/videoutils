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

async function adjustExifCommand(targetDirOrFile, options = {}) {
    const { compareDate } = options;
    const target = path.resolve(targetDirOrFile);

    if (!fs.existsSync(target)) {
        console.error(`Error: Not found at ${target}`);
        return;
    }

    const { dir, files, isFile } = getTargetFiles(target);

    console.log(`Scanning: ${target} (isFile: ${isFile})`);
    if (compareDate) console.log(`Filter Mode: ${compareDate}\n`);

    const stats = {
        scannedCount: files.length,
        processedCount: 0,
        skippedCount: 0,
        mismatchCount: 0,
        adjustedCount: 0,
        syncedCount: 0,
        heuristicResolvedCount: 0,
        currentIndex: 0,
    };

    for (const file of files) {
        stats.currentIndex++;
        await processFile(file, dir, stats, options);
    }

    printSummary(stats, options);
}

function getTargetFiles(targetPath) {
    const targetStat = fs.statSync(targetPath);
    const isFile = targetStat.isFile();
    const dir = isFile ? path.dirname(targetPath) : targetPath;
    const files = isFile 
        ? (isVideoFile(targetPath) ? [path.basename(targetPath)] : [])
        : fs.readdirSync(dir).filter(isVideoFile);
    
    return { dir, files, isFile };
}

async function processFile(file, dir, stats, options) {
    const { compareDate, dryRun, applyHeuristics } = options;
    const filePath = path.join(dir, file);
    const extracted = extractDateFromFilename(file);
    
    if (!extracted) {
        console.log(`[${stats.currentIndex}/${stats.scannedCount}] Skipping: ${file} (No valid date found in filename)`);
        stats.skippedCount++;
        return;
    }

    stats.processedCount++;
    const { iso, dateObj: filenameDateObj } = extracted;
    
    // Extract current metadata date
    const meta = getMetadata(filePath);
    const stat = fs.statSync(filePath);
    let currentMetadataDate = extractDateFromTags(meta.tags, stat);
    currentMetadataDate = formatFfmpegDate(currentMetadataDate);
    
    const metaDateObj = currentMetadataDate ? new Date(currentMetadataDate) : null;

    const { isMismatch, shouldAdjust, syncToMetadata, heuristicApplied } = shouldAdjustDate(filenameDateObj, metaDateObj, compareDate, applyHeuristics);

    if (shouldAdjust || syncToMetadata) stats.mismatchCount++;
    if (heuristicApplied) stats.heuristicResolvedCount++;

    if (shouldAdjust) {
        console.log(`[${stats.currentIndex}/${stats.scannedCount}] Mismatch found (Meeting criteria): ${file}`);
        if (heuristicApplied) console.log(`  - Heuristic applied: ${heuristicApplied}`);
        console.log(`  - Filename Date: ${iso}`);
        console.log(`  - Metadata Date: ${currentMetadataDate || 'None'}`);
    }

    if (!shouldAdjust) {
        handleNoAdjust(file, filePath, currentMetadataDate, metaDateObj, stat, syncToMetadata, stats, options);
        return;
    }

    if (dryRun) {
        console.log(`[${stats.currentIndex}/${stats.scannedCount}] [DRY RUN] Would adjust: ${file} -> Target Date: ${iso}`);
        stats.adjustedCount++;
        return;
    }

    console.log(`[${stats.currentIndex}/${stats.scannedCount}] Adjusting: ${file} -> Target Date: ${iso}`);
    stats.adjustedCount++;

    await adjustExifWithFfmpeg(filePath, iso, stats);
    restoreFileDates(filePath, filenameDateObj, filenameDateObj, filenameDateObj);
    console.log(`  ✅ Done.`);
}

function handleNoAdjust(file, filePath, currentMetadataDate, metaDateObj, stat, syncToMetadata, stats, options) {
    const { dryRun, syncFS } = options;
    let handled = false;
    
    if (syncToMetadata) {
        handled = true;
        if (dryRun) {
            console.log(`[${stats.currentIndex}/${stats.scannedCount}] [DRY RUN] Would sync FS dates to precise Metadata Date: ${currentMetadataDate} for ${file}`);
        } else {
            console.log(`[${stats.currentIndex}/${stats.scannedCount}] Syncing FS dates to precise Metadata Date: ${currentMetadataDate} for ${file}`);
            restoreFileDates(filePath, metaDateObj, metaDateObj, metaDateObj);
            console.log(`  ✅ FS Synced.`);
        }
        stats.syncedCount++;
    } else if (syncFS && metaDateObj) {
        const isFsSynced = Math.abs(stat.mtime.getTime() - metaDateObj.getTime()) < 1000;
        if (!isFsSynced) {
            handled = true;
            if (dryRun) {
                console.log(`[${stats.currentIndex}/${stats.scannedCount}] [DRY RUN] Would sync FS dates to Metadata Date: ${currentMetadataDate} for ${file}`);
            } else {
                console.log(`[${stats.currentIndex}/${stats.scannedCount}] Syncing FS dates to Metadata Date: ${currentMetadataDate} for ${file}`);
                restoreFileDates(filePath, metaDateObj, metaDateObj, metaDateObj);
                console.log(`  ✅ FS Synced.`);
            }
            stats.syncedCount++;
        }
    }
    
    if (!handled) {
        console.log(`[${stats.currentIndex}/${stats.scannedCount}] OK (no changes needed): ${file}`);
    }
}

async function adjustExifWithFfmpeg(filePath, iso, stats) {
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
                    process.stdout.write(`[${stats.currentIndex}/${stats.scannedCount}] Progress: ${Math.floor(p.percent)}% \r`);
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
}

function printSummary(stats, options) {
    const { applyHeuristics, compareDate, syncFS } = options;
    
    console.log(`\nAdjustment Summary:`);
    console.log(`- Total files scanned: ${stats.scannedCount}`);
    console.log(`- Files skipped (invalid filename): ${stats.skippedCount}`);
    console.log(`- Files processed (valid date): ${stats.processedCount}`);
    
    if (applyHeuristics) {
        console.log(`- Files resolved by heuristics: ${stats.heuristicResolvedCount}`);
    }
    if (compareDate) {
        console.log(`- Files matching filter '${compareDate}': ${stats.mismatchCount}`);
    } else {
        console.log(`- Files with date mismatch: ${stats.mismatchCount}`);
    }
    
    console.log(`- Files adjusted (or would be adjusted): ${stats.adjustedCount}`);
    
    if (syncFS || applyHeuristics) {
        console.log(`- Files with FS synced to EXIF (only): ${stats.syncedCount}`);
    }
    console.log('\nAll operations finished.');
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
            const validOptions = ['compareDate', 'syncFS', 'dryRun', 'applyHeuristics'];
            const validCompareDateValues = ['distinct', 'fileNameNewer', 'fileNameOlder'];

            Object.keys(options).forEach(key => {
                if (!validOptions.includes(key)) {
                    errors.push(`Unknown option: "${key}"`);
                }
            });

            if (options.compareDate && !validCompareDateValues.includes(options.compareDate)) {
                errors.push(`Invalid compareDate value: "${options.compareDate}". Expected one of: ${validCompareDateValues.join(', ')}`);
            }
            if (options.syncFS !== undefined && typeof options.syncFS !== 'boolean') {
                errors.push('"syncFS" must be a boolean');
            }
            if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') {
                errors.push('"dryRun" must be a boolean');
            }
            if (options.applyHeuristics !== undefined && typeof options.applyHeuristics !== 'boolean') {
                errors.push('"applyHeuristics" must be a boolean');
            }
        }
    }

    return errors;
}

module.exports = adjustExifCommand;
module.exports.validate = validate;
