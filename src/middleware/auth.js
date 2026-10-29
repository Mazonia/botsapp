const config = require('../config');

function authMiddleware(req, res, next) {
    // If no API key configured, permit all requests
    if (!config.API_KEY || config.API_KEY.trim() === '') {
        return next();
    }

    // Allow static frontend assets, dashboard UI, and health checks without auth
    if (
        req.path === '/' ||
        req.path.startsWith('/css') ||
        req.path.startsWith('/js') ||
        req.path.startsWith('/assets') ||
        req.path.startsWith('/docs') ||
        req.path === '/favicon.ico' ||
        req.path === '/api/health'
    ) {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];

    let providedKey = apiKeyHeader;
    if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.substring(7).trim();
    }

    if (!providedKey || providedKey !== config.API_KEY) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Invalid or missing API key. Provide "X-Api-Key" header or "Authorization: Bearer <key>".'
        });
    }

    next();
}

module.exports = authMiddleware;

