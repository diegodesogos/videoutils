const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { isVideoFile, getOutputFilePath, getTempFilePath } = require('../utils/file');
const { getMetadata } = require('../utils/metadata');
const { extractDateFromTags, formatFfmpegDate, restoreFileDates } = require('../utils/date');

function convertCommand(sourceDir, outputDir, options = {}) {
    const { dryRun } = options;
    const src = path.resolve(sourceDir);
    const out = path.resolve(outputDir);

    if (!fs.existsSync(src)) {
        console.error(`Source directory not found: ${src}`);
        return;
    }
    if (!fs.existsSync(out) && !dryRun) {
        fs.mkdirSync(out, { recursive: true });
    }

    const files = fs.readdirSync(src).filter(isVideoFile);
    console.log(`Scanning: ${src}`);

    async function convertVideo(file) {
        return new Promise((resolve, reject) => {
            const filePath = path.join(src, file);
            const outputFilePath = getOutputFilePath(file, out);
            const tempFilePath = getTempFilePath(outputFilePath);

            if (fs.existsSync(outputFilePath)) {
                console.log(`Skipping (already converted): ${file}`);
                return resolve();
            }

            if (dryRun) {
                console.log(`[DRY RUN] Would convert: ${file} -> ${outputFilePath}`);
                return resolve();
            }

            const stat = fs.statSync(filePath);
            const meta = getMetadata(filePath);
            if (!meta) return reject(new Error("Failed to get metadata"));

            const videoStream = meta.rawStreams.find(s => s.codec_type === 'video');
            const audioStream = meta.rawStreams.find(s => s.codec_type === 'audio');

            const width = meta.width || 0;
            const height = meta.height || 0;

            const command = ffmpeg(filePath);

            if (width >= 1280 || height >= 720) {
                console.log(`[HEVC] ${file} (${width}x${height})`);
                command.videoCodec('libx265').outputOptions(['-crf 23', '-preset medium', '-tag:v hvc1']);
            } else {
                console.log(`[AVC]  ${file} (${width}x${height})`);
                command.videoCodec('libx264').outputOptions(['-crf 18', '-preset slow']);
            }

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
            let make = meta.tags.make || meta.tags.Make;
            let model = meta.tags.model || meta.tags.Model;

            if (creationTime) {
                creationTime = formatFfmpegDate(creationTime);
                metadataOptions.push('-metadata', `creation_time=${creationTime}`);
            }
            if (make) metadataOptions.push('-metadata', `make="${make}"`);
            if (model) metadataOptions.push('-metadata', `model="${model}"`);

            command.outputOptions(metadataOptions);

            command
                .format('mp4')
                .on('error', (err) => {
                    console.error(`\nError: ${file} - ${err.message}`);
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    resolve();
                })
                .on('progress', (p) => process.stdout.write(`Progress: ${Math.floor(p.percent)}% \r`))
                .on('end', () => { 
                    fs.renameSync(tempFilePath, outputFilePath);
                    restoreFileDates(outputFilePath, stat.atime, stat.mtime, stat.birthtime);
                    console.log(`Done: ${file}          `);
                    resolve();
                })
                .save(tempFilePath);
        });
    }

    async function runBatch() {
        for (const file of files) {
            await convertVideo(file);
        }
        console.log('\nConversion batch finished.');
    }

    return runBatch();
}

module.exports = convertCommand;
