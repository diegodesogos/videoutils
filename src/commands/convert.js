const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getOutputFilePath, getTempFilePath } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { extractDateFromTags, formatFfmpegDate, restoreFileDates } = require('../utils/date');
const { formatSize } = require('../utils/size');

function convertCommand(sourceDirOrFile, outputDir, options = {}) {
    const { dryRun, recursive = true, aspectRatio } = options;
    const src = path.resolve(sourceDirOrFile);
    const out = path.resolve(outputDir);

    if (!fs.existsSync(src)) {
        console.error(`Source not found: ${src}`);
        return;
    }
    if (!fs.existsSync(out) && !dryRun) {
        fs.mkdirSync(out, { recursive: true });
    }

    const srcStat = fs.statSync(src);
    const isFile = srcStat.isFile();
    const baseSrc = isFile ? path.dirname(src) : src;
    const files = isFile 
        ? (isVideoFile(src) ? [path.basename(src)] : [])
        : fs.readdirSync(src, { recursive }).filter(file => isVideoFile(file) && fs.statSync(path.join(src, file)).isFile());

    console.log(`Scanning: ${src} (isFile: ${isFile}, recursive: ${recursive})`);

    let scannedCount = files.length;
    let processedCount = 0;
    let convertedCount = 0;
    let skippedCount = 0;
    let totalOriginalBytes = 0;
    let totalNewBytes = 0;

    async function convertVideo(file, currentIndex, totalFiles) {
        return new Promise((resolve, reject) => {
            const filePath = path.join(baseSrc, file);
            const outputFilePath = getOutputFilePath(file, out);
            const tempFilePath = getTempFilePath(outputFilePath);

            if (fs.existsSync(outputFilePath)) {
                console.log(`[${currentIndex}/${totalFiles}] Skipping (already converted): ${file}`);
                skippedCount++;
                return resolve();
            }

            processedCount++;
            const stat = fs.statSync(filePath);
            const meta = getMetadata(filePath);
            if (!meta) {
                console.error(`[${currentIndex}/${totalFiles}] Error: Failed to get metadata for ${file}`);
                return resolve();
            }

            totalOriginalBytes += stat.size;

            const width = meta.width || 0;
            const height = meta.height || 0;
            const isHevc = (width >= 1280 || height >= 720);

            let finalAspectRatio = aspectRatio;
            if (!finalAspectRatio && width > 0 && height > 0) {
                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                const divisor = gcd(width, height);
                finalAspectRatio = `${width / divisor}:${height / divisor}`;
            }

            if (dryRun) {
                console.log(`[${currentIndex}/${totalFiles}] [DRY RUN] Would convert: ${file} -> ${outputFilePath} (${isHevc ? 'HEVC' : 'AVC'})`);
                // Theoretical savings: HEVC ~60% reduction, AVC ~40% reduction
                const estimatedSavings = isHevc ? 0.6 : 0.4;
                totalNewBytes += Math.round(stat.size * (1 - estimatedSavings));
                convertedCount++;
                return resolve();
            }

            const command = ffmpeg(filePath);

            if (isHevc) {
                console.log(`[${currentIndex}/${totalFiles}] [HEVC] ${file} (${width}x${height})`);
                command.videoCodec('libx265').outputOptions(['-crf 23', '-preset medium', '-tag:v hvc1']);
            } else {
                console.log(`[${currentIndex}/${totalFiles}] [AVC]  ${file} (${width}x${height})`);
                command.videoCodec('libx264').outputOptions(['-crf 18', '-preset slow']);
            }

            const audioStream = meta.rawStreams.find(s => s.codec_type === 'audio');
            if (audioStream) {
                const codec = audioStream.codec_name;
                const compatibleCodecs = ['aac', 'mp3', 'ac3', 'eac3', 'alac'];
                if (compatibleCodecs.includes(codec)) {
                    command.audioCodec('copy');
                } else {
                    command.audioCodec('aac').audioBitrate('128k');
                }
            } else {
                command.noAudio();
            }

            const metadataOptions = ['-map_metadata', '0', '-movflags', 'use_metadata_tags'];
            let creationTime = extractDateFromTags(meta.tags, stat);
            if (creationTime) {
                creationTime = formatFfmpegDate(creationTime);
                metadataOptions.push('-metadata', `creation_time=${creationTime}`);
            }
            if (meta.tags.make || meta.tags.Make) metadataOptions.push('-metadata', `make="${meta.tags.make || meta.tags.Make}"`);
            if (finalAspectRatio) {
                metadataOptions.push('-aspect', finalAspectRatio);
            }

            command.outputOptions(metadataOptions);

            command
                .format('mp4')
                .on('error', (err) => {
                    console.error(`\nError: ${file} - ${err.message}`);
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    resolve();
                })
                .on('progress', (p) => process.stdout.write(`[${currentIndex}/${totalFiles}] Progress: ${Math.floor(p.percent)}% \r`))
                .on('end', () => { 
                    fs.renameSync(tempFilePath, outputFilePath);
                    restoreFileDates(outputFilePath, stat.atime, stat.mtime, stat.birthtime);
                    const newStat = fs.statSync(outputFilePath);
                    totalNewBytes += newStat.size;
                    console.log(`[${currentIndex}/${totalFiles}] Done: ${file}          `);
                    convertedCount++;
                    resolve();
                })
                .save(tempFilePath);
        });
    }

    async function runBatch() {
        let currentIndex = 1;
        for (const file of files) {
            await convertVideo(file, currentIndex, scannedCount);
            currentIndex++;
        }
        
        const savedBytes = totalOriginalBytes - totalNewBytes;
        const savedPercent = totalOriginalBytes > 0 ? ((savedBytes / totalOriginalBytes) * 100).toFixed(1) : 0;

        console.log(`\nConversion Summary:`);
        console.log(`- Total files scanned: ${scannedCount}`);
        console.log(`- Files skipped (already converted): ${skippedCount}`);
        console.log(`- Files processed (to be converted): ${processedCount}`);
        console.log(`- Files converted ${dryRun ? '(estimated)' : ''}: ${convertedCount}`);
        if (processedCount > 0) {
            console.log(`- Total Original Size: ${formatSize(totalOriginalBytes)}`);
            console.log(`- Total New Size ${dryRun ? '(estimated)' : ''}: ${formatSize(totalNewBytes)}`);
            console.log(`- Space Saved ${dryRun ? '(estimated)' : ''}: ${formatSize(Math.max(0, savedBytes))} (${savedPercent}%)`);
        }
        console.log('\nAll operations finished.');
    }

    return runBatch();
}

function validate(params) {
    const { sourceDirOrFile, outputDir, options } = params;
    const errors = [];

    if (!sourceDirOrFile) {
        errors.push('Missing "sourceDirOrFile"');
    } else if (!fs.existsSync(path.resolve(sourceDirOrFile))) {
        errors.push(`Source not found: ${sourceDirOrFile}`);
    }

    if (!outputDir) {
        errors.push('Missing "outputDir"');
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
                } else if (!/^\d+:\d+$/.test(options.aspectRatio)) {
                    errors.push(`Invalid "aspectRatio" format: "${options.aspectRatio}". Valid format is "W:H" (e.g., "16:9", "4:3").`);
                }
            }
        }
    }

    return errors;
}

module.exports = convertCommand;
module.exports.validate = validate;
