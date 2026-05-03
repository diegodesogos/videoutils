const { execSync } = require('child_process');

function getMetadata(filePath) {
    try {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries format=duration:format_tags -show_entries stream=width,height,codec_name:stream_tags -of json "${filePath}"`;
        const output = execSync(cmd).toString();
        const data = JSON.parse(output);
        
        const stream = data.streams && data.streams[0] ? data.streams[0] : {};
        const format = data.format || {};
        
        const allTags = { ...(format.tags || {}), ...(stream.tags || {}) };
        
        return {
            codec: stream.codec_name,
            width: parseInt(stream.width),
            height: parseInt(stream.height),
            duration: parseFloat(format.duration),
            tags: allTags,
            rawStreams: data.streams || [],
            rawFormat: data.format || {}
        };
    } catch (err) {
        return null;
    }
}

module.exports = { getMetadata };
