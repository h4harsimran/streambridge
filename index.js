const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const axios        = require("axios");
const embyClient   = require("./lib/embyClient");
const { redactServerUrl } = require("./lib/redact");
const { version } = require("./package.json");
require("dotenv").config();

const PORT = process.env.PORT || 7000;
const app  = express();

// Populated at startup when EMBY_SERVER_URL + EMBY_USERNAME + EMBY_PASSWORD are set
let envConfig = null;

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const embyAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { err: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.json({ limit: "2kb" }));

// ──────────────────────────────────────────────────────────────────────────
// Shared Emby auth — used by the API route and env-var startup
// ──────────────────────────────────────────────────────────────────────────
async function authenticateEmby(serverUrl, username, password) {
  const ax = await axios({
    method: "POST",
    url: `${serverUrl}/Users/AuthenticateByName`,
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": `MediaBrowser Client="StreamBridge", Device="WebHelper", DeviceId="webhelper", Version="${version}"`
    },
    data: { Username: username, Pw: password || "" },
    timeout: 5000,
    validateStatus: () => true
  });
  if (ax.status !== 200) {
    throw new Error(ax.data?.Message || ax.data?.message || `HTTP ${ax.status}`);
  }
  const userId      = ax.data?.User?.Id;
  const accessToken = ax.data?.AccessToken;
  const serverId    = ax.data?.ServerId;
  if (!userId || !accessToken) throw new Error("Invalid response (missing User.Id or AccessToken)");
  return { userId, accessToken, serverId };
}

