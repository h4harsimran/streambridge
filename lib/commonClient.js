// --- Constants ---
const ITEM_TYPE_MOVIE = 'Movie';
const ITEM_TYPE_EPISODE = 'Episode';
const ITEM_TYPE_SERIES = 'Series';
const DEFAULT_FIELDS = "ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber"; // Consolidated fields

// Codec to file format mapping for subtitles
const CODEC_FORMAT_MAP = {
  'subrip': 'srt',
  'webvtt': 'vtt',
  'ass': 'ass',
  'ssa': 'ssa'
};

// --- Helper Functions ---

/**
 * Checks if provider IDs match the given IMDb or TMDb IDs, handling variations.
 * Works for both Emby and Jellyfin.
 * @param {object} providerIds - The ProviderIds object from Emby/Jellyfin.
 * @param {string|null} imdbIdToMatch - The IMDb ID (e.g., "tt1234567").
 * @param {string|null} tmdbIdToMatch - The TMDb ID (as a string).
 * @param {string|null} tvdbIdToMatch - The TVDB ID (as a string).
 * @param {string|null} anidbIdToMatch - The AniDB ID (as a string).
 * @returns {boolean} True if a match is found, false otherwise.
 */
function _isMatchingProviderId(providerIds, imdbIdToMatch, tmdbIdToMatch, tvdbIdToMatch, anidbIdToMatch) {
    if (!providerIds) return false;

    // Check IMDb (case-insensitive and numeric format)
    if (imdbIdToMatch) {
        const numericImdbVal = imdbIdToMatch.replace('tt', '');
        if (providerIds.Imdb === imdbIdToMatch || providerIds.imdb === imdbIdToMatch || providerIds.IMDB === imdbIdToMatch) return true;
        if (numericImdbVal && (providerIds.Imdb === numericImdbVal || providerIds.imdb === numericImdbVal || providerIds.IMDB === numericImdbVal)) return true;
    }

    // Check TMDb (case-insensitive and string/number comparison)
    if (tmdbIdToMatch) {
        const tmdbIdStr = String(tmdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tmdb === tmdbIdStr || providerIds.tmdb === tmdbIdStr || providerIds.TMDB === tmdbIdStr ||
            (providerIds.Tmdb && String(providerIds.Tmdb) === tmdbIdStr)) return true; // Compare against server's value as string too
    }

    // Check TVDB (case-insensitive and string/number comparison)
    if (tvdbIdToMatch) {
        const tvdbIdStr = String(tvdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tvdb === tvdbIdStr || providerIds.tvdb === tvdbIdStr || providerIds.TVDB === tvdbIdStr ||
            (providerIds.Tvdb && String(providerIds.Tvdb) === tvdbIdStr)) return true; // Compare against server's value as string too
    }

    // Check AniDB (case-insensitive and string/number comparison)
    if (anidbIdToMatch) {
        const anidbIdStr = String(anidbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.AniDb === anidbIdStr || providerIds.anidb === anidbIdStr || providerIds.ANIDB === anidbIdStr ||
            (providerIds.AniDb && String(providerIds.AniDb) === anidbIdStr)) return true; // Compare against server's value as string too
    }
    return false;
}

/**
 * Parses the Stremio-style ID (e.g., "tt12345", "tmdb12345", "tt12345:1:2")
 * into its components.
 * @param {string} idOrExternalId - The input ID string.
 * @returns {object|null} An object containing parsed info { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId, tvdbId, anidbId } or null if format is invalid.
 */
