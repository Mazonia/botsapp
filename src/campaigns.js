const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const phoneUtils = require('./utils/phone');

const campaignsFilePath = path.join(config.DATA_DIR, 'campaigns.json');

class CampaignManager {
    constructor() {
        this.campaigns = this.loadCampaigns();
        this.activeCampaignId = null;
        this.isProcessing = false;
        this.whatsappClient = null;
        this.queue = null;
        this.eventEmitter = null;
    }

    init(whatsappClient, queue, eventEmitter) {
        this.whatsappClient = whatsappClient;
        this.queue = queue;
        this.eventEmitter = eventEmitter;
    }

    loadCampaigns() {
        try {
            if (fs.existsSync(campaignsFilePath)) {
                const data = JSON.parse(fs.readFileSync(campaignsFilePath, 'utf8'));
                if (Array.isArray(data)) return data;
            }
        } catch (err) {
            logger.error('Campaigns', 'Failed to read campaigns file:', err.message);
        }
        return [];
    }

    saveCampaigns() {
        try {
            fs.writeFileSync(campaignsFilePath, JSON.stringify(this.campaigns, null, 2));
        } catch (err) {
            logger.error('Campaigns', 'Failed to save campaigns file:', err.message);
        }
    }

    emitUpdate(campaign) {
        if (this.eventEmitter) {
            this.eventEmitter('campaign:update', campaign);
        }
    }

    getCampaigns() {
        return this.campaigns;
    }

    getCampaign(id) {
        return this.campaigns.find(c => c.id === id);
    }

    createCampaign({ name, template, contacts, mediaUrl = null, intervalSeconds = 20 }) {
        const id = 'camp_' + Date.now().toString(36);
        
        // Clean contacts
        const formattedContacts = contacts.map(c => ({
            phone: phoneUtils.normalizePhoneNumber(c.phone || c),
            name: c.name || '',
            customFields: c.customFields || {},
            status: 'pending',
            error: null,
            sentAt: null
        })).filter(c => phoneUtils.isValidPhone(c.phone));

        const campaign = {
            id,
            name: name || 'Broadcast ' + new Date().toLocaleDateString(),
            template,
            mediaUrl,
            intervalSeconds: Math.max(10, parseInt(intervalSeconds || '20', 10)),
            status: 'draft',
            contacts: formattedContacts,
            stats: {
                total: formattedContacts.length,
                sent: 0,
                failed: 0,
                pending: formattedContacts.length
            },
            createdAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null
        };

        this.campaigns.unshift(campaign);
        this.saveCampaigns();
        logger.info('Campaigns', `Created campaign "${campaign.name}" with ${formattedContacts.length} recipients`);
        return campaign;
    }

    async startCampaign(id) {
        const campaign = this.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status === 'running') throw new Error('Campaign already running');

        campaign.status = 'running';
        if (!campaign.startedAt) campaign.startedAt = new Date().toISOString();
        this.saveCampaigns();
        this.emitUpdate(campaign);

        logger.info('Campaigns', `Starting campaign: ${campaign.name}`);
        this.runCampaignLoop(campaign);
        return campaign;
    }

    pauseCampaign(id) {
        const campaign = this.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');

        campaign.status = 'paused';
        this.saveCampaigns();
        this.emitUpdate(campaign);
        logger.info('Campaigns', `Paused campaign: ${campaign.name}`);
        return campaign;
    }

    resumeCampaign(id) {
        return this.startCampaign(id);
    }

    cancelCampaign(id) {
        const campaign = this.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');

        campaign.status = 'cancelled';
        campaign.finishedAt = new Date().toISOString();
        this.saveCampaigns();
        this.emitUpdate(campaign);
        logger.info('Campaigns', `Cancelled campaign: ${campaign.name}`);
        return campaign;
    }

    deleteCampaign(id) {
        this.campaigns = this.campaigns.filter(c => c.id !== id);
        this.saveCampaigns();
        logger.info('Campaigns', `Deleted campaign ${id}`);
        return true;
    }

    async runCampaignLoop(campaign) {
        for (const contact of campaign.contacts) {
            // Check if paused or cancelled
            if (campaign.status !== 'running') {
                logger.info('Campaigns', `Campaign ${campaign.name} loop halted (status: ${campaign.status})`);
                break;
            }

            if (contact.status !== 'pending') continue;

            // Personalize message
            let personalized = campaign.template
                .replace(/\{\{name\}\}/gi, contact.name || 'there')
                .replace(/\{\{phone\}\}/gi, contact.phone);

            // Replace custom fields
            if (contact.customFields && typeof contact.customFields === 'object') {
                for (const [k, v] of Object.entries(contact.customFields)) {
                    personalized = personalized.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gi'), String(v));
                }
            }

            try {
                // Submit to SendQueue
                await this.queue.enqueue({
                    priority: 'normal',
                    meta: { to: contact.phone, category: 'campaign', campaignId: campaign.id },
                    taskFn: async () => {
                        if (campaign.mediaUrl) {
                            return this.whatsappClient.sendMediaMessage(
                                contact.phone,
                                campaign.mediaUrl,
                                'broadcast',
                                null,
                                personalized
                            );
                        } else {
                            return this.whatsappClient.sendTextMessage(contact.phone, personalized);
                        }
                    }
                });

                contact.status = 'sent';
                contact.sentAt = new Date().toISOString();
                campaign.stats.sent++;
                campaign.stats.pending--;
            } catch (err) {
                contact.status = 'failed';
                contact.error = err.message;
                campaign.stats.failed++;
                campaign.stats.pending--;
                logger.error('Campaigns', `Failed message to ${contact.phone} in campaign ${campaign.name}:`, err.message);
            }

            this.saveCampaigns();
            this.emitUpdate(campaign);
        }

        // Check if finished
        const pendingCount = campaign.contacts.filter(c => c.status === 'pending').length;
        if (pendingCount === 0 && campaign.status === 'running') {
            campaign.status = 'completed';
            campaign.finishedAt = new Date().toISOString();
            this.saveCampaigns();
            this.emitUpdate(campaign);
            logger.success('Campaigns', `Campaign completed: ${campaign.name}`);
        }
    }
}

module.exports = new CampaignManager();

