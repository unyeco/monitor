// mon.js
const fs = require('fs');
const ws = require('./ws');
const table = require('./table');

// Read accounts from keys.json
const accounts = JSON.parse(fs.readFileSync('keys.json', 'utf8'));

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
}

// Start monitoring balances
for (const [groupName, groupAccounts] of Object.entries(groupedAccounts)) {
    for (const account of groupAccounts) {
        ws.monitorBalances(account, groupName, balances, updateAndRender);
    }
}