function parseMediaId(idOrExternalId) {
    if (!idOrExternalId) return null;

    const parts = idOrExternalId.split(':');
    let baseId = parts[0];
    let itemType = ITEM_TYPE_MOVIE; // Default to Movie
    let seasonNumber = null;
    let episodeNumber = null;
    let imdbId = null;
    let tmdbId = null;
    let tvdbId = null;
    let anidbId = null;

    if (parts.length === 3) {
        itemType = ITEM_TYPE_EPISODE; // Indicates a series episode
        seasonNumber = parseInt(parts[1], 10);
        episodeNumber = parseInt(parts[2], 10);
        if (isNaN(seasonNumber) || isNaN(episodeNumber)) {
             console.warn("❌ Invalid season/episode number in ID:", idOrExternalId);
             return null; // Invalid format
        }
    } else if (parts.length === 2) {
        
        const prefix = parts[0].toLowerCase();
        const idPart = parts[1];
        if (!idPart) {
            console.warn(`❌ Missing ${prefix.toUpperCase()} ID part in ID:`, idOrExternalId);
            return null;
        }
        if (prefix === "tmdb") {
            tmdbId = idPart;
            baseId = `tmdb${idPart}`; // normalized
        } else if (prefix === "imdb") {
            imdbId = idPart.startsWith("tt") ? idPart : `tt${idPart}`;
            baseId = imdbId; // normalized
        } else if (prefix === "tvdb") {
            tvdbId = idPart;
            baseId = `tvdb${idPart}`; // normalized
        } else if (prefix === "anidb") {
            anidbId = idPart;
            baseId = `anidb${idPart}`; // normalized
        } else {
            console.warn("❌ Unsupported prefix in ID:", prefix);
            return null;
        }
    } else if (parts.length !== 1) {
        console.warn("❌ Unexpected ID format:", idOrExternalId);
        return null; // Unexpected format
    }

    if (baseId.startsWith("tt")) {
        if (baseId.length <= 2) {
            console.warn("❌ Incomplete IMDb ID format:", baseId);
            return null;
        }
        imdbId = baseId;
    } else if (baseId.startsWith("imdb") && baseId.length > 4) { 
        imdbId = baseId.substring(4); 
        if (!imdbId.startsWith("tt")) imdbId = "tt" + imdbId; 
    } else if (baseId.startsWith("tmdb") && baseId.length > 4) {
        tmdbId = baseId.substring(4);
    } else if (baseId.startsWith("tvdb") && baseId.length > 4) {
        tvdbId = baseId.substring(4);
    } else if (baseId.startsWith("anidb") && baseId.length > 5) {
        anidbId = baseId.substring(5);
    } else {
        console.warn("❌ Unsupported base ID format (expected tt..., tmdb..., tvdb..., or anidb...):", baseId);
        return null;
    }

    return { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId, tvdbId, anidbId };
}

// --- Helper Functions for Stream Enrichment ---

/**
 * Returns resolution label based on video stream dimensions, using server's DisplayTitle when available.
 * Handles different aspect ratios correctly (4K UHD, DCI, ultrawide, etc.)
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string} Quality tag like "4K", "1080p", "720p", etc.
 */
function getQualityTag(videoStream) {
  if (!videoStream) return 'Unknown';
  
  const height = videoStream.Height;
  const width = videoStream.Width;
  const displayTitle = videoStream.DisplayTitle || '';
  
  // Try to extract resolution from DisplayTitle first (most accurate)
  // DisplayTitle often contains formatted resolution like "1080p", "4K", "2160p", etc.
  const resolutionMatch = displayTitle.match(/\b(\d+k|4k|2160p|1440p|1080p|720p|576p|480p|sd)\b/i);
  if (resolutionMatch) {
    const resolution = resolutionMatch[1].toUpperCase();
    // Normalize variations
    if (resolution.includes('4K') || resolution.includes('2160')) return '4K';
    if (resolution.includes('1440')) return '1440p';
    if (resolution.includes('1080')) return '1080p';
    if (resolution.includes('720')) return '720p';
    if (resolution.includes('576')) return '576p';
    if (resolution.includes('480')) return '480p';
    if (resolution.includes('SD')) return 'SD';
  }
  
  // If DisplayTitle doesn't have resolution, calculate from dimensions
  if (!width && !height) return 'Unknown';
  
  // Use width-based detection for 4K (handles different aspect ratios correctly)
  // 4K UHD = 3840x2160, DCI 4K = 4096x2160, ultrawide 4K = 3840x1600+
  if (width >= 3840 || height >= 2160) {
    // Further distinguish based on width
    if (width >= 4096) return '4K DCI';
    if (width >= 3840) return '4K';
    // Some tall formats with 2160p height
    return '2160p';
  }
  
  // Standard resolution detection based on height
  // Only use height if width-based detection doesn't apply
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 576) return '576p';
  if (height >= 480) return '480p';
  
  return 'SD';
}

