const axios = require("axios");
const common = require("./commonClient");
const { mediaSourceCache, itemLookupCache, hierarchyCache, streamCache } = require("./cache");
const { version } = require("../package.json");

// --- Constants ---
const HEADER_EMBY_TOKEN = 'X-Emby-Token';
const ITEM_TYPE_MOVIE = common.ITEM_TYPE_MOVIE;
const ITEM_TYPE_EPISODE = common.ITEM_TYPE_EPISODE;
const ITEM_TYPE_SERIES = common.ITEM_TYPE_SERIES;
const DEFAULT_FIELDS = common.DEFAULT_FIELDS;
const CODEC_FORMAT_MAP = common.CODEC_FORMAT_MAP;

// --- Emby Item Finding & API Communication ---

/**
 * Performs an Emby API request with standard headers, authentication, and error handling.
 * Supports GET, POST, and DELETE methods.
 * @param {string} url - The full URL for the API request.
 * @param {string} [method='get'] - The HTTP method ('get', 'post', 'delete').
 * @param {object} [params={}] - Optional query parameters.
 * @param {object|null} [data=null] - Optional request body for POST/PUT.
 * @param {object} config - Configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|boolean|null>} Response data, true for 204 No Content, or null on error.
 */
async function makeApiCall(url, method = 'get', params = {}, data = null, config) {
    try {
        const isPostOrPut = method.toLowerCase() === 'post' || method.toLowerCase() === 'put';
        const headers = {
            [HEADER_EMBY_TOKEN]: config.accessToken,
            'X-Emby-Authorization': `MediaBrowser Client="StreamBridge", Device="Stremio", DeviceId="stremio-addon-device-id", Version="${version}", Token="${config.accessToken}"`
        };
        if (isPostOrPut) {
            headers['Content-Type'] = 'application/json';
        }

        const reqConfig = {
            method: method.toLowerCase(),
            url: url,
            headers: headers,
            params: params,
            timeout: 10000 // 10 seconds timeout
        };
        if (isPostOrPut && data !== null && data !== undefined) {
            reqConfig.data = data;
        }

        const response = await axios(reqConfig);
        return response.data !== undefined && response.data !== '' ? response.data : true;
    } catch (err) {
        // SECURITY: Redact sensitive info from URL (remove domain/host to protect user's server URL)
        const sanitizedUrl = url.replace(/https?:\/\/[^\/\s:]+(?::\d+)?/, '[SERVER]');
        const sanitizedParams = { ...params };
        if (sanitizedParams.UserId) delete sanitizedParams.UserId;

        console.warn(`⚠️ API [${method.toUpperCase()}] failed for ${sanitizedUrl}:`, err.message);

        if (err.response?.status === 401) {
            console.log("🔧 Detected Unauthorized (401). The provided access token might be invalid or expired.");
        }
        return null;
    }
}

/**
 * Performs a GET Emby API request (backward-compatible wrapper around makeApiCall).
 * @param {string} url - The full URL for the API request.
 * @param {object} [params] - Optional query parameters.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The response data object or null if an error occurs.
 */
async function makeApiRequest(url, params = {}, config) {
    return makeApiCall(url, 'get', params, null, config);
}

/**
 * Attempts to find a movie item in Emby using various strategies.
 * @param {string|null} imdbId - The IMDb ID to search for.
 * @param {string|null} tmdbId - The TMDb ID to search for.
 * @param {string|null} tvdbId - The TVDB ID to search for.
 * @param {string|null} anidbId - The AniDB ID to search for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>>} Array of found Emby movie items.
 */
