const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.avi', '.m4v', '.webm', '.mpg', '.mpeg', '.wmv'];

function isVideoFile(filePath) {
    return VIDEO_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function getOutputFilePath(filePath, outputDir) {
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    return path.join(outputDir, `${basename}.mp4`);
}

function getTempFilePath(filePath) {
    const ext = path.extname(filePath);
    return filePath.slice(0, -ext.length) + '_tmp' + ext;
}

module.exports = { isVideoFile, getOutputFilePath, getTempFilePath, VIDEO_EXTENSIONS };
