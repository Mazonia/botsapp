const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const whatsapp = require('../whatsapp');
const queue = require('../queue');
const webhooks = require('../webhooks');
const responder = require('../responder');
const campaigns = require('../campaigns');
const logger = require('../utils/logger');
const config = require('../config');
const csvUtils = require('../utils/csv');
const phoneUtils = require('../utils/phone');

// Multer storage for media uploads and CSV files
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// ====================================================================
// 1. CORE BACKWARD-COMPATIBLE ENDPOINTS (GeekByte LMS / Standard APIs)
// ====================================================================

// GET /api/status - Device & Gateway Health
router.get('/status', (req, res) => {
    res.json(whatsapp.getStatus());
});

// GET /api/qr - Latest QR code data URL
router.get('/qr', (req, res) => {
    const status = whatsapp.getStatus();
    res.json({
        online: true,
        success: true,
        authenticated: status.authenticated,
        hasQr: status.hasQr,
        qr: status.qr,
        rawQr: status.rawQr,
        message: status.message
    });
});

// GET /api/qr.png - Stream raw PNG of latest QR code
router.get('/qr.png', async (req, res) => {
    const status = whatsapp.getStatus();
    if (!status.rawQr) {
        return res.status(404).send('QR code not available yet');
    }
    try {
        const buffer = await QRCode.toBuffer(status.rawQr);
        res.type('png').send(buffer);
    } catch (e) {
        res.status(500).send('Error rendering QR PNG: ' + e.message);
    }
});

// POST /api/reset - Purge session and reinitialize client
router.post('/reset', async (req, res) => {
    const result = await whatsapp.resetSession();
    res.json(result);
});

