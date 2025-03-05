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
            style = style.hex(part);
        } else if (style[part]) {
            style = style[part];
        } else {
            console.warn(`Warning: Unrecognized style "${part}" in "${styleString}". Using default style.`);
            return chalk;
        }
    }
    return style;
}

const fundValueColor = parseChalkStyle('green'); // dark green for Earn and Spot values

function render(balancesObj) {
    const col1Width = 6; // Width of the symbol column including padding
    const col2Width = 14; // Width of the amount column including padding

    const totalWidth = col1Width + col2Width + 3; // Total width including borders and spaces
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
    const futuresSymbolColor = parseChalkStyle(colors.futuresSymbolColor || 'dim.green');
    const defaultSymbolColor = parseChalkStyle(colors.defaultSymbolColor || 'white');
    const amountColor = parseChalkStyle(colors.amountColor || 'green');
    const accountTotalColor = parseChalkStyle(colors.accountTotalColor || 'cyanBright');
    const grandTotalColor = parseChalkStyle(colors.grandTotalColor || 'white');
    const baseCurrencySymbolStyle = parseChalkStyle(colors.baseCurrencySymbolStyle || 'bold');
    const pnlPositive = parseChalkStyle(colors.pnlPositive || 'green');
    const pnlNegative = parseChalkStyle(colors.pnlNegative || 'red');
    const wPnlPositive = parseChalkStyle(colors.wpnlPositive || 'dim.green');
    const wPnlNegative = parseChalkStyle(colors.wpnlNegative || 'dim.red');
    const futurePos = parseChalkStyle(colors.futurePos || 'green');
    const futureNeg = parseChalkStyle(colors.futureNeg || 'red');
    const pnlLabelColor = parseChalkStyle(colors.pnlLabelColor || 'dim.gray');
    const fundLabelColor = parseChalkStyle(colors.fundLabelColor || 'dim.green');
    const fundValueColor = parseChalkStyle(colors.fundValueColor || 'dim.green');

    const leftMarginSize = colors.leftMarginSize || 0;
    const leftMargin = ' '.repeat(leftMarginSize);

    let grandTotalStartBalance = 0;
    let grandTotalCurrentBalance = 0;
    let earliestStartTime = null;

    let firstExchange = true;

    for (let ex of Object.values(balancesObj)) {
        const lineLength = totalWidth + 1; // Ensuring consistent line length

        // Exchange header
        let exchangeName = ex.exchange.padEnd(lineLength - 5, ' ');
        if (firstExchange) {
            output += leftMargin + borderColor('┌' + '─'.repeat(lineLength - 3) + '┐\n');
            firstExchange = false;
        } else {
            output += leftMargin + borderColor('├' + '─'.repeat(lineLength - 3) + '┤\n');
        }

        // Determine the appropriate icon for the pool
        let icon = '';
        if (pnlEnabled && pnlConfig[ex.exchange] && pnlConfig[ex.exchange].icon && pnlConfig[ex.exchange].iconTerminal) {
            icon = pnlConfig[ex.exchange].icon;
        } else if (config.tg && config.tg.poolIcon) {
            icon = config.tg.poolIcon;
        }
        const formattedExchangeName = icon ? `${icon} ${ex.exchange}` : `${ex.exchange}`;
        const coloredExchangeName = accountNameColor(formattedExchangeName.padEnd(lineLength - 5, ' ').slice(0, lineLength - 5));

        output += leftMargin + borderColor('│ ') + coloredExchangeName + borderColor(' │\n');
        output += leftMargin + borderColor('├' + '──────' + '┬' + '──────────────' + '┤\n');

        // Sort balances: baseCurrency at top, then by baseValue descending
        let balancesArray = Object.values(ex.balances);
        balancesArray.sort((a, b) => {
            if (a.symbol === ex.baseCurrency && b.symbol !== ex.baseCurrency) {
                return -1;
            } else if (b.symbol === ex.baseCurrency && a.symbol !== ex.baseCurrency) {
                return 1;
            } else {
                return (b.baseValue || 0) - (a.baseValue || 0);
            }
        });

        // Render balance rows
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

        output += leftMargin + borderColor('│      ├' + '─'.repeat(col2Width) + '┤\n');

        let totalStr = formatNumber(ex.total);
        let totalFormatted = accountTotalColor(totalStr.padStart(col2Width - 2, ' '));
        output += leftMargin + borderColor('│  ' + ' '.repeat(col1Width - 2) + '│ ') + totalFormatted + borderColor(' │\n');

        // PNL Calculations per exchange
        let TPNL = null;
        let WPNL = null;
        const exPnlConfig = pnlEnabled ? pnlConfig[ex.exchange] : null;

        if (pnlEnabled && exPnlConfig && exPnlConfig.start && exPnlConfig.balance) {
            try {
                const startTime = new Date(exPnlConfig.start);
                if (isNaN(startTime)) {
                    throw new Error('Invalid start time');
                }
                const currentTime = new Date();
                const secondsSinceStart = (currentTime - startTime) / 1000;

                const startBalance = parseFloat(exPnlConfig.balance);
                const currentBalance = ex.total;

                if (!(isNaN(startBalance) || isNaN(currentBalance) || startBalance === 0 || secondsSinceStart <= 0)) {
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

                    grandTotalStartBalance += startBalance;
                    // For grand total, add extra fund balances if available
                    let adjustedCurrent = currentBalance;
                    if (ex.hasOwnProperty('spotBalance')) {
                        adjustedCurrent += ex.spotBalance;
                    }
                    if (ex.hasOwnProperty('earnBalance')) {
                        adjustedCurrent += ex.earnBalance;
                    }
                    grandTotalCurrentBalance += adjustedCurrent;

                    if (!earliestStartTime || startTime < earliestStartTime) {
                        earliestStartTime = startTime;
                    }
                }
            } catch (err) {
                console.error(`Error calculating PNL for ${ex.exchange}:`, err);
            }
        }

        if (TPNL !== null) {
            const valueWidth = col2Width - 2;
            const exLabelWidth = col1Width - 1;
            let tpnLabel = 'P:'.padEnd(exLabelWidth, ' ');
            let tpnValue = (TPNL.value >= 0 ? '+' : '') + TPNL.formatted + '%';
            tpnValue = tpnValue.padStart(valueWidth, ' ');

            output += leftMargin + borderColor('│ ') + pnlLabelColor(tpnLabel) + borderColor('│ ') +
                getPnlColor(TPNL.value, pnlPositive, pnlNegative)(tpnValue) + borderColor(' │\n');
        }

        // --- New: Render extra Fund lines if available ---
        if (ex.hasOwnProperty('spotBalance') || ex.hasOwnProperty('earnBalance')) {
            // Add a blank line
            output += leftMargin + borderColor('│' + ' '.repeat(totalWidth - 2) + '│\n');
            // Reduce overall content width by 2 chars for proper sizing
            const contentWidth = (totalWidth - 2) - 2;
            const extraLabelWidth = 8;
            const extraValueWidth = contentWidth - extraLabelWidth;
            if (ex.hasOwnProperty('earnBalance')) {
                let label = 'EARN';
                let labelFormatted = fundLabelColor(label.padEnd(extraLabelWidth, ' '));
                let valueFormatted = fundValueColor(formatNumber(ex.earnBalance).padStart(extraValueWidth, ' '));
                output += leftMargin + borderColor('│ ') + labelFormatted + valueFormatted + borderColor(' │\n');
            }
            if (ex.hasOwnProperty('spotBalance')) {
                let label = 'SPOT';
                let labelFormatted = fundLabelColor(label.padEnd(extraLabelWidth, ' '));
                let valueFormatted = fundValueColor(formatNumber(ex.spotBalance).padStart(extraValueWidth, ' '));
                output += leftMargin + borderColor('│ ') + labelFormatted + valueFormatted + borderColor(' │\n');
            }
        }
    }

    // Footer
    output += leftMargin + borderColor('├' + '─'.repeat(totalWidth - 2) + '┤\n');

    let grandTotalValue = Object.values(balancesObj).reduce((sum, ex) => {
        return sum + ex.total + (ex.spotBalance || 0) + (ex.earnBalance || 0);
    }, 0);
    let grandTotalStr = formatNumber(grandTotalValue);
    output += leftMargin + borderColor('│ ') + 'T:'.padEnd(labelWidth, ' ') + grandTotalColor(grandTotalStr.padStart(totalWidth - labelWidth - 4, ' ')) + borderColor(' │\n');

    let grandTotalPnl = null;
    let grandWeeklyPnl = null;

    if (grandTotalStartBalance > 0 && earliestStartTime) {
        const currentTime = new Date();
        const totalSecondsSinceStart = (currentTime - earliestStartTime) / 1000;

        const grandTotalPnlValue = ((grandTotalCurrentBalance - grandTotalStartBalance) / grandTotalStartBalance) * 100;
        const grandWeeklyPnlValue = (604800 / totalSecondsSinceStart) * grandTotalPnlValue;

        grandTotalPnl = {
            value: grandTotalPnlValue,
            formatted: grandTotalPnlValue.toFixed(2)
        };

        grandWeeklyPnl = {
            value: grandWeeklyPnlValue,
            formatted: grandWeeklyPnlValue.toFixed(2)
        };
    }

    if (grandTotalPnl !== null) {
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