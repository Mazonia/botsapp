const fs = require('fs');
const path = require('path');
const config = require('../config');

const logFilePath = path.join(config.LOGS_DIR, 'botsapp.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

const MAX_MEMORY_LOGS = 200;
const memoryLogs = [];
let socketEmitter = null;

function setSocketEmitter(emitter) {
    socketEmitter = emitter;
}

function formatLog(level, category, message, meta = null) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ' ' + (typeof meta === 'object' ? JSON.stringify(meta) : String(meta)) : '';
    const fullText = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${metaStr}`;
    
    // File write
    try {
        logStream.write(fullText + '\n');
    } catch (_) {}

    // Memory buffer
    const logItem = {
        id: Date.now() + Math.random().toString(36).substring(2, 7),
        timestamp,
        level,
        category,
        message,
        meta
    };
    memoryLogs.unshift(logItem);
    if (memoryLogs.length > MAX_MEMORY_LOGS) {
        memoryLogs.pop();
    }

    // Socket emit if live client is listening
    if (socketEmitter) {
        try {
            socketEmitter('log:new', logItem);
        } catch (_) {}
    }

    return fullText;
}

const logger = {
    setSocketEmitter,
    getMemoryLogs() {
        return memoryLogs;
    },
    clearLogs() {
        memoryLogs.length = 0;
    },
    info(category, message, meta) {
        const text = formatLog('info', category, message, meta);
        console.log('\x1b[36m%s\x1b[0m', text);
    },
    success(category, message, meta) {
        const text = formatLog('success', category, message, meta);
        console.log('\x1b[32m%s\x1b[0m', text);
    },
    warn(category, message, meta) {
        const text = formatLog('warn', category, message, meta);
        console.warn('\x1b[33m%s\x1b[0m', text);
    },
    error(category, message, meta) {
        const text = formatLog('error', category, message, meta);
        console.error('\x1b[31m%s\x1b[0m', text);
    },
    antiBan(message, meta) {
        const text = formatLog('anti-ban', 'AntiBan', message, meta);
        console.log('\x1b[35m%s\x1b[0m', text);
    },
    webhook(message, meta) {
        const text = formatLog('webhook', 'Webhook', message, meta);
        console.log('\x1b[34m%s\x1b[0m', text);
    }
};

module.exports = logger;
