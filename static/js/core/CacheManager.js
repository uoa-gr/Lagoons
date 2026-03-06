/**
 * CacheManager - TTL-based caching layer
 */

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.stats = { hits: 0, misses: 0, sets: 0, invalidations: 0 };
    }

    set(key, value, ttl = null) {
        if (!key) { console.error('CacheManager.set: Key is required'); return; }
        this.cache.set(key, { value, timestamp: Date.now(), ttl });
        this.stats.sets++;
        if (window.DEBUG_MODE) console.log(`💾 CacheManager: Set "${key}"`);
    }

    get(key) {
        if (!this.cache.has(key)) { this.stats.misses++; return undefined; }
        const entry = this.cache.get(key);
        if (entry.ttl !== null) {
            const age = Date.now() - entry.timestamp;
            if (age > entry.ttl) { this.cache.delete(key); this.stats.misses++; return undefined; }
        }
        this.stats.hits++;
        return entry.value;
    }

    has(key) {
        if (!this.cache.has(key)) return false;
        const entry = this.cache.get(key);
        if (entry.ttl !== null && (Date.now() - entry.timestamp) > entry.ttl) {
            this.cache.delete(key); return false;
        }
        return true;
    }

    invalidate(key) {
        const deleted = this.cache.delete(key);
        if (deleted) this.stats.invalidations++;
        return deleted;
    }

    invalidateAll() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats.invalidations += size;
    }

    invalidatePattern(pattern) {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        let count = 0;
        for (const key of this.cache.keys()) {
            if (regex.test(key)) { this.cache.delete(key); count++; }
        }
        this.stats.invalidations += count;
        return count;
    }

    cleanup() {
        let count = 0;
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (entry.ttl !== null && (now - entry.timestamp) > entry.ttl) {
                this.cache.delete(key); count++;
            }
        }
        return count;
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
        return { ...this.stats, total, hitRate: `${hitRate}%`, size: this.cache.size, keys: Array.from(this.cache.keys()) };
    }

    resetStats() {
        this.stats = { hits: 0, misses: 0, sets: 0, invalidations: 0 };
    }
}

export default CacheManager;
