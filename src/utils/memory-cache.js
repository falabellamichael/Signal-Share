/**
 * Memory Cache Manager
 * Implements LRU (Least Recently Used) cache with eviction policy
 */
class MemoryCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.usageHistory = [];
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    // Move to front for LRU
    this.usageHistory = [key, ...this.usageHistory.filter(k => k !== key)];

    return this.cache.get(key);
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      return;
    }

    if (this.cache.size >= this.maxSize) {
      // Evict least recently used item
      const evictedKey = this.usageHistory.pop();
      this.cache.delete(evictedKey);
    }

    this.cache.set(key, value);
    this.usageHistory.push(key);
  }

  clear() {
    this.cache.clear();
    this.usageHistory = [];
  }
}

export default new MemoryCache();