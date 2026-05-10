# Video Converter Pro (video-utils)

A Node.js CLI utility wrapper around `fluent-ffmpeg` designed to reliably batch convert legacy video codecs (like AVI/MPEG) to modern MP4 (H.264/HEVC) while guaranteeing the absolute preservation of internal EXIF metadata and OS-level file timestamps.

## Project Architecture

The project adheres to a modular, decoupled architecture, separating the core utility functions from the CLI command handlers.

```text
├── src/
│   ├── index.js                  # Main CLI entry point
│   ├── commands/                 # Command controllers
│   │   ├── adjust-exif.js        # Modifies EXIF/OS dates via filename extraction
│   │   ├── convert.js            # Video codec conversion & metadata mapping
│   │   └── inspect.js            # Metadata extraction and console reporting
│   └── utils/                    # Shared core business logic
│       ├── date.js               # Date/time regex extraction and OS timestamp logic
│       ├── file.js               # FS path resolution and validation
│       └── metadata.js           # FFprobe subprocess execution and JSON parsing
└── test/
    └── unit/                     # Native node:test unit suites
        ├── date.test.js
        └── file.test.js
```

## CLI Usage

The library exposes a single entry point via `src/index.js`. 

### `convert <sourceDir> <outputDir>`
Scans the source directory and transpiles videos. By default, it scans recursively but outputs all files to a single flat level in the output directory.
- Switches to `libx265` (HEVC) for >720p, otherwise `libx264` (AVC).
- Detects legacy audio (like `pcm_u8`) and transpiles to `aac` to prevent MP4 multiplexing failures.
- Recursively maps stream-level EXIF data (e.g. `DateTime`, `Make`, `Model`) into the output MP4 format metadata.
- Applies `fs.utimesSync` and macOS `SetFile` to replicate identical OS modification/birth timestamps on the output.

- Calculates and displays a comprehensive **Space Saving Summary** (Actual vs Estimated in dry-run).

**Options:**
- `--dry-run`: Log actions and estimate space savings without creating output files or directories.
- `--no-recursive`: Disable recursive scanning (Scans recursively by default).

```bash
node src/index.js convert ./test/sourceTest ./test/outputTest
```

### `adjust-exif <targetDir> [options]`
Extracts the date and time strings embedded directly within filenames (e.g. `2007-12-07_192638.mp4`).
- Utilizes `ffmpeg -c copy` to inject a newly formatted ISO-8601 `creation_time` directly into the container header without re-encoding the stream.
- Re-aligns OS `birthtime` and `mtime` to match.
- Designed to fallback to the furthest-right date sequence if multiple dates exist in the string.

**Options:**
- `--compareDate=distinct` (Default): Only adjust files where filename date and metadata date differ. Logs mismatches.
- `--compareDate=fileNameNewer`: Only adjust if the date extracted from the filename is more recent than the metadata.
- `--compareDate=fileNameOlder`: Only adjust if the existing metadata date is more recent than the filename.
- `--syncFS`: One-way sync. Ensures OS file system timestamps match the internal EXIF metadata, even if no metadata adjustment is required.
- `--dry-run`: Log actions without modifying any files. Useful for testing comparison filters.

```bash
node src/index.js adjust-exif ./test/outputTest
```

### `inspect <targetDir> [options]`
Iterates through a directory, spawning `ffprobe` to pull and summarize video resolution, duration, OS timestamps, and raw internal format/stream EXIF tags.

**Options:**
- `--min-duration=<mins>`
- `--min-height=<pixels>`
- `--min-resolution=<width>x<height>` (or single number for width)

```bash
node src/index.js inspect ./test/sourceTest --min-height=720
```

### Profiles
The CLI supports running a preconfigured chain of commands defined in a `video-utils.config.json` file. This is useful for automating repetitive workflows.

**Usage:**
```bash
# Direct usage
node src/index.js --profile=<name>

# NPM shortcut (requires -- to pass arguments)
npm run profile -- <name>
```

**Configuration File (`video-utils.config.json`):**
The CLI looks for a `video-utils.config.json` file in the root of your project. A sample file is provided as `video-utils.config.sample.json`. To use profiles, copy the sample file and rename it to `video-utils.config.json`.

```json
{
  "profiles": {
    "daily-sync": [
      {
        "command": "convert",
        "sourceDir": "./input",
        "outputDir": "./output",
        "options": { "dryRun": false }
      },
      {
        "command": "adjust-exif",
        "targetDir": "./output",
        "options": { "compareDate": "distinct", "syncFS": true }
      },
      {
        "command": "inspect",
        "targetDir": "./output",
        "options": { "minHeight": 720 }
      }
    ]
  }
}
```

## Testing

This project utilizes Node.js's native `node:test` runner and `node:assert` modules, ensuring zero overhead and no third-party test dependencies. Tests focus strictly on validating regex boundaries and utility behaviors.

```bash
npm test
```
