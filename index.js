/**
 * StreamBridge – Emby → Stremio addon
 * Full Express server with parameterised manifest + stream routes
 * User data is embedded in the URL path as a base64-url string.
 */

const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const axios        = require("axios");
const embyClient   = require("./lib/embyClient");
const { redactServerUrl } = require("./lib/redact");
const { version } = require("./package.json");
// JELLYFIN: Jellyfin client import commented out for future Jellyfin support
// const jellyfinClient = require("./lib/jellyfinClient");
require("dotenv").config();

const PORT = process.env.PORT || 7000;
const app  = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const embyAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { err: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.json({ limit: "2kb" }));

app.post("/api/get-emby-tokens", embyAuthLimiter, async (req, res) => {
  const serverUrl = typeof req.body?.serverUrl === "string" ? req.body.serverUrl.trim() : "";
  const username  = typeof req.body?.username === "string" ? req.body.username : "";
  const password  = typeof req.body?.password === "string" ? req.body.password : "";

  if (!serverUrl || !username) {
    console.warn("Auth: missing serverUrl or username");
    return res.status(400).json({ err: "serverUrl and username are required" });
  }

  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    console.warn("Auth: invalid URL scheme (must be http:// or https://)");
    return res.status(400).json({ err: "URL must start with http:// or https://" });
  }

  const authUrl = `${normalizedUrl}/Users/AuthenticateByName`;
  try {
    const ax = await axios({
      method: "POST",
      url: authUrl,
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": `MediaBrowser Client="StreamBridge", Device="WebHelper", DeviceId="webhelper", Version="${version}"`
      },
      data: { Username: username, Pw: password || "" },
      timeout: 5000,
      validateStatus: () => true
    });

    if (ax.status !== 200) {
      const msg = ax.data?.Message || ax.data?.message || `HTTP ${ax.status}`;
      console.warn("Auth failed:", redactServerUrl(normalizedUrl), "→", ax.status, msg);
      return res.status(400).json({ err: msg });
    }

    const data = ax.data;
    const userId = data?.User?.Id;
    const accessToken = data?.AccessToken;
    const serverId = data?.ServerId;

    if (!userId || !accessToken) {
      console.warn("Auth failed:", redactServerUrl(normalizedUrl), "→ invalid response (missing User.Id or AccessToken)");
      return res.status(502).json({ err: "Invalid response from server" });
    }

    return res.json({
      Id: userId,
      AccessToken: accessToken,
      ServerId: serverId != null ? serverId : undefined
    });
  } catch (e) {
    const msg = e?.response?.data?.Message || e?.response?.data?.message || e?.code || e?.message || "Request failed";
    const code = e?.code || (e?.response?.status ? `HTTP ${e.response.status}` : "");
    console.warn("Auth failed:", redactServerUrl(normalizedUrl), code ? "→" : "", code || "", msg);
    return res.status(502).json({ err: String(msg) });
  }
});