// POST /api/pairing-code - Link device using phone pairing code instead of QR
router.post('/pairing-code', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    try {
        const result = await whatsapp.requestPairingCode(phone);
        res.json(result);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/check-number or /api/check-user - Verify WhatsApp registration (phone or @username)
const handleCheckUser = async (req, res) => {
    const target = req.body.phone || req.body.username || req.body.identifier || req.body.to;
    if (!target) {
        return res.status(400).json({ success: false, exists: false, message: 'Phone or username parameter is required.' });
    }
    const result = await whatsapp.checkNumberRegistered(target);
    res.json(result);
};
router.post('/check-number', handleCheckUser);
router.post('/check-user', handleCheckUser);

// POST /api/message-status - Check live ACK / delivery of a message
router.post('/message-status', async (req, res) => {
    const target = req.body.phone || req.body.username || req.body.to;
    const { message_id } = req.body;
    if (!target) {
        return res.status(400).json({ success: false, message: 'Phone or username parameter is required.' });
    }
    const result = await whatsapp.getMessageStatus(target, message_id);
    res.json(result);
});

// POST /api/sync-statuses - Batch sync statuses for notifications
router.post('/sync-statuses', async (req, res) => {
    const { items } = req.body;
    const result = await whatsapp.syncStatuses(items || []);
    res.json(result);
});

// GET /api/anti-ban-status - Anti-ban stats
router.get('/anti-ban-status', (req, res) => {
    res.json({
        success: true,
        ...queue.getStats()
    });
});

// POST /api/send - Send text message (anti-ban queued, supports phone or @username)
router.post('/send', async (req, res) => {
    const target = req.body.to || req.body.phone || req.body.username || req.body.recipient;
    const { message, priority = 'normal', options = {} } = req.body;

    if (!target || !message) {
        return res.status(400).json({
            success: false,
            message: 'Recipient (phone or @username) and message are required in request body.'
        });
    }

    if (!whatsapp.isReady) {
        return res.status(503).json({
            success: false,
            message: 'WhatsApp client is not ready. Please scan QR code first.'
        });
    }

    try {
        const result = await queue.enqueue({
            priority,
            meta: { to: target, messageSnippet: message.substring(0, 30) },
            taskFn: () => whatsapp.sendTextMessage(target, message, options)
        });

        res.json({
            ...result,
            daily_count: queue.getDailySendCount(),
            daily_limit: config.DAILY_SEND_LIMIT
        });
    } catch (err) {
        logger.error('API', `Send error to ${target}:`, err.message);
        res.status(500).json({
            success: false,
            message: 'Failed to send WhatsApp message: ' + err.message,
            error: err.message
        });
    }
});

// ====================================================================
// 2. EXTENDED RICH MESSAGING ENDPOINTS
// ====================================================================

// POST /api/messages/media - Send image, video, audio, voice note, or document
router.post('/messages/media', upload.single('file'), async (req, res) => {
    const target = req.body.to || req.body.phone || req.body.username || req.body.recipient;
    const { mediaUrl, caption = '', isVoice = false, filename } = req.body;
    const uploadedFile = req.file;

    if (!target) {
        return res.status(400).json({ success: false, message: 'Recipient (phone or @username) is required.' });
    }

    if (!uploadedFile && !mediaUrl) {
        return res.status(400).json({ success: false, message: 'Either file upload or mediaUrl is required.' });
    }

    try {
        const mediaSource = uploadedFile ? uploadedFile.path : mediaUrl;
        const finalFilename = filename || (uploadedFile ? uploadedFile.originalname : 'attachment');

        const result = await queue.enqueue({
            priority: 'normal',
            meta: { to: target, type: 'media' },
            taskFn: () => whatsapp.sendMediaMessage(
                target,
                mediaSource,
                finalFilename,
                uploadedFile ? uploadedFile.mimetype : null,
                caption,
                String(isVoice) === 'true'
            )
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/messages/location - Share location coordinates
router.post('/messages/location', async (req, res) => {
    const target = req.body.to || req.body.phone || req.body.username || req.body.recipient;
    const { latitude, longitude, description = '' } = req.body;
    if (!target || !latitude || !longitude) {
        return res.status(400).json({ success: false, message: 'Recipient, latitude and longitude are required.' });
    }

    try {
        const result = await queue.enqueue({
            priority: 'normal',
            meta: { to: target, type: 'location' },
            taskFn: () => whatsapp.sendLocationMessage(target, latitude, longitude, description)
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/messages/poll - Create interactive poll
router.post('/messages/poll', async (req, res) => {
    const target = req.body.to || req.body.phone || req.body.username || req.body.recipient;
    const { title, options, allowMultiple = false } = req.body;
    if (!target || !title || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ success: false, message: 'Recipient, title and at least 2 options are required.' });
    }

    try {
        const result = await queue.enqueue({
            priority: 'normal',
            meta: { to: target, type: 'poll' },
            taskFn: () => whatsapp.sendPollMessage(target, title, options, allowMultiple)
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/messages/contact - Share contact card
router.post('/messages/contact', async (req, res) => {
    const target = req.body.to || req.body.phone || req.body.username || req.body.recipient;
    const { contactPhone } = req.body;
    if (!target || !contactPhone) {
        return res.status(400).json({ success: false, message: 'Recipient and contactPhone are required.' });
    }

    try {
        const result = await queue.enqueue({
            priority: 'normal',
            meta: { to: target, type: 'contact' },
            taskFn: () => whatsapp.sendContactMessage(target, { phone: contactPhone })
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/messages/react - React with emoji
router.post('/messages/react', async (req, res) => {
    const { messageId, emoji } = req.body;
    if (!messageId || !emoji) {
        return res.status(400).json({ success: false, message: 'messageId and emoji are required.' });
    }
    try {
        const result = await whatsapp.reactToMessage(messageId, emoji);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/messages/delete - Revoke message
router.post('/messages/delete', async (req, res) => {
    const { messageId, everyone = true } = req.body;
    if (!messageId) {
        return res.status(400).json({ success: false, message: 'messageId is required.' });
    }
    try {
        const result = await whatsapp.deleteMessage(messageId, everyone);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================================================================
// 3. CHATS & CONVERSATIONS
// ====================================================================

// GET /api/chats - List conversations
router.get('/chats', async (req, res) => {
    try {
        const chats = await whatsapp.getChats(parseInt(req.query.limit || '40', 10));
        res.json({ success: true, chats });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/chats/:id/messages - Fetch messages for specific chat
router.get('/chats/:id/messages', async (req, res) => {
    try {
        const messages = await whatsapp.getChatMessages(req.params.id, parseInt(req.query.limit || '50', 10));
        res.json({ success: true, messages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/chats/:id/messages - Send text or media directly to a chat
router.post('/chats/:id/messages', upload.single('file'), async (req, res) => {
    const chatId = req.params.id;
    const { message, caption = '' } = req.body;
    const uploadedFile = req.file;

    try {
        if (uploadedFile) {
            const result = await queue.enqueue({
                priority: 'normal',
                meta: { to: chatId, type: 'chat_media' },
                taskFn: () => whatsapp.sendMediaMessage(
                    chatId,
                    uploadedFile.path,
                    uploadedFile.originalname,
                    uploadedFile.mimetype,
                    caption || message || ''
                )
            });
            return res.json(result);
        }

        if (!message) {
            return res.status(400).json({ success: false, message: 'Message text or file attachment is required.' });
        }

        const result = await queue.enqueue({
            priority: 'normal',
            meta: { to: chatId, type: 'chat_text' },
            taskFn: () => whatsapp.sendTextMessage(chatId, message)
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/chats/:id/read - Mark chat as read
router.post('/chats/:id/read', async (req, res) => {
    try {
        const result = await whatsapp.markChatRead(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================================================================
// 4. CONTACTS & NUMBER VALIDATION (WITH CSV SUPPORT)
// ====================================================================

// GET /api/contacts - List synced contacts
router.get('/contacts', async (req, res) => {
    try {
        const contacts = await whatsapp.getContacts();
        res.json({ success: true, contacts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/contacts/validate-bulk - Validate a list of numbers
router.post('/contacts/validate-bulk', async (req, res) => {
    const { numbers } = req.body;
    if (!Array.isArray(numbers) || numbers.length === 0) {
        return res.status(400).json({ success: false, message: 'numbers array is required' });
    }

    const results = [];
    for (const num of numbers.slice(0, 150)) {
        const r = await whatsapp.checkNumberRegistered(num);
        results.push({ phone: num, exists: r.exists, jid: r.jid || null, message: r.message });
    }

    res.json({
        success: true,
        total: results.length,
        registered: results.filter(r => r.exists).length,
        unregistered: results.filter(r => !r.exists).length,
        results
    });
});

// POST /api/contacts/validate-csv - Upload CSV file to bulk check numbers
router.post('/contacts/validate-csv', upload.single('csvFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'CSV file is required.' });
    }

    try {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const parsed = csvUtils.parseCsv(content);
        fs.unlinkSync(req.file.path); // Clean up temp file

        if (parsed.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid phone numbers found in CSV file.' });
        }

        const results = [];
        for (const item of parsed.slice(0, 200)) {
            const r = await whatsapp.checkNumberRegistered(item.phone);
            results.push({
                phone: item.phone,
                name: item.name,
                exists: r.exists,
                jid: r.jid || null
            });
        }

        res.json({
            success: true,
            total: results.length,
            registered: results.filter(r => r.exists).length,
            unregistered: results.filter(r => !r.exists).length,
            results
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'CSV processing failed: ' + err.message });
    }
});

// POST /api/contacts/export-csv - Generate downloadable CSV from validation results
router.post('/contacts/export-csv', (req, res) => {
    const { results } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
        return res.status(400).json({ success: false, message: 'results array is required.' });
    }

    const headers = ['phone', 'name', 'status', 'jid'];
    const rows = results.map(r => ({
        phone: r.phone,
        name: r.name || '',
        status: r.exists ? 'REGISTERED' : 'UNREGISTERED',
        jid: r.jid || ''
    }));

    const csvContent = csvUtils.generateCsv(headers, rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp-validation-results.csv"');
    res.send(csvContent);
});

// ====================================================================
// 5. GROUPS
// ====================================================================

// GET /api/groups - List all groups
router.get('/groups', async (req, res) => {
    try {
        const groups = await whatsapp.getGroups();
        res.json({ success: true, groups });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/groups/create - Create new group
router.post('/groups/create', async (req, res) => {
    const { title, participants } = req.body;
    if (!title || !Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({ success: false, message: 'title and participants array required.' });
    }
    try {
        const result = await whatsapp.createGroup(title, participants);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/groups/:id/invite - Get group invite URL
router.get('/groups/:id/invite', async (req, res) => {
    try {
        const result = await whatsapp.getGroupInvite(req.params.id);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================================================================
// 6. BULK BROADCAST CAMPAIGNS (WITH CSV UPLOAD)
// ====================================================================

// GET /api/campaigns - List campaigns
router.get('/campaigns', (req, res) => {
    res.json({ success: true, campaigns: campaigns.getCampaigns() });
});

// POST /api/campaigns - Create campaign
router.post('/campaigns', (req, res) => {
    const { name, template, contacts: rawContacts, mediaUrl, intervalSeconds } = req.body;
    if (!template || !Array.isArray(rawContacts) || rawContacts.length === 0) {
        return res.status(400).json({ success: false, message: 'template and contacts array are required.' });
    }
    const camp = campaigns.createCampaign({ name, template, contacts: rawContacts, mediaUrl, intervalSeconds });
    res.json({ success: true, campaign: camp });
});

// POST /api/campaigns/upload-csv - Upload and parse CSV contact file
router.post('/campaigns/upload-csv', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'CSV file is required.' });
    }

    try {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const parsed = csvUtils.parseCsv(content);
        fs.unlinkSync(req.file.path); // Clean up temp file

        if (parsed.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid phone numbers found in CSV file.' });
        }

        res.json({
            success: true,
            count: parsed.length,
            preview: parsed.slice(0, 5),
            contacts: parsed
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to parse CSV: ' + err.message });
    }
});

// POST /api/campaigns/:id/start - Run campaign
router.post('/campaigns/:id/start', async (req, res) => {
    try {
        const camp = await campaigns.startCampaign(req.params.id);
        res.json({ success: true, campaign: camp });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/campaigns/:id/pause - Pause campaign
router.post('/campaigns/:id/pause', (req, res) => {
    try {
        const camp = campaigns.pauseCampaign(req.params.id);
        res.json({ success: true, campaign: camp });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/campaigns/:id/resume - Resume campaign
router.post('/campaigns/:id/resume', async (req, res) => {
    try {
        const camp = await campaigns.resumeCampaign(req.params.id);
        res.json({ success: true, campaign: camp });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/campaigns/:id/cancel - Cancel campaign
router.post('/campaigns/:id/cancel', (req, res) => {
    try {
        const camp = campaigns.cancelCampaign(req.params.id);
        res.json({ success: true, campaign: camp });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// DELETE /api/campaigns/:id - Delete campaign
router.delete('/campaigns/:id', (req, res) => {
    campaigns.deleteCampaign(req.params.id);
    res.json({ success: true });
});

// ====================================================================
// 7. AUTO-RESPONDER RULES & TRIGGER SIMULATOR
// ====================================================================

// GET /api/autoresponder - List rules
router.get('/autoresponder', (req, res) => {
    res.json({ success: true, rules: responder.getRules() });
});

// POST /api/autoresponder - Add rule
router.post('/autoresponder', (req, res) => {
    const { name, triggerType, keywords, responseType, responseText, mediaUrl, cooldownSeconds } = req.body;
    if (!keywords || !responseText) {
        return res.status(400).json({ success: false, message: 'keywords and responseText are required.' });
    }
    const rule = responder.addRule({ name, triggerType, keywords, responseType, responseText, mediaUrl, cooldownSeconds });
    res.json({ success: true, rule });
});

// POST /api/autoresponder/test - Test / simulate trigger against text
router.post('/autoresponder/test', (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ success: false, message: 'text is required.' });
    }

    const clean = String(text).trim().toLowerCase();
    const rules = responder.getRules();
    let matchedRule = null;

    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (responder.testMatch(clean, rule)) {
            matchedRule = rule;
            break;
        }
    }

    res.json({
        success: true,
        matched: Boolean(matchedRule),
        rule: matchedRule
    });
});

// PUT /api/autoresponder/:id - Update rule
router.put('/autoresponder/:id', (req, res) => {
    const updated = responder.updateRule(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Rule not found' });
    res.json({ success: true, rule: updated });
});

// POST /api/autoresponder/:id/toggle - Toggle rule active state
router.post('/api/autoresponder/:id/toggle', (req, res) => {
    const rules = responder.getRules();
    const rule = rules.find(r => r.id === req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });

    const updated = responder.updateRule(req.params.id, { enabled: !rule.enabled });
    res.json({ success: true, rule: updated });
});

// DELETE /api/autoresponder/:id - Delete rule
router.delete('/autoresponder/:id', (req, res) => {
    responder.deleteRule(req.params.id);
    res.json({ success: true });
});

// ====================================================================
// 8. WEBHOOKS REGISTRY & HISTORY
// ====================================================================

// GET /api/webhooks - List webhook destinations
router.get('/webhooks', (req, res) => {
    res.json({ success: true, webhooks: webhooks.getWebhooks() });
});

// POST /api/webhooks - Add webhook
router.post('/webhooks', (req, res) => {
    const { url, events } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'url is required' });
    const hook = webhooks.addWebhook(url, events);
    res.json({ success: true, webhook: hook });
});

// DELETE /api/webhooks/:id - Remove webhook
router.delete('/webhooks/:id', (req, res) => {
    webhooks.removeWebhook(req.params.id);
    res.json({ success: true });
});

// POST /api/webhooks/test - Test trigger a ping payload
router.post('/webhooks/test', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'url is required' });

    try {
        await webhooks.sendToUrl(url, {
            event: 'test:ping',
            message: 'BotsApp Webhook Test Event',
            timestamp: new Date().toISOString()
        }, webhooks.signPayload(JSON.stringify({ test: true })), 'test:ping');
        res.json({ success: true, message: 'Test webhook event dispatched' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/webhooks/history - Recent webhook delivery logs
router.get('/webhooks/history', (req, res) => {
    res.json({ success: true, history: webhooks.getDeliveryHistory() });
});

// ====================================================================
// 9. LOGS & SYSTEM CONTROLS
// ====================================================================

// GET /api/logs - Live in-memory logs
router.get('/logs', (req, res) => {
    res.json({ success: true, logs: logger.getMemoryLogs() });
});

// POST /api/queue/clear - Clear pending queue
router.post('/queue/clear', (req, res) => {
    const cleared = queue.clear();
    res.json({ success: true, cleared_count: cleared });
});

// POST /api/queue/pause - Pause send queue
router.post('/queue/pause', (req, res) => {
    queue.pause();
    res.json({ success: true, is_paused: true });
});

// POST /api/queue/resume - Resume send queue
router.post('/queue/resume', (req, res) => {
    queue.resume();
    res.json({ success: true, is_paused: false });
});

module.exports = router;
