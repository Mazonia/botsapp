// BotsApp Dashboard Frontend Application v2.0
let socket = null;
let currentTab = 'dashboard';
let currentFormat = 'text';
let activeChatId = null;
let uploadedCampContacts = [];
let lastValidationResults = [];
let selectedChatAttachment = null;

// ===================================================================
// 1. THEME MANAGEMENT (LIGHT / DARK)
// ===================================================================
function initTheme() {
    const savedTheme = localStorage.getItem('botsapp-theme') || 'dark';
    if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('botsapp-theme', 'light');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('botsapp-theme', 'dark');
    }
    if (window.lucide) lucide.createIcons();
}

initTheme();

// ===================================================================
// 2. SOCKET.IO REAL-TIME SUBSCRIPTION
// ===================================================================
try {
    socket = io();
    setupSocketListeners();
} catch (e) {
    console.warn('Socket.io initialization warning:', e);
}

function setupSocketListeners() {
    socket.on('connect', () => {
        appendLog('success', 'WebSocket', 'Connected to BotsApp live stream');
    });

    socket.on('session:status', (status) => renderStatus(status));

    socket.on('session:qr', (data) => {
        if (data.qr) updateQrDisplay(data.qr);
    });

    socket.on('session:ready', () => {
        appendLog('success', 'Gateway', 'WhatsApp client is authenticated and ready!');
        fetchStatus();
    });

    socket.on('session:disconnected', (data) => {
        appendLog('warn', 'Gateway', 'WhatsApp disconnected: ' + (data.reason || ''));
        fetchStatus();
    });

    socket.on('queue:update', (stats) => updateQueueStats(stats));

    socket.on('log:new', (logItem) => appendLog(logItem.level, logItem.category, logItem.message));

    socket.on('logs:batch', (logs) => {
        logs.reverse().forEach(l => appendLog(l.level, l.category, l.message));
    });

    socket.on('message:received', (msg) => {
        appendLog('info', 'Incoming', `From: ${msg.phone} - "${(msg.body || '').substring(0, 30)}"`);
        if (activeChatId && (activeChatId.includes(msg.phone) || msg.from === activeChatId)) {
            appendChatMessage({
                fromMe: false,
                body: msg.body,
                timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
            });
        }
        if (currentTab === 'chat') refreshChats();
    });

    socket.on('message:ack', (ack) => {
        appendLog('info', 'Ack', `Message ${ack.message_id} -> ${ack.status}`);
        if (currentTab === 'chat' && activeChatId) {
            const checkElem = document.getElementById('ack-' + ack.message_id);
            if (checkElem) {
                if (ack.status === 'delivered') checkElem.textContent = '✓✓';
                if (ack.status === 'read') {
                    checkElem.textContent = '✓✓';
                    checkElem.className = 'text-sky-500 font-bold';
                }
            }
        }
    });

    socket.on('campaign:update', () => {
        if (currentTab === 'campaigns') fetchCampaigns();
    });
}

// ===================================================================
// 3. TAB NAVIGATION
// ===================================================================
function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(el => {
        el.classList.remove('bg-slate-200/80', 'dark:bg-white/10', 'text-slate-900', 'dark:text-white');
    });

    const activeSection = document.getElementById(`tab-${tabName}`);
    const activeNav = document.getElementById(`nav-${tabName}`);

    if (activeSection) activeSection.classList.remove('hidden');
    if (activeNav) activeNav.classList.add('bg-slate-200/80', 'dark:bg-white/10', 'text-slate-900', 'dark:text-white');

    if (tabName === 'chat') refreshChats();
    if (tabName === 'campaigns') fetchCampaigns();
    if (tabName === 'autoresponder') fetchRules();
    if (tabName === 'webhooks') { fetchWebhooks(); fetchWebhookHistory(); }

    if (window.lucide) lucide.createIcons();
}

// ===================================================================
// 4. STATUS & CONNECTION RENDERING
// ===================================================================
async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        renderStatus(data);
    } catch (err) {
        console.error('Fetch status error:', err);
    }
}

