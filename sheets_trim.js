// sheets_trim.js
const { google } = require('googleapis');
const fs = require('fs');

async function trimData(config) {
    const auth = await authorize(config.googleAPI.credentialsPath);
    const sheets = google.sheets({ version: 'v4', auth });
    const { sheetName, dataTabName, trimmingRules } = config.googleAPI;

    // Logic for trimming based on rules (e.g., afterWeek, afterMonth)
    // Implement as per requirements
}

async function authorize(credentialsPath) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    const token = JSON.parse(fs.readFileSync('token.json', 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
}

module.exports = {
    trimData,
};