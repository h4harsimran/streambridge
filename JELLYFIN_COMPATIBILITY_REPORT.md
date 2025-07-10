# Jellyfin Compatibility Report for StreamBridge Addon

## Executive Summary

This report analyzes the changes required to make the existing **StreamBridge** Emby addon compatible with Jellyfin servers. While Jellyfin was originally forked from Emby and maintains significant API compatibility, several key differences exist that require careful modification to ensure proper functionality.

## Current Addon Architecture

The StreamBridge addon is a Stremio addon that:
- Connects to Emby servers using REST API
- Resolves IMDb/TMDb/TVDB/AniDB IDs to Emby content
- Provides direct streaming links from Emby servers
- Uses Express.js backend with parameterized manifests
- Requires HTTPS-accessible Emby servers

## Key Changes Required for Jellyfin Compatibility

### 1. Authentication Header Changes

**Current Implementation (Emby):**
```javascript
const HEADER_EMBY_TOKEN = 'X-Emby-Token';
```

**Required Changes for Jellyfin:**

Jellyfin supports multiple authentication methods but is deprecating legacy Emby headers:

| Authentication Method | Status | Recommendation |
|----------------------|--------|----------------|
| `Authorization: MediaBrowser` | ✅ Preferred | **Use this for new implementations** |
| `X-Emby-Token` | ⚠️ Deprecated | Works but scheduled for removal |
| `ApiKey` query parameter | ⚠️ Discouraged | Fallback only |

**Recommended Implementation:**
```javascript
// Replace X-Emby-Token with Authorization header
headers: {
  'Authorization': `MediaBrowser Token="${accessToken}", Client="StreamBridge", Device="Stremio", DeviceId="${deviceId}", Version="1.0.0"`
}
```

### 2. API Endpoint Compatibility

Most endpoints remain compatible, but some differences exist:

**Compatible Endpoints:**
- `/Users/AuthenticateByName` ✅
- `/Users/{userId}/Items` ✅
- `/Items/{itemId}/PlaybackInfo` ✅
- `/Shows/{seriesId}/Seasons` ✅
- `/Shows/{seriesId}/Episodes` ✅
- `/Videos/{itemId}/stream.{container}` ✅

**Potential Issues:**
- Legacy `/emby/` routes are maintained but may be removed in future versions
- Some query parameters may have different defaults

### 3. Configuration Changes Required

**File: `embyClient.js`**

1. **Update Authentication Function:**
```javascript
async function makeEmbyApiRequest(url, params = {}, config) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            headers: { 
                'Authorization': `MediaBrowser Token="${config.accessToken}", Client="StreamBridge", Device="Stremio", DeviceId="streambridge-${config.userId}", Version="1.0.0"`
            },
            params: params,
        });
        return response.data;
    } catch (err) {
        // Handle Jellyfin-specific error responses
        console.warn(`⚠️ API Request failed for ${url}:`, err.message);
        return null;
    }
}
```

2. **Update Stream URL Generation:**
```javascript
// Jellyfin uses the same stream endpoint structure
const directPlayUrl = `${config.serverUrl}/Videos/${embyItem.Id}/stream.${source.Container}?MediaSourceId=${source.Id}&Static=true&api_key=${config.accessToken}&DeviceId=streambridge-addon`;
```

**File: `public/configure.html`**

1. **Update Server Type References:**
```html
<!-- Change from -->
<title>StreamBridge • Emby ↔ Stremio Setup</title>
<!-- To -->
<title>StreamBridge • Jellyfin ↔ Stremio Setup</title>
```