function renderStatus(status) {
    const topBadge = document.getElementById('topStatusBadge');
    const topText = document.getElementById('topStatusText');
    const kpiState = document.getElementById('kpiState');
    const kpiUser = document.getElementById('kpiUser');
    const dashConnectedBox = document.getElementById('dashConnectedBox');
    const dashQrBox = document.getElementById('dashQrBox');
    const dashQrImg = document.getElementById('dashQrImg');
    const dashQrLoading = document.getElementById('dashQrLoading');
    const dashLoadingText = document.getElementById('dashLoadingText');

    if (status.authenticated) {
        topBadge.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20';
        topText.textContent = 'Active & Connected';
        kpiState.textContent = 'Connected';
        kpiState.className = 'text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-2';

        const name = status.client_info?.pushname || 'WhatsApp User';
        const phone = status.client_info?.phone ? `+${status.client_info.phone}` : 'Active session';
        kpiUser.textContent = `${name} (${phone})`;

        document.getElementById('connectedDeviceDetail').textContent = `Connected as ${name} (${phone})`;
        dashConnectedBox.classList.remove('hidden');
        dashQrBox.classList.add('hidden');
    } else if (status.hasQr && status.qr) {
        topBadge.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
        topText.textContent = 'Scan QR Code';
        kpiState.textContent = 'Waiting for QR Scan';
        kpiState.className = 'text-lg font-bold text-amber-600 dark:text-amber-400 mt-2';
        kpiUser.textContent = 'Point phone camera at QR';

        dashConnectedBox.classList.add('hidden');
        dashQrBox.classList.remove('hidden');
        dashQrImg.src = status.qr;
        dashQrImg.classList.remove('hidden');
        dashQrLoading.classList.add('hidden');
    } else {
        topBadge.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
        topText.textContent = 'Initializing...';
        kpiState.textContent = 'Initializing...';
        kpiState.className = 'text-lg font-bold text-blue-600 dark:text-blue-400 mt-2';
        kpiUser.textContent = status.message || 'Starting Chromium';

        dashConnectedBox.classList.add('hidden');
        dashQrBox.classList.remove('hidden');
        dashQrImg.classList.add('hidden');
        dashQrLoading.classList.remove('hidden');
        if (dashLoadingText) dashLoadingText.textContent = status.message || 'Generating QR code...';
    }

    updateQueueStats(status);
}

function updateQrDisplay(qrDataUrl) {
    const dashConnectedBox = document.getElementById('dashConnectedBox');
    const dashQrBox = document.getElementById('dashQrBox');
    const dashQrImg = document.getElementById('dashQrImg');
    const dashQrLoading = document.getElementById('dashQrLoading');

    dashConnectedBox.classList.add('hidden');
    dashQrBox.classList.remove('hidden');
    dashQrImg.src = qrDataUrl;
    dashQrImg.classList.remove('hidden');
    dashQrLoading.classList.add('hidden');
}

function updateQueueStats(stats) {
    if (!stats) return;

    const kpiDaily = document.getElementById('kpiDaily');
    const kpiQueue = document.getElementById('kpiQueue');
    const kpiQueueState = document.getElementById('kpiQueueState');
    const kpiProfile = document.getElementById('kpiProfile');
    const kpiAge = document.getElementById('kpiAge');
    const sidebarQueueCount = document.getElementById('sidebarQueueCount');
    const sidebarDailyCount = document.getElementById('sidebarDailyCount');
    const sidebarProgressBar = document.getElementById('sidebarProgressBar');

    if (kpiDaily) kpiDaily.textContent = `${stats.daily_count || 0} / ${stats.daily_limit || 120}`;
    if (sidebarDailyCount) sidebarDailyCount.textContent = `${stats.daily_count || 0} / ${stats.daily_limit || 120}`;
    if (sidebarQueueCount) sidebarQueueCount.textContent = `${stats.queue_size || 0} pending`;
    if (kpiQueue) kpiQueue.textContent = `${stats.queue_size || 0} in queue`;

    if (kpiQueueState) {
        if (stats.is_paused) {
            kpiQueueState.textContent = 'Queue Paused';
            kpiQueueState.className = 'text-xs text-amber-500 mt-1';
        } else if (stats.is_processing) {
            kpiQueueState.textContent = 'Processing with anti-ban delay...';
            kpiQueueState.className = 'text-xs text-emerald-500 mt-1 animate-pulse';
        } else {
            kpiQueueState.textContent = 'Ready for requests';
            kpiQueueState.className = 'text-xs text-slate-500 mt-1';
        }
    }

    if (sidebarProgressBar && stats.daily_limit) {
        const percent = Math.min(100, Math.round(((stats.daily_count || 0) / stats.daily_limit) * 100));
        sidebarProgressBar.style.width = percent + '%';
    }

    if (stats.delay_profile && kpiProfile) {
        kpiProfile.textContent = stats.delay_profile.label || 'Active';
    }
    if (kpiAge && stats.session_age_hours !== undefined) {
        kpiAge.textContent = stats.session_age_hours !== null ? `Session Age: ${stats.session_age_hours}h` : 'Session: Established';
    }
}

