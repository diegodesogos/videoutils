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
  convert <sourceDir> <outputDir>    Convert videos (HEVC/AVC) and preserve metadata
  inspect <targetDir> [options]      Inspect video metadata
                                       --min-duration=<mins>
                                       --min-height=<pixels>
  adjust-exif <targetDir>            Adjust EXIF and OS dates based on filename

Examples:
  node src/index.js convert ./source ./output
  node src/index.js inspect ./output --min-height=720
  node src/index.js adjust-exif ./output
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
        convertCommand(src, out);
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
        });
        inspectCommand(target, options);
        break;
    }
    case 'adjust-exif': {
        const target = args[1];
        if (!target) {
            console.error('Error: Target directory is required.');
            process.exit(1);
        }
        adjustExifCommand(target);
        break;
    }
    default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
}
