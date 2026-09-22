// public/history.js
const $ = (id) => document.getElementById(id);

let chart = null;
let currentDate = null;

// ===== โหลดรายการวันที่ =====
async function loadDates() {
  try {
    const res = await fetch('/api/logs/dates');
    const data = await res.json();

    if (!data.dates || data.dates.length === 0) {
      $('dateList').innerHTML = '<div class="text-gray-400 text-sm p-2">ยังไม่มี log</div>';
      return;
    }

    $('dateList').innerHTML = data.dates.map(date => `
      <button onclick="selectDate('${date}')"
              class="date-btn w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition text-sm border-2 border-transparent"
              data-date="${date}">
        📅 ${date}
      </button>
    `).join('');

    selectDate(data.dates[0]);
  } catch (e) {
    $('dateList').innerHTML = `<div class="text-red-500 text-sm p-2">Error: ${e.message}</div>`;
  }
}

// ===== เลือกวัน =====
window.selectDate = async (date) => {
  currentDate = date;
  $('selectedDate').textContent = date;

  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.classList.remove('bg-blue-100', 'border-blue-500');
    if (btn.dataset.date === date) {
      btn.classList.add('bg-blue-100', 'border-blue-500');
    }
  });

  await Promise.all([
    loadSummary(date),
    loadEvents(date),
  ]);
};

// ===== Summary =====
async function loadSummary(date) {
  try {
    const res = await fetch(`/api/logs/summary/${date}`);
    const s = await res.json();

    $('statEvents').textContent = s.totalEvents || 0;
    $('statBlocks').textContent = s.blocks || 0;
    $('statWarns').textContent = s.warns || 0;
    $('statPeak').textContent = s.peakRps || 0;
    $('statIPs').textContent = (s.uniqueIPs || []).length;

    drawChart(s.timeline || []);
    renderTopAttackers(s.topAttackers || []);
  } catch (e) {
    console.error('loadSummary:', e);
  }
}

// ===== Chart =====
function drawChart(timeline) {
  const ctx = $('historyChart').getContext('2d');

  if (chart) chart.destroy();

  if (!timeline || timeline.length === 0) {
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'ไม่มีข้อมูลสำหรับวันนี้' },
        },
      },
    });
    return;
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: timeline.map(t => t.time),
      datasets: [{
        label: 'req/s',
        data: timeline.map(t => t.rps),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        y: {
          beginAtZero: true,
          grace: '10%',
          title: { display: true, text: 'req/s' },
        },
        x: {
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 20 },
        },
      },
      plugins: { legend: { display: false } },
    },
  });
}

// ===== Top Attackers =====
function renderTopAttackers(list) {
  if (!list || list.length === 0) {
    $('topAttackers').innerHTML = '<div class="text-gray-400 text-sm">ไม่มีข้อมูล</div>';
    return;
  }

  $('topAttackers').innerHTML = list.map((item, i) => `
    <div class="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full">
      <span class="text-xs font-bold text-gray-500">#${i + 1}</span>
      <span class="font-mono text-sm text-red-700">${escapeHtml(item.ip)}</span>
      <span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">${item.count}x</span>
    </div>
  `).join('');
}

// ===== Events =====
async function loadEvents(date) {
  try {
    const res = await fetch(`/api/logs/${date}`);
    const data = await res.json();

    const events = (data.events || []).filter(e => e.type !== 'TRAFFIC_SNAPSHOT');

    if (events.length === 0) {
      $('eventTable').innerHTML = '';
      $('eventEmpty').style.display = 'block';
      return;
    }

    $('eventEmpty').style.display = 'none';

    $('eventTable').innerHTML = events.map(e => {
      let badge = '';
      switch (e.type) {
        case 'BLOCK':
          badge = '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">🚫 BLOCK</span>';
          break;
        case 'UNBLOCK':
          badge = '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold">✅ UNBLOCK</span>';
          break;
        case 'WARN':
          badge = '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-bold">⚠️ WARN</span>';
          break;
        case 'HEALTH_CHANGE':
          badge = '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold">💚 HEALTH</span>';
          break;
        case 'ATTACK_DETECTED':
          badge = '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">🚨 ATTACK</span>';
          break;
        default:
          badge = `<span class="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs">${e.type}</span>`;
      }

      let detail = e.reason || e.byWhom || '';
      if (e.duration) detail += ` [${(e.duration / 1000).toFixed(0)}s]`;
      if (e.oldStatus && e.newStatus) detail = `${e.oldStatus} → ${e.newStatus} (${e.responseTime}ms)`;

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="py-2 font-mono text-xs text-gray-600">${e.time || ''}</td>
          <td>${badge}</td>
          <td class="font-mono text-xs">${e.ip || '—'}</td>
          <td class="text-xs text-gray-600">${escapeHtml(detail)}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('loadEvents:', e);
  }
}

// ===== Controls =====
$('btnExport').onclick = () => {
  if (!currentDate) return alert('เลือกวันก่อน');
  window.open(`/api/logs/download/${currentDate}`, '_blank');
};

$('btnRefresh').onclick = () => {
  loadDates();
  if (currentDate) selectDate(currentDate);
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===== Init =====
loadDates();
