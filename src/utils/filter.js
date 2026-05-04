function matchesFilters(meta, options = {}) {
    const { minDuration, minHeight, minResolution } = options;

    const matchesDuration = minDuration ? (meta.duration / 60) >= parseFloat(minDuration) : true;
    const matchesHeight = minHeight ? meta.height >= parseInt(minHeight) : true;
    
    let matchesResolution = true;
    if (minResolution) {
        const parts = minResolution.toLowerCase().split('x');
        const minW = parseInt(parts[0]);
        const minH = parseInt(parts[1] || '0');
        if (!isNaN(minW)) {
            // If format is WxH, compare total pixels. If just W, compare width.
            const minPixels = minH ? (minW * minH) : minW;
            const videoPixels = minH ? (meta.width * meta.height) : meta.width;
            matchesResolution = videoPixels >= minPixels;
        }
    }

    // Filters are additive, so all specified conditions must be true
    return matchesDuration && matchesHeight && matchesResolution;
}

module.exports = { matchesFilters };
