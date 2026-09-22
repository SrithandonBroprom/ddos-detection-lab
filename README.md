# 🛡️ DDoS Detection & Prevention Lab

> **Educational lab for learning DDoS detection and prevention techniques**
> 
> ⚠️ **For educational purposes only. Do NOT use against systems you don't own.**

![Node.js](https://img.shields.io/badge/Node.js-20.x-green)
![License](https://img.shields.io/badge/License-MIT-blue)
![Status](https://img.shields.io/badge/Status-Educational-orange)

---

## 📖 Overview

โปรเจคนี้เป็น **Lab การศึกษา** เรื่อง **DDoS Detection & Prevention** โดยจำลองสถานการณ์ HTTP Flood Attack และแสดงระบบตรวจจับ + ป้องกันแบบ Real-time

**สถาปัตยกรรม:** แยกเป็น 2 ฝั่งชัดเจน
- 🎯 **Victim Server** — เป้าหมาย + ระบบป้องกัน
- ⚔️ **Attacker Server** — สแกนหาเป้า + โจมตี

---

## ✨ Features

### 🎯 Victim Side
- **Rate-based Detection** — นับ req/s จาก sliding window
- **Pattern-based Detection** — วิเคราะห์ UA, path, method
- **Auto IP Blocking** — บล็อกอัตโนมัติพร้อม TTL
- **Exponential Backoff** — block ซ้ำ = นานขึ้น x2
- **Real-time Dashboard** — กราฟ + ตาราง + log
- **Whitelist Support** — ยกเว้น IP ที่ปลอดภัย
- **Configurable Thresholds** — ปรับได้ผ่าน UI

### ⚔️ Attacker Side
- **Network Scanner** — สแกนหา IP ที่เปิด port ในวง LAN
- **Victim Detection** — ยืนยันเป้าหมายด้วย `/api/info`
- **HTTP Flood Simulator** — ยิงด้วย concurrency ปรับได้
- **Real-time Results** — เห็น OK/Blocked/RPS

---

## 🏗️ Architecture
```bash
┌─────────────────────────────────────────────────────────────────┐
│                       LOCAL NETWORK                              │
│                       192.168.56.0/24                            │
│                                                                  │
│  ┌──────────────────────────┐    ┌──────────────────────────┐  │
│  │   ⚔️  ATTACKER SERVER     │    │   🎯  VICTIM SERVER       │  │
│  │      Port 4000            │    │      Port 3000            │  │
│  │                           │    │                           │  │
│  │  ┌───────────────────┐    │    │    ┌──────────────────┐  │  │
│  │  │ Network Scanner   │    │    │    │ Detection Engine │  │  │
│  │  └───────────────────┘    │    │    └──────────────────┘  │  │
│  │  ┌───────────────────┐    │    │    ┌──────────────────┐  │  │
│  │  │ Attack Console    │────┼───▶│    │  Rate Limiter    │  │  │
│  │  └───────────────────┘    │HTTP│    └──────────────────┘  │  │
│  │  ┌───────────────────┐    │Flood│   ┌──────────────────┐  │  │
│  │  │  Target List      │    │300  │   │    Blocker       │  │  │
│  │  └───────────────────┘    │req/s│   └──────────────────┘  │  │
│  │                           │    │    ┌──────────────────┐  │  │
│  │  ┌───────────────────┐    │    │    │   Dashboard      │  │  │
│  │  │   HTTP Flood      │    │    │    └──────────────────┘  │  │
│  │  └───────────────────┘    │    │                           │  │
│  └──────────────────────────┘    └──────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
         │                                      │
         │                                      │
         └────────── 2 VMs (Ubuntu) ────────────┘
                  Bridged Network
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18+ (แนะนำ v20)
- **2 VMs** (หรือ 1 VM ก็ได้) — Ubuntu 22.04
- **Network:** Bridged Adapter (ให้เครื่องอื่นเข้าถึงได้)

### Installation

```bash
# Clone
git clone https://github.com/SrithandonBroprom/ddos-detection-lab.git
cd ddos-detection-lab

# Node.js v18+ จำเป็นเพราะใช้ fetch() และ AbortSignal.timeout() ซึ่งเป็น built-in
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```
# Install
npm install
```
## Run
### Terminal 1 — Victim Server:
```bash
node victim-server.js
```
### Terminal 2 — Attacker Server:
```bash
node attacker-server.js
```
### เปิดในเบราว์เซอร์:
- **Victim Dashboard:** http://<victim-ip>:3000/victim.html
- **Attacker Console:** http://<attacker-ip>:4000/attacker.html

📁 Project Structure
```bash
ddos-detection-lab/
├── victim-server.js           # Victim server + detection
├── attacker-server.js         # Attacker server + scanner
├── detection/
│   ├── blocker.js             # IP blocking logic
│   └── detectionEngine.js     # Detection + analysis
├── scanner/
│   └── networkScanner.js      # TCP port scanner
├── public/
│   ├── victim.html            # Victim dashboard UI
│   ├── victim.js              # Victim dashboard logic
│   ├── attacker.html          # Attacker console UI
│   └── attacker.js            # Attacker console logic
└── package.json
```
