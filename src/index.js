#!/usr/bin/env node

const convertCommand = require('./commands/convert');
const inspectCommand = require('./commands/inspect');
const adjustExifCommand = require('./commands/adjust-exif');

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
    console.log(`
Video Utils CLI
---------------
Usage:
  node src/index.js <command> [options]

Commands:
  convert <sourceDir> <outputDir> [options] Convert videos (HEVC/AVC) and preserve metadata
                                       --dry-run                   Log actions without modifying files
  inspect <targetDir> [options]      Inspect video metadata
                                       --min-duration=<mins>
                                       --min-height=<pixels>
                                       --min-resolution=<width>x<height>
  adjust-exif <targetDir> [options]  Adjust EXIF and OS dates based on filename
                                       --compareDate=distinct      Only if dates differ
                                       --compareDate=fileNameNewer Only if filename date is newer
                                       --compareDate=fileNameOlder Only if metadata date is newer
                                       --syncFS                    One-way sync EXIF date to file system dates
                                       --dry-run                   Log actions without modifying files

Examples:
  node src/index.js convert ./source ./output
  node src/index.js inspect ./output --min-height=720
  node src/index.js adjust-exif ./output --compareDate=distinct
    `);
}

if (!command || ['help', '--help', '-h'].includes(command)) {
    showHelp();
    process.exit(0);
}

switch (command) {
    case 'convert': {
        const src = args[1];
        const out = args[2];
        if (!src || !out) {
            console.error('Error: Source and output directories are required.');
            process.exit(1);
        }
        const options = {};
        args.slice(3).forEach(arg => {
            if (arg === '--dry-run') options.dryRun = true;
        });
        convertCommand(src, out, options);
        break;
    }
    case 'inspect': {
        const target = args[1];
        if (!target || target.startsWith('--')) {
            console.error('Error: Target directory is required.');
            process.exit(1);
        }
        const options = {};
        args.slice(2).forEach(arg => {
            if (arg.startsWith('--min-duration=')) options.minDuration = arg.split('=')[1];
            if (arg.startsWith('--min-height=')) options.minHeight = arg.split('=')[1];
            if (arg.startsWith('--min-resolution=')) options.minResolution = arg.split('=')[1];
        });
        inspectCommand(target, options);
        break;
    }
    case 'adjust-exif': {
        const target = args[1];
        if (!target || target.startsWith('--')) {
            console.error('Error: Target directory is required.');
            process.exit(1);
        }
        const options = {};
        args.slice(2).forEach(arg => {
            if (arg === '--dry-run') options.dryRun = true;
            if (arg === '--syncFS') options.syncFS = true;
            if (arg.startsWith('--compareDate=')) options.compareDate = arg.split('=')[1];
        });
        adjustExifCommand(target, options);
        break;
    }
    default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
}
