/**
 * Phone number, Username, and JID utilities for WhatsApp.
 * Supports standard international phone numbers and WhatsApp @usernames.
 */

function isUsername(identifier) {
    if (!identifier) return false;
    const str = String(identifier).trim();

    // Explicit username with leading @
    if (str.startsWith('@') && !str.endsWith('@c.us') && !str.endsWith('@g.us') && !str.endsWith('@s.whatsapp.net')) {
        return true;
    }

    // Contains letters (excluding standard JID domain suffixes)
    const withoutSuffix = str
        .replace(/@c\.us$/, '')
        .replace(/@g\.us$/, '')
        .replace(/@s\.whatsapp\.net$/, '')
        .replace(/@lid$/, '');

    // If it contains alphabetic characters, it's a username handle
    return /[a-zA-Z]/.test(withoutSuffix) && !str.endsWith('@g.us');
}

function normalizeUsername(username) {
    if (!username) return '';
    let clean = String(username).trim();
    if (clean.startsWith('@')) {
        clean = clean.substring(1);
    }
    // Remove any trailing JID suffix if passed
    clean = clean.replace(/@c\.us$/, '').replace(/@s\.whatsapp\.net$/, '');
    return clean.toLowerCase();
}

function normalizePhoneNumber(phone) {
    if (!phone) return '';
    let raw = String(phone).trim();

    // If it's a group JID, return as-is
    if (raw.endsWith('@g.us')) {
        return raw;
    }

    // If it's a username, return the normalized username handle with @
    if (isUsername(raw)) {
        return '@' + normalizeUsername(raw);
    }

    // Handle user JIDs
    if (raw.endsWith('@c.us') || raw.endsWith('@s.whatsapp.net')) {
        raw = raw.replace('@c.us', '').replace('@s.whatsapp.net', '');
    }

    // Strip non-digit characters for phone numbers
    let digits = raw.replace(/\D/g, '');

    // Common local Ghana formatting: 024XXXXXXX (10 digits) -> 23324XXXXXXX
    if (digits.length === 10 && digits.startsWith('0')) {
        digits = '233' + digits.substring(1);
    }

    return digits;
}

function normalizeIdentifier(identifier) {
    if (!identifier) return '';
    const str = String(identifier).trim();

    if (str.endsWith('@g.us')) {
        return str;
    }

    if (isUsername(str)) {
        return '@' + normalizeUsername(str);
    }

    return normalizePhoneNumber(str);
}

function toJid(phoneOrUsernameOrJid) {
    if (!phoneOrUsernameOrJid) return '';
    const str = String(phoneOrUsernameOrJid).trim();

    if (str.endsWith('@g.us') || str.endsWith('@c.us') || str.endsWith('@s.whatsapp.net') || str.endsWith('@lid')) {
        return str.replace('@s.whatsapp.net', '@c.us');
    }

    if (isUsername(str)) {
        const cleanUser = normalizeUsername(str);
        return `${cleanUser}@c.us`;
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
    const clean = str.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '');
    if (/[a-zA-Z]/.test(clean)) {
        return '@' + clean;
    }
    return clean.replace(/\D/g, '');
}

function isValidIdentifier(identifier) {
    if (!identifier) return false;
    const str = String(identifier).trim();

    if (str.endsWith('@g.us')) return true;

    if (isUsername(str)) {
        const handle = normalizeUsername(str);
        // Usernames are 3 to 30 characters of alphanumeric, dots, and underscores
        return /^[a-zA-Z0-9._]{3,30}$/.test(handle);
    }

    const cleanDigits = normalizePhoneNumber(str);
    return cleanDigits.length >= 7 && cleanDigits.length <= 15;
}

function isValidPhone(phone) {
    return isValidIdentifier(phone);
}

module.exports = {
    isUsername,
    normalizeUsername,
    normalizePhoneNumber,
    normalizeIdentifier,
    toJid,
    cleanPhoneFromJid,
    isValidIdentifier,
    isValidPhone
};