function appendLog(level, category, message) {
    const consoleBox = document.getElementById('liveConsole');
    if (!consoleBox) return;

    const time = new Date().toLocaleTimeString();
    const item = document.createElement('div');
    item.className = 'flex items-start gap-2 py-0.5';

    let colorClass = 'text-slate-300';
    if (level === 'error') colorClass = 'text-rose-400 font-bold';
    if (level === 'warn') colorClass = 'text-amber-400';
    if (level === 'success') colorClass = 'text-emerald-400 font-semibold';
    if (level === 'anti-ban') colorClass = 'text-purple-300';
    if (level === 'webhook') colorClass = 'text-sky-300';

    item.innerHTML = `<span class="text-slate-500 shrink-0">[${time}]</span> <span class="font-bold shrink-0">[${category}]</span> <span class="${colorClass}">${escapeHtml(message)}</span>`;
    consoleBox.appendChild(item);
    consoleBox.scrollTop = consoleBox.scrollHeight;
}

function clearLogDisplay() {
    const consoleBox = document.getElementById('liveConsole');
    if (consoleBox) consoleBox.innerHTML = '';
}

// Quick Test Form Handler
async function handleQuickSend(e) {
    e.preventDefault();
    const phone = document.getElementById('quickPhone').value;
    const message = document.getElementById('quickMessage').value;
    const alertBox = document.getElementById('quickSendAlert');
    const btn = document.getElementById('btnQuickSend');

    btn.disabled = true;
    btn.innerHTML = 'Enqueuing...';
    alertBox.className = 'mt-3 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10';
    alertBox.textContent = 'Enqueuing into Anti-Ban Send Queue...';
    alertBox.classList.remove('hidden');

    try {
        const res = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message, priority: 'high' })
        });
        const data = await res.json();

        if (data.success) {
            alertBox.className = 'mt-3 p-3 rounded-xl text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-semibold';
            alertBox.textContent = `✓ Message sent! (ID: ${data.message_id || 'sent'}). Total today: ${data.daily_count || 1}`;
        } else {
            alertBox.className = 'mt-3 p-3 rounded-xl text-xs bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 font-semibold';
            alertBox.textContent = `✗ ${data.message || 'Failed to send'}`;
        }
    } catch (err) {
        alertBox.className = 'mt-3 p-3 rounded-xl text-xs bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 font-semibold';
        alertBox.textContent = `✗ Error: ${err.message}`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> Send Test';
        if (window.lucide) lucide.createIcons();
    }
}

// Queue Controls
async function pauseQueue() { await fetch('/api/queue/pause', { method: 'POST' }); }
async function resumeQueue() { await fetch('/api/queue/resume', { method: 'POST' }); }
async function clearQueue() {
    if (confirm('Clear all pending messages in queue?')) {
        await fetch('/api/queue/clear', { method: 'POST' });
    }
}

