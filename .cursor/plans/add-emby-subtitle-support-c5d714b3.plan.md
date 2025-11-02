<!-- c5d714b3-9ea4-4702-a5e9-30c5581a17ff dca117d3-3cff-4344-8605-4fb182ae3d96 -->
# Add Emby Subtitle Support to Stremio Addon (Corrected Plan)

## Overview

Add subtitles directly to each stream object in the existing stream response. When Stremio requests streams, each stream will include its available subtitles embedded within the stream object itself. No manifest changes or separate routes needed.

## Implementation Steps

### 1. Extract Subtitles from PlaybackInfo (`embyClient.js`)

Modify `getPlaybackStreams()` function to:

- After fetching PlaybackInfo (line 368-372), extract subtitle streams from `MediaSources[].MediaStreams`
- Filter `MediaStreams` where `Type === 'Subtitle'`
- For each subtitle stream, extract:
  - `Index` property - numeric index used for building subtitle URL
  - `Language` property - ISO 639-2 three-letter code (e.g., "eng", "spa", "fre")
  - `Codec` property - format identifier ("subrip", "webvtt", "ass", "ssa", etc.)
  - `IsExternal` property - boolean indicating external vs embedded subtitle
  - `DisplayTitle` or `DisplayLanguage` - human-readable label
  - Note: All these properties are standard in Emby's MediaStream structure

### 2. Build Subtitle URLs (`embyClient.js`)

In `getPlaybackStreams()`, for each subtitle found:

- Build Emby subtitle URL using format: `${serverUrl}/Videos/${itemId}/Subtitles/${subtitle.Index}/Stream.${format}?api_key=${accessToken}`
  - Use `subtitle.Index` from MediaStream
  - Format detection: Map `Codec` property to file extension:
    - "subrip" → "srt"
    - "webvtt" → "vtt"
    - "ass" → "ass"
    - "ssa" → "ssa"
    - Default to "srt" for unknown codecs
  - Note: Emby subtitle endpoint is `/Videos/{itemId}/Subtitles/{Index}/Stream.{format}`
- Preserve Emby's three-letter ISO 639-2 language codes (keep "eng", not "en")
- Fallback to "und" (undefined) if `Language` is null/missing
- Create subtitle object: `{ id: "sub-{itemId}-{index}", lang: "{3-letter-code}", url: "..." }`
- Optional: Add human-readable label from `DisplayTitle` or `DisplayLanguage`

### 3. Collect Subtitles Per MediaSource (`embyClient.js`)

Modify `getPlaybackStreams()` to:

- Extract subtitles for each MediaSource individually
- Build subtitle array as part of stream object creation (not separately)
- Return subtitles embedded within each stream: Each stream object gets its own `subtitles` array
- Handle cases where MediaSource has no subtitles (return empty array `[]` for that stream)

### 4. Embed Subtitles in Stream Objects (`embyClient.js`)

**Critical correction**: Subtitles must be embedded **inside each stream object**, not as a separate top-level array:

- When building stream objects in `getPlaybackStreams()`, add `subtitles` property to each stream:
  ```javascript
  const stream = {
    title: "...",
    name: "...",
    url: "...",
    behaviorHints: {...},
    subtitles: [  // Embedded in stream object
      { id: "sub-123-0", lang: "eng", url: "https://..." },
      { id: "sub-123-1", lang: "spa", url: "https://..." }
    ]
  };
  ```
- If no subtitles exist for a MediaSource, set `subtitles: []` (empty array, not omitted)
- All streams from the same item will share the same subtitle array

### 5. Return Streams with Embedded Subtitles (`index.js`)

The stream route handler (line 89-116) requires **no structural changes**:

- `emby.getStream()` already returns `{ streams: [...] }`
- Each stream object now contains its own `subtitles` array
- Response format remains unchanged:
  ```javascript
  res.json({ 
    streams: [
      {
        url: "...",
        title: "...",
        subtitles: [...]  // Inside stream object
      }
    ]
  });
  ```

## Key Technical Details

**Correct Stremio Stream Response Format:**

```javascript
{
  streams: [
    { 
      title: "1080p", 
      name: "Emby", 
      url: "https://...",
      behaviorHints: { notWebReady: true },
      subtitles: [  // CRITICAL: Inside stream object, not top-level
        { 
          id: "sub-12345-0", 
          lang: "eng",  // 3-letter ISO 639-2 code
          url: "https://emby-server/Videos/12345/Subtitles/0/Stream.srt?api_key=..."
        },
        { 
          id: "sub-12345-1", 
          lang: "spa", 
          url: "https://emby-server/Videos/12345/Subtitles/1/Stream.vtt?api_key=..."
        }
      ]
    }
  ]
}
```

