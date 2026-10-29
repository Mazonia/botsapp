# BotsApp - Enterprise Standalone WhatsApp Gateway and API Platform

[![Version](https://img.shields.io/badge/version-2.0.0-emerald.svg)](https://github.com/Mazonia/botsapp)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-blue.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

BotsApp is an enterprise-grade, standalone WhatsApp Gateway, REST API service, and automation platform. Originally designed as the communication backbone for GeekByte LMS, it has been completely decoupled into an independent, full-featured microservice ready for production deployment, internal operations, or contractor outsourcing.

---

## About BotsApp

BotsApp solves the challenge of connecting applications, web platforms, and CRMs directly to WhatsApp without paying exorbitant per-conversation SaaS pricing or getting numbers banned. It bridges standard HTTP REST endpoints and Webhooks with WhatsApp Web through an isolated Chromium engine.

### Why BotsApp Was Created
- **Independence:** Decoupled from any monolithic framework so any backend (Laravel, Django, Express, FastAPI, Go, Spring, or Rails) can interact with WhatsApp via simple JSON requests.
- **Outsource-Friendly:** Built with clean directory boundaries, OpenAPI/Swagger specifications, Postman collections, and comprehensive documentation so external contractors, freelancers, or development teams can build on top of it without accessing your main codebase.
- **Enterprise Automation:** Includes built-in bulk campaign broadcasting, CSV list importing, number verification, keyword auto-responder bots, and real-time live inbox messaging out of the box.
- **Self-Hosted Privacy:** 100% self-hosted. Your customer data, phone numbers, and chat logs never pass through third-party servers.

---

## Key Features

- **Phone Numbers and WhatsApp @Usernames Support:**
  - Full support for traditional international E.164 phone numbers (e.g. `+233...`, `024...`).
  - Native support for WhatsApp's modern username system (`@username` handles) across all API endpoints, broadcasting engine, CSV parser, and validation tools.
  - Automatically resolves usernames via WhatsApp Web internal contact stores and page contexts.
- **Multi-Format Messaging:**
  - Formatted text with markdown support (*bold*, _italic_, ~strike~, ```code```).
  - Rich media attachments: high-resolution images (JPEG, PNG, WebP), videos (MP4), audio, WhatsApp voice notes (PTT), and documents/PDFs.
  - Interactive WhatsApp polls with single-choice or multi-choice options.
  - GPS location pins with latitude, longitude, and venue names.
  - Contact cards (vCards) for single or multiple contacts.
  - Emoji reactions and message revoking (delete for everyone).
- **Anti-Ban 2.0 Protection:**
  - Serialized FIFO send queue ensuring zero concurrent flood requests.
  - Progressive session warmup delays tailored to session age.
  - Dynamic human typing speed simulation (`chat.sendStateTyping()`).
  - Daily send volume limits with automatic midnight resets.
- **Clean and Modern Web Dashboard:**
  - Dual theme support: instant toggle between Light and Dark mode with persistent user preference.
  - Interactive tooltips throughout the interface for zero-friction navigation.
  - Real-time QR code display with auto-refresh and phone pairing code support.
  - Two-column live chat inbox with message history and quick replies.
  - Multi-format message studio with live mobile phone preview mockup.
  - Broadcast campaign engine with drag-and-drop CSV upload, variable replacement (`{{name}}`), and pacing sliders.
  - Number validation tool with single checks and bulk CSV batch validation.
  - Rule-based keyword auto-responder chatbot with cooldown protection.
  - Real-time server log console powered by WebSockets.
- **Universal Webhooks Engine:**
  - Dispatches inbound messages, delivery receipts (sent, delivered, read/blue ticks), and session lifecycle events.
  - HMAC SHA-256 payload signing for request authenticity.
  - Full backward compatibility with existing GeekByte LMS webhooks.
- **Developer Tools and SDKs:**
  - Drop-in Laravel / PHP Client (`sdk/BotsAppClient.php`).
  - OpenAPI 3.0 specification (`docs/openapi.json`).
  - Postman Collection v2.1 (`docs/postman.json`).
  - Docker, Docker Compose, PM2, and Windows one-click launchers.

---

## Security

Security and account safety are core architectural pillars of BotsApp:

### 1. WhatsApp Session Credential Protection
- WhatsApp session keys, tokens, and browser caches are saved locally in `.wwebjs_auth/`.
- This directory is strictly excluded from version control via `.gitignore` and must never be committed.
- All session files remain isolated on the host machine with operating system file access permissions.

### 2. API Key Authentication
- You can protect all `/api/*` endpoints by configuring `API_KEY` in your `.env` file.
- When enabled, every incoming request must provide either:
  - Header: `X-Api-Key: <your_secret_key>`
  - Header: `Authorization: Bearer <your_secret_key>`
- Requests without a valid key receive an immediate `401 Unauthorized` response.

### 3. Webhook Integrity (HMAC SHA-256 Signatures)
- To prevent spoofing or man-in-the-middle tampering, outgoing webhook calls can be signed with `WEBHOOK_SECRET`.
- When set, BotsApp calculates an HMAC SHA-256 hash of the JSON payload and attaches it as:
  ```
  X-Hub-Signature-256: sha256=<hex_digest>
  ```
- Your receiving server can verify this signature before processing events.

### 4. Anti-Ban and Abuse Prevention
- Anti-flood queue prevents automated scripts from blasting parallel messages that trigger WhatsApp security blocks.
- Hard daily send limits (`WA_DAILY_LIMIT`) prevent runaway loops from exhausting SIM carrier allowances.
- Session warmup profiles apply conservative delays (45s to 90s) for new accounts to safely build sender reputation.

### 5. Input Sanitization and Validation
- Phone numbers are sanitized against strict E.164-compatible patterns to prevent script injection.
- Uploaded media files are validated for size limits (max 50MB) and MIME type integrity.

### 6. Vulnerability Reporting
If you discover a security vulnerability in BotsApp, please open a private security advisory or contact the maintainer directly. Vulnerabilities are addressed with the highest priority.

---

## Quickstart

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

Review `.env` to configure your port, webhook destinations, or daily send limits.

### 3. Run Locally

```bash
npm start
```

Or on Windows:
- Run `start.bat` or `start.ps1`
- Or launch as a background daemon: `node start_detached.js`

Open **http://localhost:3001** in your browser to scan the QR code and access the dashboard.

---

## Docker Deployment

```bash
docker-compose up -d
```

---

## API Reference Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Device health, battery, queue and anti-ban stats |
| `GET` | `/api/qr` | Latest QR code Data URL |
| `GET` | `/api/qr.png` | Raw PNG stream of QR code |
| `POST` | `/api/send` | Send text message (Anti-ban queued) |
| `POST` | `/api/messages/media` | Send image, video, audio, or document |
| `POST` | `/api/messages/poll` | Send interactive WhatsApp poll |
| `POST` | `/api/messages/location` | Send location coordinates |
| `POST` | `/api/check-number` | Check if number is registered on WhatsApp |
| `POST` | `/api/contacts/validate-bulk` | Bulk validate a list of phone numbers |
| `POST` | `/api/campaigns/upload-csv` | Upload and parse CSV contact lists |
| `POST` | `/api/message-status` | Get live delivery and read status (ACK) |
| `POST` | `/api/reset` | Clear session and generate fresh QR |
| `GET` | `/api/chats` | List active conversations |
| `GET` | `/api/campaigns` | List broadcast campaigns |
| `GET` | `/api/webhooks` | List webhook endpoints |

See [`OUTSOURCING.md`](./OUTSOURCING.md) for full developer documentation.

---

## License

This project is open-sourced software licensed under the [MIT License](LICENSE).
Copyright (c) 2026 Mazonia.
