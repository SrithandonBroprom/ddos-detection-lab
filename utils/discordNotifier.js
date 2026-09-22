// utils/discordNotifier.js
// แจ้งเตือนผ่าน Discord Webhook

class DiscordNotifier {
  constructor({ webhookUrl = null, enabled = true, cooldownMs = 30000 } = {}) {
    this.webhookUrl = webhookUrl;
    this.enabled = enabled && !!webhookUrl;
    this.cooldownMs = cooldownMs;
    this.lastSent = new Map();

    if (this.enabled) {
      console.log('📢 Discord Notifier enabled');
    } else {
      console.log('📢 Discord Notifier disabled (no webhook URL)');
    }
  }

  async send(content, embed = null) {
    if (!this.enabled) return { sent: false, reason: 'disabled' };

    const body = { content };
    if (embed) body.embeds = [embed];

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { sent: res.ok, status: res.status };
    } catch (e) {
      console.error('Discord error:', e.message);
      return { sent: false, error: e.message };
    }
  }

  async alert(key, content, embed = null, force = false) {
    if (!this.enabled) return { sent: false, reason: 'disabled' };

    if (!force) {
      const last = this.lastSent.get(key) || 0;
      if (Date.now() - last < this.cooldownMs) {
        return { sent: false, reason: 'cooldown' };
      }
    }
    this.lastSent.set(key, Date.now());

    return await this.send(content, embed);
  }

  // ===== Alert Types =====

  serverDown(responseTime, consecutiveFails) {
    return this.alert('server_down',
      '🚨 **SERVER DOWN!**',
      {
        title: '⚠️ Server ไม่ตอบสนอง',
        description: `Server ล่มหรือหยุดทำงาน`,
        fields: [
          { name: 'Response Time', value: `${responseTime}ms`, inline: true },
          { name: 'Fail Count', value: String(consecutiveFails), inline: true },
        ],
        color: 0xff0000,
        timestamp: new Date().toISOString(),
        footer: { text: 'DDoS Detection Lab' },
      }
    );
  }

  serverDegraded(responseTime) {
    return this.alert('server_degraded',
      '⚠️ **Server DEGRADED**',
      {
        title: 'Response time สูงผิดปกติ',
        description: `Response time: **${responseTime}ms**`,
        color: 0xffa500,
        timestamp: new Date().toISOString(),
      }
    );
  }

  serverRecovered(previousStatus) {
    return this.alert('server_recovered',
      '✅ **Server กลับมาปกติ**',
      {
        title: 'Server ทำงานปกติแล้ว',
        description: `Recovered from: ${previousStatus}`,
        color: 0x16a34a,
        timestamp: new Date().toISOString(),
      },
      true // force (ไม่ต้อง cooldown)
    );
  }

  ddosDetected({ ip, reason, score, rps, total }) {
    return this.alert(`ddos_${ip}`,
      '🚨 **ตรวจพบการโจมตี DDoS!**',
      {
        title: 'DDoS Attack Detected',
        fields: [
          { name: '🌐 IP ผู้โจมตี', value: `\`${ip}\``, inline: true },
          { name: '📊 Score', value: String(score), inline: true },
          { name: '⚡ req/s', value: String(rps || 0), inline: true },
          { name: '📝 เหตุผล', value: reason || 'N/A', inline: false },
          { name: '📈 Total Requests', value: String(total || 0), inline: true },
        ],
        color: 0xff0000,
        timestamp: new Date().toISOString(),
      }
    );
  }

  ipBlocked({ ip, reason, score, duration, hitCount }) {
    return this.alert(`block_${ip}`,
      '🚫 **IP ถูกบล็อก**',
      {
        title: 'IP Blocked',
        fields: [
          { name: '🌐 IP', value: `\`${ip}\``, inline: true },
          { name: '⏱️ Duration', value: `${(duration / 1000).toFixed(0)}s`, inline: true },
          { name: '📊 Score', value: String(score), inline: true },
          { name: '🔁 Hit Count', value: String(hitCount || 1), inline: true },
          { name: '📝 เหตุผล', value: reason || 'N/A', inline: false },
        ],
        color: 0xdc2626,
        timestamp: new Date().toISOString(),
      }
    );
  }

  abnormalTraffic({ rps, threshold, direction }) {
    const emoji = direction === 'high' ? '📈' : '📉';
    const color = direction === 'high' ? 0xffa500 : 0x3b82f6;

    return this.alert(`traffic_${direction}`,
      `${emoji} **Traffic ผิดปกติ**`,
      {
        title: `Traffic ${direction === 'high' ? 'สูง' : 'ต่ำ'}ผิดปกติ`,
        description: `req/s: **${rps}** (Threshold: ${threshold})`,
        color,
        timestamp: new Date().toISOString(),
      }
    );
  }

  dailySummary({ date, blocks, warns, attacks, peakRps, uniqueIPs, totalRequests }) {
    return this.send('📊 **สรุปประจำวัน**', {
      title: `รายงานวันที่ ${date}`,
      fields: [
        { name: '🚫 บล็อก', value: String(blocks), inline: true },
        { name: '⚠️ เตือน', value: String(warns), inline: true },
        { name: '🚨 โจมตี', value: String(attacks), inline: true },
        { name: '📈 Peak req/s', value: String(peakRps), inline: true },
        { name: '🌐 IP ที่โจมตี', value: String(uniqueIPs), inline: true },
        { name: '📊 Requests รวม', value: String(totalRequests), inline: true },
      ],
      color: 0x0284c7,
      timestamp: new Date().toISOString(),
    });
  }

  test() {
    return this.send('🧪 **ทดสอบการแจ้งเตือน**', {
      title: 'Discord Notifier Test',
      description: 'ถ้าเห็นข้อความนี้ = Discord ทำงานปกติ ✅',
      color: 0x16a34a,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = DiscordNotifier;
