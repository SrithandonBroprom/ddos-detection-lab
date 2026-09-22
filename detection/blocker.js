// detection/blocker.js
const EventEmitter = require('events');

class Blocker extends EventEmitter {
  constructor({
    defaultDurationMs = 30000,
    maxDurationMs = 300000,
    escalationFactor = 2,
    whitelist = ['127.0.0.1', '::1'],
  } = {}) {
    super();
    this.defaultDurationMs = defaultDurationMs;
    this.maxDurationMs = maxDurationMs;
    this.escalationFactor = escalationFactor;
    this.whitelist = new Set(whitelist);
    this.blocklist = new Map();
    this.history = [];
    this.stats = { totalBlocks: 0, currentBlocked: 0 };
  }

  isWhitelisted(ip) { return this.whitelist.has(ip); }

  isBlocked(ip) {
    if (this.isWhitelisted(ip)) return false;
    const entry = this.blocklist.get(ip);
    if (!entry) return false;
    if (Date.now() >= entry.unblockAt) {
      this.blocklist.delete(ip);
      this.stats.currentBlocked = this.blocklist.size;
      this.emit('unblocked', { ip, timestamp: Date.now(), reason: 'expired' });
      return false;
    }
    return true;
  }

  block(ip, reason, score = 100) {
    if (this.isWhitelisted(ip)) {
      return { blocked: false, reason: 'whitelisted' };
    }
    const now = Date.now();
    const existing = this.blocklist.get(ip);
    let duration;

    if (existing) {
      const prevDur = existing.unblockAt - existing.blockedAt;
      duration = Math.min(prevDur * this.escalationFactor, this.maxDurationMs);
    } else {
      duration = this.defaultDurationMs;
    }

    const entry = {
      ip, reason, score,
      blockedAt: existing?.blockedAt || now,
      unblockAt: now + duration,
      hitCount: (existing?.hitCount || 0) + 1,
    };
    this.blocklist.set(ip, entry);
    this.stats.totalBlocks++;
    this.stats.currentBlocked = this.blocklist.size;

    const log = {
      timestamp: now, ip, reason, score, duration,
      hitCount: entry.hitCount, action: 'block',
    };
    this.history.unshift(log);
    if (this.history.length > 500) this.history.pop();

    this.emit('blocked', log);
    console.log(`🚫 BLOCKED ${ip} | ${reason} | ${(duration/1000).toFixed(0)}s`);
    return { blocked: true, ...log };
  }

  unblock(ip) {
    const existed = this.blocklist.delete(ip);
    if (existed) {
      this.stats.currentBlocked = this.blocklist.size;
      this.emit('unblocked', { ip, timestamp: Date.now(), reason: 'manual' });
    }
    return existed;
  }

  unblockAll() {
    const ips = Array.from(this.blocklist.keys());
    this.blocklist.clear();
    this.stats.currentBlocked = 0;
    ips.forEach(ip => this.emit('unblocked', { ip, timestamp: Date.now(), reason: 'manual_all' }));
    return ips;
  }

  getActive() {
    const now = Date.now();
    return Array.from(this.blocklist.entries())
      .filter(([, v]) => v.unblockAt > now)
      .map(([ip, v]) => ({
        ip, reason: v.reason, score: v.score, hitCount: v.hitCount,
        blockedAt: v.blockedAt, unblockAt: v.unblockAt, remainingMs: v.unblockAt - now,
      }));
  }

  getHistory(limit = 50) { return this.history.slice(0, limit); }
  addWhitelist(ip) { this.whitelist.add(ip); this.unblock(ip); }
  removeWhitelist(ip) { this.whitelist.delete(ip); }
  getWhitelist() { return Array.from(this.whitelist); }
  reset() {
    this.blocklist.clear();
    this.history = [];
    this.stats = { totalBlocks: 0, currentBlocked: 0 };
  }
}

module.exports = Blocker;