app.post("/api/get-emby-tokens", embyAuthLimiter, async (req, res) => {
  const serverUrl = typeof req.body?.serverUrl === "string" ? req.body.serverUrl.trim() : "";
  const username  = typeof req.body?.username  === "string" ? req.body.username  : "";
  const password  = typeof req.body?.password  === "string" ? req.body.password  : "";

  if (!serverUrl || !username) {
    console.warn("[AUTH] Missing serverUrl or username");
    return res.status(400).json({ err: "serverUrl and username are required" });
  }

  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    console.warn("[AUTH] Invalid URL scheme (must be http:// or https://)");
    return res.status(400).json({ err: "URL must start with http:// or https://" });
  }

  try {
    console.log(`[AUTH] Authenticating ${username} at ${redactServerUrl(normalizedUrl)}`);
    const { userId, accessToken, serverId } = await authenticateEmby(normalizedUrl, username, password);
    console.log(`[AUTH] Success — userId: ${userId}`);
    return res.json({
      Id:          userId,
      AccessToken: accessToken,
      ServerId:    serverId != null ? serverId : undefined
    });
  } catch (e) {
    const msg  = e?.response?.data?.Message || e?.response?.data?.message || e?.code || e?.message || "Request failed";
    const code = e?.code || (e?.response?.status ? `HTTP ${e.response.status}` : "");
    console.warn(`[AUTH] Failed: ${redactServerUrl(normalizedUrl)}`, code ? `→ ${code}` : "", msg);
    return res.status(502).json({ err: String(msg) });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest() {
  return {
    id      : "org.streambridge.embyresolver",
    version,
    name    : "StreamBridge: Emby to Stremio",
    description:
      "Stream media from your Emby server using IMDb/TMDB/Tvdb/Anidb IDs.",
    catalogs : [],
    resources: [
      { name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "imdb:", "tmdb:"] }
    ],
    types: ["movie", "series"],
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl",   type: "text", title: "Server URL (Emby)",  required: true },
      { key: "userId",      type: "text", title: "User ID",            required: true },
      { key: "accessToken", type: "text", title: "Access Token",        required: true }
    ]
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: decode the cfg URL segment into a config object
// ──────────────────────────────────────────────────────────────────────────
function decodeCfg(str) {
  const cfg = JSON.parse(Buffer.from(str, "base64url").toString("utf8"));

  if (cfg.serverUrl) cfg.serverUrl = cfg.serverUrl.replace(/\/+$/, "");
  if (!cfg.serverType)                 cfg.serverType    = "emby";
  if (cfg.showServerName === undefined) cfg.showServerName = false;
  if (!cfg.streamName)                 cfg.streamName    = cfg.serverType === "jellyfin" ? "Jellyfin" : "Emby";
  if (!cfg.hideStreamTypes)            cfg.hideStreamTypes = [];

  return cfg;
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: filter streams by user hideStreamTypes preference
// ──────────────────────────────────────────────────────────────────────────
function shouldFilterStream(stream, hideStreamTypes) {
  if (!hideStreamTypes || hideStreamTypes.length === 0) return false;

  const qualityTag = stream.mediaInfo?.qualityTag || "";
  const hdrTag     = stream.mediaInfo?.hdrTag     || "";

  if (hideStreamTypes.includes("4K")    && (qualityTag.includes("4K") || qualityTag === "2160p")) return true;
  if (hideStreamTypes.includes("1080p") && qualityTag === "1080p")                                 return true;
  if (hideStreamTypes.includes("DV")    && (hdrTag === "DV" || hdrTag === "DolbyVision"))          return true;
  if (hideStreamTypes.includes("HDR")   && hdrTag && (hdrTag.includes("HDR") || hdrTag === "HLG" || hdrTag === "DV" || hdrTag === "DolbyVision")) return true;

  return false;
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: fetch and format streams — shared by both stream routes
// ──────────────────────────────────────────────────────────────────────────
async function handleStreamRequest(cfg, type, id, res) {
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken)
    return res.json({ streams: [] });

  console.log(`[SEARCH] ${type} ${id} → ${redactServerUrl(cfg.serverUrl)}`);

  try {
    const raw             = await embyClient.getStream(id, cfg);
    const streamName      = cfg.streamName      || "Emby";
    const hideStreamTypes = cfg.hideStreamTypes || [];

    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .filter(s => !shouldFilterStream(s, hideStreamTypes))
      .map(s => {
        const qualityLabel = [s.mediaInfo?.qualityTag, s.mediaInfo?.hdrTag]
          .filter(Boolean).join(" ") || s.qualityTitle || "Direct Play";
        return {
          name        : `${streamName}\n${qualityLabel}`,
          description : s.streamDescription || s.qualityTitle || "Direct Play",
          url         : s.directPlayUrl,
          behaviorHints: {
            filename   : s.mediaInfo?.filename ?? undefined,
            videoSize  : s.mediaInfo?.size     ?? undefined,
            videoHash  : s.mediaInfo?.videoHash ?? undefined,
            notWebReady: true,
            bingeGroup : `${streamName}|${(s.qualityTitle || "Direct Play").trim()}`
          },
          subtitles: (cfg.includeSubtitles === false) ? [] : (s.subtitles || [])
        };
      });

    console.log(`[STREAM] ${type}/${id} → ${streams.length} stream(s)`);

    res.set("Cache-Control", streams.length > 0 ? "public, max-age=120" : "no-cache");
    res.json({ streams });
  } catch (e) {
    console.error(`[STREAM] Error for ${type}/${id}:`, e?.message || String(e));
    if (e?.stack && process.env.NODE_ENV === "development") console.error(e.stack);
    res.json({ streams: [] });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// MANIFEST  →  /<cfg>/manifest.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/manifest.json", (req, res) => {
  const cfgString = req.params.cfg;
  let cfg;
  try {
    cfg = decodeCfg(cfgString);
  } catch (err) {
    console.error("[MANIFEST] Failed to decode cfg:", err.message);
    return res.status(400).json({ err: "Bad config in URL", details: err.message });
  }

  const mf = baseManifest();
  mf.id += "." + cfgString.slice(0, 8);
  if (cfg.showServerName === true) {
    const host = cfg.serverUrl ? cfg.serverUrl.replace(/^https?:\/\//, "") : "Unknown Server";
    mf.name += ` (${host})`;
  }
  mf.behaviorHints.configurationRequired = false;

  console.log(`[MANIFEST] Serving for ${redactServerUrl(cfg.serverUrl || "unknown")}`);
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// STREAM  →  /<cfg>/stream/<type>/<id>.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/stream/:type/:id.json", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.json({ streams: [] });
  }
  await handleStreamRequest(cfg, req.params.type, req.params.id, res);
});

// ──────────────────────────────────────────────────────────────────────────
// FALLBACK MANIFEST  →  /manifest.json
// Returns a configured manifest when EMBY_* env vars are set, otherwise
// shows the config form
// ──────────────────────────────────────────────────────────────────────────
app.get("/manifest.json", (_req, res) => {
  const mf = baseManifest();
  if (envConfig) {
    mf.behaviorHints.configurationRequired = false;
    console.log(`[MANIFEST] Serving env-configured manifest for ${redactServerUrl(envConfig.serverUrl)}`);
  } else {
    console.log("[MANIFEST] Serving unconfigured manifest");
  }
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// STREAM (no cfg)  →  /stream/<type>/<id>.json
// Used when the addon is installed via /manifest.json with env-var config
// ──────────────────────────────────────────────────────────────────────────
app.get("/stream/:type/:id.json", async (req, res) => {
  if (!envConfig) return res.json({ streams: [] });
  await handleStreamRequest(envConfig, req.params.type, req.params.id, res);
});

// ──────────────────────────────────────────────────────────────────────────
// ENV CONFIG STATUS  →  /api/env-config
// Returns resolved credentials so the configure page can skip Step 1
// ──────────────────────────────────────────────────────────────────────────
app.get("/api/env-config", (_req, res) => {
  if (!envConfig) return res.json({ configured: false });
  res.json({
    configured:  true,
    serverUrl:   envConfig.serverUrl,
    userId:      envConfig.userId,
    accessToken: envConfig.accessToken
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CONFIGURE
// ──────────────────────────────────────────────────────────────────────────
app.get("/configure", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "configure.html")));

app.get("/:cfg/configure", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "configure.html")));

// ──────────────────────────────────────────────────────────────────────────
// Startup: authenticate from env vars if provided, then start listening
// ──────────────────────────────────────────────────────────────────────────
async function initEnvConfig() {
  const serverUrl = (process.env.EMBY_SERVER_URL || "").replace(/\/+$/, "");
  const username  =  process.env.EMBY_USERNAME   || "";
  const password  =  process.env.EMBY_PASSWORD   || "";

  if (!serverUrl || !username) return;

  console.log(`[INIT] Authenticating env config: ${redactServerUrl(serverUrl)} as ${username}`);
  try {
    const { userId, accessToken } = await authenticateEmby(serverUrl, username, password);
    envConfig = {
      serverUrl, userId, accessToken,
      serverType: "emby", showServerName: false,
      streamName: "Emby", hideStreamTypes: [], includeSubtitles: true
    };
    console.log(`[INIT] Env config ready — server: ${redactServerUrl(serverUrl)}, userId: ${userId}`);
  } catch (e) {
    console.error("[INIT] Env config auth failed:", e.message);
  }
}

(async () => {
  await initEnvConfig();
  app.listen(PORT, () =>
    console.log(`🚀  StreamBridge up at http://localhost:${PORT}/<cfg>/manifest.json`)
  );
})();
