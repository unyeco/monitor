// table.js
const chalk = require('chalk');
const fs = require('fs');

function formatNumber(num) {
    if (typeof num !== 'number') return num;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Function to determine PNL color
function getPnlColor(value, pnlPositive, pnlNegative) {
    return value >= 0 ? pnlPositive : pnlNegative;
}

// Function to parse color strings from config
function parseChalkStyle(styleString) {
    const styleParts = styleString.split('.');
    let style = chalk;
    for (let part of styleParts) {
        if (part.startsWith('#')) {
            // If part is a hex color code
            style = style.hex(part);
        } else if (style[part]) {
            style = style[part];
        } else {
            // If the style is not recognized, return the default chalk style
            console.warn(`Warning: Unrecognized style "${part}" in "${styleString}". Using default style.`);
            return chalk;
        }
    }
    return style;
}

function render(balancesObj) {
    const col1Width = 6; // Width of the symbol column including padding
    const col2Width = 14; // Width of the amount column including padding

    const totalWidth = col1Width + col2Width + 3; // 6 + 14 + 3 = 23 (including borders and spaces)
    const labelWidth = 4; // Width for labels like 'W:' or 'P:'

    let output = '';

    // Read config.json
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    } catch (err) {
        console.error('Error reading config.json:', err);
        return;
    }

    // Access table configurations
    const tableConfig = config.table || {};

    // Access PNL configurations from top-level pnl
    const pnlConfig = config.pnl || {};
    const pnlEnabled = pnlConfig.enabled;

    // Parse color configurations from tableConfig
    const colors = tableConfig.colors || {};

    const borderColor = parseChalkStyle(colors.borderColor || 'dim.gray');
    const accountNameColor = parseChalkStyle(colors.accountNameColor || 'cyan');
    const spotSymbolColor = parseChalkStyle(colors.spotSymbolColor || 'green');
    const futuresSymbolColor = parseChalkStyle(colors.futuresSymbolColor || 'red');
    const defaultSymbolColor = parseChalkStyle(colors.defaultSymbolColor || 'white');
    const amountColor = parseChalkStyle(colors.amountColor || 'green');
    const accountTotalColor = parseChalkStyle(colors.accountTotalColor || 'cyanBright');
    const grandTotalColor = parseChalkStyle(colors.grandTotalColor || 'white');
    const baseCurrencySymbolStyle = parseChalkStyle(colors.baseCurrencySymbolStyle || 'bold');
    const pnlPositive = parseChalkStyle(colors.pnlPositive || 'dim.green');
    const pnlNegative = parseChalkStyle(colors.pnlNegative || 'dim.red');
    const futurePos = parseChalkStyle(colors.futurePos || 'green');
    const futureNeg = parseChalkStyle(colors.futureNeg || 'red');
    const pnlLabelColor = parseChalkStyle(colors.pnlLabelColor || 'dim.gray');

    // Left margin (number of spaces to add at the beginning of each line)
    const leftMarginSize = colors.leftMarginSize || 0;
    const leftMargin = ' '.repeat(leftMarginSize);

    // Initialize grand total variables
    let grandTotalStartBalance = 0;
    let grandTotalCurrentBalance = 0;
    let earliestStartTime = null;

    let firstExchange = true;

    for (let ex of Object.values(balancesObj)) {
        // Ensure each line is the same length
        const lineLength = totalWidth + 1; // +1 for the extra character in the bottom line

        // Exchange header
        let exchangeName = ex.exchange.padEnd(lineLength - 5, ' '); // Adjusted padding to remove extra spaces

        if (firstExchange) {
            output += leftMargin + borderColor('┌' + '─'.repeat(lineLength - 3) + '┐\n'); // Top border
            firstExchange = false;
        } else {
            output += leftMargin + borderColor('├' + '─'.repeat(lineLength - 3) + '┤\n');
        }

        output += leftMargin + borderColor('│ ') + accountNameColor(exchangeName) + borderColor(' │\n'); // Account name
        output += leftMargin + borderColor('├' + '──────' + '┬' + '──────────────' + '┤\n'); // Separator

        // Sort balances: baseCurrency at top, then by baseValue descending
        let balancesArray = Object.values(ex.balances);
        balancesArray.sort((a, b) => {
            if (a.symbol === ex.baseCurrency && b.symbol !== ex.baseCurrency) {
                return -1;
            } else if (b.symbol === ex.baseCurrency && a.symbol !== ex.baseCurrency) {
                return 1;
            } else {
                return b.baseValue - a.baseValue;
            }
        });

        // Balances
        for (let asset of balancesArray) {
            let symbolColor;
            if (asset.type === 'spot') {
                symbolColor = spotSymbolColor;
            } else if (asset.type === 'futures') {
                symbolColor = futuresSymbolColor;
            } else {
                symbolColor = defaultSymbolColor;
            }

            let amountStr = formatNumber(asset.baseValue);

            let symbolStr = asset.symbol.padEnd(col1Width - 1, ' ').slice(0, col1Width - 1);
            let amountFormatted = amountStr.padStart(col2Width - 2, ' ');

            if (asset.symbol === ex.baseCurrency) {
                symbolStr = baseCurrencySymbolStyle(symbolStr);
                amountFormatted = baseCurrencySymbolStyle(amountFormatted);
            } else if (asset.type === 'futures') {
                // Apply futurePos or futureNeg color based on the value
                let valueColor = asset.baseValue >= 0 ? futurePos : futureNeg;
                amountFormatted = valueColor(amountFormatted);
            } else {
                amountFormatted = amountColor(amountFormatted);
            }

            output += leftMargin + borderColor('│ ') +
                symbolColor(symbolStr) +
                borderColor('│ ') +
                amountFormatted +
                borderColor(' │\n');
        }

        // Added line above the per exchange total
        output += leftMargin + borderColor('│      ├' + '─'.repeat(col2Width) + '┤\n');

        // Total per exchange
        let totalStr = formatNumber(ex.total);
        let totalFormatted = accountTotalColor(totalStr.padStart(col2Width - 2, ' ')); // Total in light blue

        // Added one extra space in the first column for the total line
        output += leftMargin + borderColor('│  ' + ' '.repeat(col1Width - 2) + '│ ') + totalFormatted + borderColor(' │\n');

        // PNL Calculations per exchange
        let TPNL = null; // Total PNL
        let WPNL = null; // Weekly PNL

        // Access PNL configuration for this exchange/account from top-level pnl
        const exPnlConfig = pnlEnabled ? pnlConfig[ex.exchange] : null;

        if (pnlEnabled && exPnlConfig && exPnlConfig.start && exPnlConfig.balance) {
            try {
                const startTime = new Date(exPnlConfig.start);
                if (isNaN(startTime)) {
                    throw new Error('Invalid start time');
                }
                const currentTime = new Date();
                const secondsSinceStart = (currentTime - startTime) / 1000; // in seconds

                const startBalance = parseFloat(exPnlConfig.balance);
                const currentBalance = ex.total;

                if (isNaN(startBalance) || isNaN(currentBalance) || startBalance === 0 || secondsSinceStart <= 0) {
                    // Cannot calculate PNL
                } else {
                    const totalPnlValue = ((currentBalance - startBalance) / startBalance) * 100;
                    const weeklyPnlValue = (604800 / secondsSinceStart) * totalPnlValue;

                    TPNL = {
                        value: totalPnlValue,
                        formatted: totalPnlValue.toFixed(2)
                    };
                    WPNL = {
                        value: weeklyPnlValue,
                        formatted: weeklyPnlValue.toFixed(2)
                    };

                    // Sum up for grand total calculations
                    grandTotalStartBalance += startBalance;
                    grandTotalCurrentBalance += currentBalance;

                    // Find the earliest start time
                    if (!earliestStartTime || startTime < earliestStartTime) {
                        earliestStartTime = startTime;
                    }
                }
            } catch (err) {
                console.error(`Error calculating PNL for ${ex.exchange}:`, err);
                // Cannot calculate PNL
            }
        }

        // Output PNL lines if available
        const valueWidth = col2Width - 2;
        const exLabelWidth = col1Width - 1;

        if (WPNL !== null) {
            let wpnLabel = 'W:'.padEnd(exLabelWidth, ' ');
            let wpnValue = (WPNL.value >= 0 ? '+' : '') + WPNL.formatted + '%';
            wpnValue = wpnValue.padStart(valueWidth, ' ');

            output += leftMargin + borderColor('│ ') + pnlLabelColor(wpnLabel) + borderColor('│ ') +
                getPnlColor(WPNL.value, pnlPositive, pnlNegative)(wpnValue) + borderColor(' │\n');
        }

        if (TPNL !== null) {
            let tpnLabel = 'P:'.padEnd(exLabelWidth, ' ');
            let tpnValue = (TPNL.value >= 0 ? '+' : '') + TPNL.formatted + '%';
            tpnValue = tpnValue.padStart(valueWidth, ' ');

            output += leftMargin + borderColor('│ ') + pnlLabelColor(tpnLabel) + borderColor('│ ') +
                getPnlColor(TPNL.value, pnlPositive, pnlNegative)(tpnValue) + borderColor(' │\n');
        }
    }

    // Footer
    output += leftMargin + borderColor('├' + '─'.repeat(totalWidth - 2) + '┤\n');

    // Grand total line
    let grandTotalValue = Object.values(balancesObj).reduce((sum, ex) => sum + ex.total, 0);
    let grandTotalStr = formatNumber(grandTotalValue);
    output += leftMargin + borderColor('│ ') + 'T:'.padEnd(labelWidth, ' ') + grandTotalColor(grandTotalStr.padStart(totalWidth - labelWidth - 4, ' ')) + borderColor(' │\n');

    // Grand total PNL calculations
    let grandTotalPnl = null;
    let grandWeeklyPnl = null;

    if (grandTotalStartBalance > 0 && earliestStartTime) {
        const currentTime = new Date();
        const totalSecondsSinceStart = (currentTime - earliestStartTime) / 1000;

        const grandTotalPnlValue = ((grandTotalCurrentBalance - grandTotalStartBalance) / grandTotalStartBalance) * 100;
        const grandWeeklyPnlValue = (604800 / totalSecondsSinceStart) * grandTotalPnlValue;

        // Format to two decimal places
        grandTotalPnl = {
            value: grandTotalPnlValue,
            formatted: grandTotalPnlValue.toFixed(2)
        };

        grandWeeklyPnl = {
            value: grandWeeklyPnlValue,
            formatted: grandWeeklyPnlValue.toFixed(2)
        };
    }

    // Output grand total PNL lines if available
    if (grandWeeklyPnl) {
        let wpnLabel = 'W:'.padEnd(labelWidth, ' ');
        let wpnValue = (grandWeeklyPnl.value >= 0 ? '+' : '') + grandWeeklyPnl.formatted + '%';
        wpnValue = wpnValue.padStart(totalWidth - labelWidth - 4, ' ');

        output += leftMargin + borderColor('│ ') + pnlLabelColor(wpnLabel) +
            getPnlColor(grandWeeklyPnl.value, pnlPositive, pnlNegative)(wpnValue) + borderColor(' │\n');
    }

    if (grandTotalPnl) {
        let tpnLabel = 'P:'.padEnd(labelWidth, ' ');
        let tpnValue = (grandTotalPnl.value >= 0 ? '+' : '') + grandTotalPnl.formatted + '%';
        tpnValue = tpnValue.padStart(totalWidth - labelWidth - 4, ' ');

        output += leftMargin + borderColor('│ ') + pnlLabelColor(tpnLabel) +
            getPnlColor(grandTotalPnl.value, pnlPositive, pnlNegative)(tpnValue) + borderColor(' │\n');
    }

    output += leftMargin + borderColor('└' + '─'.repeat(totalWidth - 2) + '┘\n');

    process.stdout.write('\x1Bc'); // Clear the screen
    process.stdout.write(output);
}

module.exports = {
    render,
};
