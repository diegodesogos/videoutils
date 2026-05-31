const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const { getOutputFilePath, getTempFilePath } = require('./file');

/**
 * Scans a DVD directory using HandBrakeCLI and extracts title information.
 * @param {string} dvdPath The path to the DVD directory (usually containing VIDEO_TS)
 * @returns {Promise<Array<{ title: number, duration: string, durationSeconds: number }>>}
 */
function scanDvd(dvdPath) {
    return new Promise((resolve, reject) => {
        const handbrake = child_process.spawn('HandBrakeCLI', ['--scan', '-t', '0', '-i', dvdPath]);
        
        let output = '';
        const interval = setInterval(() => process.stdout.write('.'), 1000);
        
        handbrake.stdout.on('data', (data) => output += data.toString());
        handbrake.stderr.on('data', (data) => output += data.toString());
        
        handbrake.on('close', () => {
            clearInterval(interval);
            process.stdout.write('\n');
            // HandBrakeCLI often exits with non-zero code after a scan, which is normal.
            const titles = [];
            
            // Match: "+ title 1:"
            const titleRegex = /\+\s+title\s+(\d+):/g;
            // Match: "+ duration: 00:15:30"
            const durationRegex = /\+\s+duration:\s+(\d{2}):(\d{2}):(\d{2})/g;
            
            let titleMatch;
            let currentTitle = null;
            
            const lines = output.split('\n');
            for (const line of lines) {
                const tMatch = line.match(/\+\s+title\s+(\d+):/);
                if (tMatch) {
                    currentTitle = {
                        title: parseInt(tMatch[1], 10),
                    };
                    titles.push(currentTitle);
                } else if (currentTitle) {
                    const dMatch = line.match(/\+\s+duration:\s+(\d{2}):(\d{2}):(\d{2})/);
                    if (dMatch) {
                        const h = parseInt(dMatch[1], 10);
                        const m = parseInt(dMatch[2], 10);
                        const s = parseInt(dMatch[3], 10);
                        currentTitle.duration = dMatch[0].replace('+ duration: ', '').trim();
                        currentTitle.durationSeconds = h * 3600 + m * 60 + s;
                    }
                }
            }
            
            // Filter out empty or invalid titles
            const validTitles = titles.filter(t => t.durationSeconds > 0);
            resolve(validTitles);
        });
    });
}

/**
 * Converts a specific title from a DVD to mp4.
 * @param {string} dvdPath 
 * @param {number} titleNum 
 * @param {string} outputFilePath 
 * @param {boolean} dryRun 
 * @param {Function} onProgress 
 */
function convertDvdTitle(dvdPath, titleNum, outputFilePath, dryRun = false, onProgress = null) {
    return new Promise((resolve, reject) => {
        if (dryRun) {
            console.log(`[DRY RUN] Would extract DVD Title ${titleNum} from ${dvdPath} to ${outputFilePath}`);
            return resolve();
        }

        const tempFilePath = getTempFilePath(outputFilePath);
        
        // Basic parameters: -e x264 -q 20 --encoder-preset fast (good quality/speed for typical DVD rips)
        const args = [
            '-i', dvdPath,
            '-t', titleNum.toString(),
            '-o', tempFilePath,
            '-e', 'x264',
            '-q', '20',
            '--encoder-preset', 'fast',
            '-a', '1', // default audio track
            '-E', 'ca_aac' // coreaudio aac encoding (macOS native, very fast/good) or just 'av_aac'
        ];

        const handbrake = child_process.spawn('HandBrakeCLI', args);

        let stderrBuffer = '';
        handbrake.stderr.on('data', (data) => {
            stderrBuffer += data.toString();
            // HandBrakeCLI prints progress to stderr: "Encoding: task 1 of 1, 45.23 % (42.12 fps, avg 40.50 fps, ETA 00h02m10s)"
            const matches = [...stderrBuffer.matchAll(/(\d+\.\d+)\s*%(?:.*?(?:ETA\s+([\dhms]+)))?/g)];
            if (matches.length > 0) {
                const lastMatch = matches[matches.length - 1];
                if (onProgress) {
                    onProgress(parseFloat(lastMatch[1]), lastMatch[2]);
                }
                // Keep only the end of the buffer to prevent memory growth
                stderrBuffer = stderrBuffer.slice(-200);
            }
            // If no match is found, keep buffer small
            if (stderrBuffer.length > 1000) {
                stderrBuffer = stderrBuffer.slice(-1000);
            }
        });

        handbrake.on('close', (code) => {
            if (code === 0) {
                fs.renameSync(tempFilePath, outputFilePath);
                resolve();
            } else {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                reject(new Error(`HandBrakeCLI exited with code ${code}`));
            }
        });
    });
}

module.exports = {
    scanDvd,
    convertDvdTitle
};
