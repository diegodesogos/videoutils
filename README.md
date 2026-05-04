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
Scans the source directory and transpiles videos.
- Switches to `libx265` (HEVC) for >720p, otherwise `libx264` (AVC).
- Detects legacy audio (like `pcm_u8`) and transpiles to `aac` to prevent MP4 multiplexing failures.
- Recursively maps stream-level EXIF data (e.g. `DateTime`, `Make`, `Model`) into the output MP4 format metadata.
- Applies `fs.utimesSync` and macOS `SetFile` to replicate identical OS modification/birth timestamps on the output.

```bash
node src/index.js convert ./test/sourceTest ./test/outputTest
```

### `adjust-exif <targetDir>`
Extracts the date and time strings embedded directly within filenames (e.g. `2007-12-07_192638.mp4`).
- Utilizes `ffmpeg -c copy` to inject a newly formatted ISO-8601 `creation_time` directly into the container header without re-encoding the stream.
- Re-aligns OS `birthtime` and `mtime` to match.
- Designed to fallback to the furthest-right date sequence if multiple dates exist in the string.

```bash
node src/index.js adjust-exif ./test/outputTest
```

### `inspect <targetDir> [options]`
Iterates through a directory, spawning `ffprobe` to pull and summarize video resolution, duration, OS timestamps, and raw internal format/stream EXIF tags.

**Options:**
- `--min-duration=<mins>`
- `--min-height=<pixels>`

```bash
node src/index.js inspect ./test/sourceTest --min-height=720
```

## Testing

This project utilizes Node.js's native `node:test` runner and `node:assert` modules, ensuring zero overhead and no third-party test dependencies. Tests focus strictly on validating regex boundaries and utility behaviors.

```bash
npm test
```
