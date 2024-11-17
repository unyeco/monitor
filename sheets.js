// sheets.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule'); // Ensure you have node-schedule installed
const util = require('util');

class SheetsModule {
    constructor() {
        this.sheets = null;
        this.drive = null;
        this.spreadsheetId = null;
        this.dataSheetId = null;
        this.currentBalances = {};
        this.config = null;
        this.groupNames = [];
    }

    /**
     * Initializes the Sheets module.
     * @param {Object} config - Sheets configuration from config.json.
     */
    async initialize(config) {
        this.config = config;

        try {
            // Extract group names from keys.json
            const keys = this.readKeysFile('keys.json');
            this.groupNames = this.extractUniqueGroupNames(keys);

            // Authorize with Google Sheets API
            const auth = await this.authorize(config.credentialsPath);

            // Initialize Google Sheets and Drive API clients
            this.sheets = google.sheets({ version: 'v4', auth });
            this.drive = google.drive({ version: 'v3', auth });

            // Find or create the spreadsheet
            this.spreadsheetId = await this.findOrCreateSpreadsheet(config.sheetName, config.accountEmail);

            // Ensure data tab exists
            await this.ensureDataTab(config.dataTabName);

            // Ensure headers are set up
            await this.ensureHeaderRow(config.dataTabName);

            // Share spreadsheet with accountEmail with full permissions
            await this.shareSpreadsheet(config.accountEmail, auth);

            // Setup scheduler based on frequency
            this.setupScheduler(config.frequency);

            console.log('Sheets module initialized successfully.');
        } catch (error) {
            console.error('Error initializing Sheets module:', error.message);
            throw error; // Propagate the error to be handled in mon.js
        }
    }

    /**
     * Reads the keys.json file to extract group names.
     * @param {string} keysFilePath - Path to the keys.json file.
     * @returns {Array} - Array of account objects.
     */
    readKeysFile(keysFilePath) {
        try {
            const keysPath = path.resolve(keysFilePath);
            const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
            if (!Array.isArray(keys)) {
                throw new Error('Invalid keys format: Expected an array.');
            }
            return keys;
        } catch (error) {
            throw new Error(`Failed to read keys.json: ${error.message}`);
        }
    }

    /**
     * Extracts unique group names from the accounts.
     * @param {Array} keys - Array of account objects.
     * @returns {Array} - Array of unique group names.
     */
    extractUniqueGroupNames(keys) {
        const groupNamesSet = new Set(keys.map(key => key.n));
        return Array.from(groupNamesSet);
    }

