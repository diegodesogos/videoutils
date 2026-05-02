const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);

// Show help if no arguments or --help is requested
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Video Inspector Utility
-----------------------
Usage:
  node index.js <folder_path> [options]

Options:
  --min-duration=N    Filter videos longer than or equal to N minutes.
  --min-height=N      Filter videos with a vertical resolution >= N (e.g., 720, 1080).
  --help, -h          Show this help menu.

Examples:
  # Find videos longer than 10 minutes:
  node index.js ./my-folder --min-duration=10

  # Find videos that are 1080p or higher:
  node index.js /Users/movies --min-height=1080

  # Combine both filters:
  node index.js . --min-duration=5 --min-height=720
    `);
    process.exit(0);
}

const targetDir = args.find(arg => !arg.startsWith('--'));
const minDuration = args.find(arg => arg.startsWith('--min-duration='))?.split('=')[1];
const minHeight = args.find(arg => arg.startsWith('--min-height='))?.split('=')[1];

// Validate that at least one filter is provided along with the path
if (!targetDir || (!minDuration && !minHeight)) {
    console.error('Error: You must provide a folder path and at least one filter (--min-duration or --min-height).');
    console.log('Run with --help for more information.');
    process.exit(1);
}

function getMetadata(filePath) {
    try {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries format=duration -show_entries stream=width,height,codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const output = execSync(cmd).toString().trim().split('\n');
        
        return {
            codec: output[0],
            width: parseInt(output[1]),
            height: parseInt(output[2]),
            duration: parseFloat(output[3])
        };
    } catch (err) {
        return null;
    }
}

function processVideos() {
    const absolutePath = path.resolve(targetDir);
    if (!fs.existsSync(absolutePath)) {
        return console.error(`Error: Folder not found at ${absolutePath}`);
    }

    const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.m4v', '.webm', '.mpg', '.mpeg', '.wmv'];
    const files = fs.readdirSync(absolutePath);

    console.log(`Scanning: ${absolutePath}\n`);

    let foundCount = 0;

    files.forEach(file => {
        if (!videoExtensions.includes(path.extname(file).toLowerCase())) return;

        const meta = getMetadata(path.join(absolutePath, file));
        if (!meta) return;

        const matchesDuration = minDuration ? (meta.duration / 60) >= parseFloat(minDuration) : true;
        const matchesHeight = minHeight ? meta.height >= parseInt(minHeight) : true;

        if (matchesDuration && matchesHeight) {
            foundCount++;
            console.log(`File: ${file}`);
            console.log(`  Codec: ${meta.codec} | Res: ${meta.width}x${meta.height} | Duration: ${(meta.duration / 60).toFixed(2)} mins`);
            console.log('-----------------------------------------------------------------');
        }
    });

    if (foundCount === 0) {
        console.log('No videos matched your criteria.');
    } else {
        console.log(`Total matches found: ${foundCount}`);
    }
}

processVideos();