/**
 * Returns formatted resolution dimensions string (e.g., "3840x2160").
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string|null} Resolution dimensions string or null if unavailable.
 */
function getResolutionDimensions(videoStream) {
  if (!videoStream) return null;
  
  const width = videoStream.Width;
  const height = videoStream.Height;
  
  if (width && height) {
    return `${width}x${height}`;
  }
  
  return null;
}

/**
 * Returns formatted video codec with profile information.
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string} Formatted codec tag like "H.264", "HEVC 10bit", etc.
 */
function getVideoTag(videoStream) {
  if (!videoStream) return '';
  
  const codec = videoStream.Codec?.toUpperCase();
  const profile = videoStream.Profile;
  
  // Map codec names to common abbreviations
  const codecMap = {
    'H264': 'H.264',
    'H265': 'HEVC',
    'HEVC': 'HEVC',
    'VP8': 'VP8',
    'VP9': 'VP9',
    'AV1': 'AV1',
    'MPEG2VIDEO': 'MPEG-2',
    'VC1': 'VC-1'
  };
  
  const displayCodec = codecMap[codec] || codec || '';
  
  // Add profile if meaningful (Main10 for 10-bit, etc.)
  if (profile && ['Main10', 'High10', 'Main 10'].some(p => profile.includes(p))) {
    return `${displayCodec} 10bit`;
  }
  
  return displayCodec;
}

/**
 * Returns HDR format using ExtendedVideoType enum with fallback to ColorTransfer detection.
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string|null} HDR tag like "HDR10", "HDR10+", "HLG", "DV", or null.
 */
function getHdrTag(videoStream) {
  if (!videoStream) return null;
  
  // Primary detection via ExtendedVideoType enum (most accurate)
  switch(videoStream.ExtendedVideoType) {
    case 'Hdr10': return 'HDR10';
    case 'Hdr10Plus': return 'HDR10+';
    case 'HyperLogGamma': return 'HLG';
    case 'DolbyVision': return 'DV';
    default: break;
  }
  
  // Fallback to ColorTransfer property
  if (videoStream.ColorTransfer === 'smpte2084') return 'HDR10';
  if (videoStream.ColorTransfer === 'arib-std-b67') return 'HLG';
  
  // Legacy IsHDR flag as last resort
  if (videoStream.IsHDR === true) return 'HDR';
  
  return null;
}

/**
 * Returns formatted audio codec with channel layout, preferring default audio stream.
 * @param {object} audioStream - The audio MediaStream object.
 * @returns {string} Formatted audio tag like "AAC 2.0", "TrueHD 7.1", etc.
 */
function getAudioTag(audioStream) {
  if (!audioStream) return '';
  
  const codec = audioStream.Codec?.toUpperCase();
  const channels = audioStream.Channels;
  
  // Map codec names to industry-standard abbreviations
  const codecMap = {
    'AAC': 'AAC',
    'AC3': 'DD',      // Dolby Digital
    'EAC3': 'DD+',    // Dolby Digital Plus
    'DTS': 'DTS',
    'DTSHD': 'DTS-HD',
    'TRUEHD': 'TrueHD',
    'FLAC': 'FLAC',
    'OPUS': 'Opus',
    'MP3': 'MP3',
    'VORBIS': 'Vorbis',
    'PCM': 'PCM'
  };
  
  const displayCodec = codecMap[codec] || codec || 'Unknown';
  
  // Format channel count to standard notation
  let channelStr = '';
  if (channels === 1) channelStr = 'Mono';
  else if (channels === 2) channelStr = '2.0';
  else if (channels === 6) channelStr = '5.1';
  else if (channels === 8) channelStr = '7.1';
  else if (channels) channelStr = `${channels}ch`;
  
  return channelStr ? `${displayCodec} ${channelStr}` : displayCodec;
}

