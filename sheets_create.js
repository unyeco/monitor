// sheets_create.js
const { google } = require('googleapis');
const fs = require('fs');

async function createAndSetupSheet(config) {
    const keys = readKeysFile('keys.json'); // Load keys.json
    const groupNames = extractUniqueGroupNames(keys); // Extract unique group names

    const auth = await authorize(config.googleAPI.credentialsPath);
    const sheets = google.sheets({ version: 'v4', auth });

    // Find or create spreadsheet
    const spreadsheetId = await getOrCreateSpreadsheet(auth, config);

    // Check if Balances tab exists
    const balancesTabExists = await checkBalancesTabExists(sheets, spreadsheetId, config.googleAPI.dataTabName);
    if (!balancesTabExists) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    { addSheet: { properties: { title: config.googleAPI.dataTabName } } },
                ],
            },
        });
    }

    // Retrieve existing header row if present
    const existingHeader = await getExistingHeaderRow(sheets, spreadsheetId, config.googleAPI.dataTabName);

    // Generate new header row
    const newHeader = generateHeaderRow(groupNames);

    if (!existingHeader || !headersMatch(existingHeader, newHeader)) {
        // Update header row if it doesn't match
        await setupBalancesHeader(sheets, spreadsheetId, config.googleAPI.dataTabName, newHeader);
    }

    // Apply column formatting
    await applyColumnFormatting(sheets, spreadsheetId, config.googleAPI.dataTabName, groupNames.length + 2); // +2 for Time and Total
}

function readKeysFile(keysFilePath) {
    try {
        const keys = JSON.parse(fs.readFileSync(keysFilePath, 'utf8'));
        if (!Array.isArray(keys)) {
            throw new Error('Invalid keys format: Expected an array.');
        }
        return keys;
    } catch (error) {
        throw new Error(`Failed to read keys.json: ${error.message}`);
    }
}

function extractUniqueGroupNames(keys) {
    const groupNames = new Set(keys.map(key => key.n));
    return Array.from(groupNames); // Return as an array
}

async function authorize(credentialsPath) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const { private_key, client_email } = credentials;

    return new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });
}

async function getOrCreateSpreadsheet(auth, config) {
    const { sheetName, accountEmail } = config.googleAPI;
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
        q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet'`,
        spaces: 'drive',
        fields: 'files(id, name)',
    });

    const files = response.data.files;
    if (files.length > 0) {
        return files[0].id;
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const newSheet = await sheets.spreadsheets.create({
        requestBody: {
            properties: { title: sheetName },
        },
    });

    const spreadsheetId = newSheet.data.spreadsheetId;
    await drive.permissions.create({
        resource: { type: 'user', role: 'writer', emailAddress: accountEmail },
        fileId: spreadsheetId,
        sendNotificationEmail: false,
    });

    return spreadsheetId;
}

async function checkBalancesTabExists(sheets, spreadsheetId, tabName) {
    const response = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = response.data.sheets.map(sheet => sheet.properties.title);
    return tabs.includes(tabName);
}

async function getExistingHeaderRow(sheets, spreadsheetId, tabName) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!A1:Z1`,
        });
        return response.data.values ? response.data.values[0] : null;
    } catch (error) {
        return null; // Assume no header exists if range doesn't exist
    }
}

function generateHeaderRow(groupNames) {
    const header = ['Time', 'Total'];
    return header.concat(groupNames);
}

function headersMatch(existingHeader, newHeader) {
    return JSON.stringify(existingHeader) === JSON.stringify(newHeader);
}

async function setupBalancesHeader(sheets, spreadsheetId, tabName, headerRow) {
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1:Z1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headerRow] },
    });

    // Retrieve the sheetId for the Balances tab
    const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetId = sheetMetadata.data.sheets.find(sheet => sheet.properties.title === tabName)?.properties.sheetId;

    if (!sheetId) {
        throw new Error(`Sheet ID for tab "${tabName}" not found.`);
    }

    // Apply styling for the header row
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: 0,
                            endRowIndex: 1,
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.1, green: 0.2, blue: 0.6 }, // Dark blue 2
                                textFormat: {
                                    foregroundColor: { red: 1, green: 1, blue: 1 }, // White
                                    bold: true,
                                },
                            },
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat)',
                    },
                },
            ],
        },
    });
}

async function applyColumnFormatting(sheets, spreadsheetId, tabName, totalColumns) {
    const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetId = sheetMetadata.data.sheets.find(sheet => sheet.properties.title === tabName)?.properties.sheetId;

    if (!sheetId) {
        throw new Error(`Sheet ID for tab "${tabName}" not found.`);
    }

    const requests = [];

    // Column A: Format as datetime without milliseconds
    requests.push({
        repeatCell: {
            range: {
                sheetId: sheetId,
                startColumnIndex: 0,
                endColumnIndex: 1,
            },
            cell: {
                userEnteredFormat: {
                    numberFormat: {
                        type: 'DATE_TIME',
                        pattern: 'yyyy-MM-dd HH:mm:ss', // Updated pattern
                    },
                },
            },
            fields: 'userEnteredFormat.numberFormat',
        },
    });

    // Columns B onward: Format as numbers with two decimal places and thousands separator
    if (totalColumns > 1) {
        requests.push({
            repeatCell: {
                range: {
                    sheetId: sheetId,
                    startColumnIndex: 1,
                    endColumnIndex: totalColumns,
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: {
                            type: 'NUMBER',
                            pattern: '#,##0.00',
                        },
                    },
                },
                fields: 'userEnteredFormat.numberFormat',
            },
        });
    }

    // Batch update the formatting
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
    });
}

module.exports = {
    createAndSetupSheet,
};
