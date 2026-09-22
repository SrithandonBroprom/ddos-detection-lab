// scanner/networkScanner.js
// สแกนหา IP ในวง LAN ที่เปิด port ที่ระบุ

const net = require('net');
const os = require('os');

class NetworkScanner {
  constructor({ timeout = 1000, concurrency = 50 } = {}) {
    this.timeout = timeout;
    this.concurrency = concurrency;
  }

  getLocalNetworks() {
    const ifaces = os.networkInterfaces();
    const networks = [];

    for (const [name, list] of Object.entries(ifaces)) {
      for (const info of list) {
        if (info.family === 'IPv4' && !info.internal) {
          const cidr = this._toCIDR(info.address, info.netmask);
          networks.push({
            iface: name,
            ip: info.address,
            netmask: info.netmask,
            cidr,
            network: this._networkAddress(info.address, info.netmask),
          });
        }
      }
    }
    return networks;
  }

  getIPRange(ip, netmask) {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);

    const network = ipParts.map((p, i) => p & maskParts[i]);
    const broadcast = ipParts.map((p, i) => p | (~maskParts[i] & 255));

    const ips = [];
    for (let a = network[0]; a <= broadcast[0]; a++) {
      for (let b = network[1]; b <= broadcast[1]; b++) {
        for (let c = network[2]; c <= broadcast[2]; c++) {
          for (let d = network[3]; d <= broadcast[3]; d++) {
            const candidate = `${a}.${b}.${c}.${d}`;
            if (candidate !== network.join('.') && candidate !== broadcast.join('.')) {
              ips.push(candidate);
            }
          }
        }
      }
    }
    return ips;
  }

  checkPort(ip, port = 3000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let done = false;

      const finish = (open) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve({ ip, port, open });
      };

      socket.setTimeout(this.timeout);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, ip);
    });
  }

  async scan(options = {}) {
    const {
      port = 3000,
      onProgress = null,
      targetNetwork = null,
    } = options;

    const networks = targetNetwork
      ? [targetNetwork]
      : this.getLocalNetworks();

    if (networks.length === 0) {
      throw new Error('ไม่พบ network interface');
    }

    const allResults = [];

    for (const net of networks) {
      const ips = this.getIPRange(net.ip, net.netmask);
      console.log(`🔍 สแกน ${net.cidr} (${ips.length} IPs) — port ${port}`);

      let scanned = 0;
      const results = [];
      const batches = this._chunk(ips, this.concurrency);

      for (const batch of batches) {
        const promises = batch.map(ip => this.checkPort(ip, port));
        const batchResults = await Promise.all(promises);

        for (const r of batchResults) {
          scanned++;
          if (r.open) {
            results.push(r);
            console.log(`✅ พบ: ${r.ip}:${r.port}`);
          }
          if (onProgress) onProgress({ scanned, total: ips.length, found: results.length });
        }
      }

      allResults.push({ network: net.cidr, iface: net.iface, hosts: results });
    }

    return allResults;
  }

  _chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  _toCIDR(ip, netmask) {
    const maskParts = netmask.split('.').map(Number);
    let bits = 0;
    for (const p of maskParts) {
      bits += (p >>> 0).toString(2).split('1').length - 1;
    }
    return `${ip}/${bits}`;
  }

  _networkAddress(ip, netmask) {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);
    return ipParts.map((p, i) => p & maskParts[i]).join('.');
  }
}

module.exports = NetworkScanner;
