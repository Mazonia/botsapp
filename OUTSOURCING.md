# BotsApp - Contractor and Outsourcing Handover Guide

Welcome to the **BotsApp** project! This repository contains a standalone, enterprise-grade WhatsApp Gateway, API service, and automation platform extracted from GeekByte LMS into an independent microservice.

This document serves as the complete technical onboarding guide for outsourced developers, agencies, and contractors.

---

## 1. About the Project

### Origin and Purpose
BotsApp was created to decouple WhatsApp automation logic from the main monolithic application. By creating an autonomous Node.js service with standard HTTP REST endpoints, Webhooks, and WebSocket streaming, any external developer or platform can build on top of BotsApp without touching core proprietary databases or business logic.

### Core Capabilities
- Unofficial WhatsApp Web Gateway via Puppeteer automation.
- Multi-format message delivery: text, images, videos, audio/voice notes, documents, location pins, and polls.
- Intelligent Anti-Ban 2.0 queue with human typing delays and daily volume caps.
- Broadcast campaign manager with drag-and-drop CSV upload and variable replacements.
- Phone number verification tool (single checks and bulk validation).
- Automated keyword reply bots and webhook forwarders.
- Real-time web dashboard with dual theme (Light and Dark) support.

---

## 2. Architecture and Tech Stack

BotsApp is built with modern, battle-tested technologies designed for 24/7 reliability:

- **Runtime:** Node.js (v18+ or v20+ recommended)
- **WhatsApp Engine:** `whatsapp-web.js` v1.34+ (Puppeteer / Chromium headless automation with session persistence via `LocalAuth`)
- **API Server:** Express.js with JSON/Multipart parsing, rate limiting, and CORS
- **Real-Time Layer:** Socket.io (WebSocket event stream for live dashboard, QR code updates, and ACK receipts)
- **Frontend Dashboard:** Vanilla JavaScript + Tailwind CSS + Lucide Icons + Custom CSS (zero heavy frontend build steps required)
- **SDKs:** Standalone PHP/Laravel Client (`sdk/BotsAppClient.php`)

```
botsapp/
├── src/
│   ├── index.js              # Express + Socket.io Server Entrypoint
│   ├── config.js             # Environment Configuration and Directory Setup
│   ├── whatsapp.js           # Core WhatsApp Web.js Client Wrapper
│   ├── queue.js              # Anti-Ban 2.0 Send Queue (Typing Delay and Rate Limiting)
│   ├── webhooks.js           # Multi-Destination Webhook Dispatcher
│   ├── responder.js          # Chatbot and Keyword Auto-Responder Engine
│   ├── campaigns.js          # Bulk Broadcast Campaign Manager
│   ├── routes/
│   │   └── api.js            # REST API (Backward-Compatible and Extended Endpoints)
│   ├── middleware/
│   │   └── auth.js           # API Key Protection Middleware
│   └── utils/
│       ├── logger.js         # Unified Console and File Logger + Live Stream Buffer
│       └── phone.js          # Phone Normalization and JID Resolution
├── public/                   # Single Page App Dashboard
│   ├── index.html            # Main Dashboard UI (Dual Theme + Tooltips)
│   ├── css/custom.css        # Light / Dark Glassmorphism Styling
│   └── js/app.js             # Dashboard Controller, CSV Parsers, and Socket Handlers
├── sdk/
│   └── BotsAppClient.php     # Drop-in Laravel / PHP Service
├── docs/
│   ├── openapi.json          # OpenAPI 3.0 / Swagger Schema
│   └── postman.json          # Postman Collection v2.1
├── data/                     # Persistent JSON Storage (Campaigns, Webhooks, Rules)
├── uploads/                  # Temporary file upload directory for media messages
└── logs/                     # Persistent rotating log files
```

---

## 3. Security Standards

When developing or maintaining BotsApp, all contributors must adhere to these security requirements:

