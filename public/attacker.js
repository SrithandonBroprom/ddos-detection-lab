// public/attacker.js
const socket = io();
const $ = (id) => document.getElementById(id);

let selectedTarget = null;
let currentAttackId = null;

// ===== Socket =====
socket.on('connect', () => {
  $('connBadge').textContent = '🟢 พร้อม';
  $('connBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-green-500';
});
socket.on('disconnect', () => {
  $('connBadge').textContent = '⚪ หลุด';
  $('connBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-gray-500';
});

socket.on('scan:start', (d) => {
  $('scanProgress').classList.remove('hidden');
  $('scanStatus').textContent = `กำลังสแกน port ${d.port}...`;
  $('scanBar').style.width = '0%';
  log(`🔍 เริ่มสแกน port ${d.port}`);
});

socket.on('scan:progress', (p) => {
  const pct = Math.round((p.scanned / p.total) * 100);
  $('scanBar').style.width = pct + '%';
  $('scanText').textContent = `${p.scanned} / ${p.total} IPs (พบ ${p.found})`;
});

socket.on('scan:found', (v) => {
  log(`✅ พบเป้าหมาย: ${v.ip} (${v.hostname})`);
});

socket.on('scan:done', (d) => {
  $('scanStatus').textContent = `เสร็จ — พบ ${d.total} เป้าหมาย`;
  renderTargets(d.victims);
  log(`🏁 สแกนเสร็จ พบ ${d.total} เป้าหมาย`);
});

socket.on('scan:error', (e) => {
  $('scanStatus').textContent = `❌ ${e.message}`;
  log(`❌ สแกนล้มเหลว: ${e.message}`);
});

socket.on('attack:start', (d) => {
  log(`⚔️ เริ่มโจมตี ${d.targetIP}${d.endpoint} (${d.total} req)`);
  $('btnAttack').disabled = true;
  $('btnStop').disabled = false;
  resetResults();
});

socket.on('attack:progress', (p) => {
  $('resSent').textContent = p.sent;
  $('resOk').textContent = p.ok;
  $('resBlocked').textContent = p.blocked;
  $('resRps').textContent = p.rps;
});

socket.on('attack:done', (s) => {
  log(`🏁 เสร็จ: ${s.total} req | OK=${s.ok} | Blocked=${s.blocked} | ${s.avgRps} req/s`);
  $('btnAttack').disabled = false;
  $('btnStop').disabled = true;
  currentAttackId = null;
});

// ===== Scan =====
$('btnScan').onclick = async () => {
  const port = parseInt($('scanPort').value);
  $('btnScan').disabled = true;
  $('targetsList').innerHTML = '<div class="col-span-full text-center text-gray-500 py-6 text-sm">กำลังสแกน...</div>';
  log(`🔍 เริ่มสแกน port ${port}`);

  try {
    await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port }),
    });
  } catch (e) {
    log(`❌ ${e.message}`);
  } finally {
    setTimeout(() => { $('btnScan').disabled = false; }, 30000);
  }
};

function renderTargets(victims) {
  const list = $('targetsList');
  $('targetCount').textContent = victims.length;

  if (victims.length === 0) {
    list.innerHTML = '<div class="col-span-full text-center text-gray-500 py-6 text-sm">ไม่พบเป้าหมาย — ลองสแกนใหม่</div>';
    return;
  }

  list.innerHTML = victims.map(v => `
    <div class="target-card bg-gray-900 rounded-lg p-4 border-2 border-gray-700 hover:border-red-500 cursor-pointer transition"
         onclick="selectTarget('${v.ip}', ${v.port}, '${escapeHtml(v.hostname)}')">
      <div class="flex items-center justify-between mb-2">
        <span class="font-mono text-lg font-bold text-red-400">${v.ip}</span>
        <span class="text-xs bg-gray-700 px-2 py-0.5 rounded">:${v.port}</span>
      </div>
      <div class="text-sm text-gray-300 mb-1">🖥️ ${escapeHtml(v.hostname)}</div>
      <div class="text-xs text-gray-500">
        Protection: ${v.protectionEnabled ? '<span class="text-green-400">ON</span>' : '<span class="text-red-400">OFF</span>'}
      </div>
      <div class="text-xs text-gray-500 mt-1">
        ${v.endpoints?.length || 0} endpoints
      </div>
    </div>
  `).join('');
}

window.selectTarget = (ip, port, hostname) => {
  selectedTarget = { ip, port, hostname };
  $('selectedTargetIP').textContent = `${ip}:${port} (${hostname})`;
  $('btnAttack').disabled = false;

  // Highlight
  document.querySelectorAll('.target-card').forEach(el => {
    el.classList.remove('border-red-500', 'bg-red-900/30');
    el.classList.add('border-gray-700');
  });
  event.currentTarget.classList.remove('border-gray-700');
  event.currentTarget.classList.add('border-red-500', 'bg-red-900/30');

  log(`🎯 เลือกเป้าหมาย: ${ip}`);
};

// ===== Attack =====
$('btnAttack').onclick = async () => {
  if (!selectedTarget) return;

  const endpoint = $('attackEndpoint').value;
  const total = parseInt($('attackTotal').value);
  const concurrency = parseInt($('attackConc').value);

  try {
    const res = await fetch('/api/attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetIP: selectedTarget.ip,
        targetPort: selectedTarget.port,
        endpoint, total, concurrency,
      }),
    });
    const data = await res.json();
    if (data.attackId) currentAttackId = data.attackId;
  } catch (e) {
    log(`❌ ${e.message}`);
  }
};

$('btnStop').onclick = async () => {
  if (!currentAttackId) return;
  await fetch('/api/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attackId: currentAttackId }),
  });
  log('⏹️ ส่งคำสั่งหยุด');
};

function resetResults() {
  $('resSent').textContent = '0';
  $('resOk').textContent = '0';
  $('resBlocked').textContent = '0';
  $('resRps').textContent = '0';
}

function log(msg) {
  const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
  const div = document.createElement('div');
  div.textContent = `[${time}] ${msg}`;
  $('logBox').prepend(div);
  while ($('logBox').children.length > 100) $('logBox').removeChild($('logBox').lastChild);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// โหลด targets ที่มีอยู่
fetch('/api/targets').then(r => r.json()).then(d => {
  if (d.targets?.length) renderTargets(d.targets);
});
