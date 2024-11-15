// table.js
const chalk = require('chalk');

// Colors allowed by chalk:
// black, red, green, yellow, blue, magenta, cyan, white, gray, grey,
// blackBright, redBright, greenBright, yellowBright, blueBright,
// magentaBright, cyanBright, whiteBright
//
// Modifiers: reset, bold, dim, italic, underline, inverse, hidden, strikethrough, visible

// Color configuration
const borderColor = chalk.dim.gray;
const accountNameColor = chalk.cyan;
const spotSymbolColor = chalk.green;
const futuresSymbolColor = chalk.red;
const defaultSymbolColor = chalk.white;
const amountColor = chalk.green;
const accountTotalColor = chalk.cyanBright;
const grandTotalColor = chalk.white;
const baseCurrencySymbolStyle = chalk.bold;

// Left margin (number of spaces to add at the beginning of each line)
const leftMarginSize = 0;
const leftMargin = ' '.repeat(leftMarginSize);

function formatNumber(num) {
    if (typeof num !== 'number') return num;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function render(balancesObj) {
    const col1Width = 6; // Width of the symbol column including padding
    const col2Width = 14; // Width of the amount column including padding

    const totalWidth = col1Width + col2Width + 3; // 6 + 14 + 3 = 23 (including borders and spaces)

    let output = '';

    // Calculate the grand total
    let grandTotal = 0;

    let firstExchange = true;

    for (let ex of Object.values(balancesObj)) {
        // Ensure each line is the same length
        const lineLength = totalWidth + 1; // +1 for the extra character in the bottom line

        // Exchange header
        let exchangeName = ex.exchange.padEnd(lineLength - 5, ' '); // Adjusted padding to remove extra spaces

        if (firstExchange) {
            output += leftMargin + borderColor('┌' + '─'.repeat(lineLength - 3) + '┐\n'); // Top border, removed one "─"
            firstExchange = false;
        } else {
            output += leftMargin + borderColor('├' + '─'.repeat(lineLength - 3) + '┤\n'); // Removed one "─"
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
            }

            output += leftMargin + borderColor('│ ') +
                symbolColor(symbolStr) +
                borderColor('│ ') +
                amountColor(amountFormatted) +
                borderColor(' │\n');
        }

        // Added line above the per exchange total
        output += leftMargin + borderColor('│      ├' + '─'.repeat(col2Width) + '┤\n');

        // Total per exchange
        let totalStr = formatNumber(ex.total);
        let totalFormatted = accountTotalColor(totalStr.padStart(col2Width - 2, ' ')); // Total in light blue

        // Added one extra space in the first column for the total line
        output += leftMargin + borderColor('│  ' + ' '.repeat(col1Width - 2) + '│ ') + totalFormatted + borderColor(' │\n');

        grandTotal += ex.total;
    }

    // Footer
    output += leftMargin + borderColor('├' + '─'.repeat(totalWidth - 2) + '┤\n');
    output += leftMargin + borderColor('│' + ' '.repeat(totalWidth - 2) + '│\n');
    let grandTotalStr = formatNumber(grandTotal);
    output += leftMargin + borderColor('│ ') + 'T:'.padEnd(2, ' ') + grandTotalColor(grandTotalStr.padStart(totalWidth - 6, ' ')) + borderColor(' │\n'); // Adjusted padding
    output += leftMargin + borderColor('└' + '─'.repeat(totalWidth - 2) + '┘\n');

    process.stdout.write('\x1Bc'); // Clear the screen
    process.stdout.write(output);
}

module.exports = {
    render,
};