async function triggerResetSession() {
    if (!confirm('Are you sure you want to reset the WhatsApp session? You will need to re-link your phone via QR code.')) return;
    try {
        const res = await fetch('/api/reset', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Reset initiated.');
        fetchStatus();
    } catch (e) {
        alert('Reset error: ' + e.message);
    }
}

// ===================================================================
// 5. MULTI-FORMAT COMPOSER & MEDIA UPLOADS
// ===================================================================
function setComposerFormat(fmt) {
    currentFormat = fmt;
    document.querySelectorAll('.format-btn').forEach(b => {
        b.className = 'format-btn px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
    });
    const activeBtn = document.getElementById(`btn-format-${fmt}`);
    if (activeBtn) activeBtn.className = 'format-btn px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white';

    const fieldText = document.getElementById('field-text');
    const fieldMedia = document.getElementById('field-media');
    const fieldPoll = document.getElementById('field-poll');
    const fieldLocation = document.getElementById('field-location');

    fieldText.classList.add('hidden');
    fieldMedia.classList.add('hidden');
    fieldPoll.classList.add('hidden');
    fieldLocation.classList.add('hidden');

    if (fmt === 'text') fieldText.classList.remove('hidden');
    if (fmt === 'image' || fmt === 'document' || fmt === 'audio') fieldMedia.classList.remove('hidden');
    if (fmt === 'poll') fieldPoll.classList.remove('hidden');
    if (fmt === 'location') fieldLocation.classList.remove('hidden');
}

function updatePreviewPhone(val) {
    document.getElementById('previewRecipient').textContent = val ? '+' + val.replace(/\D/g, '') : '+233 XXXXXXXX';
}

function updatePreviewText(val) {
    document.getElementById('previewBubbleText').textContent = val || 'Type a message to see how it renders live on WhatsApp...';
}

function insertSyntax(before, after) {
    const area = document.getElementById('composerText');
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const sel = area.value.substring(start, end);
    area.value = area.value.substring(0, start) + before + sel + after + area.value.substring(end);
    updatePreviewText(area.value);
}

function handleMediaFileSelected(input) {
    const file = input.files[0];
    if (!file) return;

    document.getElementById('mediaFileName').textContent = file.name;
    document.getElementById('mediaFileSize').textContent = `(${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    document.getElementById('mediaFilePreview').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function clearMediaFile() {
    document.getElementById('composerFile').value = '';
    document.getElementById('mediaFilePreview').classList.add('hidden');
}

async function handleSendComposer(e) {
    e.preventDefault();
    const phone = document.getElementById('composerPhone').value;
    const priority = document.getElementById('composerPriority').value || 'normal';
    const btn = document.getElementById('btnComposerSend');
    btn.disabled = true;

    try {
        if (currentFormat === 'text') {
            const message = document.getElementById('composerText').value;
            await fetch('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message, priority })
            });
        } else if (currentFormat === 'image' || currentFormat === 'document' || currentFormat === 'audio') {
            const formData = new FormData();
            formData.append('phone', phone);
            formData.append('caption', document.getElementById('composerCaption').value);
            formData.append('isVoice', currentFormat === 'audio');

            const file = document.getElementById('composerFile').files[0];
            const mediaUrl = document.getElementById('composerMediaUrl').value;

            if (file) formData.append('file', file);
            if (mediaUrl) formData.append('mediaUrl', mediaUrl);

            await fetch('/api/messages/media', { method: 'POST', body: formData });
        } else if (currentFormat === 'poll') {
            const title = document.getElementById('composerPollQuestion').value;
            const options = document.getElementById('composerPollOptions').value.split('\n').filter(Boolean);
            const allowMultiple = document.getElementById('composerPollMulti').checked;

            await fetch('/api/messages/poll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, title, options, allowMultiple })
            });
        } else if (currentFormat === 'location') {
            const latitude = document.getElementById('composerLat').value;
            const longitude = document.getElementById('composerLng').value;
            const description = document.getElementById('composerLocDesc').value;

            await fetch('/api/messages/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, latitude, longitude, description })
            });
        }

        alert('Message submitted to send queue successfully!');
    } catch (err) {
        alert('Failed to send: ' + err.message);
    } finally {
        btn.disabled = false;
    }
}

// ===================================================================
// 6. BROADCAST CAMPAIGNS (CSV UPLOAD & VARIABLE REPLACEMENT)
// ===================================================================
function openNewCampaignModal() {
    uploadedCampContacts = [];
    document.getElementById('campCsvSelectedName').textContent = '';
    document.getElementById('campParsedPreview').classList.add('hidden');
    document.getElementById('campModalNumbers').value = '';
    document.getElementById('campaignModal').classList.remove('hidden');
    setContactInputMode('csv');
}

function closeCampaignModal() {
    document.getElementById('campaignModal').classList.add('hidden');
}

function setContactInputMode(mode) {
    const btnCsv = document.getElementById('btn-mode-csv');
    const btnManual = document.getElementById('btn-mode-manual');
    const csvArea = document.getElementById('campCsvArea');
    const manualArea = document.getElementById('campManualArea');

    if (mode === 'csv') {
        btnCsv.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-600 text-white';
        btnManual.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white';
        csvArea.classList.remove('hidden');
        manualArea.classList.add('hidden');
    } else {
        btnManual.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-600 text-white';
        btnCsv.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white';
        csvArea.classList.add('hidden');
        manualArea.classList.remove('hidden');
    }
}

async function handleCampCsvUpload(input) {
    const file = input.files[0];
    if (!file) return;

    document.getElementById('campCsvSelectedName').textContent = `Uploading ${file.name}...`;

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
        const res = await fetch('/api/campaigns/upload-csv', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.success && data.contacts) {
            uploadedCampContacts = data.contacts;
            document.getElementById('campCsvSelectedName').textContent = `✓ Loaded ${data.count} contacts from ${file.name}`;
            
            const previewBox = document.getElementById('campParsedPreview');
            previewBox.classList.remove('hidden');
            previewBox.innerHTML = `
                <div class="font-bold">✓ Parsed ${data.count} recipients ready for broadcast.</div>
                <div class="text-[10px] opacity-80 mt-1">Sample: ${data.preview.map(p => `${p.name} (+${p.phone})`).join(', ')}</div>
            `;
        } else {
            alert('Failed to parse CSV: ' + (data.message || 'No contacts found'));
        }
    } catch (err) {
        alert('CSV upload error: ' + err.message);
    }
}

function downloadSampleCsv(e) {
    e.preventDefault();
    const csvContent = "phone,name,course\n233241234567,Kofi Mensah,Full Stack Web Dev\n233501234567,Ama Serwaa,Data Science\n0241112233,Kwame Osei,Mobile App Dev\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'botsapp-contacts-sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function handleCreateCampaign(e) {
    e.preventDefault();
    const name = document.getElementById('campModalName').value;
    const template = document.getElementById('campModalTemplate').value;
    const intervalSeconds = document.getElementById('campModalInterval').value;
    let contacts = uploadedCampContacts;

    if (contacts.length === 0) {
        const rawNumbers = document.getElementById('campModalNumbers').value;
        if (!rawNumbers.trim()) {
            return alert('Please upload a CSV file or enter phone numbers.');
        }
        contacts = rawNumbers.split(/[\n,;]+/).map(n => ({ phone: n.trim(), name: 'Learner' })).filter(c => c.phone);
    }

    try {
        const res = await fetch('/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, template, contacts, intervalSeconds })
        });
        const data = await res.json();
        if (data.success) {
            closeCampaignModal();
            fetchCampaigns();
        } else {
            alert('Failed to create campaign: ' + data.message);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function fetchCampaigns() {
    const tbody = document.getElementById('campaignsTableBody');
    try {
        const res = await fetch('/api/campaigns');
        const data = await res.json();
        if (!data.campaigns || data.campaigns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">No campaigns found. Click "New Campaign" to create one.</td></tr>';
            return;
        }

        tbody.innerHTML = data.campaigns.map(c => `
            <tr class="hover:bg-slate-100/50 dark:hover:bg-white/[0.02] transition">
                <td class="p-4 font-bold text-slate-900 dark:text-white">${escapeHtml(c.name)}</td>
                <td class="p-4">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        c.status === 'completed' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                        c.status === 'running' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse' :
                        c.status === 'paused' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }">${c.status.toUpperCase()}</span>
                </td>
                <td class="p-4">${c.stats.sent} / ${c.stats.total}</td>
                <td class="p-4">${c.intervalSeconds}s</td>
                <td class="p-4 text-slate-500">${new Date(c.createdAt).toLocaleDateString()}</td>
                <td class="p-4 text-right space-x-2">
                    ${c.status === 'draft' || c.status === 'paused' ? `<button onclick="startCampaign('${c.id}')" class="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">Start</button>` : ''}
                    ${c.status === 'running' ? `<button onclick="pauseCampaign('${c.id}')" class="text-amber-600 dark:text-amber-400 font-bold hover:underline">Pause</button>` : ''}
                    <button onclick="deleteCampaign('${c.id}')" class="text-rose-500 hover:underline">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-rose-500">${e.message}</td></tr>`;
    }
}