/**
 * Returns uppercase container format.
 * @param {string} container - The container string (e.g., "mkv", "mp4").
 * @returns {string} Uppercase container tag or empty string.
 */
function getContainerTag(container) {
  if (!container) return '';
  return container.toUpperCase();
}

/**
 * Detects if the source is a remux by checking if filename contains "remux".
 * @param {object} source - The MediaSource object.
 * @param {object} videoStream - The video MediaStream object (unused but kept for compatibility).
 * @returns {boolean} True if filename contains "remux", false otherwise.
 */
function isRemux(source, videoStream) {
  if (!source) return false;
  
  // Check filename/path for remux indicator
  const path = source.Path?.toLowerCase() || '';
  const name = source.Name?.toLowerCase() || '';
  
  return path.includes('remux') || name.includes('remux');
}

/**
 * Converts bits per second to human-readable Mbps format.
 * @param {number} bps - Bitrate in bits per second.
 * @returns {string|null} Formatted bitrate like "8.2Mbps" or null if invalid.
 */
function formatBitrate(bps) {
  if (!bps || bps === 0) return null;
  const mbps = (bps / 1000000).toFixed(1);
  return `${mbps}Mbps`;
}

/**
 * Converts bytes to human-readable format with appropriate unit.
 * @param {number} bytes - File size in bytes.
 * @returns {string|null} Formatted size like "6.9GB" or "1.2MB" or null if invalid.
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return null;
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  // Use 1 decimal place for GB/TB, 0 for smaller units
  const decimals = unitIndex >= 3 ? 1 : 0;
  return `${size.toFixed(decimals)}${units[unitIndex]}`;
}

/**
 * Creates comprehensive description string with all technical details in 4-line format.
 * @param {object} mediaInfo - Enriched media information object.
 * @returns {string} Multi-line description string with all available metadata.
 */
function buildStreamDescription(mediaInfo) {
  const lines = [];
  
  // Line 1: Resolution (Quality tag + Dimensions)
  const resolutionLine = [];
  if (mediaInfo.qualityTag && mediaInfo.qualityTag !== 'Unknown') {
    resolutionLine.push(mediaInfo.qualityTag);
  }
  if (mediaInfo.resolutionDimensions) {
    resolutionLine.push(mediaInfo.resolutionDimensions);
  }
  if (resolutionLine.length > 0) {
    lines.push(resolutionLine.join(' • '));
  }
  
  // Line 2: Type (HDR + Video Codec)
  const typeLine = [];
  if (mediaInfo.hdrTag) {
    typeLine.push(mediaInfo.hdrTag);
  }
  if (mediaInfo.videoTag) {
    typeLine.push(mediaInfo.videoTag);
  }
  if (typeLine.length > 0) {
    lines.push(typeLine.join(' • '));
  }
  
  // Line 3: REMUX (when available)
  if (mediaInfo.isRemux) {
    lines.push('REMUX');
  }
  
  // Line 4: Audio information
  if (mediaInfo.audioTag) {
    lines.push(mediaInfo.audioTag);
  }
  
  // Line 5: Container, Bitrate, Size
  const fileLine = [];
  if (mediaInfo.container) {
    fileLine.push(mediaInfo.container);
  }
  if (mediaInfo.bitrateFormatted) {
    fileLine.push(mediaInfo.bitrateFormatted);
  }
  if (mediaInfo.sizeFormatted) {
    fileLine.push(mediaInfo.sizeFormatted);
  }
  if (fileLine.length > 0) {
    lines.push(fileLine.join(' • '));
  }
  
  // Join all lines with newline character
  return lines.join('\n') || 'Stream Available';
}

/**
 * Safely extracts media information with error handling and fallbacks.
 * @param {object} source - The MediaSource object.
 * @param {object} videoStream - The video MediaStream object.
 * @param {object} audioStream - The audio MediaStream object.
 * @returns {object} Enriched media information object.
 */