    /**
     * Authorizes with Google Sheets API using service account credentials.
     * @param {string} credentialsPath - Path to the service account credentials JSON file.
     * @returns {Object} - Auth client.
     */
    async authorize(credentialsPath) {
        try {
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            const { client_email, private_key } = credentials;
            const auth = new google.auth.JWT({
                email: client_email,
                key: private_key,
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive',
                ],
            });
            await auth.authorize();
            return auth;
        } catch (error) {
            throw new Error(`Failed to authorize Google Sheets API: ${error.message}`);
        }
    }

    /**
     * Finds an existing spreadsheet by name or creates a new one.
     * @param {string} sheetName - Name of the spreadsheet.
     * @param {string} accountEmail - Email to share the spreadsheet with.
     * @returns {string} - Spreadsheet ID.
     */
    async findOrCreateSpreadsheet(sheetName, accountEmail) {
        try {
            // Search for the spreadsheet
            const res = await this.drive.files.list({
                q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet'`,
                fields: 'files(id, name)',
                spaces: 'drive',
            });

            if (res.data.files.length > 0) {
                console.log(`Spreadsheet "${sheetName}" found.`);
                return res.data.files[0].id;
            }

            // Create a new spreadsheet
            const newSpreadsheet = await this.sheets.spreadsheets.create({
                requestBody: {
                    properties: {
                        title: sheetName,
                    },
                },
            });

            console.log(`Spreadsheet "${sheetName}" created.`);
            return newSpreadsheet.data.spreadsheetId;
        } catch (error) {
            throw new Error(`Failed to find or create spreadsheet "${sheetName}": ${error.message}`);
        }
    }

    /**
     * Ensures that the data tab exists; if not, creates it.
     * @param {string} dataTabName - Name of the data tab.
     */
    async ensureDataTab(dataTabName) {
        try {
            const res = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
                includeGridData: false,
            });

            const sheets = res.data.sheets.map(sheet => sheet.properties.title);
            if (sheets.includes(dataTabName)) {
                console.log(`Data tab "${dataTabName}" exists.`);
                this.dataSheetId = res.data.sheets.find(sheet => sheet.properties.title === dataTabName).properties.sheetId;
                return;
            }

            // Add the data tab
            const addSheetResponse = await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: dataTabName,
                                },
                            },
                        },
                    ],
                },
            });

            console.log(`Data tab "${dataTabName}" created.`);
            this.dataSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
        } catch (error) {
            throw new Error(`Failed to ensure data tab "${dataTabName}": ${error.message}`);
        }
    }

    /**
     * Ensures that the header row is set up correctly.
     * @param {string} dataTabName - Name of the data tab.
     */
    async ensureHeaderRow(dataTabName) {
        try {
            // Define the header row
            const header = ['Time', 'Total'].concat(this.groupNames);

            // Get existing headers
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${dataTabName}!A1:Z1`,
            });

            const existingHeader = res.data.values ? res.data.values[0] : null;

            // Compare existing header with the desired header
            const headersMatch = existingHeader &&
                existingHeader.length === header.length &&
                existingHeader.every((val, index) => val === header[index]);

            if (headersMatch) {
                console.log('Header row already exists and matches.');
                return;
            }

            // Set the header row
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${dataTabName}!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [header],
                },
            });

            console.log('Header row set up.');

            // Apply formatting to the header row
            await this.formatHeaderRow(dataTabName);
        } catch (error) {
            throw new Error(`Failed to ensure header row in "${dataTabName}": ${error.message}`);
        }
    }

    /**
     * Formats the header row with specific styles.
     * @param {string} dataTabName - Name of the data tab.
     */
    async formatHeaderRow(dataTabName) {
        try {
            const requests = [
                {
                    repeatCell: {
                        range: {
                            sheetId: this.dataSheetId,
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
            ];

            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                requestBody: {
                    requests,
                },
            });

            console.log('Header row formatted.');
        } catch (error) {
            console.error(`Failed to format header row in "${dataTabName}":`, error.message);
        }
    }

    /**
     * Shares the spreadsheet with the specified email with full permissions.
     * @param {string} accountEmail - Email to share the spreadsheet with.
     * @param {Object} auth - Auth client.
     */
    async shareSpreadsheet(accountEmail, auth) {
        try {
            await this.drive.permissions.create({
                fileId: this.spreadsheetId,
                requestBody: {
                    type: 'user',
                    role: 'writer',
                    emailAddress: accountEmail,
                },
                fields: 'id',
                sendNotificationEmail: false,
            });

            console.log(`Spreadsheet shared with ${accountEmail}.`);
        } catch (error) {
            throw new Error(`Failed to share spreadsheet with ${accountEmail}: ${error.message}`);
        }
    }

    /**
     * Sets up the scheduler based on the specified frequency.
     * @param {string} frequency - Frequency string (e.g., "1m", "10m", "30m", "1h").
     */
    setupScheduler(frequency) {
        try {
            const cronExpression = this.getCronExpression(frequency);

            // Schedule the job
            schedule.scheduleJob(cronExpression, () => {
                this.writeBalances();
            });

            console.log(`Scheduler set up to write balances every ${frequency}. Cron: "${cronExpression}"`);
        } catch (error) {
            throw new Error(`Failed to set up scheduler with frequency "${frequency}": ${error.message}`);
        }
    }

    /**
     * Generates a cron expression based on the frequency string.
     * @param {string} frequency - Frequency string (e.g., "1m", "10m", "30m", "1h").
     * @returns {string} - Cron expression.
     */
    getCronExpression(frequency) {
        const regex = /^(\d+)([smhd])$/;
        const match = frequency.match(regex);

        if (!match) {
            throw new Error(`Invalid frequency format: "${frequency}". Expected format like "1m", "10m", "30m", "1h", "1d".`);
        }

        const value = parseInt(match[1], 10);
        const unit = match[2];
        let cron;

        switch (unit) {
            case 's':
                throw new Error('Scheduling with seconds is not supported. Use minutes or higher.');
            case 'm':
                if (value < 1 || value > 59) {
                    throw new Error(`Invalid minutes value: "${value}". Must be between 1 and 59.`);
                }
                // Every 'value' minutes at second 0
                // node-schedule uses 6 fields: second minute hour dayOfMonth month dayOfWeek
                cron = `0 */${value} * * * *`;
                break;
            case 'h':
                if (value < 1 || value > 23) {
                    throw new Error(`Invalid hours value: "${value}". Must be between 1 and 23.`);
                }
                // Every 'value' hours at minute 0, second 0
                cron = `0 0 */${value} * * *`;
                break;
            case 'd':
                if (value < 1 || value > 31) {
                    throw new Error(`Invalid days value: "${value}". Must be between 1 and 31.`);
                }
                // Every 'value' days at hour 0, minute 0, second 0
                cron = `0 0 0 */${value} * *`;
                break;
            default:
                throw new Error(`Unsupported frequency unit: "${unit}". Use "s", "m", "h", or "d".`);
        }

        return cron;
    }

    /**
     * Writes the current balances to the Google Sheet.
     */
    async writeBalances() {
        if (!this.currentBalances || Object.keys(this.currentBalances).length === 0) {
            console.warn('No balances to write.');
            return;
        }

        try {
            const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

            // Calculate total balance
            const totalBalance = Object.values(this.currentBalances).reduce((sum, group) => sum + group.total, 0);

            // Prepare the row
            const row = [timestamp, totalBalance];
            for (const group of this.groupNames) {
                const groupBalance = this.currentBalances[group] ? this.currentBalances[group].total : 0;
                row.push(groupBalance);
            }

            // Append the row to the sheet
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${this.config.dataTabName}!A:Z`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: [row],
                },
            });

            console.log(`Balances written to sheet at ${timestamp}.`);
        } catch (error) {
            console.error('Error writing balances to Google Sheets:', error.message);
        }
    }

    /**
     * Stores the latest balances to be written by the scheduler.
     * @param {Object} balances - The global balances object.
     */
    streamBalances(balances) {
        this.currentBalances = balances;
        // Balances will be written by the scheduler at the next scheduled time
    }
}

module.exports = new SheetsModule();
