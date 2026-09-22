// detection/detectionEngine.js
const EventEmitter = require('events');
const Blocker = require('./blocker');

class DetectionEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      windowMs: config.windowMs || 1000,
      maxRequests: config.maxRequests || 30,
      autoBlockScore: config.autoBlockScore || 50,
      blockDurationMs: config.blockDurationMs || 30000,
      whitelist: config.whitelist || ['127.0.0.1', '::1'],
      protectionEnabled: config.protectionEnabled !== false,
      debug: config.debug || false,
    };

    this.ipData = new Map();
    this.blocker = new Blocker({
      defaultDurationMs: this.config.blockDurationMs,
      whitelist: this.config.whitelist,
    });

    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      suspiciousRequests: 0,
      startTime: Date.now(),
    };

    this.blocker.on('blocked', (e) => this.emit('blocked', e));
    this.blocker.on('unblocked', (e) => this.emit('unblocked', e));

    this.checkTimer = setInterval(() => this._periodicCheck(), 1000);
    this.cleanupTimer = setInterval(() => this._cleanup(), 30000);
  }

  inspect(req) {
    const ip = this._extractIP(req);
    this.stats.totalRequests++;

    if (this.blocker.isWhitelisted(ip)) {
      return { action: 'allow', ip, reason: 'whitelist' };
    }
    if (this.blocker.isBlocked(ip)) {
      this.stats.blockedRequests++;
      return { action: 'block', ip, reason: 'IP ถูกบล็อกอยู่' };
    }
    if (!this.config.protectionEnabled) {
      this._track(ip, req);
      return { action: 'allow', ip, reason: 'protection_off' };
    }

    this._track(ip, req);
    const analysis = this._analyze(ip);

    if (analysis.score >= this.config.autoBlockScore) {
      this.blocker.block(ip, analysis.reason, analysis.score);
      this.stats.blockedRequests++;
      this.stats.suspiciousRequests++;
      return { action: 'block', ip, reason: analysis.reason, score: analysis.score };
    }
    if (analysis.score >= this.config.autoBlockScore * 0.6) {
      this.stats.suspiciousRequests++;
      return { action: 'warn', ip, reason: analysis.reason, score: analysis.score };
    }
    return { action: 'allow', ip, score: analysis.score };
  }

  _track(ip, req) {
    const now = Date.now();
    let data = this.ipData.get(ip);
    if (!data) {
      data = {
        timestamps: [], userAgents: new Set(),
        paths: new Map(), methods: new Map(),
        firstSeen: now, lastSeen: now, totalRequests: 0,
      };
      this.ipData.set(ip, data);
    }
    data.timestamps.push(now);
    data.lastSeen = now;
    data.totalRequests++;
    data.userAgents.add(req.headers['user-agent'] || '');
    const p = req.path || '/';
    data.paths.set(p, (data.paths.get(p) || 0) + 1);
    data.methods.set(req.method, (data.methods.get(req.method) || 0) + 1);
    if (data.timestamps.length > 300) data.timestamps = data.timestamps.slice(-300);
  }

  _analyze(ip) {
    const data = this.ipData.get(ip);
    if (!data) return { score: 0, reason: 'no_data' };

    const now = Date.now();
    const w = this.config.windowMs;
    const recentReqs = data.timestamps.filter(t => now - t < w).length;

    const rateRatio = recentReqs / this.config.maxRequests;
    let rateScore = 0;
    if (rateRatio >= 3) rateScore = 80;
    else if (rateRatio >= 2) rateScore = 70;
    else if (rateRatio >= 1) rateScore = 50;
    else if (rateRatio >= 0.7) rateScore = 25;
    else rateScore = 5;

    const flags = [];
    if (recentReqs >= this.config.maxRequests) flags.push(`rate=${recentReqs}/${w}ms`);

    let patternScore = 0;

    const pathVals = Array.from(data.paths.values());
    const totalPathReqs = pathVals.reduce((a, b) => a + b, 0);
    if (totalPathReqs > 20) {
      const concentration = Math.max(...pathVals) / totalPathReqs;
      if (concentration > 0.95) { patternScore += 15; flags.push('single_path'); }
    }

    if (data.totalRequests > 20 && data.methods.size === 1) {
      patternScore += 10; flags.push('single_method');
    }

    const uas = Array.from(data.userAgents).filter(Boolean);
    if (uas.length === 1 && data.totalRequests > 20) {
      const ua = uas[0];
      patternScore += 10; flags.push('single_ua');
      if (/curl|wget|python|node|bot|scanner|ab\//i.test(ua)) {
        patternScore += 15; flags.push('non_browser_ua');
      }
    }

    if (data.totalRequests > 30 && recentReqs > 20) {
      patternScore += 10; flags.push('high_freq');
    }

    patternScore = Math.min(patternScore, 100);

    let score = Math.max(rateScore, patternScore);
    if (rateScore >= 50 && patternScore >= 30) score = Math.min(score + 20, 100);

    const reason = flags.length > 0 ? flags.join(',') : `score=${score}`;

    return { score, reason, flags, recentReqs, rateScore, patternScore };
  }

  _periodicCheck() {
    if (!this.config.protectionEnabled) return;
    const now = Date.now();
    for (const [ip, data] of this.ipData.entries()) {
      if (this.blocker.isBlocked(ip) || this.blocker.isWhitelisted(ip)) continue;
      if (now - data.lastSeen > 5000) continue;
      const analysis = this._analyze(ip);
      if (analysis.score >= this.config.autoBlockScore) {
        this.blocker.block(ip, `periodic:${analysis.reason}`, analysis.score);
      }
    }
  }

  _cleanup() {
    const now = Date.now();
    for (const [ip, data] of this.ipData.entries()) {
      if (now - data.lastSeen > 120000) this.ipData.delete(ip);
    }
  }

  _extractIP(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
    let ip = req.socket?.remoteAddress || req.ip || 'unknown';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return ip;
  }

  getStatus() {
    const blocked = this.blocker.getActive();
    return {
      stats: { ...this.stats },
      blockedCount: blocked.length,
      blockedIPs: blocked,
      trackedCount: this.ipData.size,
      whitelist: this.blocker.getWhitelist(),
      protectionEnabled: this.config.protectionEnabled,
      config: {
        maxRequests: this.config.maxRequests,
        windowMs: this.config.windowMs,
        autoBlockScore: this.config.autoBlockScore,
        blockDurationMs: this.config.blockDurationMs,
      },
      uptime: Date.now() - this.stats.startTime,
    };
  }

  getTrafficSnapshot() {
    const now = Date.now();
    const w = this.config.windowMs;
    const snapshot = {};
    for (const [ip, data] of this.ipData.entries()) {
      const recentReqs = data.timestamps.filter(t => now - t < w).length;
      const analysis = this._analyze(ip);
      snapshot[ip] = {
        reqPerSec: recentReqs,
        totalRequests: data.totalRequests,
        isBlocked: this.blocker.isBlocked(ip),
        isWhitelisted: this.blocker.isWhitelisted(ip),
        score: analysis.score,
        lastSeen: data.lastSeen,
      };
    }
    return snapshot;
  }

  updateConfig(updates) {
    if (updates.maxRequests) this.config.maxRequests = updates.maxRequests;
    if (updates.autoBlockScore) this.config.autoBlockScore = updates.autoBlockScore;
    if (updates.blockDurationMs) {
      this.config.blockDurationMs = updates.blockDurationMs;
      this.blocker.defaultDurationMs = updates.blockDurationMs;
    }
    if (typeof updates.protectionEnabled === 'boolean') {
      this.config.protectionEnabled = updates.protectionEnabled;
    }
    if (typeof updates.debug === 'boolean') this.config.debug = updates.debug;
    this.emit('config_updated', this.config);
    return this.config;
  }

  unblock(ip) { return this.blocker.unblock(ip); }
  unblockAll() { return this.blocker.unblockAll(); }
  getHistory(limit) { return this.blocker.getHistory(limit); }
  addWhitelist(ip) { this.blocker.addWhitelist(ip); }
  removeWhitelist(ip) { this.blocker.removeWhitelist(ip); }
  getWhitelist() { return this.blocker.getWhitelist(); }
  forceBlock(ip, reason, score) {
    return this.blocker.block(ip, reason || 'manual', score || 100);
  }

  reset() {
    this.ipData.clear();
    this.blocker.reset();
    this.stats = {
      totalRequests: 0, blockedRequests: 0,
      suspiciousRequests: 0, startTime: Date.now(),
    };
  }

  destroy() {
    clearInterval(this.checkTimer);
    clearInterval(this.cleanupTimer);
    this.removeAllListeners();
  }
}

module.exports = DetectionEngine;