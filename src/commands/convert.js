const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getOutputFilePath, getTempFilePath } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { extractDateFromTags, formatFfmpegDate, restoreFileDates } = require('../utils/date');
const { formatSize } = require('../utils/size');

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
    
    let jobs = []; // Stores either string (normal file path relative to baseSrc) or object (DVD pseudo-file)

    function scanDirectory(currentPath, relativePath = '') {
        const filesInDir = fs.readdirSync(currentPath);
        
        if (filesInDir.some(f => f.toLowerCase() === 'video_ts' || f.toLowerCase() === 'video_ts.ifo')) {
            // It's a DVD structure. Group VOBs by title.
            let targetDir = currentPath;
            const videoTsPath = path.join(currentPath, 'VIDEO_TS');
            if (fs.existsSync(videoTsPath) && fs.statSync(videoTsPath).isDirectory()) {
                targetDir = videoTsPath;
            }

            const dvdFilesInDir = fs.readdirSync(targetDir);
            const titles = {};

            dvdFilesInDir.forEach(f => {
                const m = f.match(/^VTS_(\d{2})_([1-9])\.VOB$/i);
                if (m) {
                    const t = m[1];
                    if (!titles[t]) titles[t] = [];
                    titles[t].push(f);
                }
            });

            const titleKeys = Object.keys(titles).sort();
            if (titleKeys.length === 0) {
                console.log(`No valid VOB titles found in DVD: ${currentPath}`);
                return;
            }

            const dvdName = path.basename(currentPath);
            titleKeys.forEach(t => {
                const vobFiles = titles[t].sort();
                const concatFiles = vobFiles.map(f => path.join(targetDir, f)).join('|');
                
                jobs.push({
                    isDvdConcat: true,
                    concatString: `concat:${concatFiles}`,
                    firstVob: path.join(targetDir, vobFiles[0]),
                    vobFiles: vobFiles,
                    dvdDir: targetDir,
                    outName: `${dvdName}_Title_${t}.mp4`
                });
            });
            return;
        }

        for (const file of filesInDir) {
            const fullPath = path.join(currentPath, file);
            const relPath = path.join(relativePath, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                if (recursive) scanDirectory(fullPath, relPath);
            } else if (stat.isFile() && isVideoFile(file)) {
                jobs.push(relPath);
            }
        }
    }

    if (isFile) {
        if (isVideoFile(src)) jobs.push(path.basename(src));
        console.log(`Scanning: ${src} (isFile: true)`);
    } else {
        console.log(`Scanning directory: ${src} (recursive: ${recursive})...`);
        scanDirectory(src);
    }

    const normalCount = jobs.filter(j => typeof j === 'string').length;
    const dvdCount = jobs.filter(j => typeof j === 'object').length;
    console.log(`Found ${normalCount} normal video(s) and ${dvdCount} DVD title(s).`);

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

    function isAlreadyConverted(outputFilePath) {
        if (fs.existsSync(outputFilePath)) return true;
        const ext = path.extname(outputFilePath);
        const base = path.basename(outputFilePath, ext);
        const dir = path.dirname(outputFilePath);
        const part01Path = path.join(dir, `${base}_part01${ext}`);
        return fs.existsSync(part01Path);
    }

    async function convertJob(job, currentIndex, totalFiles) {
        return new Promise((resolve, reject) => {
            let isDvd = false;
            let filePath, outputFilePath, tempFilePath, displayFileName, concatString, firstVobPath;

            if (typeof job === 'object' && job.isDvdConcat) {
                isDvd = true;
                concatString = job.concatString;
                firstVobPath = job.firstVob;
                outputFilePath = path.join(out, job.outName);
                displayFileName = job.outName;
                tempFilePath = getTempFilePath(outputFilePath);
            } else {
                filePath = path.join(baseSrc, job);
                outputFilePath = getOutputFilePath(job, out);
                tempFilePath = getTempFilePath(outputFilePath);
                displayFileName = job;
            }

            if (isAlreadyConverted(outputFilePath)) {
                console.log(`[${currentIndex}/${totalFiles}] Skipping (already converted): ${displayFileName}`);
                skippedCount++;
                return resolve();
            }

            processedCount++;
            
            let stat, meta, originalSize;
            if (isDvd) {
                stat = fs.statSync(firstVobPath);
                meta = getMetadata(firstVobPath);
                originalSize = job.vobFiles.reduce((acc, f) => acc + fs.statSync(path.join(job.dvdDir, f)).size, 0);
            } else {
                stat = fs.statSync(filePath);
                meta = getMetadata(filePath);
                originalSize = stat.size;
            }

            if (!meta) {
                console.error(`[${currentIndex}/${totalFiles}] Error: Failed to get metadata for ${displayFileName}`);
                return resolve();
            }

            totalOriginalBytes += originalSize;

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
                console.log(`[${currentIndex}/${totalFiles}] [DRY RUN] Would convert: ${displayFileName} -> ${outputFilePath} (${isHevc ? 'HEVC' : 'AVC'})`);
                const estimatedSavings = isHevc ? 0.6 : 0.4;
                totalNewBytes += Math.round(originalSize * (1 - estimatedSavings));
                convertedCount++;
                return resolve();
            }

            const command = ffmpeg(isDvd ? concatString : filePath);

            if (isHevc) {
                console.log(`[${currentIndex}/${totalFiles}] [HEVC] ${displayFileName} (${width}x${height})`);
                command.videoCodec('libx265').outputOptions(['-crf 23', '-preset medium', '-tag:v hvc1']);
            } else {
                console.log(`[${currentIndex}/${totalFiles}] [AVC]  ${displayFileName} (${width}x${height})`);
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
                    console.error(`\nError: ${displayFileName} - ${err.message}`);
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
                    
                    // Probe the newly created output file to get the exact duration (important for DVD concat)
                    const newMeta = getMetadata(outputFilePath);
                    const durationSeconds = newMeta && newMeta.format && newMeta.format.duration ? parseFloat(newMeta.format.duration) : 0;
                    
                    await splitIfTooBig(outputFilePath, durationSeconds, maxFileSizeMb);
                    
                    const newStat = fs.existsSync(outputFilePath) ? fs.statSync(outputFilePath) : { size: 0 };
                    totalNewBytes += newStat.size;
                    console.log(`[${currentIndex}/${totalFiles}] Done: ${displayFileName}          `);
                    convertedCount++;
                    resolve();
                })
                .save(tempFilePath);
        });
    }

    async function runAll() {
        if (jobs.length === 0) {
            console.log('\nNo files or DVDs to process.');
            return;
        }

        let currentIndex = 1;
        for (const job of jobs) {
            await convertJob(job, currentIndex, jobs.length);
            currentIndex++;
        }
        
        const savedBytes = totalOriginalBytes - totalNewBytes;
        const savedPercent = totalOriginalBytes > 0 ? ((savedBytes / totalOriginalBytes) * 100).toFixed(1) : 0;

        console.log(`\nConversion Summary:`);
        console.log(`- Total jobs scanned: ${jobs.length}`);
        console.log(`- Jobs skipped (already converted): ${skippedCount}`);
        console.log(`- Jobs processed (to be converted): ${processedCount}`);
        console.log(`- Jobs converted ${dryRun ? '(estimated)' : ''}: ${convertedCount}`);
        if (processedCount > 0) {
            console.log(`- Total Original Size: ${formatSize(totalOriginalBytes)}`);
            console.log(`- Total New Size ${dryRun ? '(estimated)' : ''}: ${formatSize(totalNewBytes)}`);
            console.log(`- Space Saved ${dryRun ? '(estimated)' : ''}: ${formatSize(Math.max(0, savedBytes))} (${savedPercent}%)`);
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
