// sheets.js
const sheetsCreate = require('./sheets_create');
const sheetsStream = require('./sheets_stream');
const sheetsTrim = require('./sheets_trim');

let config;

function initialize(userConfig) {
    config = userConfig;
    sheetsCreate.createAndSetupSheet(config);
}

function streamBalances(balances) {
    sheetsStream.writeBalances(config, balances);
}

function trimSheetData() {
    sheetsTrim.trimData(config);
}

module.exports = {
    initialize,
    streamBalances,
    trimSheetData,
};
