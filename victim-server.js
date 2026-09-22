// victim-server.js
// Victim Server + Detection + Health Check + File Log + Discord

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');

const DetectionEngine = require('./detection/detectionEngine');
const HealthChecker = require('./detection/healthChecker');
const FileLogger = require('./utils/fileLogger');
const DiscordNotifier = require('./utils/discordNotifier');

// ============================================================
//  LOAD ENV (ถ้ามี)
// ============================================================
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1551667638348816494/4UTzt-_My3_zYCjT7nEqOjVWnL1gyqx-JlxLPlKuUYgV8m-zPDw1KAWy21v9omw-Fmsy';

// ============================================================
//  INIT APP
// ============================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const HOSTNAME = os.hostname();
const VICTIM_INFO = {
  hostname: HOSTNAME,
  startTime: Date.now(),
};

// ============================================================
//  INIT COMPONENTS
// ============================================================
const engine = new DetectionEngine({
  windowMs: 1000,
  maxRequests: 30,
  autoBlockScore: 50,
  blockDurationMs: 30000,
  protectionEnabled: true,
  whitelist: ['127.0.0.1', '::1'],
});

const healthChecker = new HealthChecker({
  checkIntervalMs: 5000,
  responseTimeThreshold: 1000,
  failCountThreshold: 3,
});

const fileLogger = new FileLogger({ logDir: './logs' });

const discord = new DiscordNotifier({
  webhookUrl: DISCORD_WEBHOOK,
  enabled: !!DISCORD_WEBHOOK,
});

// ============================================================
//  START HEALTH CHECKER
// ============================================================
healthChecker.start(`http://localhost:3000`);

// ============================================================
//  MIDDLEWARE — DDoS Protection
// ============================================================
const EXCLUDED = [
  '/socket.io', '/api/status', '/api/traffic', '/api/config',
  '/api/unblock', '/api/blocker', '/api/whitelist', '/api/reset',
  '/api/block', '/api/heavy', '/api/info', '/api/debug',
  '/api/logs', '/api/test-discord', '/api/health',
  '/victim.js', '/history.js', '/attacker.js', '/favicon.ico',
];

app.use((req, res, next) => {
  if (EXCLUDED.some(p => req.path.startsWith(p))) return next();

  const result = engine.inspect(req);

  if (result.action === 'block') {
    const info = engine.blocker.blocklist.get(result.ip);
    const retryAfter = info ? Math.ceil((info.unblockAt - Date.now()) / 1000) : 30;
    res.setHeader('Retry-After', retryAfter);
    res.setHeader('X-DDoS-Blocked', 'true');
    return res.status(429).json({
      error: 'Too Many Requests',
      reason: result.reason,
      retryAfter,
      blockedBy: HOSTNAME,
    });
  }

  if (result.action === 'warn') {
    res.setHeader('X-DDoS-Warning', result.reason);
  }

  next();
});

// ============================================================
//  TARGET ENDPOINTS
// ============================================================
app.get('/api/data', (req, res) => {
  const t0 = Date.now();
  let sum = 0;
  for (let i = 0; i < 500000; i++) sum += Math.sqrt(i);
  res.json({
    ok: true,
    sum: Math.floor(sum),
    computeMs: Date.now() - t0,
    servedBy: HOSTNAME,
    timestamp: Date.now(),
  });
});

app.get('/api/heavy', (req, res) => {
  const t0 = Date.now();
  let sum = 0;
  for (let i = 0; i < 5000000; i++) sum += Math.sqrt(i) * Math.sin(i);
  setTimeout(() => {
    res.json({
      ok: true,
      sum: Math.floor(sum),
      computeMs: Date.now() - t0,
      servedBy: HOSTNAME,
    });
  }, 50);
});

app.get('/api/login', (req, res) => res.json({ ok: true, servedBy: HOSTNAME }));

app.get('/api/info', (req, res) => {
  res.json({
    isVictim: true,
    hostname: HOSTNAME,
    uptime: Date.now() - VICTIM_INFO.startTime,
    endpoints: ['/api/data', '/api/heavy', '/api/login'],
    protectionEnabled: engine.config.protectionEnabled,
    health: healthChecker.getStatus().status,
  });
});

