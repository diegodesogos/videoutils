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

function restoreFileDates(filePath, atime, mtime, birthtime) {
    const d = birthtime || mtime;
    try {
        fs.utimesSync(filePath, atime || d, mtime || d);
    } catch (err) { }

    try {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        const HH = String(d.getHours()).padStart(2, '0');
        const MM = String(d.getMinutes()).padStart(2, '0');
        const SS = String(d.getSeconds()).padStart(2, '0');
        const dateStr = `${mm}/${dd}/${yyyy} ${HH}:${MM}:${SS}`;
        execSync(`SetFile -d "${dateStr}" -m "${dateStr}" "${filePath}"`);
    } catch (err) {}
}

module.exports = { extractDateFromFilename, extractDateFromTags, formatFfmpegDate, restoreFileDates };