app.post("/api/get-emby-playlists", embyAuthLimiter, async (req, res) => {
  const serverUrl   = typeof req.body?.serverUrl === "string" ? req.body.serverUrl.trim() : "";
  const userId      = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
  const accessToken = typeof req.body?.accessToken === "string" ? req.body.accessToken.trim() : "";

  if (!serverUrl || !userId || !accessToken) {
    return res.status(400).json({ err: "serverUrl, userId, and accessToken are required" });
  }

  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    return res.status(400).json({ err: "URL must start with http:// or https://" });
  }

  try {
    const ax = await axios({
      method: "GET",
      url: `${normalizedUrl}/Users/${encodeURIComponent(userId)}/Items`,
      params: {
        IncludeItemTypes: "Playlist",
        Recursive: true
      },
      headers: {
        "X-Emby-Token": accessToken
      },
      timeout: 8000
    });

    const items = ax.data?.Items || [];
    const playlists = items.map(p => ({
      id: String(p.Id),
      name: p.Name
    }));

    return res.json({ playlists });
  } catch (e) {
    const msg = e?.response?.data?.Message || e?.response?.data?.message || e?.message || "Failed to fetch playlists";
    return res.status(e?.response?.status || 502).json({ err: String(msg) });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest () {
  return {
    id      : "org.streambridge.embyresolver",
    version,
    name    : "StreamBridge: Emby to Stremio",
    description:
      "Stream media from your Emby server using IMDb/TMDB/Tvdb/Anidb IDs.",
    logo    : "/logo.svg",
    icon    : "/logo.svg",
    catalogs : [],
    resources: [
      { name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] },
      { name: "player",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] },
      { name: "library",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] }
    ],
    types: ["movie", "series"],
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl",   type: "text", title: "Server URL (Emby)",  required: true },
      { key: "userId",      type: "text", title: "User ID",     required: true },
      { key: "accessToken", type: "text", title: "Access Token", required: true }
    ]
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: decode the cfg string into an object with defaults for backward compatibility
// ──────────────────────────────────────────────────────────────────────────
function decodeCfg(str) {
  const cfg = JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
  
  // Normalize serverUrl: remove trailing slash to prevent double slashes in API calls
  if (cfg.serverUrl) {
    cfg.serverUrl = cfg.serverUrl.replace(/\/+$/, '');
  }
  
  // Set defaults for new features to maintain backward compatibility
  // If these fields don't exist, use sensible defaults
  if (!cfg.serverType) cfg.serverType = 'emby'; // Default: Emby for backward compatibility
  if (cfg.showServerName === undefined) cfg.showServerName = false; // Default: hide server name
  if (!cfg.streamName) {
    // Default stream name based on server type
    cfg.streamName = cfg.serverType === 'jellyfin' ? 'Jellyfin' : 'Emby';
  }
  if (!cfg.hideStreamTypes) cfg.hideStreamTypes = []; // Default: show all stream types
  if (cfg.syncPlayback === undefined) cfg.syncPlayback = true; // Default: scrobble playback to Emby
  if (cfg.syncWatched === undefined) cfg.syncWatched = true;   // Default: sync watched/unwatched
  if (cfg.syncFavorites === undefined) cfg.syncFavorites = false; // Default: do not alter favorites unless opted in
  if (cfg.syncPlaylist === undefined) cfg.syncPlaylist = false;   // Default: do not alter playlists unless opted in
  if (!cfg.playlistMode) cfg.playlistMode = 'separate';
  if (!cfg.moviePlaylistName) cfg.moviePlaylistName = 'Stremio Movies';
  if (!cfg.seriesPlaylistName) cfg.seriesPlaylistName = 'Stremio Shows';
  if (!cfg.moviePlaylistId) cfg.moviePlaylistId = '';
  if (!cfg.seriesPlaylistId) cfg.seriesPlaylistId = '';
  
  return cfg;
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: check if a stream should be filtered based on hideStreamTypes config
// Returns true if the stream matches ANY of the selected types to hide
// ──────────────────────────────────────────────────────────────────────────
function shouldFilterStream(stream, hideStreamTypes) {
  if (!hideStreamTypes || hideStreamTypes.length === 0) return false;
  
  const mediaInfo = stream.mediaInfo || {};
  const qualityTag = mediaInfo.qualityTag || '';
  const hdrTag = mediaInfo.hdrTag || '';
  
  // Check for 4K streams
  if (hideStreamTypes.includes('4K')) {
    if (qualityTag.includes('4K') || qualityTag === '2160p') {
      return true;
    }
  }
  
  // Check for 1080p streams
  if (hideStreamTypes.includes('1080p')) {
    if (qualityTag === '1080p') {
      return true;
    }
  }
  
  // Check for Dolby Vision (DV)
  if (hideStreamTypes.includes('DV')) {
    if (hdrTag === 'DV' || hdrTag === 'DolbyVision') {
      return true;
    }
  }
  
  // Check for HDR tags (any HDR variant: HDR10, HDR10+, HLG, DV, etc.)
  if (hideStreamTypes.includes('HDR')) {
    if (hdrTag && (hdrTag.includes('HDR') || hdrTag === 'HLG' || hdrTag === 'DV' || hdrTag === 'DolbyVision')) {
      return true;
    }
  }
  
  return false;
}   

// ──────────────────────────────────────────────────────────────────────────
// Parameterised MANIFEST route  →  /<cfg>/manifest.json
//     <cfg> is a base64-url-encoded JSON blob with {serverUrl,userId,accessToken}
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/manifest.json", (req, res) => {
  const cfgString = req.params.cfg;
  let cfg;
  try {
    cfg = decodeCfg(cfgString);    
  } catch (err) {
    console.error("[ERROR] Error decoding cfg in manifest route:", err.message);
    // SECURITY: Do not log cfgString as it contains sensitive user credentials (accessToken, userId, serverUrl)
    console.error("[ERROR] Failed to decode config (cfgString length:", cfgString?.length || 0, ")");
    return res.status(400).json({ err: "Bad config in URL", details: err.message });
  }

  const mf = baseManifest();

  if (!mf) {
    console.error("[FATAL] baseManifest() returned undefined. This is the cause of the error.");
    return res.status(500).json({ err: "Server error: Failed to generate base manifest object." });
  }

  mf.id += "." + cfgString.slice(0, 8); 

  // Conditionally show server name based on config (defaults to false - server name hidden by default)
  if (cfg.showServerName === true) {
    const serverHostname = (cfg && cfg.serverUrl) ? cfg.serverUrl.replace(/^https?:\/\//, "") : "Unknown Server";
    mf.name += ` (${serverHostname})`;
  }
  mf.behaviorHints.configurationRequired = false;

  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// STREAM route  →  /<cfg>/stream/<type>/<id>.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/stream/:type/:id.json", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.json({ streams: [] });
  }

  const { id } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken)
    return res.json({ streams: [] });

  try {
    // JELLYFIN: Always use Emby client - Jellyfin support commented out for future
    // Select the appropriate client based on serverType (defaults to 'emby' for backward compatibility)
    // const client = cfg.serverType === 'jellyfin' ? jellyfinClient : embyClient;
    const client = embyClient;
    const raw = await client.getStream(id, cfg);
    
    // Get custom stream name from config (defaults based on server type)
    const streamName = cfg.streamName || (cfg.serverType === 'jellyfin' ? 'Jellyfin' : 'Emby');
    
    // Get hideStreamTypes from config (defaults to empty array for backward compatibility)
    const hideStreamTypes = cfg.hideStreamTypes || [];
         
    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .filter(s => !shouldFilterStream(s, hideStreamTypes)) // Filter based on user preferences
      .map(s => {
        // Build behaviorHints with enriched data
        const behaviorHints = {
          filename: s.mediaInfo?.filename ?? undefined,
          videoSize: s.mediaInfo?.size ?? undefined,
          notWebReady: true, // Default to true for safety
          bingeGroup: `${streamName}-${(s.qualityTitle || "Direct Play").trim()}` // Same stream name+quality = consistent auto-play across episodes
        };
        
        return {
          name: streamName, // Use custom stream name from config
          description: s.streamDescription || s.qualityTitle || "Direct Play", // Full detailed technical information
          url: s.directPlayUrl,
          behaviorHints: behaviorHints,
          subtitles: (cfg.includeSubtitles === false) ? [] : (s.subtitles || []) // Include subtitles unless user opted out
        };
      });
    // Set cache based on whether streams were found
    if (streams.length > 0) {
      res.set('Cache-Control', 'public, max-age=120');  // Cache for 2 minutes when streams exist
    } else {
      res.set('Cache-Control', 'no-cache');  // Don't cache empty results
    }

    res.json({ streams });
  } catch (e) {
    // SECURITY: Only log error message and stack, not the full error object which might contain config
    console.error("Stream handler error:", e?.message || String(e));
    if (e?.stack && process.env.NODE_ENV === 'development') {
      console.error("Stack trace:", e.stack);
    }
    res.json({ streams: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// PLAYER route  →  /:cfg/player/:type/:videoID/:extraArgs.json
// ──────────────────────────────────────────────────────────────────────────
app.get(["/:cfg/player/:type/:videoID/:extraArgs.json", "/:cfg/player/:type/:videoID.json"], async (req, res) => {
  res.set("Cache-Control", "no-store");

  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.json({ success: false });
  }

  const { videoID, extraArgs } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken || !videoID) {
    return res.json({ success: false });
  }

  try {
    const result = await embyClient.handlePlayerEvent(videoID, extraArgs || "", cfg);
    res.json(result || { success: true });
  } catch (err) {
    console.error("Player event error:", err?.message || String(err));
    res.json({ success: false });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// LIBRARY route  →  /:cfg/library/:type/:id/:extraArgs.json
// ──────────────────────────────────────────────────────────────────────────
app.get(["/:cfg/library/:type/:id/:extraArgs.json", "/:cfg/library/:type/:id.json"], async (req, res) => {
  res.set("Cache-Control", "no-store");

  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.json({ success: false });
  }

  const { id, extraArgs } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken || !id) {
    return res.json({ success: false });
  }

  try {
    const result = await embyClient.handleLibraryEvent(id, extraArgs || "", cfg);
    res.json(result || { success: true });
  } catch (err) {
    console.error("Library event error:", err?.message || String(err));
    res.json({ success: false });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// FALLBACK manifest for users who hit /manifest.json with no cfg
//     (Stremio will show its built-in config form)
// ──────────────────────────────────────────────────────────────────────────
app.get("/manifest.json", (_req, res) => {
  const mf = baseManifest();
  if (!mf) {
    console.error("[FATAL] baseManifest() returned undefined for fallback route.");
    return res.status(500).json({ err: "Server error: Failed to generate base manifest object." });
  }
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// CONFIGURE route  →  /configure
// ──────────────────────────────────────────────────────────────────────────
app.get("/configure", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "configure.html")));

app.get("/:cfg/configure", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "configure.html"));
});
// ──────────────────────────────────────────────────────────────────────────
// Start the server
// ──────────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`🚀  StreamBridge up at http://localhost:${PORT}/<cfg>/manifest.json`)
);