async function startCampaign(id) { await fetch(`/api/campaigns/${id}/start`, { method: 'POST' }); fetchCampaigns(); }
async function pauseCampaign(id) { await fetch(`/api/campaigns/${id}/pause`, { method: 'POST' }); fetchCampaigns(); }
async function deleteCampaign(id) { if (confirm('Delete campaign?')) { await fetch(`/api/campaigns/${id}`, { method: 'DELETE' }); fetchCampaigns(); } }

// ===================================================================
// 7. NUMBER CHECK & BULK CSV VALIDATION
// ===================================================================
async function runSingleCheck() {
    const phone = document.getElementById('singleCheckInput').value;
    const resBox = document.getElementById('singleCheckResult');
    if (!phone) return alert('Enter phone number');

    resBox.textContent = 'Verifying WhatsApp registration...';
    resBox.className = 'p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
    resBox.classList.remove('hidden');

    try {
        const res = await fetch('/api/check-number', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.exists) {
            resBox.className = 'p-3 rounded-xl text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-bold';
            resBox.textContent = `✓ ${phone} is REGISTERED on WhatsApp (${data.jid})`;
        } else {
            resBox.className = 'p-3 rounded-xl text-xs bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 font-bold';
            resBox.textContent = `✗ ${phone} is NOT found on WhatsApp.`;
        }
    } catch (e) {
        resBox.textContent = 'Error: ' + e.message;
    }
}

async function handleValidatorCsv(input) {
    const file = input.files[0];
    if (!file) return;

    document.getElementById('validatorCsvName').textContent = `Validating ${file.name}...`;
    const resBox = document.getElementById('bulkCheckResult');
    resBox.className = 'p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
    resBox.textContent = `Uploading and verifying ${file.name}...`;
    resBox.classList.remove('hidden');

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
        const res = await fetch('/api/contacts/validate-csv', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            lastValidationResults = data.results;
            document.getElementById('btnExportCsv').classList.remove('hidden');
            resBox.className = 'p-3 rounded-xl text-xs bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20';
            resBox.innerHTML = `
                <div class="font-bold text-slate-900 dark:text-white mb-1">CSV Validation Complete</div>
                <div>Total Processed: <b>${data.total}</b> | <span class="text-emerald-600 dark:text-emerald-400 font-bold">Registered: ${data.registered}</span> | <span class="text-rose-600 dark:text-rose-400 font-bold">Unregistered: ${data.unregistered}</span></div>
            `;
        } else {
            resBox.textContent = 'Validation error: ' + (data.message || 'Failed to process file');
        }
    } catch (err) {
        resBox.textContent = 'Error: ' + err.message;
    }
}

