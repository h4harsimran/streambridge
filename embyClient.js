const axios = require("axios");

// --- Constants ---
const ITEM_TYPE_MOVIE = 'Movie';
const ITEM_TYPE_EPISODE = 'Episode';
const ITEM_TYPE_SERIES = 'Series';
const HEADER_EMBY_TOKEN = 'X-Emby-Token';
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
 * Checks if Emby provider IDs match the given IMDb or TMDb IDs, handling variations.
 * @param {object} providerIds - The ProviderIds object from Emby.
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
            (providerIds.Tmdb && String(providerIds.Tmdb) === tmdbIdStr)) return true; // Compare against Emby's value as string too
    }

    // Check TVDB (case-insensitive and string/number comparison)
    if (tvdbIdToMatch) {
        const tvdbIdStr = String(tvdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tvdb === tvdbIdStr || providerIds.tvdb === tvdbIdStr || providerIds.TVDB === tvdbIdStr ||
            (providerIds.Tvdb && String(providerIds.Tvdb) === tvdbIdStr)) return true; // Compare against Emby's value as string too
    }

    // Check AniDB (case-insensitive and string/number comparison)
    if (anidbIdToMatch) {
        const anidbIdStr = String(anidbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.AniDb === anidbIdStr || providerIds.anidb === anidbIdStr || providerIds.ANIDB === anidbIdStr ||
            (providerIds.AniDb && String(providerIds.AniDb) === anidbIdStr)) return true; // Compare against Emby's value as string too
    }
    return false;
}

/**
 * Parses the Stremio-style ID (e.g., "tt12345", "tmdb12345", "tt12345:1:2")
 * into its components.
 * @param {string} idOrExternalId - The input ID string.
 * @returns {object|null} An object containing parsed info { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId } or null if format is invalid.
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


// --- Emby Item Finding ---

/**
 * Performs an Emby API request with standard headers and error handling.
 * @param {string} url - The full URL for the API request.
 * @param {object} [params] - Optional query parameters.
 * @param {string} [method='get'] - The HTTP method.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The response data object or null if an error occurs.
 */
async function makeEmbyApiRequest(url, params = {}, config) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            headers: { [HEADER_EMBY_TOKEN]: config.accessToken },
            params: params,
        });
        return response.data;
    } catch (err) {
        
        console.warn(`⚠️ API Request failed for ${url} with params ${JSON.stringify(params)}:`, err.message);
        
        if (err.response?.status === 401) {
             console.log("🔧 Detected Unauthorized (401). The provided access token might be invalid or expired.");
        }
        return null; // Indicate failure
    }
}

/**
 * Attempts to find a movie item in Emby using various strategies.
 * @param {string|null} imdbId - The IMDb ID to search for.
 * @param {string|null} tmdbId - The TMDb ID to search for.
 * @param {string|null} tvdbId - The TVDB ID to search for.
 * @param {string|null} anidbId - The AniDB ID to search for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Emby movie item or null.
 */
async function findMovieItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    let foundItems = [];
    const baseMovieParams = {
        IncludeItemTypes: ITEM_TYPE_MOVIE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10, // Limit results per query
        Filters: "IsNotFolder", // Important filter for movies
        UserId: config.userId
    };

    // --- Strategy 1: Direct ID Lookup (/Items) ---
    const directLookupParams = { ...baseMovieParams };
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }
    else if (tvdbId) { directLookupParams.TvdbId = tvdbId; searchedIdField = "TvdbId"; }
    else if (anidbId) { directLookupParams.AniDbId = anidbId; searchedIdField = "AniDbId"; }
    if (searchedIdField) {
        const data = await makeEmbyApiRequest(`${config.serverUrl}/Items`, directLookupParams, config);
        if (data?.Items?.length > 0) {
            const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
            if (matches.length > 0) {
                //console.log(`🔍 Found movie via /Items with ${searchedIdField}=${directLookupParams[searchedIdField]}`);
                foundItems.push(...matches);
            }
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (foundItems.length === 0) {
        const anyProviderIdFormats = [];
        if (imdbId) {
            const numericImdbId = imdbId.replace('tt', '');
            anyProviderIdFormats.push(`imdb.${imdbId}`, `Imdb.${imdbId}`);
            if (numericImdbId !== imdbId) anyProviderIdFormats.push(`imdb.${numericImdbId}`, `Imdb.${numericImdbId}`);
        } else if (tmdbId) {
            anyProviderIdFormats.push(`tmdb.${tmdbId}`, `Tmdb.${tmdbId}`);
        } else if (tvdbId) {
            anyProviderIdFormats.push(`tvdb.${tvdbId}`, `Tvdb.${tvdbId}`);
        } else if (anidbId) {
            anyProviderIdFormats.push(`anidb.${anidbId}`, `AniDb.${anidbId}`);
        }

        for (const attemptFormat of anyProviderIdFormats) {
            const altParams = { ...baseMovieParams, AnyProviderIdEquals: attemptFormat };
            delete altParams.ImdbId; // Remove specific ID params when using AnyProviderIdEquals
            delete altParams.TmdbId;
            delete altParams.TvdbId;
            delete altParams.AniDbId;
            delete altParams.UserId; // /Users/{userId}/Items doesn't need UserId in params

            const data = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config);
            if (data?.Items?.length > 0) {
                const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                 if (matches.length > 0) {
                    //console.log(`🔍 Found movie via /Users/{UserId}/Items with AnyProviderIdEquals=${attemptFormat}`);
                    foundItems.push(...matches);
                }
            }
        }
    }

     //if (foundItems.length === 0) 
        //console.log(`📭 No Emby movie match found for ${imdbId || tmdbId || tvdbId || anidbId}.`);
    return foundItems; // Return foundItems if found after all attempts
}


