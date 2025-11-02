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

    for (const source of playbackInfoData.MediaSources) {
        
      const videoStream = source.MediaStreams?.find(ms => ms.Type === 'Video');
      const audioStream = source.MediaStreams?.find(ms => ms.Type === 'Audio');

      const directPlayUrl = `${config.serverUrl}/Videos/${embyItem.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${config.accessToken}&DeviceId=stremio-addon-device-id`; // Ensure DeviceId is appropriate

      // Build Quality Title (same logic as original)
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

      // Extract subtitle streams from MediaStreams
      const subtitleStreams = source.MediaStreams?.filter(ms => ms.Type === 'Subtitle') || [];
      
      // Build subtitle objects
      const subtitles = subtitleStreams.map(sub => {
        const codec = sub.Codec?.toLowerCase();
        const format = CODEC_FORMAT_MAP[codec] || 'srt';
        
        return {
          id: `sub-${embyItem.Id}-${source.Id}-${sub.Index}`,
          lang: sub.Language || 'und',  // Keep 3-letter ISO 639-2 code, fallback to 'und'
          url: `${config.serverUrl}/Videos/${embyItem.Id}/${source.Id}/Subtitles/${sub.Index}/Stream.${format}?api_key=${config.accessToken}`
        };
      });

      streamDetailsArray.push({
          directPlayUrl: directPlayUrl,
          itemName: embyItem.Name,
          seriesName: seriesName, // Pass the series name if available
          // Use season/episode numbers directly from the embyItem if it's an episode
          seasonNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.ParentIndexNumber : null,
          episodeNumber: embyItem.Type === ITEM_TYPE_EPISODE ? embyItem.IndexNumber : null,
          itemId: embyItem.Id,
          mediaSourceId: source.Id,
          container: source.Container,
          videoCodec: videoStream?.Codec || source.VideoCodec || null, // Prefer stream info
          audioCodec: audioStream?.Codec || null, // Prefer stream info
          qualityTitle: qualityTitle,
          embyUrlBase: config.serverUrl,
          apiKey: config.accessToken, // Exposing API key here
          subtitles: subtitles // Embedded subtitles array
      });
      
    }

    if (streamDetailsArray.length === 0) {
        console.warn(`❌ No direct playable sources found for item: ${embyItem.Name} (${embyItem.Id})`);
        return null;
    }

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