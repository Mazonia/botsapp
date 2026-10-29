const { Client, LocalAuth, MessageMedia, Location, Poll } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const phoneUtils = require('./utils/phone');
const queue = require('./queue');
const webhooks = require('./webhooks');
const responder = require('./responder');

class WhatsAppGateway {
    constructor() {
        this.client = null;
        this.isReady = false;
        this.isAuthenticating = false;
        this.latestQrRaw = null;
        this.latestQrDataUrl = null;
        this.clientInfo = null;
        this.eventEmitter = null;
    }

    setEventEmitter(emitter) {
        this.eventEmitter = emitter;
        queue.setEventEmitter(emitter);
        webhooks.setEventEmitter(emitter);
    }

    emit(event, data) {
        if (this.eventEmitter) {
            this.eventEmitter(event, data);
        }
    }

    initialize() {
        logger.info('Gateway', 'Initializing WhatsApp Client instance...');

        const puppeteerOptions = {
            headless: config.HEADLESS,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zombie-tab',
                '--disable-gpu',
                '--disable-extensions'
            ]
        };

        if (config.PUPPETEER_EXECUTABLE_PATH) {
            puppeteerOptions.executablePath = config.PUPPETEER_EXECUTABLE_PATH;
        }

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: config.AUTH_DIR }),
            puppeteer: puppeteerOptions
        });

        // Initialize queue and responder with this client
        queue.setClientGetter(() => this.client);
        responder.init(this, queue);

        this.bindEvents();

        this.client.initialize().catch(err => {
            logger.error('Gateway', 'Initialization error:', err.message || err);
        });
    }

    bindEvents() {
        this.client.on('qr', async (qr) => {
            this.isReady = false;
            this.isAuthenticating = false;
            this.latestQrRaw = qr;

            try {
                this.latestQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
            } catch (err) {
                logger.error('Gateway', 'Failed to generate QR Data URL:', err.message);
            }

            logger.info('Gateway', 'QR Code generated. Scan with WhatsApp app.');
            qrcodeTerminal.generate(qr, { small: true });

            this.emit('session:qr', { qr: this.latestQrDataUrl, raw: qr });
            webhooks.dispatch('session:qr', { hasQr: true });
        });

        this.client.on('authenticated', () => {
            logger.info('Gateway', 'WhatsApp session authenticated. Restoring state...');
            this.isAuthenticating = true;
            this.latestQrRaw = null;
            this.latestQrDataUrl = null;
            this.emit('session:authenticated', { message: 'Restoring saved session...' });
        });

        this.client.on('ready', async () => {
            this.isReady = true;
            this.isAuthenticating = false;
            this.latestQrRaw = null;
            this.latestQrDataUrl = null;

            // Fetch device details
            let info = {
                pushname: 'WhatsApp User',
                phone: null,
                wid: null,
                platform: 'WhatsApp Web'
            };

            try {
                if (this.client.info) {
                    info.pushname = this.client.info.pushname || 'WhatsApp User';
                    info.phone = this.client.info.wid ? phoneUtils.cleanPhoneFromJid(this.client.info.wid.user) : null;
                    info.wid = this.client.info.wid?._serialized || null;
                    info.platform = this.client.info.platform || 'WhatsApp Web';
                }
            } catch (_) {}

            this.clientInfo = info;

            // Check and set session start for anti-ban warmup
            if (!fs.existsSync(config.SESSION_START_FILE)) {
                queue.recordSessionStart();
            }

            const age = queue.getSessionAgeHours();
            logger.success('Gateway', `WhatsApp Gateway is READY! Connected as: ${info.pushname} (+${info.phone || 'unknown'})`);
            logger.antiBan(`Session age: ${age > 999 ? 'Unknown' : age.toFixed(1) + 'h'}. Rate profile: ${queue.getInterMessageDelay().label}`);

            this.emit('session:ready', { ready: true, clientInfo: this.clientInfo });
            webhooks.dispatch('session:ready', { clientInfo: this.clientInfo });
        });

        this.client.on('auth_failure', (msg) => {
            logger.error('Gateway', 'Authentication failure:', msg);
            this.isReady = false;
            this.isAuthenticating = false;
            this.latestQrRaw = null;
            this.latestQrDataUrl = null;
            this.emit('session:auth_failure', { error: msg });
            webhooks.dispatch('session:auth_failure', { error: msg });
        });

        this.client.on('disconnected', (reason) => {
            logger.warn('Gateway', `WhatsApp disconnected: ${reason}`);
            this.isReady = false;
            this.isAuthenticating = false;
            this.latestQrRaw = null;
            this.latestQrDataUrl = null;
            this.clientInfo = null;

            this.emit('session:disconnected', { reason });
            webhooks.dispatch('session:disconnected', { reason });

            // Auto-reconnect after 5 seconds
            setTimeout(() => {
                try {
                    logger.info('Gateway', 'Attempting automatic client reconnect...');
                    this.initialize();
                } catch (e) {
                    logger.error('Gateway', 'Auto-reconnect handler error:', e.message);
                }
            }, 5000);
        });

        this.client.on('message', async (msg) => {
            try {
                const senderPhone = phoneUtils.cleanPhoneFromJid(msg.from);
                const isGroup = Boolean(msg.from && msg.from.endsWith('@g.us'));

                const messagePayload = {
                    id: msg.id?._serialized || msg.id?.id,
                    from: msg.from,
                    to: msg.to,
                    phone: senderPhone,
                    body: msg.body,
                    type: msg.type,
                    hasMedia: msg.hasMedia,
                    timestamp: msg.timestamp,
                    isGroup,
                    fromMe: msg.fromMe
                };

                logger.info('Message', `Incoming ${isGroup ? 'Group' : 'Direct'} message from +${senderPhone}: "${(msg.body || '').substring(0, 40)}"`);

                this.emit('message:received', messagePayload);
                webhooks.dispatch('message:received', messagePayload);

                // Auto-responder check
                await responder.handleIncomingMessage(msg);
            } catch (err) {
                logger.error('Message', 'Error processing incoming message:', err.message);
            }
        });

        this.client.on('message_ack', (msg, ack) => {
            try {
                const rawId = msg?.id?.id || null;
                const serializedId = msg?.id?._serialized || null;
                const messageId = serializedId || rawId || (typeof msg?.id === 'string' ? msg.id : null);
                const phone = msg.to ? phoneUtils.cleanPhoneFromJid(msg.to) : null;

                let status = 'sent';
                if (ack === 2) status = 'delivered';
                if (ack === 3 || ack === 4) status = 'read';
                if (ack === -1) status = 'failed';

                logger.info('Ack', `ACK Msg: ${messageId}, Phone: ${phone}, Ack: ${ack}, Status: ${status}`);

                const ackPayload = {
                    message_id: messageId,
                    serialized_id: serializedId,
                    raw_id: rawId,
                    phone: phone,
                    ack: ack,
                    status: status,
                    timestamp: Date.now()
                };

                this.emit('message:ack', ackPayload);
                // Dispatch backward-compatible webhook to Laravel and configured destinations
                webhooks.dispatch('message:ack', ackPayload);
            } catch (err) {
                logger.error('Ack', 'Error processing message_ack event:', err.message);
            }
        });

        this.client.on('message_revoke_everyone', (after, before) => {
            const payload = {
                message_id: after?.id?._serialized || after?.id?.id,
                before_body: before?.body || null
            };
            this.emit('message:revoked', payload);
            webhooks.dispatch('message:revoked', payload);
        });
    }

    async resolveTargetJid(phoneOrJid) {
        const clean = phoneUtils.normalizePhoneNumber(phoneOrJid);
        if (clean.endsWith('@g.us')) return clean;

        let targetJid = `${clean}@c.us`;
        try {
            if (this.client && typeof this.client.getNumberId === 'function') {
                const numberId = await this.client.getNumberId(clean);
                if (numberId && numberId._serialized) {
                    targetJid = numberId._serialized;
                }
            }
        } catch (_) {}
        return targetJid;
    }

    async emulateTyping(targetJid, durationMs) {
        try {
            let chat = await this.client.getChatById(targetJid).catch(() => null);
            if (chat && typeof chat.sendStateTyping === 'function') {
                await chat.sendStateTyping().catch(() => {});
                await new Promise(r => setTimeout(r, durationMs));
                await chat.clearState().catch(() => {});
                return;
            }
        } catch (_) {}
        // Fallback delay if chat typing state fails
        await new Promise(r => setTimeout(r, Math.min(durationMs, 5000)));
    }

    async sendTextMessage(to, message, options = {}) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not connected. Please scan the QR code first.');
        }

        const targetJid = await this.resolveTargetJid(to);
        const typingDuration = queue.calculateTypingDuration(message);

        logger.antiBan(`Emulating typing for ${(typingDuration / 1000).toFixed(1)}s to ${to}`);
        await this.emulateTyping(targetJid, typingDuration);

        const response = await this.client.sendMessage(targetJid, message, options);
        const messageId = response?.id?._serialized || response?.id?.id || 'sent_' + Date.now();

        return {
            success: true,
            message: 'Message sent successfully',
            message_id: messageId,
            whatsapp_registered: true,
            response: { id: messageId }
        };
    }

    async sendMediaMessage(to, mediaSource, filename = 'attachment', mimetype = null, caption = '', isVoice = false) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not connected.');
        }

        const targetJid = await this.resolveTargetJid(to);
        let media = null;

        if (typeof mediaSource === 'string') {
            if (mediaSource.startsWith('http://') || mediaSource.startsWith('https://')) {
                media = await MessageMedia.fromUrl(mediaSource, { unsafeMime: true });
            } else if (mediaSource.startsWith('data:')) {
                // Base64 Data URL
                const matches = mediaSource.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches) {
                    media = new MessageMedia(matches[1], matches[2], filename);
                }
            } else if (fs.existsSync(mediaSource)) {
                media = MessageMedia.fromFilePath(mediaSource);
            }
        } else if (Buffer.isBuffer(mediaSource)) {
            media = new MessageMedia(mimetype || 'application/octet-stream', mediaSource.toString('base64'), filename);
        }

        if (!media) {
            throw new Error('Invalid media source or file could not be read.');
        }

        if (filename && !media.filename) {
            media.filename = filename;
        }

        const sendOptions = { caption };
        if (isVoice) {
            sendOptions.sendAudioAsVoice = true;
        }

        await this.emulateTyping(targetJid, 4000);
        const response = await this.client.sendMessage(targetJid, media, sendOptions);
        const messageId = response?.id?._serialized || response?.id?.id || 'sent_' + Date.now();

        return {
            success: true,
            message: 'Media sent successfully',
            message_id: messageId,
            response: { id: messageId }
        };
    }

    async sendLocationMessage(to, latitude, longitude, description = '') {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const targetJid = await this.resolveTargetJid(to);
        const location = new Location(parseFloat(latitude), parseFloat(longitude), description);
        const response = await this.client.sendMessage(targetJid, location);
        const messageId = response?.id?._serialized || response?.id?.id;
        return { success: true, message: 'Location sent successfully', message_id: messageId };
    }

    async sendPollMessage(to, title, options, allowMultipleAnswers = false) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const targetJid = await this.resolveTargetJid(to);
        const poll = new Poll(title, options, { allowMultipleAnswers });
        const response = await this.client.sendMessage(targetJid, poll);
        const messageId = response?.id?._serialized || response?.id?.id;
        return { success: true, message: 'Poll sent successfully', message_id: messageId };
    }

    async sendContactMessage(to, contactCard) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const targetJid = await this.resolveTargetJid(to);
        const contactJid = await this.resolveTargetJid(contactCard.phone);
        const contact = await this.client.getContactById(contactJid).catch(() => null);

        if (!contact) {
            throw new Error(`Contact not found for phone: ${contactCard.phone}`);
        }

        const response = await this.client.sendMessage(targetJid, contact);
        const messageId = response?.id?._serialized || response?.id?.id;
        return { success: true, message: 'Contact shared successfully', message_id: messageId };
    }

    async reactToMessage(messageId, emoji) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const msg = await this.client.getMessageById(messageId).catch(() => null);
        if (!msg) throw new Error('Message not found');
        await msg.react(emoji);
        return { success: true, message: `Reacted with ${emoji}` };
    }

    async deleteMessage(messageId, everyone = true) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const msg = await this.client.getMessageById(messageId).catch(() => null);
        if (!msg) throw new Error('Message not found');
        await msg.delete(everyone);
        return { success: true, message: 'Message deleted' };
    }

    async checkNumberRegistered(phone) {
        if (!this.isReady) {
            return { success: false, exists: false, message: 'WhatsApp client is not ready.' };
        }

        const clean = phoneUtils.normalizePhoneNumber(phone);
        const jid = `${clean}@c.us`;

        try {
            let isRegistered = false;
            let finalJid = jid;

            // Strategy 1: getNumberId
            if (typeof this.client.getNumberId === 'function') {
                const numberId = await this.client.getNumberId(clean).catch(() => null);
                if (numberId) {
                    isRegistered = true;
                    finalJid = numberId._serialized || jid;
                }
            }

            // Strategy 2: isRegisteredUser
            if (!isRegistered && typeof this.client.isRegisteredUser === 'function') {
                isRegistered = await this.client.isRegisteredUser(jid).catch(() => false);
            }

            // Strategy 3: getContactById
            if (!isRegistered) {
                const contact = await this.client.getContactById(jid).catch(() => null);
                if (contact && (contact.isWAContact || contact.isUser)) {
                    isRegistered = true;
                }
            }

            return {
                success: true,
                phone: clean,
                exists: Boolean(isRegistered),
                jid: finalJid,
                message: isRegistered 
                    ? `Phone number +${clean} is registered on WhatsApp.` 
                    : `Phone number +${clean} is NOT registered on WhatsApp.`
            };
        } catch (err) {
            return {
                success: false,
                phone: clean,
                exists: false,
                message: 'Failed to verify WhatsApp number: ' + err.message
            };
        }
    }

    async getMessageStatus(phone, messageId = null) {
        if (!this.isReady) {
            return { success: false, exists: false, message: 'WhatsApp client is not ready.' };
        }

        const clean = phoneUtils.normalizePhoneNumber(phone);
        const targetJid = `${clean}@c.us`;

        try {
            const chat = await this.client.getChatById(targetJid).catch(() => null);
            if (!chat) {
                return { success: true, exists: true, phone: clean, found_message: false, status: 'sent', ack: 1 };
            }

            const messages = await chat.fetchMessages({ limit: 15 }).catch(() => []);
            let targetMsg = null;

            if (messageId) {
                targetMsg = messages.find(m => m.id && (m.id.id === messageId || m.id._serialized === messageId || (m.id.id && messageId.includes(m.id.id))));
            }

            if (!targetMsg) {
                // Find most recent message sent by bot
                targetMsg = [...messages].reverse().find(m => m.fromMe === true);
            }

            if (!targetMsg) {
                return { success: true, exists: true, phone: clean, found_message: false, status: 'sent', ack: 1 };
            }

            const ack = typeof targetMsg.ack === 'number' ? targetMsg.ack : 1;
            let status = 'sent';
            if (ack === 2) status = 'delivered';
            if (ack >= 3) status = 'opened';
            if (ack === -1) status = 'failed';

            return {
                success: true,
                exists: true,
                phone: clean,
                found_message: true,
                message_id: targetMsg.id?._serialized || targetMsg.id?.id,
                ack: ack,
                status: status,
                delivered: ack >= 2,
                read: ack >= 3,
                timestamp: targetMsg.timestamp
            };
        } catch (err) {
            return { success: false, phone: clean, message: 'Error checking status: ' + err.message };
        }
    }

    async syncStatuses(items) {
        if (!this.isReady) return { success: false, message: 'WhatsApp client is not ready.' };
        if (!Array.isArray(items) || items.length === 0) return { success: true, results: [] };

        const results = [];
        for (const item of items.slice(0, 50)) {
            const phone = item.phone;
            if (!phone) continue;

            const status = await this.getMessageStatus(phone, item.message_id);
            results.push({
                id: item.id,
                phone: phoneUtils.normalizePhoneNumber(phone),
                message_id: status.message_id || item.message_id,
                ack: status.ack || 1,
                status: status.status || 'sent',
                delivered: Boolean(status.delivered),
                read: Boolean(status.read)
            });
        }

        return { success: true, results };
    }

    async getChats(limit = 30) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const rawChats = await this.client.getChats();
        const sorted = rawChats.slice(0, limit).map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            isGroup: c.isGroup,
            unreadCount: c.unreadCount,
            timestamp: c.timestamp,
            lastMessage: c.lastMessage ? {
                body: c.lastMessage.body,
                type: c.lastMessage.type,
                timestamp: c.lastMessage.timestamp,
                fromMe: c.lastMessage.fromMe
            } : null
        }));
        return sorted;
    }

    async getChatMessages(chatId, limit = 40) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const chat = await this.client.getChatById(chatId);
        if (!chat) throw new Error('Chat not found');
        const msgs = await chat.fetchMessages({ limit });
        return msgs.map(m => ({
            id: m.id._serialized,
            from: m.from,
            to: m.to,
            fromMe: m.fromMe,
            body: m.body,
            type: m.type,
            hasMedia: m.hasMedia,
            ack: m.ack,
            timestamp: m.timestamp
        }));
    }

    async markChatRead(chatId) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const chat = await this.client.getChatById(chatId);
        if (chat && typeof chat.sendSeen === 'function') {
            await chat.sendSeen();
            return { success: true };
        }
        return { success: false };
    }

    async getContacts() {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const contacts = await this.client.getContacts();
        return contacts
            .filter(c => c.isWAContact && !c.isGroup)
            .map(c => ({
                id: c.id._serialized,
                number: c.number,
                name: c.name || c.pushname || c.number,
                pushname: c.pushname
            }));
    }

    async getGroups() {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const chats = await this.client.getChats();
        const groups = chats.filter(c => c.isGroup).map(g => ({
            id: g.id._serialized,
            name: g.name,
            participantsCount: g.groupMetadata?.participants?.length || 0,
            desc: g.groupMetadata?.desc || '',
            owner: g.groupMetadata?.owner?._serialized || null
        }));
        return groups;
    }

    async createGroup(title, participants) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const participantJids = participants.map(p => phoneUtils.toJid(p));
        const result = await this.client.createGroup(title, participantJids);
        return result;
    }

    async getGroupInvite(groupId) {
        if (!this.isReady) throw new Error('WhatsApp client is not connected.');
        const chat = await this.client.getChatById(groupId);
        if (!chat || !chat.isGroup) throw new Error('Group not found');
        const code = await chat.getInviteCode();
        return { invite_code: code, invite_url: `https://chat.whatsapp.com/${code}` };
    }

    async requestPairingCode(phoneNumber) {
        if (!this.client) throw new Error('WhatsApp client is not initialized.');
        const cleanPhone = phoneUtils.normalizePhoneNumber(phoneNumber);
        if (typeof this.client.requestPairingCode === 'function') {
            const code = await this.client.requestPairingCode(cleanPhone);
            logger.info('Gateway', `Generated pairing code for +${cleanPhone}: ${code}`);
            return { success: true, pairing_code: code };
        }
        throw new Error('Pairing code linking is not supported by current client version. Use QR scanning.');
    }

    async resetSession() {
        logger.warn('Gateway', 'Session reset initiated. Purging authentication tokens...');
        this.isReady = false;
        this.isAuthenticating = false;
        this.latestQrRaw = null;
        this.latestQrDataUrl = null;
        this.clientInfo = null;

        try {
            if (this.client && typeof this.client.destroy === 'function') {
                await Promise.race([
                    this.client.destroy(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 6000))
                ]).catch(() => {});
            }
        } catch (_) {}

        // Remove auth directory
        if (fs.existsSync(config.AUTH_DIR)) {
            try {
                fs.rmSync(config.AUTH_DIR, { recursive: true, force: true });
                logger.info('Gateway', 'Session directory purged.');
            } catch (e) {
                logger.warn('Gateway', `Notice clearing auth directory: ${e.message}`);
            }
        }

        // Reset session age & counters
        queue.resetSessionAge();

        // Re-initialize client
        setTimeout(() => {
            this.initialize();
        }, 1500);

        return {
            success: true,
            message: 'WhatsApp session reset initiated. New QR code will be available in ~5-10 seconds.'
        };
    }

    getStatus() {
        const queueStats = queue.getStats();
        return {
            online: true,
            success: true,
            authenticated: this.isReady,
            state: this.isReady ? 'CONNECTED' : (this.isAuthenticating ? 'AUTHENTICATING' : 'INITIALIZING'),
            hasQr: !!this.latestQrDataUrl,
            qr: this.latestQrDataUrl,
            rawQr: this.latestQrRaw,
            client_info: this.clientInfo,
            ...queueStats,
            message: this.isReady
                ? 'WhatsApp client is active and authenticated.'
                : (this.isAuthenticating 
                    ? 'WhatsApp client is restoring session... Please wait a few seconds.' 
                    : (this.latestQrDataUrl ? 'QR code available. Scan with WhatsApp app.' : 'WhatsApp client is initializing. Scan QR if prompt appears.'))
        };
    }
}

module.exports = new WhatsAppGateway();