async function findMovieItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    const primaryId = imdbId || tmdbId || tvdbId || anidbId;
    if (!primaryId) return [];

    // Check item lookup cache first
    const cacheKey = `${config.userId}:movie:${primaryId}`;
    const cached = itemLookupCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    let foundItems = [];
    const baseMovieParams = {
        IncludeItemTypes: ITEM_TYPE_MOVIE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10, // Limit results per query
        Filters: "IsNotFolder" // Important filter for movies
    };

    // AnyProviderIdEquals Lookup (/Users/{UserId}/Items)
    const anyProviderIdFormats = [];
    if (imdbId) {
        anyProviderIdFormats.push(`imdb.${imdbId}`);
        const numericImdbId = imdbId.replace(/^tt/i, '');
        if (numericImdbId !== imdbId) {
            anyProviderIdFormats.push(`imdb.${numericImdbId}`);
        }
    } else if (tmdbId) {
        anyProviderIdFormats.push(`tmdb.${tmdbId}`);
    } else if (tvdbId) {
        anyProviderIdFormats.push(`tvdb.${tvdbId}`);
    } else if (anidbId) {
        anyProviderIdFormats.push(`anidb.${anidbId}`);
    }

    for (const attemptFormat of anyProviderIdFormats) {
        const altParams = { ...baseMovieParams, AnyProviderIdEquals: attemptFormat };
        const data = await makeApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config);
        if (data?.Items?.length > 0) {
            const matches = data.Items.filter(i => common._isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
            if (matches.length > 0) {
                foundItems.push(...matches);
                break; // Stop querying additional formats once matches are found
            }
        }
    }

    if (foundItems.length > 0) {
        itemLookupCache.set(cacheKey, foundItems);
    }

    return foundItems;
}

/**
 * Attempts to find a series item in Emby.
 * @param {string|null} imdbId - The IMDb ID of the series.
 * @param {string|null} tmdbId - The TMDb ID of the series.
 * @param {string|null} tvdbId - The TVDB ID of the series.
 * @param {string|null} anidbId - The AniDB ID of the series.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>>} Array of found Emby series items.
 */
