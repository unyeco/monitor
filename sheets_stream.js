// sheets_create.js
const { google } = require('googleapis');
const fs = require('fs');

let scheduledNextWriteTime = null;

async function writeBalances(config, balances) {
    const auth = await authorize(config.googleAPI.credentialsPath);
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // Find the spreadsheet by name
    const spreadsheetId = await findSpreadsheetIdByName(drive, config.googleAPI.sheetName);
    const { dataTabName, frequency } = config.googleAPI;

    if (!spreadsheetId) {
        throw new Error(`Spreadsheet with name "${config.googleAPI.sheetName}" not found.`);
    }

    const currentTime = new Date();
    const formattedTimestamp = formatTimestamp(currentTime);

    // Skip if it's not time to write
    if (!shouldWrite(currentTime, frequency)) {
        return;
    }

    // Prepare balance data to write
    const totalBalance = Object.values(balances).reduce((sum, group) => sum + group.total, 0);
    const rowData = [formattedTimestamp, totalBalance];

    // Add group balances
    for (const group of Object.values(balances)) {
        rowData.push(group.total);
    }

    // Write the data to the sheet
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${dataTabName}!A:Z`,
        valueInputOption: 'RAW',
        requestBody: {
            values: [rowData],
        },
    });

    // Schedule the next write time
    scheduledNextWriteTime = calculateNextWriteTime(currentTime, frequency);
}

async function findSpreadsheetIdByName(drive, sheetName) {
    const response = await drive.files.list({
        q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet'`,
        spaces: 'drive',
        fields: 'files(id, name)',
    });

    const files = response.data.files;
    if (files.length > 0) {
        return files[0].id; // Return the first match
    }

    return null; // Spreadsheet not found
}

async function authorize(credentialsPath) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const { private_key, client_email } = credentials;

    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });

    return auth;
}

// Format timestamp as "YYYY-MM-DD HH:MM:SS" in UTC
function formatTimestamp(date) {
    const utcYear = date.getUTCFullYear();
    const utcMonth = String(date.getUTCMonth() + 1).padStart(2, '0'); // Months are zero-based
    const utcDate = String(date.getUTCDate()).padStart(2, '0');
    const utcHours = String(date.getUTCHours()).padStart(2, '0');
    const utcMinutes = String(date.getUTCMinutes()).padStart(2, '0');
    const utcSeconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${utcYear}-${utcMonth}-${utcDate} ${utcHours}:${utcMinutes}:${utcSeconds}`;
}

// Determine if it's time to write based on frequency and alignment
function shouldWrite(currentTime, frequency) {
    const now = currentTime.getTime();

    if (!scheduledNextWriteTime) {
        scheduledNextWriteTime = calculateNextWriteTime(currentTime, frequency);
    }

    if (now >= scheduledNextWriteTime) {
        return true;
    }

    return false;
}

// Calculate the next write time aligned to frequency
function calculateNextWriteTime(currentTime, frequency) {
    const frequencyMs = parseFrequency(frequency);

    const now = currentTime.getTime();
    const alignmentPoint = Math.floor(now / frequencyMs) * frequencyMs + frequencyMs;

    return alignmentPoint;
}

// Convert frequency like "1m" to milliseconds
function parseFrequency(frequency) {
    const match = frequency.match(/^(\d+)([smhd])$/); // Match number followed by s, m, h, or d
    if (!match) {
        throw new Error(`Invalid frequency format: "${frequency}"`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 's':
            return value * 1000; // seconds to milliseconds
        case 'm':
            return value * 60 * 1000; // minutes to milliseconds
        case 'h':
            return value * 60 * 60 * 1000; // hours to milliseconds
        case 'd':
            return value * 24 * 60 * 60 * 1000; // days to milliseconds
        default:
            throw new Error(`Unsupported frequency unit: "${unit}"`);
    }
}

module.exports = {
    writeBalances,
};