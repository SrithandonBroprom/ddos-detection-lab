// detection/healthChecker.js
// ตรวจสอบว่า Server ยังตอบสนองปกติหรือไม่

const EventEmitter = require('events');

class HealthChecker extends EventEmitter {
  constructor({
    checkIntervalMs = 5000,
    responseTimeThreshold = 1000,
    failCountThreshold = 3,
    timeoutMs = 3000,
  } = {}) {
    super();
    this.checkIntervalMs = checkIntervalMs;
    this.responseTimeThreshold = responseTimeThreshold;
    this.failCountThreshold = failCountThreshold;
    this.timeoutMs = timeoutMs;

    this.state = {
      status: 'healthy',            // healthy | degraded | down
      consecutiveFails: 0,
      consecutiveSuccess: 0,
      lastCheckAt: Date.now(),
      lastResponseTime: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      totalChecks: 0,
      totalFails: 0,
      uptime: 0,
      history: [],
    };

    this.responseTimes = [];
    this.startTime = Date.now();
    this.url = null;
  }

  start(url) {
    if (this.timer) clearInterval(this.timer);
    this.url = url;
    this.timer = setInterval(() => this._check(), this.checkIntervalMs);
    console.log(`💚 Health Checker started → ${url} (ทุก ${this.checkIntervalMs}ms)`);
    // เช็คครั้งแรกทันที
    setTimeout(() => this._check(), 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async _check() {
    const t0 = Date.now();
    let success = false;
    let responseTime = 0;

    try {
      const res = await fetch(`${this.url}/api/info`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      responseTime = Date.now() - t0;
      success = res.ok;
    } catch (e) {
      responseTime = Date.now() - t0;
      success = false;
    }

    this.state.totalChecks++;
    this.state.lastCheckAt = Date.now();
    this.state.lastResponseTime = responseTime;

    // เก็บค่า responseTime (100 ตัวล่าสุด)
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) this.responseTimes.shift();

    this.state.avgResponseTime = Math.round(
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
    );
    this.state.minResponseTime = Math.min(this.state.minResponseTime, responseTime);
    this.state.maxResponseTime = Math.max(this.state.maxResponseTime, responseTime);

    // ตรวจสถานะ
    let newStatus = 'healthy';

    if (!success) {
      this.state.consecutiveFails++;
      this.state.consecutiveSuccess = 0;
      this.state.totalFails++;

      if (this.state.consecutiveFails >= this.failCountThreshold) {
        newStatus = 'down';
      } else {
        newStatus = 'degraded';
      }
    } else {
      this.state.consecutiveFails = 0;
      this.state.consecutiveSuccess++;

      if (responseTime > this.responseTimeThreshold) {
        newStatus = 'degraded';
      } else {
        newStatus = 'healthy';
      }
    }

    // เก็บประวัติ
    this.state.history.push({
      timestamp: Date.now(),
      success,
      responseTime,
      status: newStatus,
    });
    if (this.state.history.length > 100) this.state.history.shift();

    // แจ้งเตือนเมื่อเปลี่ยนสถานะ
    if (newStatus !== this.state.status) {
      const oldStatus = this.state.status;
      this.state.status = newStatus;

      const event = {
        oldStatus,
        newStatus,
        responseTime,
        timestamp: Date.now(),
        consecutiveFails: this.state.consecutiveFails,
      };

      console.log(`💚 Health: ${oldStatus} → ${newStatus} (RT: ${responseTime}ms)`);
      this.emit('statusChange', event);
    }

    this.emit('check', {
      success,
      responseTime,
      status: newStatus,
    });
  }

  getStatus() {
    return {
      ...this.state,
      uptime: Date.now() - this.startTime,
      isDown: this.state.status === 'down',
      isDegraded: this.state.status === 'degraded',
      isHealthy: this.state.status === 'healthy',
    };
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}

module.exports = HealthChecker;
