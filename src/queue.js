const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

class SendQueue {
    constructor() {
        this.queue = [];
        this.isRunning = false;
        this.isPaused = false;
        this.dailyCount = 0;
        this.dailyDate = new Date().toDateString();
        this.eventEmitter = null;
        this.clientGetter = null;
    }

    setEventEmitter(emitter) {
        this.eventEmitter = emitter;
    }

    setClientGetter(fn) {
        this.clientGetter = fn;
    }

    emitQueueChange() {
        if (this.eventEmitter) {
            this.eventEmitter('queue:update', this.getStats());
        }
    }

    getDailySendCount() {
        const today = new Date().toDateString();
        if (today !== this.dailyDate) {
            this.dailyDate = today;
            this.dailyCount = 0;
        }
        return this.dailyCount;
    }

    incrementDailyCount() {
        this.getDailySendCount();
        this.dailyCount++;
        this.emitQueueChange();
        return this.dailyCount;
    }

    getSessionAgeHours() {
        try {
            if (fs.existsSync(config.SESSION_START_FILE)) {
                const ts = parseInt(fs.readFileSync(config.SESSION_START_FILE, 'utf8'), 10);
                return (Date.now() - ts) / (1000 * 60 * 60);
            }
        } catch (_) {}
        return 999; // Default to warmed if file not present
    }

    recordSessionStart() {
        try {
            fs.writeFileSync(config.SESSION_START_FILE, String(Date.now()));
            logger.antiBan('New WhatsApp session recorded. Warmup delays active.');
        } catch (err) {
            logger.error('AntiBan', 'Failed to write session start file', err.message);
        }
    }

    resetSessionAge() {
        try {
            if (fs.existsSync(config.SESSION_START_FILE)) {
                fs.unlinkSync(config.SESSION_START_FILE);
            }
            this.dailyCount = 0;
            this.emitQueueChange();
        } catch (_) {}
    }

    getInterMessageDelay() {
        if (!config.WARMUP_PROTECTION) {
            return { min: 4000, max: 8000, label: 'warmup-disabled (4–8s)' };
        }

        const ageHours = this.getSessionAgeHours();
        const multiplier = config.ANTI_BAN_SPEED_MULTIPLIER || 1.0;

        let delay;
        if (ageHours < 1) {
            delay = { min: 45000, max: 90000, label: 'new-session (45–90s)' };
        } else if (ageHours < 24) {
            delay = { min: 20000, max: 40000, label: 'day-1 warmup (20–40s)' };
        } else if (ageHours < 72) {
            delay = { min: 12000, max: 25000, label: 'day-2/3 warmup (12–25s)' };
        } else {
            delay = { min: 6000, max: 15000, label: 'warmed (6–15s)' };
        }

        return {
            min: Math.round(delay.min * multiplier),
            max: Math.round(delay.max * multiplier),
            label: `${delay.label} [x${multiplier}]`
        };
    }

    calculateTypingDuration(text) {
        if (!text) return 3000;
        const charsPerSec = 35 + Math.random() * 20; // 35-55 chars/sec
        const rawMs = (text.length / charsPerSec) * 1000;
        // Cap between 4s and 25s
        return Math.min(25000, Math.max(4000, rawMs));
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async randomDelay(minMs, maxMs) {
        const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        await this.sleep(ms);
    }

    enqueue({ taskFn, priority = 'normal', meta = {} }) {
        return new Promise((resolve, reject) => {
            const job = {
                id: 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                priority,
                meta,
                taskFn,
                resolve,
                reject,
                createdAt: new Date().toISOString()
            };

            // High priority jobs go to the front
            if (priority === 'high') {
                const insertIndex = this.queue.findIndex(j => j.priority !== 'high');
                if (insertIndex === -1) {
                    this.queue.push(job);
                } else {
                    this.queue.splice(insertIndex, 0, job);
                }
            } else {
                this.queue.push(job);
            }

            logger.antiBan(`Job enqueued (${priority}): ${meta.to || 'unknown'}, queue size: ${this.queue.length}`);
            this.emitQueueChange();
            this.process();
        });
    }

    async process() {
        if (this.isRunning || this.isPaused || this.queue.length === 0) {
            return;
        }

        this.isRunning = true;

        while (this.queue.length > 0 && !this.isPaused) {
            const currentDaily = this.getDailySendCount();
            if (currentDaily >= config.DAILY_SEND_LIMIT) {
                logger.warn('AntiBan', `Daily limit of ${config.DAILY_SEND_LIMIT} reached. Queue paused until midnight.`);
                const err = new Error(`Daily send limit (${config.DAILY_SEND_LIMIT}) reached. Paused to prevent WhatsApp ban.`);
                
                // Reject all remaining jobs in queue
                while (this.queue.length > 0) {
                    const droppedJob = this.queue.shift();
                    droppedJob.reject(err);
                }
                break;
            }

            const job = this.queue.shift();
            this.emitQueueChange();

            try {
                const result = await job.taskFn();
                this.incrementDailyCount();
                job.resolve(result);
            } catch (err) {
                logger.error('AntiBan', `Job ${job.id} failed:`, err.message);
                job.reject(err);
            }

            // Human delay before next job if there are more jobs
            if (this.queue.length > 0 && !this.isPaused) {
                const spacing = this.getInterMessageDelay();
                logger.antiBan(`Waiting ${spacing.label} before next message. Remaining: ${this.queue.length}`);
                await this.randomDelay(spacing.min, spacing.max);
            }
        }

        this.isRunning = false;
        this.emitQueueChange();
    }

    pause() {
        this.isPaused = true;
        logger.warn('AntiBan', 'Send queue manually paused.');
        this.emitQueueChange();
    }

    resume() {
        if (this.isPaused) {
            this.isPaused = false;
            logger.info('AntiBan', 'Send queue resumed.');
            this.emitQueueChange();
            this.process();
        }
    }

    clear() {
        const droppedCount = this.queue.length;
        const err = new Error('Queue was cleared by administrator');
        while (this.queue.length > 0) {
            const j = this.queue.shift();
            j.reject(err);
        }
        logger.warn('AntiBan', `Cleared ${droppedCount} jobs from queue.`);
        this.emitQueueChange();
        return droppedCount;
    }

    getStats() {
        return {
            queue_size: this.queue.length,
            is_processing: this.isRunning,
            is_paused: this.isPaused,
            daily_count: this.getDailySendCount(),
            daily_limit: config.DAILY_SEND_LIMIT,
            session_age_hours: this.getSessionAgeHours() > 999 ? null : parseFloat(this.getSessionAgeHours().toFixed(1)),
            delay_profile: this.getInterMessageDelay()
        };
    }
}

module.exports = new SendQueue();
