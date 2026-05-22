const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getTempFilePath } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { extractDateFromTags, formatFfmpegDate, restoreFileDates } = require('../utils/date');
const { formatSize } = require('../utils/size');

function remuxCommand(targetDirOrFile, options = {}) {
    const { dryRun, recursive = true, aspectRatio } = options;
    const target = path.resolve(targetDirOrFile);

    if (!fs.existsSync(target)) {
        console.error(`Target not found: ${target}`);
        return;
    }

    const targetStat = fs.statSync(target);
    const isFile = targetStat.isFile();
    const baseSrc = isFile ? path.dirname(target) : target;
    const files = isFile 
        ? (isVideoFile(target) ? [path.basename(target)] : [])
        : fs.readdirSync(target, { recursive }).filter(file => isVideoFile(file) && fs.statSync(path.join(target, file)).isFile());

    console.log(`Scanning: ${target} (isFile: ${isFile}, recursive: ${recursive})`);

    let scannedCount = files.length;
    let remuxedCount = 0;
    let skippedCount = 0;

    async function remuxVideo(file, currentIndex, totalFiles) {
        return new Promise((resolve, reject) => {
            const filePath = path.join(baseSrc, file);
            const tempFilePath = getTempFilePath(filePath);

            const stat = fs.statSync(filePath);
            const meta = getMetadata(filePath);
            if (!meta) {
                console.error(`[${currentIndex}/${totalFiles}] Error: Failed to get metadata for ${file}`);
                return resolve();
            }

            const width = meta.width || 0;
            const height = meta.height || 0;

            let finalAspectRatio = aspectRatio;
            if (aspectRatio === 'default' && width > 0 && height > 0) {
                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                const divisor = gcd(width, height);
                finalAspectRatio = `${width / divisor}:${height / divisor}`;
            }

            if (!finalAspectRatio || finalAspectRatio === 'default') {
                console.log(`[${currentIndex}/${totalFiles}] Skipping: No valid aspect ratio provided for ${file}`);
                skippedCount++;
                return resolve();
            }

            if (dryRun) {
                console.log(`[${currentIndex}/${totalFiles}] [DRY RUN] Would remux: ${file} (AspectRatio: ${finalAspectRatio})`);
                remuxedCount++;
                return resolve();
            }

            console.log(`[${currentIndex}/${totalFiles}] Remuxing ${file} (AspectRatio: ${finalAspectRatio})`);

            const command = ffmpeg(filePath);
            command.videoCodec('copy');
            command.audioCodec('copy');

            const metadataOptions = ['-map_metadata', '0', '-movflags', 'use_metadata_tags'];
            let creationTime = extractDateFromTags(meta.tags, stat);
            if (creationTime) {
                creationTime = formatFfmpegDate(creationTime);
                metadataOptions.push('-metadata', `creation_time=${creationTime}`);
            }
            if (meta.tags.make || meta.tags.Make) metadataOptions.push('-metadata', `make="${meta.tags.make || meta.tags.Make}"`);
            
            metadataOptions.push('-aspect', finalAspectRatio);

            command.outputOptions(metadataOptions);

            command
                .format('mp4')
                .on('error', (err) => {
                    console.error(`\nError: ${file} - ${err.message}`);
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    resolve();
                })
                .on('progress', (p) => process.stdout.write(`[${currentIndex}/${totalFiles}] Progress: ${p.percent ? Math.floor(p.percent) : 0}% \r`))
                .on('end', () => { 
                    // Replace original file with remuxed file
                    fs.unlinkSync(filePath); // delete original
                    fs.renameSync(tempFilePath, filePath); // rename temp to original

                    restoreFileDates(filePath, stat.atime, stat.mtime, stat.birthtime);
                    console.log(`[${currentIndex}/${totalFiles}] Done: ${file}          `);
                    remuxedCount++;
                    resolve();
                })
                .save(tempFilePath);
        });
    }

    async function runBatch() {
        let currentIndex = 1;
        for (const file of files) {
            await remuxVideo(file, currentIndex, scannedCount);
            currentIndex++;
        }
        
        console.log(`\nRemux Summary:`);
        console.log(`- Total files scanned: ${scannedCount}`);
        console.log(`- Files skipped: ${skippedCount}`);
        console.log(`- Files remuxed ${dryRun ? '(estimated)' : ''}: ${remuxedCount}`);
        console.log('\nAll operations finished.');
    }

    return runBatch();
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
            const validOptions = ['dryRun', 'recursive', 'aspectRatio'];
            Object.keys(options).forEach(key => {
                if (!validOptions.includes(key)) {
                    errors.push(`Unknown option: "${key}"`);
                }
            });
            if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') {
                errors.push('"dryRun" must be a boolean');
            }
            if (options.recursive !== undefined && typeof options.recursive !== 'boolean') {
                errors.push('"recursive" must be a boolean');
            }
            if (options.aspectRatio !== undefined) {
                if (typeof options.aspectRatio !== 'string') {
                    errors.push('"aspectRatio" must be a string');
                } else if (options.aspectRatio !== 'default' && !/^\d+:\d+$/.test(options.aspectRatio)) {
                    errors.push(`Invalid "aspectRatio" format: "${options.aspectRatio}". Valid format is "W:H" (e.g., "16:9") or "default".`);
                }
            }
        }
    }

    return errors;
}

module.exports = remuxCommand;
module.exports.validate = validate;
