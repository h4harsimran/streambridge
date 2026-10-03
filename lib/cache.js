/**
 * StreamBridge - Lightweight In-Memory LRU Cache with TTL
 * 100% stateless-safe: acts purely as a performance accelerator.
 * Missing or expired entries automatically fall back to querying the backend.
 */

class SimpleLRUCache {
  /**
   * @param {number} [maxSize=1000] - Maximum number of items in the cache.
   * @param {number} [defaultTtlMs=300000] - Default TTL in milliseconds (default 5 min).
   */
  constructor(maxSize = 1000, defaultTtlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU position by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    const ttl = typeof ttlMs === "number" ? ttlMs : this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest item (first key in insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
    return value;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

// Pre-configured cache stores
const mediaSourceCache = new SimpleLRUCache(1000, 2 * 60 * 60 * 1000); // 2 hours
const itemLookupCache  = new SimpleLRUCache(1000, 60 * 60 * 1000);      // 1 hour
const hierarchyCache   = new SimpleLRUCache(500,  30 * 60 * 1000);      // 30 min
const streamCache      = new SimpleLRUCache(200,   2 * 60 * 1000);      // 2 min

module.exports = {
  SimpleLRUCache,
  mediaSourceCache,
  itemLookupCache,
  hierarchyCache,
  streamCache
};
