const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const config = require('./config');
const logger = require('./utils/logger');

const webhooksFilePath = path.join(config.DATA_DIR, 'webhooks.json');
const deliveryHistory = [];
const MAX_HISTORY = 50;

class WebhookManager {
    constructor() {
        this.webhooks = this.loadWebhooks();
        this.eventEmitter = null;
    }

    setEventEmitter(emitter) {
        this.eventEmitter = emitter;
    }

    loadWebhooks() {
        try {
            if (fs.existsSync(webhooksFilePath)) {
                const data = JSON.parse(fs.readFileSync(webhooksFilePath, 'utf8'));
                if (Array.isArray(data) && data.length > 0) {
                    return data;
                }
            }
        } catch (err) {
            logger.error('Webhooks', 'Failed to read webhooks file:', err.message);
        }

        // Initialize with config defaults
        const defaults = config.WEBHOOK_URLS.map((url, i) => ({
            id: 'wh_' + (i + 1),
            url,
            events: ['all'],
            enabled: true,
            createdAt: new Date().toISOString()
        }));
        this.saveWebhooks(defaults);
        return defaults;
    }

    saveWebhooks(list = this.webhooks) {
        try {
            fs.writeFileSync(webhooksFilePath, JSON.stringify(list, null, 2));
            this.webhooks = list;
        } catch (err) {
            logger.error('Webhooks', 'Failed to save webhooks file:', err.message);
        }
    }

    getWebhooks() {
        return this.webhooks;
    }

    addWebhook(url, events = ['all']) {
        const id = 'wh_' + Date.now().toString(36);
        const newHook = {
            id,
            url: url.trim(),
            events: Array.isArray(events) ? events : ['all'],
            enabled: true,
            createdAt: new Date().toISOString()
        };
        this.webhooks.push(newHook);
        this.saveWebhooks();
        logger.webhook(`Added webhook destination: ${url}`);
        return newHook;
    }

    removeWebhook(id) {
        this.webhooks = this.webhooks.filter(w => w.id !== id);
        this.saveWebhooks();
        logger.webhook(`Removed webhook ${id}`);
    }

    toggleWebhook(id, enabled) {
        const item = this.webhooks.find(w => w.id === id);
        if (item) {
            item.enabled = Boolean(enabled);
            this.saveWebhooks();
        }
        return item;
    }

    getDeliveryHistory() {
        return deliveryHistory;
    }

    signPayload(payloadString) {
        if (!config.WEBHOOK_SECRET) return null;
        return 'sha256=' + crypto.createHmac('sha256', config.WEBHOOK_SECRET)
            .update(payloadString)
            .digest('hex');
    }

    async dispatch(event, data) {
        const payloadObj = {
            event,
            timestamp: new Date().toISOString(),
            ...data
        };

        const payloadStr = JSON.stringify(payloadObj);
        const signature = this.signPayload(payloadStr);

        const activeHooks = this.webhooks.filter(w => {
            if (!w.enabled) return false;
            if (w.events.includes('all') || w.events.includes(event)) return true;
            return false;
        });

        // Fire asynchronous HTTP requests to all endpoints
        for (const hook of activeHooks) {
            this.sendToUrl(hook.url, payloadObj, signature, event);
        }
    }

    async sendToUrl(url, payload, signature, event) {
        const startTime = Date.now();
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'BotsApp-Webhook/2.0'
        };

        if (signature) {
            headers['X-Hub-Signature-256'] = signature;
        }

        try {
            const res = await axios.post(url, payload, {
                headers,
                timeout: 8000,
                validateStatus: () => true // Catch all statuses without throwing
            });

            const duration = Date.now() - startTime;
            const logEntry = {
                id: 'del_' + Date.now() + Math.random().toString(36).substring(2, 5),
                url,
                event,
                statusCode: res.status,
                durationMs: duration,
                success: res.status >= 200 && res.status < 300,
                timestamp: new Date().toISOString()
            };

            deliveryHistory.unshift(logEntry);
            if (deliveryHistory.length > MAX_HISTORY) deliveryHistory.pop();

            if (this.eventEmitter) {
                this.eventEmitter('webhook:delivered', logEntry);
            }

            if (res.status >= 200 && res.status < 300) {
                logger.webhook(`Delivered [${event}] to ${url} (${res.status} in ${duration}ms)`);
            } else {
                logger.warn('Webhook', `HTTP ${res.status} from ${url} for event [${event}]`);
            }
        } catch (err) {
            const duration = Date.now() - startTime;
            const logEntry = {
                id: 'del_' + Date.now() + Math.random().toString(36).substring(2, 5),
                url,
                event,
                statusCode: 0,
                durationMs: duration,
                success: false,
                error: err.message,
                timestamp: new Date().toISOString()
            };

            deliveryHistory.unshift(logEntry);
            if (deliveryHistory.length > MAX_HISTORY) deliveryHistory.pop();

            if (this.eventEmitter) {
                this.eventEmitter('webhook:delivered', logEntry);
            }

            logger.error('Webhook', `Failed to deliver [${event}] to ${url}: ${err.message}`);
        }
    }
}

module.exports = new WebhookManager();
