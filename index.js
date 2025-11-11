/**
 * StreamBridge – Emby/Jellyfin → Stremio addon
 * Full Express server with parameterised manifest + stream routes
 * User data is embedded in the URL path as a base64-url string.
 */

const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const embyClient   = require("./lib/embyClient");
const jellyfinClient = require("./lib/jellyfinClient");
require("dotenv").config();

const PORT = process.env.PORT || 7000;
const app  = express();

// ──────────────────────────────────────────────────────────────────────────
// Global middleware & static assets
// ──────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────────────────────────────────
// Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest () {
  return {
    id      : "org.streambridge.embyresolver",
    version : "1.2.0",
    name    : "StreamBridge: Emby/Jellyfin to Stremio",
    description:
      "Stream media from your personal or shared Emby or Jellyfin server using IMDb/TMDB IDs.",
    catalogs : [],
    resources: [
      { name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] }
    ],
    types: ["movie", "series"],
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl",   type: "text", title: "Server URL (Emby or Jellyfin)",  required: true },
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
    // Select the appropriate client based on serverType (defaults to 'emby' for backward compatibility)
    const client = cfg.serverType === 'jellyfin' ? jellyfinClient : embyClient;
    const raw = await client.getStream(id, cfg);
    
    // Get custom stream name from config (defaults based on server type)
    const streamName = cfg.streamName || (cfg.serverType === 'jellyfin' ? 'Jellyfin' : 'Emby');
    
    // Get hideStreamTypes from config (defaults to empty array for backward compatibility)
    const hideStreamTypes = cfg.hideStreamTypes || [];
    
    // Get server type for bingeGroup (defaults to 'emby' for backward compatibility)
    const serverType = cfg.serverType || 'emby';
         
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
        
        return {
          name: streamName, // Use custom stream name from config
          description: s.streamDescription || s.qualityTitle || "Direct Play", // Full detailed technical information
          url: s.directPlayUrl,
          behaviorHints: behaviorHints,
          subtitles: s.subtitles || [] // Include subtitles if available
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
