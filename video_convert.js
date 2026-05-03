const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
/**
 * Help / Usage Instructions
 */
function showHelp() {
    console.log(`
Video Converter Tool
--------------------
Usage:
  node convert.js <source_dir> <output_dir>

Arguments:
  source_dir   Path to the folder containing original videos.
  output_dir   Path where converted MP4 files will be saved.

Logic:
  - Resolution >= 720p: HEVC (x265), CRF 20, Preset Slow, Audio Copy/Encode.
  - Resolution < 720p:  AVC (x264), CRF 18, Preset Slow, Audio Copy/Encode.
  - Audio: Copied if compatible (AAC, MP3, AC3, EAC3, ALAC), otherwise encoded to AAC 128k. Stripped if missing.
  - Metadata: Preserves EXIF metadata and original creation/modification dates.
    `);
    process.exit(0);
}

// Parse Command Line Arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length < 2) {
    showHelp();
}

const sourceDir = path.resolve(args[0]);
const outputDir = path.resolve(args[1]);
const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg', '.wmv', '.flv'];

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function processVideos(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            await processVideos(fullPath); // Recursive
            continue;
        }

        const ext = path.extname(file).toLowerCase();
        if (videoExtensions.includes(ext)) {
            await convertVideo(fullPath, file);
        }
    }
}

function convertVideo(filePath, fileName) {
    return new Promise((resolve, reject) => {
        const outputFilePath = path.join(outputDir, path.parse(fileName).name + '.mp4');
        const tempFilePath = outputFilePath + '.tmp';

        if (fs.existsSync(outputFilePath)) {
            console.log(`Skipping (already converted): ${fileName}`);
            return resolve();
        }

        const stat = fs.statSync(filePath);

        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

            if (!videoStream) return resolve();

            const width = videoStream.width || 0;
            const height = videoStream.height || 0;
            const command = ffmpeg(filePath);

            // Decision Logic based on Resolution
            if (width >= 1280 || height >= 720) {
                console.log(`[HEVC] ${fileName} (${width}x${height})`);
                command.videoCodec('libx265').outputOptions(['-crf 20', '-preset slow', '-tag:v hvc1']);
            } else {
                console.log(`[AVC]  ${fileName} (${width}x${height})`);
                command.videoCodec('libx264').outputOptions(['-crf 18', '-preset slow']);
            }

            // Smart Audio Handling
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

            // Preserve EXIF metadata
            const metadataOptions = ['-map_metadata', '0', '-movflags', 'use_metadata_tags'];
            
            // Explicitly extract tags from format or video stream to preserve legacy metadata
            let creationTime = null;
            let make = null;
            let model = null;

            const formatTags = metadata.format && metadata.format.tags ? metadata.format.tags : {};
            const streamTags = videoStream && videoStream.tags ? videoStream.tags : {};
            
            creationTime = formatTags.creation_time || streamTags.creation_time || streamTags.DateTime || streamTags['ExifIFD/DateTimeOriginal'];
            make = formatTags.make || formatTags.Make || streamTags.make || streamTags.Make;
            model = formatTags.model || formatTags.Model || streamTags.model || streamTags.Model;

            if (creationTime) {
                // Convert "YYYY:MM:DD HH:MM:SS" to "YYYY-MM-DDTHH:MM:SSZ" to avoid ffmpeg space-splitting errors
                if (creationTime.match(/^\d{4}[:\-]\d{2}[:\-]\d{2}\s\d{2}:\d{2}:\d{2}$/)) {
                    creationTime = creationTime.replace(/^(\d{4})[:\-](\d{2})[:\-](\d{2})\s(.*)$/, '$1-$2-$3T$4Z');
                }
                metadataOptions.push('-metadata', `creation_time=${creationTime}`);
            }
            if (make) metadataOptions.push('-metadata', `make="${make}"`);
            if (model) metadataOptions.push('-metadata', `model="${model}"`);

            command.outputOptions(metadataOptions);

            command
                .format('mp4')
                .on('progress', (p) => process.stdout.write(`Progress: ${Math.floor(p.percent)}% \r`))
                .on('end', () => { 
                    fs.renameSync(tempFilePath, outputFilePath);

                    // Restore modification time
                    fs.utimesSync(outputFilePath, stat.atime, stat.mtime);

                    // Restore creation date on macOS
                    try {
                        const d = stat.birthtime || stat.mtime;
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        const yyyy = d.getFullYear();
                        const HH = String(d.getHours()).padStart(2, '0');
                        const MM = String(d.getMinutes()).padStart(2, '0');
                        const SS = String(d.getSeconds()).padStart(2, '0');
                        const dateStr = `${mm}/${dd}/${yyyy} ${HH}:${MM}:${SS}`;
                        execSync(`SetFile -d "${dateStr}" "${outputFilePath}"`);
                    } catch (err) {
                        // Ignore if SetFile is not available
                    }

                    console.log(`Done: ${fileName}          `); 
                    resolve(); 
                })
                .on('error', (e) => { 
                    if (fs.existsSync(tempFilePath)) {
                        try { fs.unlinkSync(tempFilePath); } catch (err) {}
                    }
                    console.error(`\nError: ${fileName} - ${e.message}`); 
                    resolve(); 
                })
                .save(tempFilePath);
        });
    });
}

console.log(`Scanning: ${sourceDir}`);
processVideos(sourceDir).then(() => console.log("\nConversion batch finished."));
