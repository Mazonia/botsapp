const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Ensure data, uploads, and logs directories exist
const dataDir = path.resolve(__dirname, '../data');
const uploadsDir = path.resolve(__dirname, '../uploads');
const logsDir = path.resolve(__dirname, '../logs');
const authDir = path.resolve(__dirname, '../.wwebjs_auth');

[dataDir, uploadsDir, logsDir, authDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

module.exports = {
    PORT: parseInt(process.env.PORT || '3001', 10),
    HOST: process.env.HOST || '0.0.0.0',
    API_KEY: process.env.API_KEY || null,
    
    // Webhooks
    WEBHOOK_URLS: process.env.WEBHOOK_URLS 
        ? process.env.WEBHOOK_URLS.split(',').map(u => u.trim()).filter(Boolean)
        : [
            'http://127.0.0.1:8000/webhooks/whatsapp',
            'http://localhost:8000/webhooks/whatsapp'
        ],
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
    
    // Anti-ban & rate limiting
    DAILY_SEND_LIMIT: parseInt(process.env.WA_DAILY_LIMIT || '120', 10),
    ANTI_BAN_SPEED_MULTIPLIER: parseFloat(process.env.ANTI_BAN_SPEED_MULTIPLIER || '1.0'),
    WARMUP_PROTECTION: process.env.WARMUP_PROTECTION !== 'false',
    
    // Auto responder
    AUTO_RESPONDER_ENABLED: process.env.AUTO_RESPONDER_ENABLED !== 'false',
    
    // Puppeteer
    HEADLESS: process.env.HEADLESS !== 'false',
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    
    // Paths
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
    LOGS_DIR: logsDir,
    AUTH_DIR: authDir,
    SESSION_START_FILE: path.join(dataDir, '.session_start')
};

