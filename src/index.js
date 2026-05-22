#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const convertCommand = require('./commands/convert');
const inspectCommand = require('./commands/inspect');
const adjustExifCommand = require('./commands/adjust-exif');
const remuxCommand = require('./commands/remux');
const { loadConfig, getProfile, validateProfile } = require('./utils/profile');

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
    console.log(`
Video Utils CLI
---------------
Usage:
  node src/index.js <command> [options]
  node src/index.js --profile=<name>

Commands:
  convert <sourceDirOrFile> <outputDir> [options] Convert videos (HEVC/AVC) and preserve metadata
                                       --dry-run                   Log actions without modifying files
                                       --no-recursive              Disable recursive scanning (default: true)
                                       --aspectRatio=<ratio>       Override aspect ratio (e.g., 16:9, default). Not applied by default.
  inspect <targetDirOrFile> [options]      Inspect video metadata
                                       --min-duration=<mins>
                                       --min-height=<pixels>
                                       --min-resolution=<width>x<height>
  adjust-exif <targetDirOrFile> [options]  Adjust EXIF and OS dates based on filename
                                       --compareDate=distinct      Only if dates differ
                                       --compareDate=fileNameNewer Only if filename date is newer
                                       --compareDate=fileNameOlder Only if metadata date is newer
                                       --syncFS                    One-way sync EXIF date to file system dates
                                       --dry-run                   Log actions without modifying files
  remux <targetDirOrFile> [options]        Remux videos in-place to edit stream data losslessly
                                       --dry-run                   Log actions without modifying files
                                       --no-recursive              Disable recursive scanning (default: true)
                                       --aspectRatio=<ratio>       Override aspect ratio (e.g., 16:9, default).

Profiles:
  --profile=<name>                  Run a preconfigured chain of commands from video-utils.config.json

Examples:
  node src/index.js convert ./source ./output
  node src/index.js convert ./source/video.mp4 ./output
  node src/index.js inspect ./output --min-height=720
  node src/index.js inspect ./output/video.mp4
  node src/index.js adjust-exif ./output --compareDate=distinct
  node src/index.js adjust-exif ./output/video.mp4
  node src/index.js remux ./output --aspectRatio=16:9
  node src/index.js remux ./output/video.mp4 --aspectRatio=default
  node src/index.js --profile=daily-sync
    `);
}

async function runProfile(profileName) {
    const configPath = path.join(process.cwd(), 'video-utils.config.json');
    let config, profile;
    
    try {
        config = loadConfig(configPath);
        profile = getProfile(config, profileName);
        validateProfile(profile);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }

    console.log(`Running profile: ${profileName}\n`);

    for (const step of profile) {
        console.log(`\n>>> Executing step: ${step.command}`);
        try {
            switch (step.command) {
                case 'convert':
                    await convertCommand(step.sourceDirOrFile, step.outputDir, step.options || {});
                    break;
                case 'inspect':
                    // inspectCommand is currently synchronous, but we await it for consistency
                    await inspectCommand(step.targetDirOrFile, step.options || {});
                    break;
                case 'adjust-exif':
                    await adjustExifCommand(step.targetDirOrFile, step.options || {});
                    break;
                case 'remux':
                    await remuxCommand(step.targetDirOrFile, step.options || {});
                    break;
                default:
                    console.error(`Error: Unknown command "${step.command}" in profile.`);
                    process.exit(1);
            }
        } catch (err) {
            console.error(`Error executing step ${step.command}: ${err.message}`);
            process.exit(1);
        }
    }
}

async function main() {
    if (!command || ['help', '--help', '-h'].includes(command)) {
        showHelp();
        process.exit(0);
    }

    if (command === '--profile' || command.startsWith('--profile=')) {
        let profileName;
        if (command.includes('=')) {
            profileName = command.split('=')[1];
        } else {
            profileName = args[1];
        }

        if (!profileName) {
            console.error('Error: Profile name is required.');
            process.exit(1);
        }
        await runProfile(profileName);
        return;
    }

    switch (command) {
        case 'convert': {
            const src = args[1];
            const out = args[2];
            const options = {};
            args.slice(3).forEach(arg => {
                if (arg === '--dry-run') options.dryRun = true;
                if (arg === '--recursive') options.recursive = true;
                if (arg === '--no-recursive') options.recursive = false;
                if (arg.startsWith('--aspectRatio=')) options.aspectRatio = arg.split('=')[1];
            });

            const params = { sourceDirOrFile: src, outputDir: out, options };
            const errors = convertCommand.validate(params);
            if (errors.length > 0) {
                console.error(`Validation errors:\n- ${errors.join('\n- ')}`);
                process.exit(1);
            }

            await convertCommand(src, out, options);
            break;
        }
        case 'inspect': {
            const target = args[1];
            const options = {};
            args.slice(2).forEach(arg => {
                if (arg.startsWith('--min-duration=')) options.minDuration = arg.split('=')[1];
                if (arg.startsWith('--min-height=')) options.minHeight = arg.split('=')[1];
                if (arg.startsWith('--min-resolution=')) options.minResolution = arg.split('=')[1];
            });

            const params = { targetDirOrFile: target, options };
            const errors = inspectCommand.validate(params);
            if (errors.length > 0) {
                console.error(`Validation errors:\n- ${errors.join('\n- ')}`);
                process.exit(1);
            }

            await inspectCommand(target, options);
            break;
        }
        case 'adjust-exif': {
            const target = args[1];
            const options = {};
            args.slice(2).forEach(arg => {
                if (arg === '--dry-run') options.dryRun = true;
                if (arg === '--syncFS') options.syncFS = true;
                if (arg.startsWith('--compareDate=')) options.compareDate = arg.split('=')[1];
            });

            const params = { targetDirOrFile: target, options };
            const errors = adjustExifCommand.validate(params);
            if (errors.length > 0) {
                console.error(`Validation errors:\n- ${errors.join('\n- ')}`);
                process.exit(1);
            }

            await adjustExifCommand(target, options);
            break;
        }
        case 'remux': {
            const target = args[1];
            const options = {};
            args.slice(2).forEach(arg => {
                if (arg === '--dry-run') options.dryRun = true;
                if (arg === '--recursive') options.recursive = true;
                if (arg === '--no-recursive') options.recursive = false;
                if (arg.startsWith('--aspectRatio=')) options.aspectRatio = arg.split('=')[1];
            });

            const params = { targetDirOrFile: target, options };
            const errors = remuxCommand.validate(params);
            if (errors.length > 0) {
                console.error(`Validation errors:\n- ${errors.join('\n- ')}`);
                process.exit(1);
            }

            await remuxCommand(target, options);
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            showHelp();
            process.exit(1);
    }
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
