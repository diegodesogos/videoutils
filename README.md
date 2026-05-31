# Video Converter Pro (video-utils)

A Node.js CLI utility wrapper around `fluent-ffmpeg` designed to reliably batch convert legacy video codecs (like AVI/MPEG) to modern MP4 (H.264/HEVC) while guaranteeing the absolute preservation of internal EXIF metadata and OS-level file timestamps.

## Prerequisites & Installation

This utility relies on external system-level binaries to perform video transcoding, metadata parsing, and file timestamp preservation.

### 1. System Dependencies

Ensure the following packages are installed on your system and available in your shell's `PATH`:
- **FFmpeg & FFprobe**: Required for video transcoding, metadata extraction, stream mapping, and container manipulations.
- **HandBrakeCLI**: Required specifically for processing and converting DVD structures (`VIDEO_TS`).
- **Xcode Command Line Tools** (macOS only): Required for the `SetFile` utility, which preserves identical file creation (`birthtime`) timestamps.

#### macOS Setup
Using [Homebrew](https://brew.sh):
```bash
# Install FFmpeg and HandBrake CLI
brew install ffmpeg handbrake-cli

# Install Xcode Command Line Tools (to get 'SetFile')
xcode-select --install
```

#### Linux Setup
On Debian/Ubuntu-based distributions:
```bash
# Update packages and install FFmpeg and HandBrake CLI
sudo apt update
sudo apt install ffmpeg handbrake-cli
```
> [!NOTE]
> On Linux, the macOS-exclusive `SetFile` utility is not available. The application will automatically fallback to updating access and modification times (`atime` and `mtime`) via standard file system calls, while skipping creation time modification.

### 2. Project Installation

This utility requires **Node.js (v18+)**. 

To set up the repository:
```bash
# Clone the repository and navigate to its root directory
git clone <repository-url>
cd video_utils

# Install Node dependencies
npm install
```

## Project Architecture

The project adheres to a modular, decoupled architecture, separating the core utility functions from the CLI command handlers.

```text
├── src/
│   ├── index.js                  # Main CLI entry point
│   ├── commands/                 # Command controllers
│   │   ├── adjust-exif.js        # Modifies EXIF/OS dates via filename extraction
│   │   ├── convert.js            # Video codec conversion & metadata mapping
│   │   ├── inspect.js            # Metadata extraction and console reporting
│   │   └── remux.js              # In-place lossless stream editing (e.g. DAR)
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

### `convert <sourceDirOrFile> <outputDir>`
Scans the source directory or a single file and transpiles videos. By default, it scans recursively if a directory is provided, but outputs all files to a single flat level in the output directory.
- **DVD/VOB Directory Support**: Automatically detects DVD structures (containing `VIDEO_TS` or `VIDEO_TS.IFO`). When a DVD directory is detected, it utilizes `HandBrakeCLI` (required system dependency) to dynamically parse the DVD structure, filter out menu loops (under 10 seconds), and convert individual DVD titles sequentially into independent, optimized `.mp4` files (named `Title_01.mp4`, `Title_02.mp4`, etc.). If the output file exceeds `--maxFileSizeMb`, it is automatically split into smaller chunks (using fast lossless `ffmpeg` segmenting) to facilitate uploads to Google Photos. The progress tracking maintains a robust stream buffer to ensure smooth conversion metrics on long files.
- Switches to `libx265` (HEVC) for >720p, otherwise `libx264` (AVC) for standard video files.
- Detects legacy audio (like `pcm_u8`) and transpiles to `aac` to prevent MP4 multiplexing failures.
- Recursively maps stream-level EXIF data (e.g. `DateTime`, `Make`, `Model`) into the output MP4 format metadata.
- Applies `fs.utimesSync` and macOS `SetFile` to replicate identical OS modification/birth timestamps on the output.
- Leaves Display Aspect Ratio (DAR) untouched by default, allowing you to explicitly override it or dynamically infer it via GCD mapping.

- Calculates and displays a comprehensive **Space Summary** (Actual vs Estimated in dry-run).

**Options:**
- `--dry-run`: Log actions and estimate space savings without creating output files or directories.
- `--no-recursive`: Disable recursive scanning (Scans recursively by default).
- `--aspectRatio=<ratio>`: The aspect ratio to force on the container (e.g. `16:9`).
- `--aspectRatio=default`: Automatically calculates and infers the correct Display Aspect Ratio (DAR) based on the exact pixel dimensions (using GCD).
- `--maxFileSizeMb=<MB>`: Splits files larger than this target size in megabytes (e.g. `1024`). Defaults to `1024` (1 GB) for DVD conversions.
```bash
# Directory processing
node src/index.js convert ./test/sourceTest ./test/outputTest

# Single file processing
node src/index.js convert ./test/sourceTest/video.mp4 ./test/outputTest

# Processing with options
node src/index.js convert ./test/sourceTest ./test/outputTest --dry-run --no-recursive
```

### `adjust-exif <targetDirOrFile> [options]`
Extracts the date and time strings embedded directly within filenames of all videos in a directory or a single file.
- Utilizes `ffmpeg -c copy` to inject a newly formatted ISO-8601 `creation_time` (using the system's local timezone instead of UTC) directly into the container header without re-encoding the stream.
- Re-aligns OS `birthtime` and `mtime` to match.
- Employs a structured heuristic engine to extract dates. It prioritizes finding a date coupled with a time separated by a dash, underscore, or space (e.g., `2013-01-19 120718- Summer Trip 01.mp4` or `2023-08-15_093000_birthday.mp4`).
- If no combined date and time is found, it falls back to extracting just the date (e.g., `2020-12-25.mp4`).
- Designed to fallback to the furthest-right date sequence if multiple matching dates exist in the string.

**Options:**
- `--compareDate=distinct` (Default): Only adjust files where filename date and metadata date differ. Logs mismatches.
- `--compareDate=fileNameNewer`: Only adjust if the date extracted from the filename is more recent than the metadata.
- `--compareDate=fileNameOlder`: Only adjust if the existing metadata date is more recent than the filename.
- `--syncFS`: One-way sync. Ensures OS file system timestamps match the internal EXIF metadata, even if no metadata adjustment is required.
- `--applyHeuristics`: Enables edge-case heuristics:
  - **Epoch Zero Metadata:** If the existing metadata date is invalid (e.g. before year 1971), it unconditionally overwrites the EXIF with the filename date, ignoring `--compareDate` filters.
  - **Exact Hour Precision:** If either the filename date or the metadata date has an exact hour (`XX:00:00`, 0 minutes and 0 seconds) and the time difference is less than 24 hours, the more precise date is preferred. If the metadata is the precise one, it prevents EXIF overwriting and selectively synchronizes only the OS file system dates.
- `--dry-run`: Log actions without modifying any files. Useful for testing comparison filters.

```bash
# Directory processing
node src/index.js adjust-exif ./test/outputTest

# Single file processing
node src/index.js adjust-exif ./test/outputTest/video.mp4
```

### `inspect <targetDirOrFile> [options]`
Iterates through a directory or a single file, spawning `ffprobe` to pull and summarize video resolution, duration, OS timestamps, and raw internal format/stream EXIF tags.

**Options:**
- `--min-duration=<mins>`
- `--min-height=<pixels>`
- `--min-resolution=<width>x<height>` (or single number for width)

```bash
# Directory processing
node src/index.js inspect ./test/sourceTest --min-height=720

# Single file processing
node src/index.js inspect ./test/sourceTest/video.mp4
```

### `remux <targetDirOrFile> [options]`
Iterates through a directory or a single file to losslessly modify stream metadata in-place (such as Display Aspect Ratio).
- Uses `ffmpeg -c copy` to completely bypass video and audio re-encoding, ensuring 100% preservation of original quality.
- Safely writes to a temporary file before overwriting the original file.
- Re-applies `fs.utimesSync` to preserve the original OS creation and modification timestamps.

**Options:**
- `--aspectRatio=<ratio>`: The aspect ratio to force on the container (e.g. `16:9`).
- `--aspectRatio=default`: Automatically calculates and infers the correct Display Aspect Ratio (DAR) based on the exact pixel dimensions (using GCD).
- `--no-recursive`: Disable recursive scanning (Scans recursively by default).
- `--dry-run`: Log actions without modifying any files.

```bash
# Directory processing (infer from pixels)
node src/index.js remux ./test/sourceTest --aspectRatio=default

# Single file processing
node src/index.js remux ./test/sourceTest/video.mp4 --aspectRatio=16:9
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
        "sourceDirOrFile": "./input",
        "outputDir": "./output",
        "options": { "dryRun": false, "recursive": true }
      },
      {
        "command": "adjust-exif",
        "targetDirOrFile": "./output",
        "options": { "compareDate": "distinct", "syncFS": true }
      },
      {
        "command": "inspect",
        "targetDirOrFile": "./output",
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