### Authentication and Authorization
- **API Keys:** Production deployments should always configure `API_KEY` in `.env`.
- API endpoints check the `X-Api-Key` or `Authorization: Bearer <key>` headers.
- Static dashboard assets and health check endpoints remain accessible for monitoring.

### Webhook Signatures
- When `WEBHOOK_SECRET` is defined, every dispatched webhook includes an `X-Hub-Signature-256` header.
- Receiving systems should compute `hash_hmac('sha256', $rawBody, $secret)` to authenticate the payload.

### Credential Protection
- WhatsApp authentication tokens stored in `.wwebjs_auth/` contain active session cookies.
- Never commit `.wwebjs_auth/`, `.env`, or `.session_start` to any public or private git repository.
- Temporary files uploaded to `uploads/` should be scrubbed after transmission.

### Input Sanitization
- All telephone parameters must pass through `phoneUtils.normalizePhoneNumber()` to ensure digits conform to the E.164 standard.
- File uploads are capped at 50MB to prevent denial of service.

---

## 4. Getting Started (Local Development)

### Prerequisites
- Node.js (v18, v20, or v22)
- Git
- Chrome / Chromium (managed by Puppeteer or configured via `PUPPETEER_EXECUTABLE_PATH`)

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

### Windows Launchers
- Double-click `start.bat`
- Or execute PowerShell launcher: `./start.ps1`
- Or run in background: `node start_detached.js`

### Accessing the Dashboard and API
- **Web Dashboard:** `http://localhost:3001`
- **Health Check:** `http://localhost:3001/api/status`
- **QR Code Stream:** `http://localhost:3001/api/qr.png`

---

## 5. Anti-Ban 2.0 Protection System

WhatsApp accounts can be flagged if automated systems send messages simultaneously or too rapidly. BotsApp includes an anti-ban engine (`src/queue.js`):

1. **Serialized Queue:** All outgoing messages are queued and executed one-by-one.
2. **Session Warmup Delay:**
   - Brand New Session (< 1 hour): 45s to 90s delay between messages.
   - Day 1 Warmup (< 24 hours): 20s to 40s delay.
   - Days 2 to 3 (< 72 hours): 12s to 25s delay.
   - Fully Warmed (> 72 hours): 6s to 15s delay.
3. **Humanized Typing Simulation:**
   - Calculates typing time proportional to character count (~35 to 55 chars/sec).
   - Triggers `chat.sendStateTyping()` on the recipient's phone before sending.
4. **Daily Send Guard:**
   - Configurable daily limit (default 120 messages/day).
   - Auto-resets at midnight.
   - Rejects excess sends with `429 Too Many Requests` to prevent carrier blocks.

---

## 6. Webhooks Architecture

BotsApp can dispatch events to multiple HTTP endpoints simultaneously (including Laravel, CRM, Zapier, Make, etc.):

### Dispatched Events:
- `message:received`: Incoming WhatsApp message from a user or group.
- `message:ack`: Delivery receipts (`ack: 1` = sent, `ack: 2` = delivered, `ack: 3` = read/blue tick, `ack: -1` = failed).
- `session:ready`: WhatsApp client successfully authenticated.
- `session:disconnected`: WhatsApp connection dropped.
- `session:qr`: New QR code generated for linking.

---

## 7. Laravel Drop-in Integration

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

## 8. Tasks Available for Outsourcing / Roadmap

When assigning tasks to contractors or new team members, here are the recommended areas of enhancement:

1. **Multi-Session Support:**
   - Allow managing multiple phone numbers simultaneously by namespacing `LocalAuth` sessions (`/sessions/:id/qr`, `/sessions/:id/send`).
2. **AI LLM Integration Hook:**
   - Integrate OpenAI or Google Gemini into `src/responder.js` for intelligent conversational auto-replies.
3. **Message Scheduling:**
   - Add scheduled send timestamp to queue items (e.g. send at 8:00 AM tomorrow).
4. **Cloud Storage Provider for Media:**
   - Support uploading media directly to AWS S3, Cloudinary, or DigitalOcean Spaces instead of local disk.

---

## 9. License

This project is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 Mazonia.