async function runBulkCheck() {
    const raw = document.getElementById('bulkCheckInput').value;
    const resBox = document.getElementById('bulkCheckResult');
    const numbers = raw.split(/[\n,;]+/).map(n => n.trim()).filter(Boolean);
    if (numbers.length === 0) return alert('Please enter numbers');

    resBox.textContent = `Validating ${numbers.length} numbers...`;
    resBox.className = 'p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
    resBox.classList.remove('hidden');

    try {
        const res = await fetch('/api/contacts/validate-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers })
        });
        const data = await res.json();
        lastValidationResults = data.results;
        document.getElementById('btnExportCsv').classList.remove('hidden');
        resBox.className = 'p-3 rounded-xl text-xs bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20';
        resBox.innerHTML = `
            <div class="font-bold text-slate-900 dark:text-white mb-1">Validation Complete</div>
            <div>Total: ${data.total} | <span class="text-emerald-600 dark:text-emerald-400 font-bold">Registered: ${data.registered}</span> | <span class="text-rose-600 dark:text-rose-400 font-bold">Unregistered: ${data.unregistered}</span></div>
        `;
    } catch (e) {
        resBox.textContent = 'Error: ' + e.message;
    }
}

async function exportValidationCsv() {
    if (lastValidationResults.length === 0) return alert('No validation results to export');

    try {
        const res = await fetch('/api/contacts/export-csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: lastValidationResults })
        });
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'whatsapp-validation-results.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        alert('Export error: ' + e.message);
    }
}

