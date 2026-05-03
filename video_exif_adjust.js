const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Video EXIF Adjust Utility
-------------------------
Usage:
  node video_exif_adjust.js <folder_path>

Description:
  Scans all video files in the specified folder. Extracts the date and 
  optional time from the filename (e.g., YYYYMMDD or YYYY-MM-DD, and HHMMSS).
  It then adjusts the video's internal EXIF creation_time and the OS file 
  modification/creation dates to match.
    `);
    process.exit(0);
}

const targetDir = path.resolve(args[0]);

if (!fs.existsSync(targetDir)) {
    console.error(`Error: Folder not found at ${targetDir}`);
    process.exit(1);
}

const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.m4v', '.webm', '.mpg', '.mpeg', '.wmv'];

function extractDateFromFilename(filename) {
    // Match YYYY-MM-DD or YYYYMMDD, optionally followed by _HHMMSS or -HHMMSS
    const regex = /(?:^|[^0-9])((?:19|20)\d{2}[-]?\d{2}[-]?\d{2})(?:[_-](\d{6}))?(?=[^0-9]|$)/g;
    let match;
    let lastMatch = null;

    while ((match = regex.exec(filename)) !== null) {
        lastMatch = match;
    }

    if (!lastMatch) return null;

    let dateStr = lastMatch[1].replace(/-/g, ''); // "20071230"
    let timeStr = lastMatch[2] || '120000';       // default to 12:00:00

    const yyyy = dateStr.substring(0, 4);
    const mm = dateStr.substring(4, 6);
    const dd = dateStr.substring(6, 8);

    if (parseInt(mm) > 12 || parseInt(mm) < 1 || parseInt(dd) > 31 || parseInt(dd) < 1) {
        return null; // invalid date
    }

    let hh = timeStr.substring(0, 2);
    let min = timeStr.substring(2, 4);
    let ss = timeStr.substring(4, 6);

    if (parseInt(hh) > 23 || parseInt(min) > 59 || parseInt(ss) > 59) {
        hh = '12'; min = '00'; ss = '00';
    }

    return {
        iso: `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`,
        dateObj: new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`)
    };
}

async function processFile(filePath, fileName) {
    const extracted = extractDateFromFilename(fileName);
    if (!extracted) {
        console.log(`Skipping: ${fileName} (No valid date found in filename)`);
        return;
    }

    const { iso, dateObj } = extracted;
    console.log(`Adjusting: ${fileName} -> Target Date: ${iso}`);

    const ext = path.extname(filePath);
    const tempPath = filePath.slice(0, -ext.length) + '_tmp' + ext;

    // 1. Adjust Internal EXIF metadata using FFmpeg (copying streams without re-encoding)
    await new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .outputOptions([
                '-c', 'copy',
                '-map', '0',
                '-metadata', `creation_time=${iso}`
            ])
            .on('end', () => resolve())
            .on('error', (err) => {
                console.error(`  Error adjusting EXIF: ${err.message}`);
                resolve();
            })
            .save(tempPath);
    });

    if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, filePath);
    }

    // 2. Adjust File System dates
    // Using fs.utimesSync for modification/access time
    try {
        fs.utimesSync(filePath, dateObj, dateObj);
    } catch (err) {
        console.error(`  Warning: Could not set utimes: ${err.message}`);
    }

    // Using SetFile on macOS for creation time (birthtime)
    try {
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const yyyy = dateObj.getFullYear();
        const HH = String(dateObj.getHours()).padStart(2, '0');
        const MM = String(dateObj.getMinutes()).padStart(2, '0');
        const SS = String(dateObj.getSeconds()).padStart(2, '0');
        const dateStr = `${mm}/${dd}/${yyyy} ${HH}:${MM}:${SS}`;
        execSync(`SetFile -d "${dateStr}" -m "${dateStr}" "${filePath}"`);
    } catch (err) {
        // ignore if not on mac or SetFile fails
    }

    console.log(`  ✅ Done.`);
}

async function run() {
    console.log(`Scanning folder: ${targetDir}`);
    const files = fs.readdirSync(targetDir);

    for (const file of files) {
        const fullPath = path.join(targetDir, file);
        if (fs.statSync(fullPath).isDirectory()) continue;

        if (videoExtensions.includes(path.extname(file).toLowerCase())) {
            await processFile(fullPath, file);
        }
    }

    console.log('\nAll EXIF adjustments finished.');
}

run();
