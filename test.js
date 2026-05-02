const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const sourceDir = path.join(__dirname, 'test', 'sourceTest');
const outputDir = path.join(__dirname, 'test', 'outputTest');

console.log("Running video_convert.js...");
try {
    execSync(`node video_convert.js "${sourceDir}" "${outputDir}"`, { stdio: 'inherit' });
} catch (e) {
    console.error("Error running script:", e.message);
    process.exit(1);
}

console.log("\nValidating outputs...");
const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg', '.wmv', '.flv'];
const files = fs.readdirSync(sourceDir).filter(f => videoExtensions.includes(path.extname(f).toLowerCase()));

if (files.length === 0) {
    console.error("No source files found!");
    process.exit(1);
}

let allPassed = true;

const validateFile = (file) => {
    return new Promise((resolve) => {
        const sourceFile = path.join(sourceDir, file);
        const outputFile = path.join(outputDir, path.parse(file).name + '.mp4');

        console.log(`\nValidating: ${file}`);
        
        // 1. Check if generated file exists
        if (!fs.existsSync(outputFile)) {
            console.error(`❌ Output file missing: ${outputFile}`);
            allPassed = false;
            return resolve();
        }
        console.log(`✅ File exists.`);

        // 2. Check File dates
        const sourceStat = fs.statSync(sourceFile);
        const outputStat = fs.statSync(outputFile);
        
        // Compare mtime (allowing small ms differences due to precision)
        if (Math.abs(sourceStat.mtimeMs - outputStat.mtimeMs) > 2000) {
            console.error(`❌ mtime mismatch. Source: ${sourceStat.mtime}, Output: ${outputStat.mtime}`);
            allPassed = false;
        } else {
            console.log(`✅ Modification time matches.`);
        }

        if (Math.abs(sourceStat.birthtimeMs - outputStat.birthtimeMs) > 2000) {
            console.error(`❌ birthtime mismatch. Source: ${sourceStat.birthtime}, Output: ${outputStat.birthtime}`);
            allPassed = false;
        } else {
            console.log(`✅ Creation time matches.`);
        }

        // 3. Check codec format and metadata
        ffmpeg.ffprobe(outputFile, (err, metadata) => {
            if (err) {
                console.error(`❌ Error probing file: ${err.message}`);
                allPassed = false;
                return resolve();
            }

            ffmpeg.ffprobe(sourceFile, (errSrc, metadataSrc) => {
                if (errSrc) {
                    console.error(`❌ Error probing source file: ${errSrc.message}`);
                    allPassed = false;
                    return resolve();
                }
                const srcVideo = metadataSrc.streams.find(s => s.codec_type === 'video');
                const srcWidth = srcVideo.width || 0;
                const srcHeight = srcVideo.height || 0;
                
                const expectedCodec = (srcWidth >= 1280 || srcHeight >= 720) ? 'hevc' : 'h264';
                
                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                if (videoStream.codec_name !== expectedCodec) {
                    console.error(`❌ Codec mismatch. Expected: ${expectedCodec}, Found: ${videoStream.codec_name}`);
                    allPassed = false;
                } else {
                    console.log(`✅ Codec format is ${videoStream.codec_name}.`);
                }
                
                const srcCreation = metadataSrc.format.tags && metadataSrc.format.tags.creation_time;
                const outCreation = metadata.format.tags && metadata.format.tags.creation_time;
                
                if (srcCreation && srcCreation !== outCreation) {
                    console.error(`❌ EXIF creation_time mismatch. Source: ${srcCreation}, Output: ${outCreation}`);
                    allPassed = false;
                } else if (!srcCreation) {
                    console.log(`✅ No EXIF creation_time in source to preserve.`);
                } else {
                    console.log(`✅ EXIF metadata preserved (${outCreation}).`);
                }
                
                resolve();
            });
        });
    });
};

async function runTests() {
    for (const file of files) {
        await validateFile(file);
    }
    
    if (allPassed) {
        console.log("\n🎉 All tests passed successfully!");
    } else {
        console.log("\n⚠️ Some tests failed.");
        process.exit(1);
    }
}

runTests();
