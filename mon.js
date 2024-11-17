// mon.js

/**
 * Main Entry Point for Crypto Balance Monitor
 * 
 * Initializes modules based on the configuration and starts monitoring crypto balances.
 */

// Suppress specific deprecated warnings to maintain console cleanliness
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
    if (typeof warning === 'string' && warning.includes('The `punycode` module is deprecated')) {
        return; // Suppress punycode warnings
    }
    originalEmitWarning(warning, ...args); // Allow other warnings
};

// Import required core modules
const fs = require('fs');
const ws = require('./ws');

// Initialize module variables
let table = null;
let sheets = null;
let tg = null; // Telegram module

/**
 * Safely loads a JSON file.
 * @param {string} filePath - Path to the JSON file.
 * @param {Object} defaultValue - Default value if file read fails.
 * @returns {Object} Parsed JSON content or default value.
 */
function loadJsonFile(filePath, defaultValue = {}) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error.message);
        return defaultValue;
    }
}

// Load configuration and account files
const config = loadJsonFile('config.json', {});
const accounts = loadJsonFile('keys.json', []);

// Validate presence of accounts
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

// Initialize Modules Based on `enabled` Flags

// Initialize Table Module if enabled
if (config.table?.enabled) {
    try {
        table = require('./table');
        console.log('Table module initialized.');
    } catch (error) {
        console.error('Error initializing Table module:', error.message);
        table = null; // Disable table logic if initialization fails
    }
}

// Initialize Sheets Module if enabled
if (config.sheets?.enabled) {
    try {
        sheets = require('./sheets'); // Ensure you have a sheets.js module
        sheets.initialize(config.sheets);
        console.log('Sheets module initialized.');
    } catch (error) {
        console.error('Error initializing Sheets module:', error.message);
        sheets = null; // Disable sheets logic if initialization fails
    }
}

// Initialize Telegram (tg) Module if enabled
if (config.tg?.enabled) {
    try {
        tg = require('./tg'); // Ensure you have a tg.js module
        tg.initialize(config.tg, config.pnl); // Pass both tg and pnl configs
        console.log('Telegram module initialized.');
    } catch (error) {
        console.error('Error initializing Telegram module:', error.message);
        tg = null; // Disable tg logic if initialization fails
    }
}

/**
 * Updates balances and notifies enabled modules.
 */
function updateAndRender() {
    // Render Table if enabled
    if (table) {
        try {
            table.render(balances);
        } catch (error) {
            console.error('Error rendering Table module:', error.message);
        }
    }

    // Stream balances to Sheets if enabled
    if (sheets) {
        try {
            sheets.streamBalances(balances);
        } catch (error) {
            console.error('Error streaming balances to Google Sheets:', error.message);
        }
    }

    // Update Telegram if enabled
    if (tg && typeof tg.update === 'function') { // Ensure tg.update exists
        try {
            tg.update(balances);
        } catch (error) {
            console.error('Error updating Telegram module:', error.message);
        }
    }

    // Add additional modules here in the future following the same pattern
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