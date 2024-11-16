// mon.js

// Suppress specific warnings
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
    if (typeof warning === 'string' && warning.includes('The `punycode` module is deprecated')) {
        return; // Suppress punycode warnings
    }
    originalEmitWarning(warning, ...args); // Allow other warnings
};

// Import required modules
const fs = require('fs');
const ws = require('./ws');
const table = require('./table');
let sheets;

// Function to safely load a JSON file
function loadJsonFile(filePath, defaultValue = {}) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error.message);
        return defaultValue;
    }
}

// Load configuration and account files
const config = loadJsonFile('config.json', { googleAPI: { enabled: false } });
const accounts = loadJsonFile('keys.json', []);

if (accounts.length === 0) {
    console.error('No accounts found in keys.json. Exiting.');
    process.exit(1);
}

// Group accounts by 'n' (name)
const groupedAccounts = accounts.reduce((acc, account) => {
    const key = account.n;
    if (!acc[key]) {
        acc[key] = [];
    }
    acc[key].push(account);
    return acc;
}, {});

// Global balances object
const balances = {};

// Function to update balances and render table
function updateAndRender() {
    table.render(balances);

    // Write balances to Google Sheets if enabled and initialized
    if (config.googleAPI?.enabled && sheets) {
        try {
            sheets.streamBalances(balances);
        } catch (error) {
            console.error('Error streaming balances to Google Sheets:', error.message);
        }
    }
}

// Initialize Sheets if Google API is enabled
if (config.googleAPI?.enabled) {
    try {
        sheets = require('./sheets'); // Dynamically require sheets module only if needed
        sheets.initialize(config);
    } catch (error) {
        console.error('Error initializing Google Sheets:', error.message);
        sheets = null; // Disable sheets logic if initialization fails
    }
}

// Start monitoring balances
for (const [groupName, groupAccounts] of Object.entries(groupedAccounts)) {
    for (const account of groupAccounts) {
        try {
            ws.monitorBalances(account, groupName, balances, updateAndRender);
        } catch (error) {
            console.error(`Error monitoring balances for account "${groupName}":`, error.message);
        }
    }
}