// ============================================================
//  ADMIN API
// ============================================================
app.get('/api/status', (req, res) => {
  res.json({
    ...engine.getStatus(),
    victim: VICTIM_INFO,
    health: healthChecker.getStatus(),
  });
});

app.get('/api/traffic', (req, res) => res.json(engine.getTrafficSnapshot()));

app.post('/api/config', express.json(), (req, res) => {
  res.json({ ok: true, config: engine.updateConfig(req.body) });
});

app.post('/api/unblock/:ip', (req, res) => {
  res.json({ ok: engine.unblock(req.params.ip) });
});

app.post('/api/unblock-all', (req, res) => {
  res.json({ ok: true, ips: engine.unblockAll() });
});

app.post('/api/reset', (req, res) => {
  engine.reset();
  res.json({ ok: true });
});

app.get('/api/blocker/history', (req, res) => res.json(engine.getHistory(100)));
app.get('/api/whitelist', (req, res) => res.json({ whitelist: engine.getWhitelist() }));
app.post('/api/whitelist/:ip', (req, res) => {
  engine.addWhitelist(req.params.ip);
  res.json({ ok: true, whitelist: engine.getWhitelist() });
});

app.post('/api/block/:ip', express.json(), (req, res) => {
  const { reason = 'manual', score = 100 } = req.body || {};
  res.json({ ok: true, ...engine.forceBlock(req.params.ip, reason, score) });
});

// ============================================================
//  HEALTH API
// ============================================================
app.get('/api/health', (req, res) => {
  res.json(healthChecker.getStatus());
});

// ============================================================
//  LOGS API
// ============================================================
app.get('/api/logs/dates', (req, res) => {
  res.json({ dates: fileLogger.listDates() });
});

app.get('/api/logs/summary/:date', (req, res) => {
  try {
    const summary = fileLogger.getDailySummary(req.params.date);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/:date', (req, res) => {
  try {
    const events = fileLogger.read(req.params.date);
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/download/:date', (req, res) => {
  const filepath = path.join(__dirname, 'logs', `${req.params.date}.log`);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'ไม่พบไฟล์ log' });
  }
  res.download(filepath, `${req.params.date}.log`);
});

// ============================================================
//  DISCORD TEST
// ============================================================
app.post('/api/test-discord', async (req, res) => {
  const result = await discord.test();
  res.json(result);
});

// ============================================================
//  STATIC
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  SOCKET.IO
// ============================================================
io.on('connection', (socket) => {
  console.log('🔌 Dashboard connected');
  socket.emit('status', {
    ...engine.getStatus(),
    victim: VICTIM_INFO,
    health: healthChecker.getStatus(),
  });
  socket.emit('traffic', engine.getTrafficSnapshot());

  const t = setInterval(() => {
    socket.emit('status', {
      ...engine.getStatus(),
      victim: VICTIM_INFO,
      health: healthChecker.getStatus(),
    });
    socket.emit('traffic', engine.getTrafficSnapshot());
  }, 1000);

  socket.on('disconnect', () => clearInterval(t));
});

// ============================================================
//  EVENT HANDLERS — ENGINE
// ============================================================
engine.on('blocked', (e) => {
  io.emit('blocked', e);

  // Log ลงไฟล์
  fileLogger.write('BLOCK', {
    ip: e.ip,
    reason: e.reason,
    score: e.score,
    duration: e.duration,
    hitCount: e.hitCount,
  });

  // แจ้ง Discord
  discord.ipBlocked({
    ip: e.ip,
    reason: e.reason,
    score: e.score,
    duration: e.duration,
    hitCount: e.hitCount,
  });
});

engine.on('unblocked', (e) => {
  io.emit('unblocked', e);

  fileLogger.write('UNBLOCK', {
    ip: e.ip,
    byWhom: e.reason || 'auto',
  });
});