function safeExtractMediaInfo(source, videoStream, audioStream) {
  try {
    return {
      qualityTag: getQualityTag(videoStream),
      resolutionDimensions: getResolutionDimensions(videoStream),
      videoTag: getVideoTag(videoStream),
      videoCodec: videoStream?.Codec,
      hdrTag: getHdrTag(videoStream),
      audioTag: getAudioTag(audioStream),
      audioCodec: audioStream?.Codec,
      container: getContainerTag(source.Container),
      isRemux: isRemux(source, videoStream),
      bitrate: source.Bitrate,
      bitrateFormatted: formatBitrate(source.Bitrate),
      size: source.Size,
      sizeFormatted: formatFileSize(source.Size),
      filename: source.Path?.split(/[\\/]/).pop() || source.Name,
      supportsDirectPlay: source.SupportsDirectPlay === true,
      supportsDirectStream: source.SupportsDirectStream === true
    };
  } catch (error) {
    // SECURITY: Only log error message, not full error object
    console.error('Media info extraction failed:', error?.message || String(error));
    
    // Return minimal fallback info
    return {
      qualityTag: 'Unknown',
      resolutionDimensions: null,
      videoTag: '',
      hdrTag: null,
      audioTag: '',
      container: source?.Container?.toUpperCase() || 'Unknown',
      isRemux: false,
      bitrateFormatted: null,
      sizeFormatted: null,
      filename: source?.Path?.split(/[\\/]/).pop() || source?.Name || 'stream',
      supportsDirectPlay: source?.SupportsDirectPlay || false
    };
  }
}

/**
 * Sorts streams by quality (highest first) and deduplicates by mediaSourceId.
 * @param {Array<object>} streams - Array of stream objects.
 * @returns {Array<object>} Deduplicated and sorted streams.
 */
function deduplicateAndSortStreams(streams) {
    if (!streams || streams.length === 0) return [];
    
    // Deduplicate by mediaSourceId
    const uniqueStreams = Array.from(
        new Map(streams.map(stream => [stream.mediaSourceId, stream])).values()
    );
    
    // Sort by quality (highest to lowest)
    uniqueStreams.sort((a, b) => {
        // 1. Direct play priority
        const aDirectPlay = a.mediaInfo?.supportsDirectPlay ?? false;
        const bDirectPlay = b.mediaInfo?.supportsDirectPlay ?? false;
        if (aDirectPlay !== bDirectPlay) return bDirectPlay ? 1 : -1;
        
        // 2. Quality order
        const resOrder = {
            '4K DCI': 0, '4K': 1, '2160p': 2, '1440p': 3, '1080p': 4,
            '720p': 5, '576p': 6, '480p': 7, '360p': 8, 'SD': 9, 'Unknown': 10
        };
        const aRes = resOrder[a.mediaInfo?.qualityTag] ?? 10;
        const bRes = resOrder[b.mediaInfo?.qualityTag] ?? 10;
        if (aRes !== bRes) return aRes - bRes;
        
        // 3. HDR priority
        const aHdr = a.mediaInfo?.hdrTag ? 1 : 0;
        const bHdr = b.mediaInfo?.hdrTag ? 1 : 0;
        if (aHdr !== bHdr) return bHdr - aHdr;
        
        // 4. REMUX priority
        const aRemux = a.mediaInfo?.isRemux ? 1 : 0;
        const bRemux = b.mediaInfo?.isRemux ? 1 : 0;
        if (aRemux !== bRemux) return bRemux - aRemux;
        
        // 5. Bitrate tiebreaker
        return (b.mediaInfo?.bitrate || 0) - (a.mediaInfo?.bitrate || 0);
    });
    
    return uniqueStreams;
}

// --- Exports ---
module.exports = {
    // Constants
    ITEM_TYPE_MOVIE,
    ITEM_TYPE_EPISODE,
    ITEM_TYPE_SERIES,
    DEFAULT_FIELDS,
    CODEC_FORMAT_MAP,
    
    // Functions
    parseMediaId,
    _isMatchingProviderId,
    getQualityTag,
    getResolutionDimensions,
    getVideoTag,
    getHdrTag,
    getAudioTag,
    getContainerTag,
    isRemux,
    formatBitrate,
    formatFileSize,
    buildStreamDescription,
    safeExtractMediaInfo,
    deduplicateAndSortStreams
};