/**
 * Attempts to find a series item in Emby.
 * @param {string|null} imdbId - The IMDb ID of the series.
 * @param {string|null} tmdbId - The TMDb ID of the series.
 * @param {string|null} tvdbId - The TVDB ID of the series.
 * @param {string|null} anidbId - The AniDB ID of the series.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Emby series item or null.
 */
async function findSeriesItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    let foundSeries = [];
    const baseSeriesParams = {
        IncludeItemTypes: ITEM_TYPE_SERIES,
        Recursive: true,
        Fields: "ProviderIds,Name,Id", // Only need these fields for series lookup
        Limit: 5
    };

    // --- Strategy 1: Direct ID Lookup (/Users/{UserId}/Items) ---
    const seriesLookupParams1 = { ...baseSeriesParams };
    if (imdbId) seriesLookupParams1.ImdbId = imdbId;
    else if (tmdbId) seriesLookupParams1.TmdbId = tmdbId;
    else if (tvdbId) seriesLookupParams1.TvdbId = tvdbId;
    else if (anidbId) seriesLookupParams1.AniDbId = anidbId;
    const data1 = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams1, config);
    if (data1?.Items?.length > 0) {
        const matches = data1.Items.filter(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
        if (matches.length > 0) {
             //console.log(`🔍 Found series via /Users/{UserId}/Items with ImdbId/TmdbId`);
            foundSeries.push(...matches);
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (foundSeries.length === 0) {
        let anyProviderIdValue = null;
        if (imdbId) anyProviderIdValue = `imdb.${imdbId}`;
        else if (tmdbId) anyProviderIdValue = `tmdb.${tmdbId}`;
        else if (tvdbId) anyProviderIdValue = `tvdb.${tvdbId}`;
        else if (anidbId) anyProviderIdValue = `anidb.${anidbId}`;
        if (anyProviderIdValue) {
            const seriesLookupParams2 = { ...baseSeriesParams, AnyProviderIdEquals: anyProviderIdValue };
            delete seriesLookupParams2.ImdbId; // Remove specific ID params
            delete seriesLookupParams2.TmdbId;
            delete seriesLookupParams2.TvdbId;
            delete seriesLookupParams2.AniDbId;
            const data2 = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams2, config);
            if (data2?.Items?.length > 0) {
                const matches = data2.Items.filter(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                 if (matches.length > 0) {
                    //console.log(`🔍 Found series via /Users/{UserId}/Items with AnyProviderIdEquals=${anyProviderIdValue}`);
                    foundSeries.push(...matches);
                }
            }
        }
    }

    //if (foundSeries.length === 0) console.log(`📭 No Emby series match found for ${imdbId || tmdbId || tvdbId || anidbId}.`);
    return foundSeries;
}

/**
 * Finds a specific episode within a given series and season in Emby.
 * @param {object} parentSeriesItem - The Emby series item object (must have Id and Name).
 * @param {number} seasonNumber - The season number to look for.
 * @param {number} episodeNumber - The episode number to look for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Emby episode item or null.
 */
async function findEpisodeItem(parentSeriesItem, seasonNumber, episodeNumber, config) {
    // 1. Get Seasons for the Series
    const seasonsParams = { UserId: config.userId, Fields: "Id,IndexNumber,Name" };
    const seasonsData = await makeEmbyApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Seasons`, seasonsParams, config);

    if (!seasonsData?.Items?.length > 0) {
        console.warn(`❌ No seasons found for series: ${parentSeriesItem.Name} (${parentSeriesItem.Id})`);
        return null;
    }

    // 2. Find the Target Season
    const targetSeason = seasonsData.Items.find(s => s.IndexNumber === seasonNumber);
    if (!targetSeason) {
        //console.info(`ℹ️ Season ${seasonNumber} not found for series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 3. Get Episodes for the Target Season
    //console.log(`🔎 Fetching episodes for ${parentSeriesItem.Name} S${seasonNumber} (Season ID: ${targetSeason.Id})`);
    const episodesParams = {
        SeasonId: targetSeason.Id,
        UserId: config.userId,
        Fields: DEFAULT_FIELDS // Request all needed fields for the episode
    };
    const episodesData = await makeEmbyApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Episodes`, episodesParams, config);

    if (!episodesData?.Items?.length > 0) {
        console.warn(`❌ No episodes found for season ${seasonNumber} in series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 4. Find the Target Episode
    const targetEpisode = episodesData.Items.find(ep => ep.IndexNumber === episodeNumber && ep.ParentIndexNumber === seasonNumber);

    if (!targetEpisode) {
        console.info(`ℹ️ Episode S${seasonNumber}E${episodeNumber} not found in series: ${parentSeriesItem.Name}`);
        return null;
    }

     //console.log(`🎯 Found episode: ${targetEpisode.Name} (S${targetEpisode.ParentIndexNumber}E${targetEpisode.IndexNumber}, ID: ${targetEpisode.Id})`);
    return targetEpisode;
}


// --- Stream Generation ---

// --- Helper Functions for Stream Enrichment ---

/**
 * Returns resolution label based on video stream height, accounting for anamorphic content.
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string} Quality tag like "4K", "1080p", "720p", etc.
 */
function getQualityTag(videoStream) {
  if (!videoStream) return 'Unknown';
  
  const height = videoStream.Height;
  const width = videoStream.Width;
  
  if (!height && !width) return 'Unknown';
  
  // Calculate effective height for anamorphic content (assume 16:9 if only width available)
  const effectiveHeight = height || Math.round(width / 1.78);
  
  if (effectiveHeight >= 2160) return '4K';
  if (effectiveHeight >= 1440) return '1440p';
  if (effectiveHeight >= 1080) return '1080p';
  if (effectiveHeight >= 720) return '720p';
  if (effectiveHeight >= 576) return '576p';
  if (effectiveHeight >= 480) return '480p';
  return 'SD';
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
 * Returns HDR format using Emby's ExtendedVideoType enum with fallback to ColorTransfer detection.
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
 * Detects if the source is a Blu-ray or UHD remux based on container, bitrate, and codec.
 * @param {object} source - The MediaSource object.
 * @param {object} videoStream - The video MediaStream object.
 * @returns {boolean} True if detected as remux, false otherwise.
 */
function isRemux(source, videoStream) {
  if (!source) return false;
  
  const container = source.Container?.toUpperCase();
  const bitrate = source.Bitrate;
  const height = videoStream?.Height;
  
  // MKV is typical remux container
  if (container !== 'MKV') return false;
  
  // High bitrate threshold indicators
  // 4K remux typically > 40 Mbps
  // 1080p remux typically > 20 Mbps
  if (height >= 2160 && bitrate > 40000000) return true;
  if (height >= 1080 && bitrate > 20000000) return true;
  
  // Check filename/path for remux indicator
  const path = source.Path?.toLowerCase() || '';
  const name = source.Name?.toLowerCase() || '';
  
  if (path.includes('remux') || name.includes('remux')) return true;
  if (path.includes('bluray') || name.includes('bluray')) return true;
  
  return false;
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
  
  // Line 1: Quality + Video Codec
  const videoLine = [];
  if (mediaInfo.qualityTag && mediaInfo.qualityTag !== 'Unknown') {
    videoLine.push(mediaInfo.qualityTag);
  }
  if (mediaInfo.videoTag) {
    videoLine.push(mediaInfo.videoTag);
  }
  if (videoLine.length > 0) {
    lines.push(videoLine.join(' • '));
  }
  
  // Line 2: HDR + REMUX tags (special indicators)
  const specialLine = [];
  if (mediaInfo.hdrTag) {
    specialLine.push(mediaInfo.hdrTag);
  }
  if (mediaInfo.isRemux) {
    specialLine.push('REMUX');
  }
  if (specialLine.length > 0) {
    lines.push(specialLine.join(' • '));
  }
  
  // Line 3: Audio information
  if (mediaInfo.audioTag) {
    lines.push(mediaInfo.audioTag);
  }
  
  // Line 4: Container, Bitrate, Size
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
    console.error('Media info extraction failed:', error);
    
    // Return minimal fallback info
    return {
      qualityTag: 'Unknown',
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
 * Gets playback information for an Emby item and generates direct play stream URLs.
 * @param {object} embyItem - The Emby movie or episode item (must have Id, Name, Type).
 * @param {string|null} [seriesName=null] - Optional: The name of the series if item is an episode.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if no suitable streams are found.
 */
async function getPlaybackStreams(embyItem, seriesName = null, config) {
    
    const playbackInfoParams = { UserId: config.userId};
    const playbackInfoData = await makeEmbyApiRequest(
        `${config.serverUrl}/Items/${embyItem.Id}/PlaybackInfo`,
        playbackInfoParams,
        config
    );

    if (!playbackInfoData?.MediaSources?.length > 0) {
        console.warn("❌ No MediaSources found for item:", embyItem.Name, `(${embyItem.Id})`);
        return null;
    }

    const streamDetailsArray = [];

    // Process ALL available MediaSources (multiple quality options)
    for (const source of playbackInfoData.MediaSources) {
        try {
            // Extract video stream (primary video track)
            const videoStream = source.MediaStreams?.find(ms => ms.Type === 'Video');
            
            // Extract audio stream (prefer default, fallback to first)
            const audioStream = source.MediaStreams?.find(ms => ms.Type === 'Audio' && ms.IsDefault)
                             || source.MediaStreams?.find(ms => ms.Type === 'Audio');
            
            // Extract subtitle streams
            const subtitleStreams = source.MediaStreams?.filter(ms => ms.Type === 'Subtitle') || [];
            
            // Build enriched media info object using safe extraction
            const mediaInfo = safeExtractMediaInfo(source, videoStream, audioStream);
            
            // Build comprehensive description string
            const streamDescription = buildStreamDescription(mediaInfo);
            
            // Build Quality Title (preserved for backward compatibility)
            let qualityTitle = "";
            if (videoStream) {
              qualityTitle += videoStream.DisplayTitle || "";
              if (videoStream.Width && videoStream.Height) {
                  if (!qualityTitle.toLowerCase().includes(videoStream.Height + "p") && !qualityTitle.toLowerCase().includes(videoStream.Width + "x" + videoStream.Height)) {
                      qualityTitle = (qualityTitle ? qualityTitle + " " : "") + `${videoStream.Height}p`;
                  }
              }
              if (videoStream.Codec) {
                  if (!qualityTitle.toLowerCase().includes(videoStream.Codec.toLowerCase())) {
                        qualityTitle = (qualityTitle ? qualityTitle + " " : "") + videoStream.Codec.toUpperCase();
                  }
              }
          } else if (source.Container) {
              qualityTitle = source.Container.toUpperCase();
          }
          if (source.Name && !qualityTitle) {
                qualityTitle = source.Name;
          }
          qualityTitle = qualityTitle || 'Direct Play'; // Fallback title

            // Construct direct play URL
            const directPlayUrl = `${config.serverUrl}/Videos/${embyItem.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${config.accessToken}&DeviceId=stremio-addon-device-id`;
            
            // Format subtitles for Stremio
            const subtitles = subtitleStreams.map(sub => {
                const codec = sub.Codec?.toLowerCase();
                const format = CODEC_FORMAT_MAP[codec] || 'srt';
                
                return {
                    id: `sub-${embyItem.Id}-${source.Id}-${sub.Index}`,
                    lang: sub.Language || 'und',  // Keep 3-letter ISO 639-2 code, fallback to 'und'
                    url: `${config.serverUrl}/Videos/${embyItem.Id}/${source.Id}/Subtitles/${sub.Index}/Stream.${format}?api_key=${config.accessToken}`
                };
            });
            
            // Add enriched stream details (preserve all existing fields for backward compatibility)
            streamDetailsArray.push({
                // Existing fields (preserved for backward compatibility)
                directPlayUrl: directPlayUrl,
                itemName: embyItem.Name,
                seriesName: seriesName,
                seasonNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.ParentIndexNumber : null,
                episodeNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.IndexNumber : null,
                itemId: embyItem.Id,
                mediaSourceId: source.Id,
                container: source.Container,
                videoCodec: videoStream?.Codec || source.VideoCodec || null,
                audioCodec: audioStream?.Codec || null,
                qualityTitle: qualityTitle,
                embyUrlBase: config.serverUrl,
                apiKey: config.accessToken,
                subtitles: subtitles,
                
                // New enriched fields
                streamDescription: streamDescription,
                mediaInfo: mediaInfo
            });
        } catch (error) {
            console.error(`❌ Error processing MediaSource ${source.Id} for item ${embyItem.Id}:`, error);
            // Continue to next source instead of failing completely
            continue;
        }
    }

    if (streamDetailsArray.length === 0) {
        console.warn(`❌ No direct playable sources found for item: ${embyItem.Name} (${embyItem.Id})`);
        return null;
    }

    // Sort streams: Direct Play first, then by quality (highest to lowest)
    streamDetailsArray.sort((a, b) => {
        // Direct play priority
        if (a.mediaInfo?.supportsDirectPlay && !b.mediaInfo?.supportsDirectPlay) return -1;
        if (!a.mediaInfo?.supportsDirectPlay && b.mediaInfo?.supportsDirectPlay) return 1;
        
        // Quality/resolution priority
        const resOrder = ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD', 'Unknown'];
        const aResIndex = resOrder.indexOf(a.mediaInfo?.qualityTag || 'Unknown');
        const bResIndex = resOrder.indexOf(b.mediaInfo?.qualityTag || 'Unknown');
        
        if (aResIndex !== bResIndex) {
            return aResIndex - bResIndex;
        }
        
        // Bitrate as tiebreaker (higher is better)
        return (b.mediaInfo?.bitrate || 0) - (a.mediaInfo?.bitrate || 0);
    });

    return streamDetailsArray;
}


// --- Main Exported Function ---

/**
 * Orchestrates the process of finding an Emby item (movie or episode) based on
 * an external ID and returning direct play stream information, using provided configuration.
 * @param {string} idOrExternalId - The Stremio-style ID (e.g., "tt12345", "tmdb12345:1:2").
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if unsuccessful.
 */
async function getStream(idOrExternalId, config) {
    
    
    // Validate provided configuration
    if (!config.serverUrl || !config.userId || !config.accessToken) {
        console.error("❌ Configuration missing (serverUrl, userId, or accessToken)");
        return null; // Critical configuration is missing
    }
    let fullIdForLog = idOrExternalId;
    try {
        // 1. Parse Input ID
        const parsedId = parseMediaId(idOrExternalId);
        if (parsedId) {
            fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');
        }
        if (!parsedId) {
            console.error(`❌ Failed to parse input ID: ${idOrExternalId}`);
            return null;
        }
        //const fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');

        // 2. Find the Emby Item
        let embyItem = null;
        let parentSeriesName = null;

        if (parsedId.itemType === ITEM_TYPE_MOVIE) {
            //console.log(`🎬 Searching for Movie: ${parsedId.imdbId || parsedId.tmdbId}`);
            embyItem = await findMovieItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
        } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {   
            //console.log(`📺 Searching for Series: ${parsedId.imdbId || parsedId.tmdbId}`);
            const seriesItems = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
            if (seriesItems && seriesItems.length > 0) {
                let allStreams = [];
                let totalSeries = seriesItems.length;
                let failedSeries = 0;
                for (const series of seriesItems) {
                    const episode = await findEpisodeItem(series, parsedId.seasonNumber, parsedId.episodeNumber, config);
                    if (episode) {
                        const streams = await getPlaybackStreams(episode, series.Name, config);  
                        if (streams) allStreams.push(...streams);
                    } else {
                        failedSeries++;  // 🔥 Count failures
                    }
                }
                if (allStreams.length > 0) {
                    return allStreams;
                } else {
                    if (failedSeries === totalSeries) {
                        console.warn(`📭 Could not find episode S${parsedId.seasonNumber}E${parsedId.episodeNumber} for ${fullIdForLog} in any matching series.`);
                    } else {
                        console.info(`ℹ️ Found partial matches, but no streams for S${parsedId.seasonNumber}E${parsedId.episodeNumber} in available series.`);
                    }
                    return null;
                }
            } else {
                console.warn(`📭 Could not find parent series for ${fullIdForLog}, cannot find episode.`);
                return null;
            }
        }

        // 3. Get Playback Streams if Item Found
        if (embyItem && embyItem.length > 0) {  
            let allStreams = [];
            for (const item of embyItem) {
                const streams = await getPlaybackStreams(item, parentSeriesName, config);
                if (streams) allStreams.push(...streams);
            }
            return allStreams.length > 0 ? allStreams : null;
        } else {
             console.warn(`📭 No Emby match found for ${fullIdForLog} after all attempts.`);
            return null;
        }

    } catch (err) {
        console.error(`❌ Unhandled error in getStreamWithConfig for ID ${fullIdForLog}:`, err.message, err.stack);
        return null;
    } 
}

// --- Exports ---
module.exports = {
    getStream,
    parseMediaId
};