// ===================================================================
// 8. AUTO-RESPONDER & TRIGGER SIMULATOR
// ===================================================================
async function fetchRules() {
    const grid = document.getElementById('rulesListGrid');
    try {
        const res = await fetch('/api/autoresponder');
        const data = await res.json();
        if (!data.rules || data.rules.length === 0) {
            grid.innerHTML = '<div class="col-span-2 text-center text-slate-400 py-8">No auto-responder rules configured.</div>';
            return;
        }

        grid.innerHTML = data.rules.map(r => `
            <div class="glass-panel p-5 rounded-3xl space-y-3">
                <div class="flex items-center justify-between">
                    <h4 class="text-xs font-bold text-slate-900 dark:text-white">${escapeHtml(r.name)}</h4>
                    <button onclick="toggleRule('${r.id}')" data-tooltip="Click to toggle rule on/off" class="px-2 py-0.5 rounded-full text-[10px] font-bold ${r.enabled ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}">
                        ${r.enabled ? 'Active' : 'Disabled'}
                    </button>
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Triggers on: <span class="font-bold text-amber-600 dark:text-amber-400">${escapeHtml(r.keywords.join(', '))}</span> (${r.triggerType})
                </div>
                <div class="p-3 bg-slate-100 dark:bg-slate-950/60 rounded-xl text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono">
                    ${escapeHtml(r.responseText)}
                </div>
                <div class="flex items-center justify-between pt-1 text-[11px]">
                    <span class="text-slate-400">Cooldown: ${r.cooldownSeconds || 60}s</span>
                    <button onclick="deleteRule('${r.id}')" class="text-rose-500 hover:underline">Delete Rule</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = `<div class="col-span-2 text-center text-rose-500 py-8">${e.message}</div>`;
    }
}

async function runTriggerSimulation() {
    const text = document.getElementById('simTestInput').value;
    const resBox = document.getElementById('simTestResult');
    if (!text.trim()) return alert('Type a phrase to test');

    resBox.textContent = 'Testing triggers...';
    resBox.className = 'p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
    resBox.classList.remove('hidden');

    try {
        const res = await fetch('/api/autoresponder/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await res.json();

        if (data.matched && data.rule) {
            resBox.className = 'p-3 rounded-xl text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20';
            resBox.innerHTML = `
                <div class="font-bold">✓ Matches Rule: "${escapeHtml(data.rule.name)}"</div>
                <div class="text-[11px] mt-1">Bot would reply: <i>"${escapeHtml(data.rule.responseText)}"</i></div>
            `;
        } else {
            resBox.className = 'p-3 rounded-xl text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-semibold';
            resBox.textContent = 'No active auto-responder rule matches this phrase.';
        }
    } catch (e) {
        resBox.textContent = 'Simulation error: ' + e.message;
    }
}

function insertRuleTag(tag) {
    const area = document.getElementById('ruleModalResponse');
    area.value += ' ' + tag;
}

function openNewRuleModal() { document.getElementById('ruleModal').classList.remove('hidden'); }
function closeRuleModal() { document.getElementById('ruleModal').classList.add('hidden'); }

async function handleCreateRule(e) {
    e.preventDefault();
    const name = document.getElementById('ruleModalName').value;
    const triggerType = document.getElementById('ruleModalTrigger').value;
    const cooldownSeconds = document.getElementById('ruleModalCooldown').value;
    const rawKeywords = document.getElementById('ruleModalKeywords').value;
    const responseText = document.getElementById('ruleModalResponse').value;

    const keywords = rawKeywords.split(',').map(k => k.trim()).filter(Boolean);

    try {
        await fetch('/api/autoresponder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, triggerType, cooldownSeconds, keywords, responseText })
        });
        closeRuleModal();
        fetchRules();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function toggleRule(id) {
    await fetch(`/api/autoresponder/${id}/toggle`, { method: 'POST' });
    fetchRules();
}

async function deleteRule(id) {
    if (confirm('Delete rule?')) {
        await fetch(`/api/autoresponder/${id}`, { method: 'DELETE' });
        fetchRules();
    }
}

// ===================================================================
// 9. LIVE CHAT WITH DIRECT ATTACHMENTS
// ===================================================================
async function refreshChats() {
    const container = document.getElementById('chatListContainer');
    try {
        const res = await fetch('/api/chats');
        const data = await res.json();
        if (!data.chats || data.chats.length === 0) {
            container.innerHTML = '<div class="p-4 text-xs text-center text-slate-400">No active chats found.</div>';
            return;
        }

        container.innerHTML = data.chats.map(chat => `
            <div onclick="selectChat('${chat.id}', '${escapeHtml(chat.name)}')" class="p-3 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer transition flex items-center gap-3 ${activeChatId === chat.id ? 'bg-slate-200/80 dark:bg-white/10' : ''}">
                <div class="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
                    ${chat.name ? chat.name.charAt(0).toUpperCase() : '?'}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <h4 class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(chat.name)}</h4>
                        <span class="text-[10px] text-slate-400">${formatTime(chat.timestamp)}</span>
                    </div>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">${escapeHtml(chat.lastMessage?.body || 'Attachment')}</p>
                </div>
                ${chat.unreadCount > 0 ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">${chat.unreadCount}</span>` : ''}
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="p-4 text-xs text-center text-rose-500">Failed to load chats</div>';
    }
}

async function selectChat(id, name) {
    activeChatId = id;
    document.getElementById('activeChatTitle').textContent = name;
    document.getElementById('activeChatSubtitle').textContent = id;
    document.getElementById('activeChatAvatar').textContent = name.charAt(0).toUpperCase();

    const thread = document.getElementById('chatThread');
    thread.innerHTML = '<div class="m-auto text-xs text-slate-400">Loading messages...</div>';

    try {
        const res = await fetch(`/api/chats/${encodeURIComponent(id)}/messages?limit=40`);
        const data = await res.json();
        thread.innerHTML = '';

        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(m => appendChatMessage(m));
        } else {
            thread.innerHTML = '<div class="m-auto text-xs text-slate-400">No messages in this chat.</div>';
        }

        fetch(`/api/chats/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => {});
    } catch (e) {
        thread.innerHTML = `<div class="m-auto text-xs text-rose-500">Failed to load: ${e.message}</div>`;
    }
}

function appendChatMessage(m) {
    const thread = document.getElementById('chatThread');
    if (!thread) return;

    const div = document.createElement('div');
    div.className = m.fromMe 
        ? 'bubble-sent max-w-[75%] ml-auto p-3 rounded-2xl text-xs space-y-1 shadow' 
        : 'bubble-received max-w-[75%] mr-auto p-3 rounded-2xl text-xs space-y-1 shadow';

    let ackText = '';
    if (m.fromMe) {
        ackText = '✓';
        if (m.ack === 2) ackText = '✓✓';
        if (m.ack >= 3) ackText = '<span class="text-sky-300 font-bold">✓✓</span>';
    }

    div.innerHTML = `
        <div class="whitespace-pre-wrap break-words">${escapeHtml(m.body || '[Media attachment]')}</div>
        <div class="flex items-center justify-end gap-1 text-[9px] opacity-70">
            <span>${formatTime(m.timestamp)}</span>
            <span id="ack-${m.id || ''}">${ackText}</span>
        </div>
    `;
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
}

function handleChatFileAttach(input) {
    const file = input.files[0];
    const badge = document.getElementById('chatAttachBadge');
    if (file) {
        selectedChatAttachment = file;
        badge.textContent = `📎 ${file.name}`;
        badge.classList.remove('hidden');
    } else {
        selectedChatAttachment = null;
        badge.classList.add('hidden');
    }
}

async function handleSendReply(e) {
    e.preventDefault();
    if (!activeChatId) return alert('Select a chat first');
    const input = document.getElementById('chatReplyInput');
    const text = input.value.trim();

    if (!text && !selectedChatAttachment) return;

    appendChatMessage({ fromMe: true, body: text || `[File: ${selectedChatAttachment?.name}]`, timestamp: Math.floor(Date.now() / 1000) });
    input.value = '';

    const badge = document.getElementById('chatAttachBadge');
    badge.classList.add('hidden');

    try {
        if (selectedChatAttachment) {
            const formData = new FormData();
            formData.append('file', selectedChatAttachment);
            formData.append('message', text);
            await fetch(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, { method: 'POST', body: formData });
            selectedChatAttachment = null;
            document.getElementById('chatAttachInput').value = '';
        } else {
            await fetch('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: activeChatId, message: text })
            });
        }
    } catch (err) {
        console.error('Send error:', err);
    }
}

// ===================================================================
// 10. WEBHOOKS
// ===================================================================
async function fetchWebhooks() {
    const container = document.getElementById('webhooksListContainer');
    try {
        const res = await fetch('/api/webhooks');
        const data = await res.json();
        if (!data.webhooks || data.webhooks.length === 0) {
            container.innerHTML = '<div class="text-xs text-slate-400 p-3">No webhook destinations configured.</div>';
            return;
        }

        container.innerHTML = data.webhooks.map(w => `
            <div class="p-3 bg-slate-100 dark:bg-slate-950/60 rounded-2xl border border-slate-200 dark:border-white/5 flex items-center justify-between text-xs">
                <div class="min-w-0 pr-2">
                    <p class="font-mono text-slate-800 dark:text-slate-200 truncate">${escapeHtml(w.url)}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5">Events: ${w.events.join(', ')}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="testWebhook('${w.url}')" data-tooltip="Send test ping payload" class="px-2.5 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-[10px] font-bold">Ping</button>
                    <button onclick="deleteWebhook('${w.id}')" data-tooltip="Remove webhook" class="text-rose-500 hover:underline text-[11px]">&times;</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<div class="text-xs text-rose-500 p-3">${e.message}</div>`;
    }
}

async function testWebhook(url) {
    const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    const d = await res.json();
    alert(d.message || 'Dispatched');
    fetchWebhookHistory();
}

async function deleteWebhook(id) {
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    fetchWebhooks();
}

function openNewWebhookModal() { document.getElementById('webhookModal').classList.remove('hidden'); }
function closeWebhookModal() { document.getElementById('webhookModal').classList.add('hidden'); }

async function handleCreateWebhook(e) {
    e.preventDefault();
    const url = document.getElementById('webhookModalUrl').value;
    await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, events: ['all'] })
    });
    closeWebhookModal();
    fetchWebhooks();
}

async function fetchWebhookHistory() {
    const container = document.getElementById('webhookHistoryContainer');
    try {
        const res = await fetch('/api/webhooks/history');
        const data = await res.json();
        if (!data.history || data.history.length === 0) {
            container.innerHTML = '<div class="text-slate-400 p-4 text-center">No webhook delivery logs yet.</div>';
            return;
        }

        container.innerHTML = data.history.map(h => `
            <div class="py-2 flex items-center justify-between text-[11px]">
                <div class="min-w-0 pr-2">
                    <span class="font-bold ${h.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">[${h.statusCode || 'ERR'}]</span>
                    <span class="text-slate-700 dark:text-slate-300">${h.event} &rarr; ${escapeHtml(h.url)}</span>
                </div>
                <div class="text-slate-400 shrink-0">${h.durationMs}ms</div>
            </div>
        `).join('');
    } catch (e) {}
}

// ===================================================================
// 11. PAIRING CODE MODAL
// ===================================================================
function openPairingModal() { document.getElementById('pairingModal').classList.remove('hidden'); }
function closePairingModal() { document.getElementById('pairingModal').classList.add('hidden'); }

async function requestPairingCode() {
    const phone = document.getElementById('pairingPhoneInput').value;
    const display = document.getElementById('pairingCodeDisplay');
    if (!phone) return alert('Please enter phone number');

    display.textContent = 'Requesting code...';
    display.classList.remove('hidden');

    try {
        const res = await fetch('/api/pairing-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success && data.pairing_code) {
            display.textContent = data.pairing_code;
        } else {
            display.textContent = data.message || 'Pairing code unavailable. Use QR scanning.';
        }
    } catch (e) {
        display.textContent = 'Error: ' + e.message;
    }
}

// ===================================================================
// 12. CODE SNIPPET SWITCHER
// ===================================================================
function switchCodeLang(lang) {
    document.querySelectorAll('.code-box').forEach(b => b.classList.add('hidden'));
    const box = document.getElementById(`code-${lang}`);
    if (box) box.classList.remove('hidden');

    ['curl', 'php', 'js', 'python'].forEach(l => {
        const btn = document.getElementById(`btn-lang-${l}`);
        if (btn) btn.className = l === lang ? 'text-xs font-bold text-emerald-600 dark:text-emerald-400' : 'text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white';
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[m]);
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000 > 1000000000000 ? timestamp : timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Initial bootstrap
fetchStatus();
setInterval(fetchStatus, 3000);