2. **Update Authentication Endpoint:**
```javascript
// Update the authentication call
const res = await fetch(`${url}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Authorization": 'MediaBrowser Client="StreamBridge", Device="WebHelper", DeviceId="webhelper", Version="1.0.0"'
    },
    body: JSON.stringify({Username: user, Pw: pass})
});
```

**File: `index.js`**

1. **Update Manifest Information:**
```javascript
function baseManifest() {
    return {
        id: "org.streambridge.jellyfinresolver",
        version: "1.1.0",
        name: "StreamBridge: Jellyfin to Stremio",
        description: "Stream media from your personal or shared Jellyfin server using IMDb/TMDB IDs.",
        // ... rest unchanged
    };
}
```

### 4. Error Handling Improvements

Jellyfin may return slightly different error responses:

```javascript
// Enhanced error handling for Jellyfin
async function makeJellyfinApiRequest(url, params = {}, config) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            headers: { 
                'Authorization': `MediaBrowser Token="${config.accessToken}", Client="StreamBridge", Device="Stremio", DeviceId="streambridge-${config.userId}", Version="1.0.0"`
            },
            params: params,
        });
        return response.data;
    } catch (err) {
        if (err.response?.status === 401) {
            console.log("🔧 Detected Unauthorized (401). The provided access token might be invalid or expired.");
        } else if (err.response?.status === 404) {
            console.log("🔧 Endpoint not found (404). Check if the Jellyfin server version supports this endpoint.");
        }
        return null;
    }
}
```

### 5. Device ID Considerations

Jellyfin has specific requirements for device IDs:
- Must be unique per device/user combination
- Should include username hash to avoid conflicts
- Maximum one token per deviceId

```javascript
// Generate proper device ID for Jellyfin
function generateDeviceId(username) {
    const hash = require('crypto').createHash('md5').update(username).digest('hex').substring(0, 8);
    return `streambridge-${hash}`;
}
```

## Version Compatibility Matrix

| Jellyfin Version | Compatibility | Notes |
|------------------|---------------|-------|
| 10.8.x | ✅ Full | Legacy auth methods still supported |
| 10.9.x | ✅ Full | Legacy auth methods still supported |
| 10.10.x | ✅ Full | Some legacy deprecation warnings |
| 10.11+ | ⚠️ Partial | Legacy auth methods may be disabled |

## Implementation Strategy

### Phase 1: Dual Compatibility (Recommended)
Create a unified addon that works with both Emby and Jellyfin:

1. **Auto-detection Logic:**
```javascript
async function detectServerType(serverUrl) {
    try {
        const response = await axios.get(`${serverUrl}/System/Info/Public`);
        return response.data.ServerName.toLowerCase().includes('jellyfin') ? 'jellyfin' : 'emby';
    } catch {
        return 'unknown';
    }
}
```

2. **Conditional Authentication:**
```javascript
function getAuthHeaders(serverType, accessToken) {
    if (serverType === 'jellyfin') {
        return {
            'Authorization': `MediaBrowser Token="${accessToken}", Client="StreamBridge", Device="Stremio", DeviceId="streambridge-addon", Version="1.0.0"`
        };
    } else {
        return {
            'X-Emby-Token': accessToken
        };
    }
}
```

### Phase 2: Jellyfin-Only Fork
Create a dedicated Jellyfin version with optimized implementation.

## Testing Requirements

1. **Authentication Testing**
   - Test with API keys vs user tokens
   - Verify device ID uniqueness
   - Test token expiration handling

2. **Media Resolution Testing**
   - Test various ID formats (IMDb, TMDb, TVDB, AniDB)
   - Verify series/episode resolution
   - Test with different library structures

3. **Streaming Testing**
   - Verify direct play URLs
   - Test different media formats
   - Validate quality selection

## Potential Risks & Mitigation

### Risk 1: Authentication Method Deprecation
**Mitigation:** Implement modern `Authorization` header from the start

### Risk 2: API Endpoint Changes
**Mitigation:** Add version detection and fallback mechanisms

### Risk 3: Stream URL Format Changes
**Mitigation:** Use Jellyfin's PlaybackInfo endpoint for URL generation

## Estimated Development Effort

| Task | Effort | Priority |
|------|--------|----------|
| Authentication Updates | 4-6 hours | High |
| UI/Documentation Updates | 2-3 hours | Medium |
| Error Handling Improvements | 3-4 hours | Medium |
| Testing & Validation | 6-8 hours | High |
| **Total** | **15-21 hours** | |

## Recommendations

1. **Start with Phase 1 (Dual Compatibility)** to maintain existing Emby users while adding Jellyfin support
2. **Use modern authentication methods** to future-proof the implementation
3. **Implement comprehensive error handling** for better user experience
4. **Add server type detection** for automatic configuration
5. **Create separate documentation** for Jellyfin-specific setup instructions

## Conclusion

The StreamBridge addon can be successfully adapted for Jellyfin with moderate development effort. The main changes involve updating authentication methods, modernizing API calls, and improving error handling. The high degree of API compatibility between Emby and Jellyfin makes this a feasible project with minimal risk of breaking existing functionality.