**Emby Subtitle URL Format:**

- Endpoint: `/Videos/{itemId}/Subtitles/{index}/Stream.{format}?api_key={token}`
- Format must match codec type (map Emby's codec names to file extensions)
- Authentication via `api_key` query parameter (same as video stream)

**Codec to Format Mapping:**

```javascript
const CODEC_FORMAT_MAP = {
  'subrip': 'srt',
  'webvtt': 'vtt',
  'ass': 'ass',
  'ssa': 'ssa'
};
const format = CODEC_FORMAT_MAP[codec?.toLowerCase()] || 'srt';
```

**Language Code Handling:**

- Preserve Emby's three-letter ISO 639-2 codes (e.g., "eng", "spa", "fre", "jpn")
- Do NOT convert to two-letter codes
- Use "und" (undefined) as fallback when language is null/missing
- Never use "en" as a default

**Minimal Changes:**

- Only modify `getPlaybackStreams()` to extract subtitles and embed in each stream object
- No changes needed to `index.js` stream route handler
- No manifest changes needed
- No new routes needed

## Files to Modify

- `embyClient.js`: 
  - Modify `getPlaybackStreams()` to extract subtitle MediaStreams
  - Build subtitle URLs with proper codec-to-format mapping
  - Embed `subtitles` array directly in each stream object before returning
- `index.js`: **No changes required** (response structure unchanged)

## Implementation Code Example

### In `embyClient.js` - `getPlaybackStreams()` function:

```javascript
// After fetching PlaybackInfo and iterating MediaSources

const CODEC_FORMAT_MAP = {
  'subrip': 'srt',
  'webvtt': 'vtt',
  'ass': 'ass',
  'ssa': 'ssa'
};

// Extract subtitles from MediaStreams
const subtitleStreams = mediaSource.MediaStreams.filter(s => s.Type === 'Subtitle');

const subtitles = subtitleStreams.map(sub => {
  const codec = sub.Codec?.toLowerCase();
  const format = CODEC_FORMAT_MAP[codec] || 'srt';
  
  return {
    id: `sub-${embyItem.Id}-${sub.Index}`,
    lang: sub.Language || 'und',  // Keep 3-letter code, fallback to 'und'
    url: `${config.serverUrl}/Videos/${embyItem.Id}/Subtitles/${sub.Index}/Stream.${format}?api_key=${config.accessToken}`
  };
});

// Build stream object with embedded subtitles
const stream = {
  title: streamTitle,
  name: streamName,
  url: streamUrl,
  behaviorHints: { notWebReady: true },
  subtitles: subtitles  // Embed here
};

streams.push(stream);
```

## Implementation Notes

- Subtitles are already available in the PlaybackInfo response we're fetching—no additional API calls needed
- Reuse existing `embyItem.Id`, `config.serverUrl`, and `config.accessToken` for building subtitle URLs
- Each stream object carries its own subtitle array—if returning multiple quality streams, they all share the same subtitles
- Empty subtitle arrays (`[]`) are valid when no subtitles exist
- Subtitle URLs must be publicly accessible (authentication via query parameter only)

## Testing Checklist

- [ ] Verify subtitles appear in Stremio's subtitle selector UI
- [ ] Test items with no subtitles (should return empty `subtitles: []` array)
- [ ] Test items with multiple subtitles in the same language
- [ ] Test both external (IsExternal: true) and embedded (IsExternal: false) subtitles
- [ ] Confirm subtitle URLs are accessible by opening in browser with api_key
- [ ] Verify language codes display correctly in Stremio (three-letter codes)
- [ ] Test that Stremio auto-selects subtitles based on user language preferences
- [ ] Check subtitle playback with various formats (SRT, VTT, ASS)

## Key Differences from Original Plan

1. **Critical fix**: Subtitles embedded in stream objects, not as top-level response property
2. Language codes kept as three-letter ISO 639-2 (not converted to two-letter)
3. Added codec-to-format mapping for proper file extension handling
4. Fallback to "und" instead of "en" for missing languages
5. No changes needed to `index.js` stream route handler
6. Added comprehensive testing checklist