// ============================================================
//  EVENT HANDLERS — HEALTH CHECKER
// ============================================================
healthChecker.on('statusChange', (e) => {
  console.log(`💚 Health: ${e.oldStatus} → ${e.newStatus}`);

  io.emit('health:change', e);

  fileLogger.write('HEALTH_CHANGE', {
    oldStatus: e.oldStatus,
    newStatus: e.newStatus,
    responseTime: e.responseTime,
    consecutiveFails: e.consecutiveFails,
  });

  // Discord alerts
  if (e.newStatus === 'down') {
    discord.serverDown(e.responseTime, e.consecutiveFails);
  } else if (e.newStatus === 'degraded') {
    discord.serverDegraded(e.responseTime);
  } else if (e.newStatus === 'healthy' && e.oldStatus !== 'healthy') {
    discord.serverRecovered(e.oldStatus);
  }
});

// ============================================================
//  PERIODIC LOGGING & MONITORING
// ============================================================

// Traffic snapshot ทุก 10 วิ
setInterval(() => {
  const traffic = engine.getTrafficSnapshot();
  const status = engine.getStatus();

  let totalRps = 0;
  for (const ip in traffic) {
    totalRps += traffic[ip].reqPerSec;
  }

  fileLogger.write('TRAFFIC_SNAPSHOT', {
    rps: totalRps,
    total: status.stats.totalRequests,
    blocked: status.stats.blockedRequests,
    suspicious: status.stats.suspiciousRequests,
    trackedIPs: status.trackedCount,
  });
}, 10000);

// ตรวจ Traffic ผิดปกติทุก 15 วิ
let lastTrafficAlert = 0;
setInterval(() => {
  const traffic = engine.getTrafficSnapshot();
  let totalRps = 0;
  for (const ip in traffic) totalRps += traffic[ip].reqPerSec;

  const threshold = engine.config.maxRequests;

  if (totalRps > threshold * 3 && Date.now() - lastTrafficAlert > 60000) {
    lastTrafficAlert = Date.now();
    discord.abnormalTraffic({
      rps: totalRps,
      threshold,
      direction: 'high',
    });
  }
}, 15000);

// Daily summary (23:59)
function scheduleDailySummary() {
  const now = new Date();
  const target = new Date();
  target.setHours(23, 59, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);

  const delay = target - now;
  setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    const summary = fileLogger.getDailySummary(today);

    discord.dailySummary({
      date: today,
      blocks: summary.blocks,
      warns: summary.warns,
      attacks: summary.attacks,
      peakRps: summary.peakRps,
      uniqueIPs: summary.uniqueIPs.length,
      totalRequests: summary.totalRequests,
    });

    // ลบ log เก่ากว่า 30 วัน
    fileLogger.cleanup(30);

    scheduleDailySummary();
  }, delay);
}
scheduleDailySummary();

// ============================================================
//  SHUTDOWN
// ============================================================
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  healthChecker.destroy();
  engine.destroy();
  server.close(() => process.exit(0));
});

// ============================================================
//  START
// ============================================================
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  Object.values(ifaces).forEach(arr => arr.forEach(i => {
    if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }));

  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   🎯 VICTIM SERVER v5.0                       ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║   Hostname: ${HOSTNAME}`.padEnd(48) + '║');
  console.log(`║   Local:    http://localhost:${PORT}             ║`);
  ips.forEach(ip => {
    console.log(`║   Network:  http://${ip}:${PORT}`.padEnd(48) + '║');
  });
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`⚙️  Protection:     ${engine.config.protectionEnabled ? 'ON ✅' : 'OFF ❌'}`);
  console.log(`⚙️  maxRequests:    ${engine.config.maxRequests} req/s`);
  console.log(`⚙️  autoBlockScore: ${engine.config.autoBlockScore}`);
  console.log(`⚙️  Health Check:   ทุก ${healthChecker.checkIntervalMs / 1000} วิ`);
  console.log(`⚙️  File Log:       ./logs/`);
  console.log(`⚙️  Discord:        ${discord.enabled ? 'ENABLED ✅' : 'DISABLED ❌'}`);
  console.log('');
  console.log(`👉 Dashboard:  http://${ips[0] || 'localhost'}:${PORT}/victim.html`);
  console.log(`👉 History:    http://${ips[0] || 'localhost'}:${PORT}/history.html`);
  console.log('');
});
