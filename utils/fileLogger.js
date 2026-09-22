// utils/fileLogger.js
// บันทึก log ลงไฟล์ แยกตามวัน

const fs = require('fs');
const path = require('path');

class FileLogger {
  constructor({ logDir = './logs' } = {}) {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    console.log(`📁 FileLogger ready → ${logDir}/`);
  }

  /**
   * เขียน log ลงไฟล์ (JSON lines)
   */
  write(type, data = {}) {
    const now = new Date();
    const dateStr = this._getDateStr(now);
    const timeStr = now.toTimeString().split(' ')[0];

    const logEntry = {
      timestamp: now.toISOString(),
      time: timeStr,
      date: dateStr,
      type,
      ...data,
    };

    const filename = path.join(this.logDir, `${dateStr}.log`);
    const line = JSON.stringify(logEntry) + '\n';

    try {
      fs.appendFileSync(filename, line, 'utf8');
    } catch (e) {
      console.error('FileLogger error:', e.message);
    }
  }

  /**
   * อ่าน log ของวันที่ระบุ
   */
  read(date) {
    const filename = path.join(this.logDir, `${date}.log`);
    if (!fs.existsSync(filename)) return [];

    try {
      return fs.readFileSync(filename, 'utf8')
        .split('\n')
        .filter(l => l.trim())
        .map(l => {
          try { return JSON.parse(l); }
          catch (e) { return null; }
        })
        .filter(Boolean);
    } catch (e) {
      console.error('FileLogger read error:', e.message);
      return [];
    }
  }

  /**
   * รายชื่อวันที่ที่มี log
   */
  listDates() {
    if (!fs.existsSync(this.logDir)) return [];
    return fs.readdirSync(this.logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => f.replace('.log', ''))
      .sort()
      .reverse();
  }

  /**
   * สรุปสถิติของวัน
   */
  getDailySummary(date) {
    const logs = this.read(date);

    const summary = {
      date,
      totalEvents: logs.length,
      blocks: 0,
      unblocks: 0,
      warns: 0,
      attacks: 0,
      healthChanges: 0,
      totalRequests: 0,
      blockedRequests: 0,
      suspiciousRequests: 0,
      peakRps: 0,
      avgRps: 0,
      uniqueIPs: [],
      firstEvent: logs[0] || null,
      lastEvent: logs[logs.length - 1] || null,
      timeline: [],
      blocksByHour: {},
      topAttackers: {},
    };

    const ips = new Set();
    const rpsValues = [];

    for (const log of logs) {
      switch (log.type) {
        case 'BLOCK':
          summary.blocks++;
          if (log.ip) {
            ips.add(log.ip);
            summary.topAttackers[log.ip] = (summary.topAttackers[log.ip] || 0) + 1;
          }
          break;

        case 'UNBLOCK':
          summary.unblocks++;
          break;

        case 'WARN':
          summary.warns++;
          break;

        case 'ATTACK_DETECTED':
          summary.attacks++;
          break;

        case 'HEALTH_CHANGE':
          summary.healthChanges++;
          break;

        case 'TRAFFIC_SNAPSHOT':
          if (log.rps !== undefined) {
            rpsValues.push(log.rps);
            if (log.rps > summary.peakRps) summary.peakRps = log.rps;
          }
          if (log.total) summary.totalRequests = log.total;
          if (log.blocked) summary.blockedRequests = log.blocked;
          if (log.suspicious) summary.suspiciousRequests = log.suspicious;
          summary.timeline.push({
            time: log.time,
            rps: log.rps || 0,
            total: log.total || 0,
            blocked: log.blocked || 0,
          });
          break;
      }

      if (log.ip) ips.add(log.ip);
    }

    if (rpsValues.length > 0) {
      summary.avgRps = Math.round(rpsValues.reduce((a, b) => a + b, 0) / rpsValues.length);
    }

    summary.uniqueIPs = Array.from(ips);

    // Top attackers
    summary.topAttackers = Object.entries(summary.topAttackers)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    return summary;
  }

  /**
   * ลบ log เก่ากว่า N วัน
   */
  cleanup(keepDays = 30) {
    const dates = this.listDates();
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;

    let removed = 0;
    for (const date of dates) {
      const fileTime = new Date(date).getTime();
      if (fileTime < cutoff) {
        try {
          fs.unlinkSync(path.join(this.logDir, `${date}.log`));
          removed++;
        } catch (e) {}
      }
    }
    return removed;
  }

  _getDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

module.exports = FileLogger;
