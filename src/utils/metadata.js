const { execSync } = require('child_process');

function getMetadata(filePath) {
    try {
        const cmd = `ffprobe -v error -show_entries format=duration:format_tags -show_entries stream=codec_type,codec_name,width,height:stream_tags -of json "${filePath}"`;
        const output = execSync(cmd).toString();
        const data = JSON.parse(output);
        
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video') || {};
        const format = data.format || {};
        
        const allTags = { ...(format.tags || {}), ...(videoStream.tags || {}) };
        
        return {
            codec: videoStream.codec_name,
            width: parseInt(videoStream.width),
            height: parseInt(videoStream.height),
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
