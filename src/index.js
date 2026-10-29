const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const whatsapp = require('./whatsapp');
const queue = require('./queue');
const campaigns = require('./campaigns');
const apiRoutes = require('./routes/api');
const authMiddleware = require('./middleware/auth');

// Crash protection guards
process.on('uncaughtException', (err) => {
    logger.error('CRASH_GUARD', 'Uncaught Exception:', err.stack || err.message || err);
});

process.on('unhandledRejection', (reason) => {
    logger.error('CRASH_GUARD', 'Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }
});

// Broadcast helper for real-time dashboard
function emitEvent(eventName, payload) {
    io.emit(eventName, payload);
}

// Wire real-time socket emitters
logger.setSocketEmitter(emitEvent);
whatsapp.setEventEmitter(emitEvent);
campaigns.init(whatsapp, queue, emitEvent);

// Global middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static frontend dashboard
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(config.UPLOADS_DIR));

// API Authentication & Routes
app.use('/api', authMiddleware, apiRoutes);

// Catch-all route to serve Dashboard SPA
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Socket.io connection logic
io.on('connection', (socket) => {
    logger.info('WebSocket', `Dashboard client connected: ${socket.id}`);

    // Send initial bootstrap state to new client
    socket.emit('session:status', whatsapp.getStatus());
    socket.emit('queue:update', queue.getStats());
    socket.emit('logs:batch', logger.getMemoryLogs().slice(0, 50));

    socket.on('disconnect', () => {
        logger.info('WebSocket', `Dashboard client disconnected: ${socket.id}`);
    });
});

// Server bootstrap
server.listen(config.PORT, config.HOST, () => {
    console.log('\n=============================================================');
    console.log(`  🚀 BotsApp Enterprise WhatsApp Gateway v2.0`);
    console.log(`  🌐 Dashboard: http://localhost:${config.PORT}`);
    console.log(`  🔗 API:       http://localhost:${config.PORT}/api/status`);
    console.log(`  🛡️  Anti-Ban:  Warmup Protection Active (${config.DAILY_SEND_LIMIT} msgs/day)`);
    console.log('=============================================================\n');

    logger.info('System', `BotsApp Server listening on http://${config.HOST}:${config.PORT}`);
    whatsapp.initialize();
});

module.exports = { app, server };
