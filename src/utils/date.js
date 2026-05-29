const fs = require('fs');
const { execSync } = require('child_process');

function extractDateFromFilename(filename) {
    const regex = /(?:^|[^0-9])((?:19|20)\d{2}[-]?\d{2}[-]?\d{2})(?:[_-](\d{6}))?(?=[^0-9]|$)/g;
    let match;
    let lastMatch = null;

    while ((match = regex.exec(filename)) !== null) {
        lastMatch = match;
    }

    if (!lastMatch) return null;

    let dateStr = lastMatch[1].replace(/-/g, '');
    let timeStr = lastMatch[2] || '120000';

    const yyyy = dateStr.substring(0, 4);
    const mm = dateStr.substring(4, 6);
    const dd = dateStr.substring(6, 8);

    if (parseInt(mm) > 12 || parseInt(mm) < 1 || parseInt(dd) > 31 || parseInt(dd) < 1) {
        return null;
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

function extractDateFromTags(tags, stat) {
    let creationTime = tags.creation_time || tags.DateTime || tags['ExifIFD/DateTimeOriginal'];
    if (!creationTime && stat) {
        const d = stat.birthtime || stat.mtime;
        if (d) creationTime = d.toISOString();
    }
    return creationTime;
}

function formatFfmpegDate(creationTime) {
    if (!creationTime) return null;
    if (creationTime.match(/^\d{4}[:\-]\d{2}[:\-]\d{2}\s\d{2}:\d{2}:\d{2}$/)) {
        return creationTime.replace(/^(\d{4})[:\-](\d{2})[:\-](\d{2})\s(.*)$/, '$1-$2-$3T$4Z');
    }
    return creationTime;
}

function formatDateForSetFile(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const HH = String(d.getHours()).padStart(2, '0');
    const MM = String(d.getMinutes()).padStart(2, '0');
    const SS = String(d.getSeconds()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${HH}:${MM}:${SS}`;
}

function restoreFileDates(filePath, atime, mtime, birthtime) {
    try {
        fs.utimesSync(filePath, atime || mtime, mtime);
    } catch (err) { }

    try {
        if (birthtime) {
            const birthStr = formatDateForSetFile(birthtime);
            execSync(`SetFile -d "${birthStr}" "${filePath}"`);
        }
        if (mtime) {
            const mtimeStr = formatDateForSetFile(mtime);
            execSync(`SetFile -m "${mtimeStr}" "${filePath}"`);
        }
    } catch (err) {}
}

/**
 * Decides if a date adjustment should occur based on a comparison mode.
 * @param {Date} filenameDate 
 * @param {Date} metadataDate 
 * @param {string} mode - 'distinct', 'fileNameNewer', 'fileNameOlder'
 * @param {boolean} applyHeuristics - whether to apply edge-case heuristics
 * @returns {{ isMismatch: boolean, shouldAdjust: boolean, syncToMetadata?: boolean, heuristicApplied?: string }}
 */
function shouldAdjustDate(filenameDate, metadataDate, mode, applyHeuristics = false) {
    if (!filenameDate) return { isMismatch: false, shouldAdjust: false };

    if (applyHeuristics) {
        // Case 1: Invalid/Epoch Zero metadata (there are no videos older than 1971) or Missing metadata
        if (!metadataDate || metadataDate.getFullYear() < 1971) {
            return { isMismatch: true, shouldAdjust: true, heuristicApplied: 'epoch-zero' };
        }

        // Case 2: Midnight/Noon Precision
        const isSuspicious = (d) => d.getUTCHours() % 12 === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
        const diff = Math.abs(metadataDate.getTime() - filenameDate.getTime());
        
        if (diff < 86400000) { // less than a day
            const filenameSuspicious = isSuspicious(filenameDate);
            const metadataSuspicious = isSuspicious(metadataDate);

            if (filenameSuspicious && !metadataSuspicious) {
                // Metadata date is more precise. Sync FS to metadata date, do not modify EXIF.
                return { isMismatch: true, shouldAdjust: false, syncToMetadata: true, heuristicApplied: 'precise-metadata' };
            } else if (!filenameSuspicious && metadataSuspicious) {
                // Filename date is more precise. Modify EXIF to filename date.
                return { isMismatch: true, shouldAdjust: true, heuristicApplied: 'precise-filename' };
            }
        }
    }

    const isMismatch = !metadataDate || Math.abs(metadataDate.getTime() - filenameDate.getTime()) > 1000;
    
    // Default behavior (no mode) is equivalent to 'distinct'
    if (!mode || mode === 'distinct') {
        return { isMismatch, shouldAdjust: isMismatch };
    }

    let shouldAdjust = false;
    switch (mode) {
        case 'fileNameNewer':
            shouldAdjust = !!(metadataDate && filenameDate.getTime() > metadataDate.getTime());
            break;
        case 'fileNameOlder':
            shouldAdjust = !!(metadataDate && filenameDate.getTime() < metadataDate.getTime());
            break;
    }

    return { isMismatch, shouldAdjust };
}

module.exports = { 
    extractDateFromFilename, 
    extractDateFromTags, 
    formatFfmpegDate, 
    restoreFileDates,
    shouldAdjustDate
};
