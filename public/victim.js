// public/victim.js
// Victim Dashboard — Real-time + Health + Chart 2 modes + Log

const socket = io();
const $ = (id) => document.getElementById(id);

// =====================================================
//  STATE
// =====================================================
let chartMode = 'rps';        // 'rps' | 'total'
let peakValue = 0;
let currentValue = 0;
const MAX_POINTS = 40;

// =====================================================
//  CHART INIT
// =====================================================
const ctx = $('trafficChart').getContext('2d');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'ปกติ',
        data: [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
      {
        label: 'น่าสงสัย',
        data: [],
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
      {
        label: 'ถูกบล็อก',
        data: [],
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    interaction: { intersect: false, mode: 'index' },
    scales: {
      y: {
        beginAtZero: true,
        grace: '10%',
        title: { display: true, text: 'req/s' },
        ticks: {
          callback: function (value) {
            if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
            return value;
          },
        },
      },
      x: {
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 15,
          font: { size: 10 },
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function (context) {
            const v = context.parsed.y;
            const unit = chartMode === 'total' ? 'req' : 'req/s';
            return `${context.dataset.label}: ${v.toLocaleString()} ${unit}`;
          },
        },
      },
    },
  },
});

// =====================================================
//  SOCKET EVENTS
// =====================================================
socket.on('connect', () => {
  $('connBadge').textContent = '🟢 เชื่อมต่อแล้ว';
  $('connBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-green-500';
});

socket.on('disconnect', () => {
  $('connBadge').textContent = '⚪ หลุด';
  $('connBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-gray-500';
});

socket.on('status', updateStatus);
socket.on('traffic', updateTraffic);
socket.on('blocked', (e) => addLog('🚫', e));
socket.on('unblocked', (e) => addLog('✅', e));
socket.on('health:change', (e) => {
  console.log('Health change:', e);
  addLog('💚', {
    timestamp: e.timestamp,
    ip: '—',
    reason: `${e.oldStatus} → ${e.newStatus} (${e.responseTime}ms)`,
  });
});

// =====================================================
//  UPDATE STATUS
// =====================================================
function updateStatus(s) {
  // Hostname
  if (s.victim?.hostname) {
    $('hostname').textContent = s.victim.hostname;
  }

  // Stats
  $('statTotal').textContent = formatNum(s.stats.totalRequests);
  $('statSuspicious').textContent = formatNum(s.stats.suspiciousRequests);
  $('statBlocked').textContent = formatNum(s.blockedCount);
  $('statTracked').textContent = formatNum(s.trackedCount);

  // Config
  $('cfgMax').textContent = s.config.maxRequests;
  $('cfgScore').textContent = s.config.autoBlockScore;

  // Counts
  $('blockedCount').textContent = s.blockedCount;
  $('trackedCount').textContent = s.trackedCount;

  // Protection toggle
  const pOn = s.protectionEnabled;
  $('protectionOn').checked = pOn;
  $('protectionStatus').textContent = pOn ? '✅ เปิดใช้งาน' : '❌ ปิดใช้งาน';
  $('protectionStatus').className = pOn ? 'text-xs text-green-600' : 'text-xs text-red-600';

  // Attack banner
  const underAttack = s.blockedCount > 0;
  $('attackBanner').classList.toggle('hidden', !underAttack);
  if (underAttack) {
    const ips = s.blockedIPs.map(b => b.ip).join(', ');
    $('attackInfo').textContent = `ถูกบล็อก ${s.blockedCount} IP: ${ips}`;
  }

  // Status badge
  if (underAttack) {
    $('statusBadge').textContent = '🚨 ถูกโจมตี';
    $('statusBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-red-500 animate-pulse';
  } else if (s.stats.suspiciousRequests > 0) {
    $('statusBadge').textContent = '⚠️ น่าสงสัย';
    $('statusBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-500';
  } else {
    $('statusBadge').textContent = '● ปกติ';
    $('statusBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-green-500';
  }

  // Health
  if (s.health) {
    updateHealthUI(s.health);
  }

  // Blocked table
  renderBlocked(s.blockedIPs);
}

// =====================================================
//  UPDATE HEALTH UI
// =====================================================
function updateHealthUI(health) {
  if (!health) return;

  const card = $('healthCard');
  const icon = $('healthIcon');
  const text = $('healthStatusText');
  const rt = $('healthRT');
  const min = $('healthMin');
  const max = $('healthMax');
  const checks = $('healthChecks');
  const badge = $('healthBadge');

  const status = health.status || 'unknown';
  const avgRT = health.avgResponseTime || 0;
  const lastRT = health.lastResponseTime || 0;

  text.textContent = status;
  rt.textContent = avgRT + 'ms';
  if (min) min.textContent = (health.minResponseTime === Infinity ? 0 : health.minResponseTime) + 'ms';
  if (max) max.textContent = (health.maxResponseTime || 0) + 'ms';
  if (checks) checks.textContent = (health.totalChecks || 0).toString();

  $('statRT').textContent = lastRT + 'ms';

  // Style by status
  card.className = 'mt-4 p-3 rounded-lg border-2 transition';
  badge.className = 'px-3 py-1 rounded-full text-xs font-bold';

  if (status === 'healthy') {
    card.classList.add('border-green-200', 'bg-green-50');
    icon.textContent = '💚';
    badge.classList.add('bg-green-500');
    badge.textContent = '💚 Healthy';
  } else if (status === 'degraded') {
    card.classList.add('border-amber-200', 'bg-amber-50');
    icon.textContent = '⚠️';
    badge.classList.add('bg-amber-500');
    badge.textContent = '⚠️ Degraded';
  } else if (status === 'down') {
    card.classList.add('border-red-200', 'bg-red-50', 'animate-pulse');
    icon.textContent = '🚨';
    badge.classList.add('bg-red-500', 'animate-pulse');
    badge.textContent = '🚨 DOWN';
  } else {
    card.classList.add('border-gray-200', 'bg-gray-50');
    icon.textContent = '❓';
    badge.classList.add('bg-gray-500');
    badge.textContent = '❓ Unknown';
  }
}

// =====================================================
//  UPDATE TRAFFIC + CHART
// =====================================================
function updateTraffic(traffic) {
  let normalRps = 0, suspiciousRps = 0, blockedRps = 0;
  let normalTotal = 0, suspiciousTotal = 0, blockedTotal = 0;
  const rows = [];

  for (const ip in traffic) {
    const d = traffic[ip];
    const total = d.totalRequests || 0;

    if (d.isBlocked) {
      blockedRps += d.reqPerSec;
      blockedTotal += total;
    } else if (d.score >= 30) {
      suspiciousRps += d.reqPerSec;
      suspiciousTotal += total;
    } else {
      normalRps += d.reqPerSec;
      normalTotal += total;
    }

    rows.push({ ip, ...d });
  }
  rows.sort((a, b) => b.reqPerSec - a.reqPerSec);

  // ===== Render Traffic Table =====
  if (rows.length === 0) {
    $('trafficTable').innerHTML = '';
    $('trafficEmpty').style.display = 'block';
  } else {
    $('trafficEmpty').style.display = 'none';
    $('trafficTable').innerHTML = rows.map(r => {
      let badge = '';
      if (r.isBlocked) badge = '<span class="text-red-600 font-bold">🚫 บล็อก</span>';
      else if (r.isWhitelisted) badge = '<span class="text-green-600">✅ wl</span>';
      else if (r.score >= 30) badge = '<span class="text-amber-600">⚠️ สงสัย</span>';
      else badge = '<span class="text-green-600">ปกติ</span>';

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-2 font-mono text-xs">${escapeHtml(r.ip)}</td>
          <td class="text-right font-bold ${r.reqPerSec > 30 ? 'text-red-600' : ''}">${r.reqPerSec}</td>
          <td class="text-right text-xs text-gray-600">${formatNum(r.totalRequests || 0)}</td>
          <td class="text-right">${r.score}</td>
          <td class="text-center text-xs">${badge}</td>
        </tr>
      `;
    }).join('');
  }

  // ===== Chart Data =====
  const label = new Date().toLocaleTimeString('th-TH', { hour12: false });

  let dataNormal, dataSuspicious, dataBlocked;
  if (chartMode === 'rps') {
    dataNormal = normalRps;
    dataSuspicious = suspiciousRps;
    dataBlocked = blockedRps;
  } else {
    dataNormal = normalTotal;
    dataSuspicious = suspiciousTotal;
    dataBlocked = blockedTotal;
  }

  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(dataNormal);
  chart.data.datasets[1].data.push(dataSuspicious);
  chart.data.datasets[2].data.push(dataBlocked);

  if (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(d => d.data.shift());
  }

  chart.update('none');

  // ===== Stats =====
  const totalRps = normalRps + suspiciousRps + blockedRps;
  $('statRps').textContent = totalRps;

  // Peak / Current
  const cv = chartMode === 'rps' ? totalRps : (normalTotal + suspiciousTotal + blockedTotal);
  currentValue = cv;
  if (cv > peakValue) peakValue = cv;

  $('chartPeak').textContent = formatNum(peakValue);
  $('chartCurrent').textContent = formatNum(currentValue);

  const unit = chartMode === 'rps' ? 'req/s' : 'req';
  $('chartPeakUnit').textContent = unit;
  $('chartCurrentUnit').textContent = unit;

  // Debug log (ทุก ~10 ครั้ง)
  if (Math.random() < 0.1) {
    console.log('[Chart]', {
      mode: chartMode,
      normal: dataNormal,
      suspicious: dataSuspicious,
      blocked: dataBlocked,
      totalRps,
    });
  }
}

// =====================================================
//  RENDER BLOCKED
// =====================================================
function renderBlocked(list) {
  if (!list || list.length === 0) {
    $('blockedTable').innerHTML = '';
    $('blockedEmpty').style.display = 'block';
    return;
  }

  $('blockedEmpty').style.display = 'none';
  $('blockedTable').innerHTML = list.map(b => `
    <tr class="border-b hover:bg-red-50">
      <td class="py-2 font-mono text-xs font-bold text-red-700">${escapeHtml(b.ip)}</td>
      <td class="text-xs text-gray-600" title="${escapeHtml(b.reason)}">${truncate(b.reason, 25)}</td>
      <td class="text-right text-xs font-bold ${b.score >= 60 ? 'text-red-600' : 'text-amber-600'}">${b.score}</td>
      <td class="text-right text-xs text-red-600 font-bold">${Math.ceil(b.remainingMs/1000)}s</td>
      <td class="text-right">
        <button class="text-xs text-blue-600 hover:underline" onclick="unblock('${escapeHtml(b.ip)}')">ปลด</button>
      </td>
    </tr>
  `).join('');
}

window.unblock = async (ip) => {
  await fetch(`/api/unblock/${encodeURIComponent(ip)}`, { method: 'POST' });
};

// =====================================================
//  LOG
// =====================================================
function addLog(icon, data) {
  const time = new Date(data.timestamp).toLocaleTimeString('th-TH', { hour12: false });
  const div = document.createElement('div');

  let color = 'text-green-400';
  if (icon === '🚫') color = 'text-red-400';
  else if (icon === '💚') color = 'text-purple-300';

  const dur = data.duration ? ` [${(data.duration/1000).toFixed(0)}s]` : '';
  const score = data.score ? ` score=${data.score}` : '';
  const reason = data.reason || data.reason_unblock || '';

  div.className = color;
  div.textContent = `[${time}] ${icon} ${data.ip || ''} — ${reason}${dur}${score}`;

  const box = $('logBox');
  box.prepend(div);

  while (box.children.length > 100) {
    box.removeChild(box.lastChild);
  }
}

// =====================================================
//  CONTROLS
// =====================================================
$('btnUnblockAll').onclick = () => fetch('/api/unblock-all', { method: 'POST' });

$('btnReset').onclick = async () => {
  if (!confirm('รีเซ็ตทั้งหมด?')) return;
  await fetch('/api/reset', { method: 'POST' });
  $('logBox').innerHTML = '<div class="text-gray-500">รีเซ็ตแล้ว...</div>';
  chart.data.labels = [];
  chart.data.datasets.forEach(d => d.data = []);
  chart.update();
  peakValue = 0;
  currentValue = 0;
  $('chartPeak').textContent = '0';
  $('chartCurrent').textContent = '0';
};

$('btnQuickBlock').onclick = async () => {
  const ip = prompt('IP ที่จะ block:');
  if (!ip) return;
  await fetch(`/api/block/${ip}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'quick block' }),
  });
};

$('btnClearLog').onclick = () => {
  $('logBox').innerHTML = '<div class="text-gray-500">ล้างแล้ว</div>';
};

$('cfgMaxInput').oninput = async (e) => {
  const v = parseInt(e.target.value);
  $('cfgMax').textContent = v;
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxRequests: v }),
  });
};

