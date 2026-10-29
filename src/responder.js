const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const phoneUtils = require('./utils/phone');

const responderFilePath = path.join(config.DATA_DIR, 'autoresponder.json');

class AutoResponder {
    constructor() {
        this.rules = this.loadRules();
        this.contactCooldowns = new Map(); // phone -> lastResponseTimestamp
        this.whatsappClient = null;
        this.queue = null;
    }

    init(whatsappClient, queue) {
        this.whatsappClient = whatsappClient;
        this.queue = queue;
    }

    loadRules() {
        try {
            if (fs.existsSync(responderFilePath)) {
                const data = JSON.parse(fs.readFileSync(responderFilePath, 'utf8'));
                if (Array.isArray(data)) return data;
            }
        } catch (err) {
            logger.error('AutoResponder', 'Failed to load rules:', err.message);
        }

        // Default initial rule
        const defaults = [
            {
                id: 'rule_welcome',
                name: 'Welcome & Info Trigger',
                enabled: true,
                triggerType: 'contains',
                keywords: ['hello', 'hi', 'hey', 'start', 'info'],
                responseType: 'text',
                responseText: '👋 Hello! Thank you for contacting us.\n\n🤖 This is an automated response from *BotsApp Gateway*.\n\nReply with *HELP* for options or visit our portal for more details.',
                cooldownSeconds: 300,
                createdAt: new Date().toISOString()
            },
            {
                id: 'rule_help',
                name: 'Help Menu',
                enabled: true,
                triggerType: 'exact',
                keywords: ['help', 'menu', 'options'],
                responseType: 'text',
                responseText: '📋 *BotsApp Menu Options:*\n\n1️⃣ Account Support\n2️⃣ Course Details & Onboarding\n3️⃣ Talk to an Agent\n\nPlease let us know how we can assist you!',
                cooldownSeconds: 60,
                createdAt: new Date().toISOString()
            }
        ];
        this.saveRules(defaults);
        return defaults;
    }

    saveRules(rules = this.rules) {
        try {
            fs.writeFileSync(responderFilePath, JSON.stringify(rules, null, 2));
            this.rules = rules;
        } catch (err) {
            logger.error('AutoResponder', 'Failed to save rules:', err.message);
        }
    }

    getRules() {
        return this.rules;
    }

    addRule(ruleData) {
        const id = 'rule_' + Date.now().toString(36);
        const rule = {
            id,
            name: ruleData.name || 'Untitled Rule',
            enabled: ruleData.enabled !== false,
            triggerType: ruleData.triggerType || 'contains',
            keywords: Array.isArray(ruleData.keywords) 
                ? ruleData.keywords.map(k => String(k).trim().toLowerCase()) 
                : [String(ruleData.keywords || '').trim().toLowerCase()],
            responseType: ruleData.responseType || 'text',
            responseText: ruleData.responseText || '',
            mediaUrl: ruleData.mediaUrl || null,
            cooldownSeconds: parseInt(ruleData.cooldownSeconds || '180', 10),
            createdAt: new Date().toISOString()
        };
        this.rules.push(rule);
        this.saveRules();
        logger.info('AutoResponder', `Added rule: ${rule.name}`);
        return rule;
    }

    updateRule(id, updates) {
        const index = this.rules.findIndex(r => r.id === id);
        if (index === -1) return null;

        this.rules[index] = {
            ...this.rules[index],
            ...updates,
            id // Protect ID
        };
        this.saveRules();
        return this.rules[index];
    }

    deleteRule(id) {
        this.rules = this.rules.filter(r => r.id !== id);
        this.saveRules();
        logger.info('AutoResponder', `Deleted rule: ${id}`);
        return true;
    }

    async handleIncomingMessage(msg) {
        if (!config.AUTO_RESPONDER_ENABLED) return;
        if (!msg || msg.fromMe) return; // Do not respond to self

        // Skip group messages by default to prevent spamming groups
        if (msg.from && msg.from.endsWith('@g.us')) return;

        const body = (msg.body || '').trim().toLowerCase();
        if (!body) return;

        const senderPhone = phoneUtils.cleanPhoneFromJid(msg.from);

        // Find first matching enabled rule
        for (const rule of this.rules) {
            if (!rule.enabled) continue;

            const isMatch = this.testMatch(body, rule);
            if (isMatch) {
                // Check cooldown for this contact and rule
                const cooldownKey = `${senderPhone}_${rule.id}`;
                const lastTrigger = this.contactCooldowns.get(cooldownKey) || 0;
                const now = Date.now();

                if (now - lastTrigger < (rule.cooldownSeconds || 60) * 1000) {
                    logger.antiBan(`Auto-responder skipped for ${senderPhone} (cooldown active)`);
                    return;
                }

                this.contactCooldowns.set(cooldownKey, now);

                // Format response variables
                const contact = await msg.getContact().catch(() => null);
                const pushname = contact?.pushname || contact?.name || 'there';
                const formattedResponse = rule.responseText
                    .replace(/\{name\}/gi, pushname)
                    .replace(/\{phone\}/gi, senderPhone)
                    .replace(/\{time\}/gi, new Date().toLocaleTimeString())
                    .replace(/\{date\}/gi, new Date().toLocaleDateString());

                logger.info('AutoResponder', `Triggered rule [${rule.name}] for ${senderPhone}`);

                // Queue the auto-reply safely
                if (this.whatsappClient && this.queue) {
                    this.queue.enqueue({
                        priority: 'normal',
                        meta: { to: senderPhone, category: 'autoresponder', rule: rule.name },
                        taskFn: async () => {
                            if (rule.responseType === 'media' && rule.mediaUrl) {
                                return this.whatsappClient.sendMediaMessage(
                                    senderPhone,
                                    rule.mediaUrl,
                                    'attachment',
                                    null,
                                    formattedResponse
                                );
                            } else {
                                return this.whatsappClient.sendTextMessage(senderPhone, formattedResponse);
                            }
                        }
                    }).catch(err => {
                        logger.error('AutoResponder', 'Failed to send auto-reply:', err.message);
                    });
                }
                break; // Handled by first matching rule
            }
        }
    }

    testMatch(text, rule) {
        const { triggerType, keywords } = rule;
        if (!keywords || keywords.length === 0) return false;

        switch (triggerType) {
            case 'exact':
                return keywords.some(k => text === k.toLowerCase());
            case 'startsWith':
                return keywords.some(k => text.startsWith(k.toLowerCase()));
            case 'regex':
                try {
                    const regex = new RegExp(keywords[0], 'i');
                    return regex.test(text);
                } catch (_) {
                    return false;
                }
            case 'contains':
            default:
                return keywords.some(k => text.includes(k.toLowerCase()));
        }
    }
}

module.exports = new AutoResponder();

