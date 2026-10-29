const phoneUtils = require('./phone');

/**
 * Robust CSV and delimited text parser.
 */
function parseCsv(content) {
    if (!content || typeof content !== 'string') return [];

    // Normalize newlines
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // Auto-detect delimiter from first line (comma, semicolon, tab, pipe)
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const pipeCount = (firstLine.match(/\|/g) || []).length;

    let delimiter = ',';
    if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
    else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
    else if (pipeCount > commaCount && pipeCount > semiCount) delimiter = '|';

    // Parse each line respecting quoted fields
    const parsedRows = lines.map(line => parseCsvLine(line, delimiter));
    if (parsedRows.length === 0) return [];

    const firstRow = parsedRows[0].map(c => c.trim().toLowerCase());

    // Check if first row is a header
    const phoneHeaderIndex = firstRow.findIndex(h => 
        ['phone', 'mobile', 'tel', 'whatsapp', 'number', 'telephone', 'contact', 'recipient'].includes(h)
    );
    const nameHeaderIndex = firstRow.findIndex(h => 
        ['name', 'fullname', 'full_name', 'first_name', 'firstname', 'client', 'customer', 'learner'].includes(h)
    );

    const hasHeader = phoneHeaderIndex !== -1 || nameHeaderIndex !== -1;
    const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
    const headers = hasHeader ? parsedRows[0].map(h => h.trim()) : null;

    const results = [];

    for (const row of dataRows) {
        if (!row || row.length === 0) continue;

        let rawPhone = '';
        let name = '';
        const customFields = {};

        if (hasHeader) {
            headers.forEach((h, idx) => {
                const val = (row[idx] || '').trim();
                const lowerH = h.toLowerCase();

                if (idx === phoneHeaderIndex || (!rawPhone && ['phone', 'mobile', 'tel', 'whatsapp', 'number'].includes(lowerH))) {
                    rawPhone = val;
                } else if (idx === nameHeaderIndex || (!name && ['name', 'full_name', 'first_name'].includes(lowerH))) {
                    name = val;
                } else {
                    customFields[h.replace(/[^a-zA-Z0-9_]/g, '_')] = val;
                }
            });
        } else {
            // Default: first column with valid digits is phone, other is name
            const col0 = (row[0] || '').trim();
            const col1 = (row[1] || '').trim();

            if (col0.replace(/\D/g, '').length >= 7) {
                rawPhone = col0;
                name = col1;
            } else if (col1.replace(/\D/g, '').length >= 7) {
                rawPhone = col1;
                name = col0;
            } else {
                rawPhone = col0;
                name = col1;
            }
        }

        const cleanPhone = phoneUtils.normalizePhoneNumber(rawPhone);
        if (cleanPhone && cleanPhone.length >= 7) {
            results.push({
                phone: cleanPhone,
                name: name || 'Valued Customer',
                customFields
            });
        }
    }

    return results;
}

function parseCsvLine(line, delimiter) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim());
    return values;
}

function generateCsv(headers, rows) {
    const escape = (val) => {
        const str = String(val === null || val === undefined ? '' : val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\r\n');
}

module.exports = {
    parseCsv,
    generateCsv
};