$('cfgScoreInput').oninput = async (e) => {
  const v = parseInt(e.target.value);
  $('cfgScore').textContent = v;
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoBlockScore: v }),
  });
};

$('protectionOn').onchange = (e) => {
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protectionEnabled: e.target.checked }),
  });
};

// =====================================================
//  DISCORD TEST
// =====================================================
$('btnTestDiscord').onclick = async () => {
  const btn = $('btnTestDiscord');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ กำลังส่ง...';

  try {
    const res = await fetch('/api/test-discord', { method: 'POST' });
    const data = await res.json();

    if (data.sent) {
      alert('✅ ส่งทดสอบสำเร็จ! ตรวจสอบ Discord');
      addLog('📢', {
        timestamp: Date.now(),
        ip: 'discord',
        reason: 'ทดสอบสำเร็จ',
      });
    } else {
      alert('❌ ส่งไม่สำเร็จ: ' + (data.reason || data.error || 'unknown'));
    }
  } catch (e) {
    alert('❌ Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// =====================================================
//  CHART MODE
// =====================================================
document.querySelectorAll('input[name="chartMode"]').forEach(radio => {
  radio.onchange = (e) => {
    chartMode = e.target.value;
    peakValue = 0;
    currentValue = 0;

    if (chartMode === 'rps') {
      chart.options.scales.y.title.text = 'req/s';
      $('chartSubtitle').textContent = 'ความเร็วปัจจุบัน (req/s)';
    } else {
      chart.options.scales.y.title.text = 'Total Requests (สะสม)';
      $('chartSubtitle').textContent = 'จำนวนสะสม (Total Requests)';
    }

    chart.data.labels = [];
    chart.data.datasets.forEach(d => d.data = []);
    chart.update('none');

    $('chartPeak').textContent = '0';
    $('chartCurrent').textContent = '0';

    console.log('Chart mode:', chartMode);
  };
});

// =====================================================
//  HELPERS
// =====================================================
function formatNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
