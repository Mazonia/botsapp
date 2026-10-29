/**
 * Phone number normalization and JID utilities for WhatsApp.
 */

function normalizePhoneNumber(phone) {
    if (!phone) return '';
    let raw = String(phone).trim();

    // If it's already a full JID (contains @c.us or @g.us), return it or extract
    if (raw.endsWith('@g.us')) {
        return raw;
    }
    if (raw.endsWith('@c.us') || raw.endsWith('@s.whatsapp.net')) {
        raw = raw.replace('@c.us', '').replace('@s.whatsapp.net', '');
    }

    // Strip non-digit characters
    let digits = raw.replace(/\D/g, '');

    // Common local Ghana formatting: 024XXXXXXX (10 digits) -> 23324XXXXXXX
    if (digits.length === 10 && digits.startsWith('0')) {
        digits = '233' + digits.substring(1);
    }

    return digits;
}

function toJid(phoneOrJid) {
    if (!phoneOrJid) return '';
    const str = String(phoneOrJid).trim();

    if (str.endsWith('@g.us') || str.endsWith('@c.us') || str.endsWith('@s.whatsapp.net')) {
        return str.replace('@s.whatsapp.net', '@c.us');
    }

    const clean = normalizePhoneNumber(str);
    return `${clean}@c.us`;
}

function cleanPhoneFromJid(jid) {
    if (!jid) return '';
    const str = String(jid);
    if (str.endsWith('@g.us')) {
        return str; // Return group ID as-is
    }
    return str.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

function isValidPhone(phone) {
    const clean = normalizePhoneNumber(phone);
    // Standard international numbers are between 7 and 15 digits (E.164 standard)
    return clean.length >= 7 && clean.length <= 15;
}

module.exports = {
    normalizePhoneNumber,
    toJid,
    cleanPhoneFromJid,
    isValidPhone
};
