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
const ssrfGuard    = require("./lib/ssrfGuard");
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
    return res.status(400).json({ err: "serverUrl and username are required" });
  }

  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    return res.status(400).json({ err: "URL must start with http:// or https://" });
  }

  try {
    await ssrfGuard.assertPublicHost(normalizedUrl);
  } catch (e) {
    const msg = e?.message || "Invalid or disallowed server URL";
    return res.status(400).json({ err: msg });
  }

  const authUrl = `${normalizedUrl}/Users/AuthenticateByName`;
  try {
    const ax = await axios({
      method: "POST",
      url: authUrl,
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": 'MediaBrowser Client="StreamBridge", Device="WebHelper", DeviceId="webhelper", Version="1.2.0"'
      },
      data: { Username: username, Pw: password || "" },
      timeout: 15000,
      validateStatus: () => true
    });

    if (ax.status !== 200) {
      const msg = ax.data?.Message || ax.data?.message || `HTTP ${ax.status}`;
      return res.status(400).json({ err: msg });
    }

    const data = ax.data;
    const userId = data?.User?.Id;
    const accessToken = data?.AccessToken;
    const serverId = data?.ServerId;

    if (!userId || !accessToken) {
      return res.status(502).json({ err: "Invalid response from server" });
    }

    return res.json({
      Id: userId,
      AccessToken: accessToken,
      ServerId: serverId != null ? serverId : undefined
    });
  } catch (e) {
    const msg = e?.response?.data?.Message || e?.response?.data?.message || e?.code || e?.message || "Request failed";
    return res.status(502).json({ err: String(msg) });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest () {
  return {
    id      : "org.streambridge.embyresolver",
    version : "1.2.1",
    name    : "StreamBridge: Emby to Stremio",
    description:
      "Stream media from your Emby server using IMDb/TMDB/Tvdb/Anidb IDs.",
    catalogs : [],
    resources: [
      { name: "stream",
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
    
    // Get server type for bingeGroup (defaults to 'emby' for backward compatibility)
    const serverType = cfg.serverType || 'emby';

    const addonBase = `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;
    const cfgStr = req.params.cfg;
         
    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .filter(s => !shouldFilterStream(s, hideStreamTypes)) // Filter based on user preferences
      .map(s => {
        // Build behaviorHints with enriched data
        const behaviorHints = {
          filename: s.mediaInfo?.filename ?? undefined,
          videoSize: s.mediaInfo?.size ?? undefined,
          notWebReady: true, // Default to true for safety
          bingeGroup: `${serverType}-${s.itemId}` // Enables auto-play for series episodes
        };

        let subtitles = s.subtitles || [];
        if (subtitles.length > 0) {
          subtitles = subtitles.map(sub => ({
            id: sub.id,
            lang: sub.lang,
            url: `${addonBase}/${cfgStr}/subtitle?u=${Buffer.from(sub.url, "utf8").toString("base64url")}`
          }));
        }
        
        return {
          name: streamName, // Use custom stream name from config
          description: s.streamDescription || s.qualityTitle || "Direct Play", // Full detailed technical information
          url: s.directPlayUrl,
          behaviorHints: behaviorHints,
          subtitles
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
// SUBTITLE PROXY  →  /<cfg>/subtitle?u=<base64url(embySubtitleUrl)>
// Proxies subtitle files so the client fetches from the addon (CORS-friendly)
// instead of directly from Emby (which blocks cross-origin requests).
// ──────────────────────────────────────────────────────────────────────────
const SUBTITLE_CONTENT_TYPE = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
  ssa: "text/x-ssa"
};

app.get("/:cfg/subtitle", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.status(400).send("Bad config");
  }

  const encodedUrl = req.query.u;
  if (!encodedUrl || typeof encodedUrl !== "string") {
    return res.status(400).send("Missing u");
  }

  let targetUrl;
  try {
    targetUrl = Buffer.from(encodedUrl, "base64url").toString("utf8");
  } catch {
    return res.status(400).send("Invalid u");
  }

  const baseServer = (cfg.serverUrl || "").replace(/\/+$/, "");
  if (!baseServer || !targetUrl.startsWith(baseServer)) {
    return res.status(403).send("Subtitle URL not allowed");
  }

  try {
    const ax = await axios({
      method: "GET",
      url: targetUrl,
      responseType: "arraybuffer",
      timeout: 15000,
      validateStatus: () => true
    });

    if (ax.status !== 200) {
      return res.status(ax.status).send(ax.statusText || "Subtitle fetch failed");
    }

    const ext = (targetUrl.split("/").pop() || "").split(".").pop()?.toLowerCase() || "srt";
    const contentType = SUBTITLE_CONTENT_TYPE[ext] || "application/x-subrip";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3600");
    res.send(ax.data);
  } catch (e) {
    console.warn("Subtitle proxy error:", e?.message || String(e));
    return res.status(502).send("Subtitle fetch failed");
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