async function findSeriesItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    const primaryId = imdbId || tmdbId || tvdbId || anidbId;
    if (!primaryId) return [];

    // Check item lookup cache first
    const cacheKey = `${config.userId}:series:${primaryId}`;
    const cached = itemLookupCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    let foundSeries = [];
    const baseSeriesParams = {
        IncludeItemTypes: ITEM_TYPE_SERIES,
        Recursive: true,
        Fields: "ProviderIds,Name,Id", // Only need these fields for series lookup
        Limit: 5
    };

    const anyProviderIdFormats = [];
    if (imdbId) {
        anyProviderIdFormats.push(`imdb.${imdbId}`);
        const numericImdbId = imdbId.replace(/^tt/i, '');
        if (numericImdbId !== imdbId) {
            anyProviderIdFormats.push(`imdb.${numericImdbId}`);
        }
    } else if (tmdbId) {
        anyProviderIdFormats.push(`tmdb.${tmdbId}`);
    } else if (tvdbId) {
        anyProviderIdFormats.push(`tvdb.${tvdbId}`);
    } else if (anidbId) {
        anyProviderIdFormats.push(`anidb.${anidbId}`);
    }

    for (const attemptFormat of anyProviderIdFormats) {
        const seriesLookupParams = { ...baseSeriesParams, AnyProviderIdEquals: attemptFormat };
        const data = await makeApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams, config);
        if (data?.Items?.length > 0) {
            const matches = data.Items.filter(s => common._isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
            if (matches.length > 0) {
                foundSeries.push(...matches);
                break; // Stop querying once matches are found
            }
        }
    }

    if (foundSeries.length > 0) {
        itemLookupCache.set(cacheKey, foundSeries);
    }

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
    // 1. Check cache for this season's episodes
    const episodesCacheKey = `${config.userId}:${parentSeriesItem.Id}:s${seasonNumber}:episodes`;
    let episodesData = hierarchyCache.get(episodesCacheKey);

    if (!episodesData) {
        // Direct Season query on /Shows/{Id}/Episodes (1 HTTP call with full MediaSources)
        const episodesParams = {
            Season: seasonNumber,
            UserId: config.userId,
            Fields: DEFAULT_FIELDS
        };
        episodesData = await makeApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Episodes`, episodesParams, config);

        // Fallback: If querying with Season returned no episodes, try the two-step /Seasons route
        if (!episodesData?.Items?.length > 0) {
            const seasonsCacheKey = `${config.userId}:${parentSeriesItem.Id}:seasons`;
            let seasonsData = hierarchyCache.get(seasonsCacheKey);
            if (!seasonsData) {
                const seasonsParams = { UserId: config.userId, Fields: "Id,IndexNumber,Name" };
                seasonsData = await makeApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Seasons`, seasonsParams, config);
                if (seasonsData?.Items?.length > 0) {
                    hierarchyCache.set(seasonsCacheKey, seasonsData);
                }
            }

            const targetSeason = seasonsData?.Items?.find(s => s.IndexNumber === seasonNumber);
            if (targetSeason) {
                const seasonIdParams = {
                    SeasonId: targetSeason.Id,
                    UserId: config.userId,
                    Fields: DEFAULT_FIELDS
                };
                episodesData = await makeApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Episodes`, seasonIdParams, config);
            }
        }

        if (episodesData?.Items?.length > 0) {
            hierarchyCache.set(episodesCacheKey, episodesData);
        }
    }

    if (!episodesData?.Items?.length > 0) {
        return null;
    }

    // Find the target episode matching episodeNumber
    const targetEpisode = episodesData.Items.find(ep =>
        ep.IndexNumber === episodeNumber &&
        (ep.ParentIndexNumber === seasonNumber || ep.ParentIndexNumber === undefined)
    );

    return targetEpisode || null;
}

/**
 * Gets playback information for an Emby item and generates direct play stream URLs.
 * @param {object} item - The Emby movie or episode item (must have Id, Name, Type).
 * @param {string|null} [seriesName=null] - Optional: The name of the series if item is an episode.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if no suitable streams are found.
 */
async function getPlaybackStreams(item, seriesName = null, config) {
    const playbackInfoParams = { UserId: config.userId };
    const playbackInfoData = await makeApiRequest(
        `${config.serverUrl}/Items/${item.Id}/PlaybackInfo`,
        playbackInfoParams,
        config
    );

    if (!playbackInfoData?.MediaSources?.length > 0) {
        console.warn("❌ No MediaSources found for item:", item.Name, `(${item.Id})`);
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
            const mediaInfo = common.safeExtractMediaInfo(source, videoStream, audioStream);
            
            // Build comprehensive description string
            const streamDescription = common.buildStreamDescription(mediaInfo);
            
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

            // Construct direct play URL (Emby format)
            const directPlayUrl = `${config.serverUrl}/Videos/${item.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${config.accessToken}&DeviceId=stremio-addon-device-id`;
            
            // Format subtitles for Stremio
            const subtitles = subtitleStreams.map(sub => {
                const codec = sub.Codec?.toLowerCase();
                const format = CODEC_FORMAT_MAP[codec] || 'srt';
                
                return {
                    id: `sub-${item.Id}-${source.Id}-${sub.Index}`,
                    lang: sub.Language || 'und',  // Keep 3-letter ISO 639-2 code, fallback to 'und'
                    url: `${config.serverUrl}/Videos/${item.Id}/${source.Id}/Subtitles/${sub.Index}/Stream.${format}?api_key=${config.accessToken}`
                };
            });
            
            // Add enriched stream details (preserve all existing fields for backward compatibility)
            streamDetailsArray.push({
                // Existing fields (preserved for backward compatibility)
                directPlayUrl: directPlayUrl,
                itemName: item.Name,
                seriesName: seriesName,
                seasonNumber: item.Type === ITEM_TYPE_EPISODE ? item.ParentIndexNumber : null,
                episodeNumber: item.Type === ITEM_TYPE_EPISODE ? item.IndexNumber : null,
                itemId: item.Id,
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
            // SECURITY: Only log error message, not full error object
            console.error(`❌ Error processing MediaSource ${source.Id} for item ${item.Id}:`, error?.message || String(error));
            // Continue to next source instead of failing completely
            continue;
        }
    }

    if (streamDetailsArray.length === 0) {
        console.warn(`❌ No direct playable sources found for item: ${item.Name} (${item.Id})`);
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

    // 0. Check stream cache first (instant response for repeat stream requests)
    const streamCacheKey = `${config.userId}:${idOrExternalId}`;
    const cachedStreams = streamCache.get(streamCacheKey);
    if (cachedStreams) {
        return cachedStreams;
    }

    let fullIdForLog = idOrExternalId;
    try {
        // 1. Parse Input ID
        const parsedId = common.parseMediaId(idOrExternalId);
        if (parsedId) {
            fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');
        }
        if (!parsedId) {
            console.error(`❌ Failed to parse input ID: ${idOrExternalId}`);
            return null;
        }

        // 2. Find the Emby Item & Get Playback Streams
        if (parsedId.itemType === ITEM_TYPE_MOVIE) {
            const items = await findMovieItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
            if (items && items.length > 0) {
                const streamResults = await Promise.all(
                    items.map(singleItem => getPlaybackStreams(singleItem, null, config))
                );
                let allStreams = [];
                for (const streams of streamResults) {
                    if (streams) allStreams.push(...streams);
                }
                if (allStreams.length > 0) {
                    const sorted = common.deduplicateAndSortStreams(allStreams);
                    if (sorted.length > 0) {
                        mediaSourceCache.set(`${config.userId}:${idOrExternalId}`, {
                            itemId: sorted[0].itemId,
                            mediaSourceId: sorted[0].mediaSourceId,
                            itemName: sorted[0].itemName
                        });
                        streamCache.set(streamCacheKey, sorted);
                    }
                    return sorted;
                }
            }
            return null;
        } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {
            const seriesItems = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
            if (seriesItems && seriesItems.length > 0) {
                // Parallelize episode search across series candidates
                const episodeResults = await Promise.all(
                    seriesItems.map(async (series) => {
                        const episode = await findEpisodeItem(series, parsedId.seasonNumber, parsedId.episodeNumber, config);
                        if (episode) {
                            return await getPlaybackStreams(episode, series.Name, config);
                        }
                        return null;
                    })
                );

                let allStreams = [];
                for (const streams of episodeResults) {
                    if (streams) allStreams.push(...streams);
                }
                if (allStreams.length > 0) {
                    const sorted = common.deduplicateAndSortStreams(allStreams);
                    if (sorted.length > 0) {
                        mediaSourceCache.set(`${config.userId}:${idOrExternalId}`, {
                            itemId: sorted[0].itemId,
                            mediaSourceId: sorted[0].mediaSourceId,
                            itemName: sorted[0].itemName
                        });
                        streamCache.set(streamCacheKey, sorted);
                    }
                    return sorted;
                }
                return null;
            }
            return null;
        }

        return null;

    } catch (err) {
        // SECURITY: Only log error message and stack, not full error object which might contain config
        console.error(`❌ Unhandled error in getStream for ID ${fullIdForLog}:`, err?.message || String(err));
        if (err?.stack && process.env.NODE_ENV === 'development') {
            console.error("Stack trace:", err.stack);
        }
        return null;
    } 
}

// --- Event Handling & Resolution Functions ---

/**
 * Resolves an external ID or video ID to an Emby item and primary MediaSourceId.
 * Checks mediaSourceCache and itemLookupCache before querying Emby.
 * @param {string} idOrVideoId - Stremio ID (e.g. "tt1234567", "tt1234567:1:2").
 * @param {object} config - Configuration object.
 * @returns {Promise<{ itemId: string, mediaSourceId: string, itemName?: string, itemType?: string }|null>}
 */
async function resolveEmbyItem(idOrVideoId, config) {
    if (!idOrVideoId || !config?.serverUrl || !config?.userId || !config?.accessToken) {
        return null;
    }

    const cacheKey = `${config.userId}:${idOrVideoId}`;
    const cached = mediaSourceCache.get(cacheKey) || itemLookupCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const parsedId = common.parseMediaId(idOrVideoId);
    if (!parsedId) return null;

    let item = null;
    if (parsedId.itemType === ITEM_TYPE_MOVIE) {
        const movies = await findMovieItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
        if (movies?.length > 0) item = movies[0];
    } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {
        const seriesItems = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
        if (seriesItems?.length > 0) {
            for (const series of seriesItems) {
                const ep = await findEpisodeItem(series, parsedId.seasonNumber, parsedId.episodeNumber, config);
                if (ep) {
                    item = ep;
                    break;
                }
            }
        }
    } else if (parsedId.itemType === ITEM_TYPE_SERIES) {
        const seriesItems = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
        if (seriesItems?.length > 0) item = seriesItems[0];
    }

    if (!item || !item.Id) {
        return null;
    }

    const mediaSourceId = item.MediaSources?.[0]?.Id || `mediasource_${item.Id}`;
    const result = {
        itemId: item.Id,
        mediaSourceId: mediaSourceId,
        itemName: item.Name,
        itemType: item.Type
    };

    mediaSourceCache.set(cacheKey, result);
    itemLookupCache.set(cacheKey, result);
    return result;
}

/**
 * Handles Stremio player events (start, pause, stop).
 * Reports playback status directly to Emby server.
 * @param {string} videoID - Video identifier (e.g. "tt0092086", "tt0944947:1:2").
 * @param {string|object} extraArgs - Action and playback parameters.
 * @param {object} config - Configuration object.
 * @returns {Promise<{ success: boolean }>}
 */
async function handlePlayerEvent(videoID, extraArgs, config) {
    if (!config?.serverUrl || !config?.userId || !config?.accessToken) {
        return { success: false };
    }

    if (config.syncPlayback === false) {
        return { success: true };
    }

    const extra = typeof extraArgs === 'string' ? common.parseExtraArgs(extraArgs) : (extraArgs || {});
    const action = extra.action;
    if (!action || !['start', 'pause', 'stop'].includes(action)) {
        return { success: true };
    }

    const currentTimeMs = Number(extra.currentTime || 0);
    const durationMs = Number(extra.duration || 0);
    const positionTicks = common.msToTicks(currentTimeMs);

    const resolved = await resolveEmbyItem(videoID, config);
    if (!resolved?.itemId) {
        return { success: true }; // Item not found on this Emby server; graceful no-op
    }

    const playSessionId = common.generateDeterministicSessionId(config.userId, videoID);

    try {
        if (action === 'start') {
            await makeApiCall(
                `${config.serverUrl}/Sessions/Playing`,
                'post',
                {},
                {
                    ItemId: resolved.itemId,
                    MediaSourceId: resolved.mediaSourceId,
                    PlaySessionId: playSessionId,
                    PlayMethod: "DirectPlay",
                    CanSeek: true,
                    IsPaused: false,
                    PositionTicks: positionTicks
                },
                config
            );
        } else if (action === 'pause') {
            await makeApiCall(
                `${config.serverUrl}/Sessions/Playing/Progress`,
                'post',
                {},
                {
                    ItemId: resolved.itemId,
                    MediaSourceId: resolved.mediaSourceId,
                    PlaySessionId: playSessionId,
                    PlayMethod: "DirectPlay",
                    CanSeek: true,
                    IsPaused: true,
                    PositionTicks: positionTicks
                },
                config
            );
        } else if (action === 'stop') {
            await makeApiCall(
                `${config.serverUrl}/Sessions/Playing/Stopped`,
                'post',
                {},
                {
                    ItemId: resolved.itemId,
                    MediaSourceId: resolved.mediaSourceId,
                    PlaySessionId: playSessionId,
                    PositionTicks: positionTicks
                },
                config
            );

            // Stremio specification: Playing past threshold does not send a separate watched event,
            // derive it from currentTime and duration on stop (>= 90% threshold).
            if (durationMs > 0 && (currentTimeMs / durationMs >= 0.90) && config.syncWatched !== false) {
                await makeApiCall(
                    `${config.serverUrl}/Users/${config.userId}/PlayedItems/${resolved.itemId}`,
                    'post',
                    {},
                    null,
                    config
                );
            }
        }
    } catch (err) {
        console.warn(`⚠️ Player event [${action}] failed for ${videoID}:`, err?.message || String(err));
    }

    return { success: true };
}

/**
 * Handles Stremio library events (libraryAdd, libraryRemove, watched, unwatched).
 * Synchronizes watch status or favorites with Emby server.
 * @param {string} id - Base media identifier (e.g. "tt0092086").
 * @param {string|object} extraArgs - Action and parameters.
 * @param {object} config - Configuration object.
 * @returns {Promise<{ success: boolean }>}
 */
async function handleLibraryEvent(id, extraArgs, config) {
    if (!config?.serverUrl || !config?.userId || !config?.accessToken) {
        return { success: false };
    }

    const extra = typeof extraArgs === 'string' ? common.parseExtraArgs(extraArgs) : (extraArgs || {});
    const action = extra.action;
    if (!action) return { success: true };

    try {
        // 1. Library add / remove -> Emby Favorites
        if (action === 'libraryAdd' || action === 'libraryRemove') {
            if (config.syncFavorites !== false) {
                const resolved = await resolveEmbyItem(id, config);
                if (resolved?.itemId) {
                    const method = (action === 'libraryAdd') ? 'post' : 'delete';
                    await makeApiCall(
                        `${config.serverUrl}/Users/${config.userId}/FavoriteItems/${resolved.itemId}`,
                        method,
                        {},
                        null,
                        config
                    );
                }
            }
            return { success: true };
        }

        // 2. Watched / Unwatched
        if (action === 'watched' || action === 'unwatched') {
            if (config.syncWatched === false) {
                return { success: true };
            }

            const isWatched = (action === 'watched');
            const method = isWatched ? 'post' : 'delete';

            if (extra.videoId) {
                // Batch episode list (e.g. season mark can send up to 100 video IDs)
                const videoIds = extra.videoId.split(',').map(s => s.trim()).filter(Boolean);
                const batchSize = 5;
                for (let i = 0; i < videoIds.length; i += batchSize) {
                    const batch = videoIds.slice(i, i + batchSize);
                    await Promise.allSettled(batch.map(async (vId) => {
                        const resolved = await resolveEmbyItem(vId, config);
                        if (resolved?.itemId) {
                            await makeApiCall(
                                `${config.serverUrl}/Users/${config.userId}/PlayedItems/${resolved.itemId}`,
                                method,
                                {},
                                null,
                                config
                            );
                        }
                    }));
                }
            } else {
                // Single item (movie or entire show)
                const resolved = await resolveEmbyItem(id, config);
                if (resolved?.itemId) {
                    await makeApiCall(
                        `${config.serverUrl}/Users/${config.userId}/PlayedItems/${resolved.itemId}`,
                        method,
                        {},
                        null,
                        config
                    );
                }
            }
        }
    } catch (err) {
        console.warn(`⚠️ Library event [${action}] failed for ${id}:`, err?.message || String(err));
    }

    return { success: true };
}

// --- Exports ---
module.exports = {
    getStream,
    resolveEmbyItem,
    handlePlayerEvent,
    handleLibraryEvent,
    parseMediaId: common.parseMediaId,
    deduplicateAndSortStreams: common.deduplicateAndSortStreams
};

