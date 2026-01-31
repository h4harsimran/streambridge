/**
 * Redact server URL for safe logging. Never log user's host, domain, path,
 * or any credentials that might appear in the URL (e.g. user:pass@host).
 * @param {string} url - Raw URL (e.g. serverUrl from request).
 * @returns {string} Always "[SERVER]" for any URL-like or invalid input.
 */
function redactServerUrl(url) {
  if (url == null || typeof url !== "string") return "[SERVER]";
  const trimmed = url.trim();
  if (trimmed === "") return "[SERVER]";
  // Redact entire URL so we never leak host, port, path, or userinfo (user:pass@host)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return "[SERVER]";
  }
  return "[SERVER]";
}

module.exports = { redactServerUrl };
