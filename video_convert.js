const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

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
  - Resolution >= 720p: HEVC (x265), CRF 20, Preset Slow, Audio Copy.
  - Resolution < 720p:  AVC (x264), CRF 18, Preset Slow, Audio Copy.
  - No Audio: Automatically detected and handled (strips audio).
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
                command.audioCodec('copy');
            } else {
                command.noAudio();
            }

            command
                .format('mp4')
                .on('progress', (p) => process.stdout.write(`Progress: ${Math.floor(p.percent)}% \r`))
                .on('end', () => { 
                    fs.renameSync(tempFilePath, outputFilePath);
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
