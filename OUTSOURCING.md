# BotsApp — Contractor & Outsourcing Handover Guide

Welcome to the **BotsApp** project! This repository contains a standalone, enterprise-grade WhatsApp Gateway, API service, and automation platform extracted from GeekByte LMS into an independent microservice.

This document serves as the complete technical onboarding guide for outsourced developers, agencies, and contractors.

---

## 🏗️ 1. Architecture & Tech Stack

BotsApp is built with modern, battle-tested technologies designed for 24/7 reliability:

- **Runtime:** Node.js (v18+ or v20+ recommended)
- **WhatsApp Engine:** `whatsapp-web.js` v1.34+ (Puppeteer / Chromium headless automation with session persistence via `LocalAuth`)
- **API Server:** Express.js with JSON/Multipart parsing, rate limiting, and CORS
- **Real-Time Layer:** Socket.io (WebSocket event stream for live dashboard, QR code updates, and ACK receipts)
- **Frontend Dashboard:** Vanilla JavaScript + Tailwind CSS + Lucide Icons + Glassmorphism UI (zero heavy frontend build steps required)
- **SDKs:** Standalone PHP/Laravel Client (`sdk/BotsAppClient.php`)

```
botsapp/
├── src/
│   ├── index.js              # Express + Socket.io Server Entrypoint
│   ├── config.js             # Environment Configuration & Directory Initialization
│   ├── whatsapp.js           # Core WhatsApp Web.js Client Wrapper
│   ├── queue.js              # Anti-Ban 2.0 Send Queue (Typing Delay & Rate Limiting)
│   ├── webhooks.js           # Multi-Destination Webhook Dispatcher
│   ├── responder.js          # Chatbot & Keyword Auto-Responder Engine
│   ├── campaigns.js          # Bulk Broadcast Campaign Manager
│   ├── routes/
│   │   └── api.js            # REST API (Backward-Compatible + Extended Endpoints)
│   ├── middleware/
│   │   └── auth.js           # API Key Protection Middleware
│   └── utils/
│       ├── logger.js         # Unified Console & File Logger + Live Stream Buffer
│       └── phone.js          # Phone Normalization & JID Resolution
├── public/                   # Single Page App Dashboard
│   ├── index.html            # Main Dashboard UI
│   ├── css/custom.css        # Glassmorphism & Custom Components
│   └── js/app.js             # Dashboard Controller & Socket.io Handlers
├── sdk/
│   └── BotsAppClient.php     # Drop-in Laravel / PHP Service
├── docs/
│   ├── openapi.json          # OpenAPI 3.0 / Swagger Schema
│   └── postman.json          # Postman Collection v2.1
├── data/                     # Persistent JSON DB (Campaigns, Webhooks, Rules)
├── uploads/                  # Temporary file upload directory for media messages
└── logs/                     # Persistent rotating log files
```

---

## 🚀 2. Getting Started (Local Development)

### Prerequisites
- Node.js (v18, v20, or v22)
- Git
- Chrome / Chromium (automatically handled by Puppeteer or can be specified via `PUPPETEER_EXECUTABLE_PATH`)

### Quick Setup

```bash
# 1. Clone repository
git clone https://github.com/Mazonia/botsapp.git
cd botsapp

# 2. Copy environment file
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Start the server
npm start
```

### Windows 1-Click Launchers
- Double-click `start.bat`
- Or execute PowerShell launcher: `./start.ps1`
- Or run in background: `node start_detached.js`

### Accessing the Dashboard & API
- **Web Dashboard:** `http://localhost:3001`
- **Health Check:** `http://localhost:3001/api/status`
- **QR Code Stream:** `http://localhost:3001/api/qr.png`

---

## 🛡️ 3. Anti-Ban 2.0 Protection System

WhatsApp accounts can be banned if automated systems send messages simultaneously or too rapidly. BotsApp includes an intelligent anti-ban engine (`src/queue.js`):

1. **Serialized Queue:** All outgoing messages are queued and executed one-by-one.
2. **Session Warmup Delay:**
   - Brand New Session (< 1 hour): 45s – 90s delay between messages
   - Day 1 Warmup (< 24 hours): 20s – 40s delay
   - Days 2–3 (< 72 hours): 12s – 25s delay
   - Fully Warmed (> 72 hours): 6s – 15s delay
3. **Humanized Typing Simulation:**
   - Calculates typing time proportional to character count (~35–55 chars/sec)
   - Triggers `chat.sendStateTyping()` on the recipient's screen before transmitting the message.
4. **Daily Send Guard:**
   - Configurable daily limit (default 120 messages/day).
   - Auto-resets at midnight.
   - Throws `429 Too Many Requests` when limit is reached to protect the SIM card.

---

## 📡 4. Webhooks Architecture

BotsApp can dispatch events to any number of HTTP endpoints (including Laravel, CRM, Zapier, Make, etc.):

### Dispatched Events:
- `message:received`: Incoming WhatsApp message from a user or group
- `message:ack`: Delivery receipts (`ack: 1` = sent, `ack: 2` = delivered, `ack: 3` = read/blue tick, `ack: -1` = failed)
- `session:ready`: WhatsApp client successfully authenticated
- `session:disconnected`: WhatsApp connection dropped
- `session:qr`: New QR code generated for linking

### Signature Verification:
If `WEBHOOK_SECRET` is configured in `.env`, all webhook POST requests include the header:
```
X-Hub-Signature-256: sha256=<hmac_hash>
```

---

## 🐘 5. Laravel Drop-in Integration

GeekByte LMS or any Laravel application can connect to BotsApp in 2 minutes:

1. Copy `sdk/BotsAppClient.php` into your Laravel app: `app/Services/BotsAppClient.php`.
2. In `.env`, add:
   ```env
   WHATSAPP_BOT_URL=http://127.0.0.1:3001
   ```
3. Use anywhere in Laravel:
   ```php
   use App\Services\BotsAppClient;

   $client = new BotsAppClient();
   $res = $client->sendMessage('0241234567', 'Hello from Laravel!');
   ```

---

## 📋 6. Tasks Available for Outsourcing / Roadmap

When assigning tasks to contractors or new team members, here are the recommended areas of enhancement:

1. **Multi-Session Support:**
   - Allow managing multiple phone numbers simultaneously by namespacing `LocalAuth` sessions (`/sessions/:id/qr`, `/sessions/:id/send`).
2. **AI LLM Integration Hook:**
   - Integrate OpenAI or Google Gemini into `src/responder.js` for intelligent conversational auto-replies.
3. **Message Scheduling:**
   - Add scheduled send timestamp to queue items (e.g. send at 8:00 AM tomorrow).
4. **Cloud Storage Provider for Media:**
   - Support uploading media directly to AWS S3, Cloudinary, or DigitalOcean Spaces instead of local disk.
