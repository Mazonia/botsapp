# 🚀 BotsApp — Enterprise Standalone WhatsApp Gateway & API Platform

[![Version](https://img.shields.io/badge/version-2.0.0-emerald.svg)](https://github.com/Mazonia/botsapp)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-blue.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**BotsApp** is an enterprise-grade, standalone WhatsApp Gateway, REST API service, and automation suite extracted from the GeekByte LMS architecture into an independent, production-ready microservice.

Designed for high reliability, zero-ban operation, and seamless outsourcing or integration into any tech stack (Laravel, Python, Node.js, Go, or no-code tools like Zapier).

---

## ✨ Features

- 📱 **Multi-Format Messaging:**
  - Standard text with full markdown formatting (`*bold*`, `_italic_`, `~strike~`, ````code````).
  - Rich Media: High-resolution images (JPEG/PNG/WebP), videos (MP4), audio/voice notes (PTT), and documents/PDFs.
  - Interactive WhatsApp Polls (single & multiple choice).
  - WhatsApp Location pins (latitude & longitude with name).
  - Contact cards (vCards).
  - Emoji reactions and message revoking (delete for everyone).
- 🛡️ **Anti-Ban 2.0 Protection:**
  - Serialized FIFO send queue (no concurrent flood sends).
  - Session Warmup Algorithm with progressive pacing tiers (brand new to warmed accounts).
  - Humanized typing speed emulation (`chat.sendStateTyping()`).
  - Daily send limits with automatic midnight reset.
- 💬 **Clean & Modern Web Dashboard:**
  - Built with Tailwind CSS, Lucide Icons, and Glassmorphism styling.
  - Live QR code scanner with auto-refresh and phone pairing code support.
  - **Live Inbox:** 2-column chat interface to read conversations and reply in real time.
  - **Message Studio:** Multi-format composer with live mobile mockup preview.
  - **Campaign Broadcaster:** Bulk CSV broadcaster with `{{name}}` variable substitution and pacing controls.
  - **Number Validator:** Verify active WhatsApp numbers individually or in bulk.
  - **Auto-Responder:** Rule-based keyword chatbot builder with cooldown protection.
- 📡 **Universal Webhooks Engine:**
  - Dispatches inbound messages, delivery receipts (sent, delivered, read/blue ticks), and session events.
  - HMAC SHA-256 payload signing for enterprise security.
  - 100% backward compatible with GeekByte LMS webhooks.
- 🔌 **Developer-Ready:**
  - Drop-in Laravel / PHP SDK (`sdk/BotsAppClient.php`).
  - Interactive OpenAPI 3.0 specification (`docs/openapi.json`).
  - Postman Collection (`docs/postman.json`).
  - Docker & Docker Compose setup for 1-command deployment.

---

## ⚡ Quickstart

### 1. Installation

```bash
git clone https://github.com/Mazonia/botsapp.git
cd botsapp
npm install
```

### 2. Configuration

```bash
cp .env.example .env
```

Edit `.env` to configure your port, webhook destinations, or daily send limits.

### 3. Run Locally

```bash
npm start
```

Or on Windows:
- Run `start.bat` or `start.ps1`
- Or launch as a background daemon: `node start_detached.js`

Open **http://localhost:3001** in your browser to scan the QR code and access the dashboard.

---

## 🐳 Docker Deployment

```bash
docker-compose up -d
```

---

## 📡 API Reference Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Device health, battery, queue & anti-ban stats |
| `GET` | `/api/qr` | Latest QR code Data URL |
| `GET` | `/api/qr.png` | Raw PNG stream of QR code |
| `POST` | `/api/send` | Send text message (Anti-ban queued) |
| `POST` | `/api/messages/media` | Send image, video, audio, or document |
| `POST` | `/api/messages/poll` | Send interactive poll |
| `POST` | `/api/messages/location` | Send location coordinates |
| `POST` | `/api/check-number` | Check if number is registered on WhatsApp |
| `POST` | `/api/message-status` | Get live delivery & read status (ACK) |
| `POST` | `/api/reset` | Clear session and generate fresh QR |
| `GET` | `/api/chats` | List active conversations |
| `GET` | `/api/campaigns` | List broadcast campaigns |
| `GET` | `/api/webhooks` | List webhook endpoints |

See [`OUTSOURCING.md`](./OUTSOURCING.md) for full developer documentation.

---

## 📄 License

MIT License &copy; 2026 Mazonia.
