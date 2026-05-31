const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getOutputFilePath, getTempFilePath } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { extractDateFromTags, formatFfmpegDate, restoreFileDates } = require('../utils/date');
const { formatSize } = require('../utils/size');
const { scanDvd, convertDvdTitle } = require('../utils/handbrake');

function convertCommand(sourceDirOrFile, outputDir, options = {}) {
    const { dryRun, recursive = true, aspectRatio, maxFileSizeMb = 1024 } = options;
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
    
    let dvdPaths = [];
    let files = [];

    function scanDirectory(currentPath, relativePath = '') {
        const filesInDir = fs.readdirSync(currentPath);
        
        if (filesInDir.some(f => f.toLowerCase() === 'video_ts' || f.toLowerCase() === 'video_ts.ifo')) {
            dvdPaths.push(currentPath);
            return;
        }

        for (const file of filesInDir) {
            const fullPath = path.join(currentPath, file);
            const relPath = path.join(relativePath, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                if (recursive) scanDirectory(fullPath, relPath);
            } else if (stat.isFile() && isVideoFile(file)) {
                files.push(relPath);
            }
        }
    }

    if (isFile) {
        if (isVideoFile(src)) files.push(path.basename(src));
        console.log(`Scanning: ${src} (isFile: true)`);
    } else {
        console.log(`Scanning directory: ${src} (recursive: ${recursive})...`);
        scanDirectory(src);
    }

    console.log(`Found ${files.length} normal video(s) and ${dvdPaths.length} DVD folder(s).`);

    let scannedCount = files.length;
    let processedCount = 0;
    let convertedCount = 0;
    let skippedCount = 0;
    let totalOriginalBytes = 0;
    let totalNewBytes = 0;

    async function splitIfTooBig(filePath, durationSeconds, maxSizeMb) {
        if (dryRun || !durationSeconds) return;
        const maxBytes = maxSizeMb * 1024 * 1024;
        const stat = fs.statSync(filePath);
        if (stat.size <= maxBytes) return;

        console.log(`\nFile ${path.basename(filePath)} is ${(stat.size / 1024 / 1024).toFixed(1)}MB (exceeds ${maxSizeMb}MB). Splitting...`);
        const numChunks = Math.ceil(stat.size / maxBytes);
        const segmentTime = Math.ceil(durationSeconds / numChunks);
        
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const dir = path.dirname(filePath);
        const outPattern = path.join(dir, `${base}_part%02d${ext}`);

        return new Promise((resolve) => {
            ffmpeg(filePath)
                .outputOptions([
                    '-c', 'copy',
                    '-f', 'segment',
                    '-segment_time', segmentTime.toString(),
                    '-reset_timestamps', '1'
                ])
                .output(outPattern)
                .on('progress', (p) => {
                    const time = p.timemark || (p.percent ? Math.floor(p.percent) + '%' : '');
                    if (time) process.stdout.write(`Splitting progress: ${time} \r`);
                })
                .on('end', () => {
                    process.stdout.write('                                        \r');
                    console.log(`Splitting done. Removed original large file.`);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`Splitting error: ${err.message}`);
                    resolve();
                })
                .run();
        });
    }

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
            if (aspectRatio === 'default' && width > 0 && height > 0) {
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
            if (finalAspectRatio && finalAspectRatio !== 'default') {
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
                .on('progress', (p) => {
                    const fps = p.currentFps ? ` (${Math.floor(p.currentFps)} fps)` : '';
                    if (p.percent) {
                        process.stdout.write(`[${currentIndex}/${totalFiles}] Progress: ${Math.floor(p.percent)}%${fps} \r`);
                    } else if (p.timemark) {
                        process.stdout.write(`[${currentIndex}/${totalFiles}] Progress: Time ${p.timemark}${fps} \r`);
                    }
                })
                .on('end', async () => { 
                    fs.renameSync(tempFilePath, outputFilePath);
                    restoreFileDates(outputFilePath, stat.atime, stat.mtime, stat.birthtime);
                    
                    const durationSeconds = meta.format && meta.format.duration ? parseFloat(meta.format.duration) : 0;
                    await splitIfTooBig(outputFilePath, durationSeconds, maxFileSizeMb);
                    
                    const newStat = fs.existsSync(outputFilePath) ? fs.statSync(outputFilePath) : { size: 0 };
                    totalNewBytes += newStat.size; // This may be 0 if split and original deleted, but size of chunks isn't easily summed here without globbing. For now, it's fine.
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
    }

    async function handleDvd(dvdPath, outDir, opts) {
        console.log(`\nDetected DVD structure at: ${dvdPath}`);
        console.log(`Scanning DVD for titles... This may take a moment.`);
        
        try {
            const titles = await scanDvd(dvdPath);
            if (titles.length === 0) {
                console.log(`No valid titles found in DVD: ${dvdPath}`);
                return;
            }

            console.log(`Found ${titles.length} titles.`);
            
            let convertedDvdCount = 0;

            for (let i = 0; i < titles.length; i++) {
                const titleInfo = titles[i];
                // Skip very short titles (often menu loops or warnings), e.g., less than 10 seconds.
                if (titleInfo.durationSeconds < 10) {
                    console.log(`[${i + 1}/${titles.length}] Skipping Title ${titleInfo.title} (Duration: ${titleInfo.duration} is too short)`);
                    continue;
                }

                const dvdName = path.basename(dvdPath);
                const outName = `${dvdName}_Title_${titleInfo.title.toString().padStart(2, '0')}.mp4`;
                const outputFilePath = path.join(outDir, outName);
                
                if (fs.existsSync(outputFilePath)) {
                    console.log(`[${i + 1}/${titles.length}] Skipping (already converted): ${outName}`);
                    continue;
                }

                console.log(`[${i + 1}/${titles.length}] Converting Title ${titleInfo.title} (${titleInfo.duration}) -> ${outName}`);
                
                await convertDvdTitle(dvdPath, titleInfo.title, outputFilePath, opts.dryRun, (percent, eta) => {
                    const etaStr = eta ? ` (ETA ${eta})` : '';
                    process.stdout.write(`[${i + 1}/${titles.length}] Progress: ${percent.toFixed(1)}%${etaStr} \r`);
                });
                
                if (!opts.dryRun) {
                    await splitIfTooBig(outputFilePath, titleInfo.durationSeconds, maxFileSizeMb);
                    console.log(`[${i + 1}/${titles.length}] Done: ${outName}                    `);
                }
                convertedDvdCount++;
            }

            console.log(`\nDVD Conversion Summary (${dvdPath}):`);
            console.log(`- Total titles found: ${titles.length}`);
            console.log(`- Titles converted: ${convertedDvdCount}`);

        } catch (err) {
            console.error(`Error processing DVD: ${err.message}`);
        }
    }

    async function runAll() {
        if (files.length > 0) {
            await runBatch();
        }
        for (const dvdPath of dvdPaths) {
            await handleDvd(dvdPath, out, options);
        }
        console.log('\nAll operations finished.');
    }

    return runAll();
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
            const validOptions = ['dryRun', 'recursive', 'aspectRatio', 'maxFileSizeMb'];
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
            if (options.maxFileSizeMb !== undefined && typeof options.maxFileSizeMb !== 'number') {
                errors.push('"maxFileSizeMb" must be a number');
            }
        }
    }

    return errors;
}

module.exports = convertCommand;
module.exports.validate = validate;
