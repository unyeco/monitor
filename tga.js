// tga.js

const config = require('./config.json');

/**
 * Helper Functions for Formatting and Calculations
 * 
 * Includes functions to format numbers, calculate percentage changes, compute PNL,
 * prepare balances for display, and format messages for Telegram.
 */

/**
 * Formats a number to a string with two decimal places and comma separators.
 * @param {number} num - The number to format.
 * @returns {string} The formatted number as a string.
 */
function formatNumber(num) {
    if (typeof num !== 'number') return '0.00';
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Calculates the percentage change from a start value to a current value.
 * @param {number} start - The starting value.
 * @param {number} current - The current value.
 * @returns {number} The percentage change.
 */
function calculatePercentageChange(start, current) {
    if (start === 0) return 0; // Prevent division by zero
    if (typeof start !== 'number' || typeof current !== 'number') return 0;
    return ((current - start) / start) * 100;
}

/**
 * Calculates the weekly PNL based on total PNL and the duration since start.
 * @param {number} totalPNL - The total PNL percentage.
 * @param {number} secondsSinceStart - The number of seconds since the start time.
 * @returns {number} The weekly PNL percentage.
 */
function calculateWeeklyPNL(totalPNL, secondsSinceStart) {
    const SECONDS_IN_A_WEEK = 604800;
    if (secondsSinceStart <= 0) return 0;
    return (SECONDS_IN_A_WEEK / secondsSinceStart) * totalPNL;
}

/**
 * Prepares the balances for display by calculating PNL and aggregating totals.
 * @param {Object} balances - The balances object.
 * @param {Object} pnlConfig - The PNL configuration.
 * @returns {Object} The updated balances object with PNL calculations.
 */
function prepareBalancesForDisplay(balances, pnlConfig) {
    const now = new Date();
    let allPoolsTotal = 0;

    for (const account in balances) {
        if (account === 'All Pools') continue; // Skip All Pools for now
        const pnlData = pnlConfig[account] || {};
        const accountData = balances[account];

        if (!accountData) {
            // No account data found for the pool
            continue;
        }

        const { balances: accountBalances, baseCurrency } = accountData;

        if (!baseCurrency) {
            // Base currency not defined for the pool
            continue;
        }

        // Sort balances: baseCurrency first, then descending by baseValue
        accountData.balances = Object.fromEntries(
            Object.entries(accountBalances || {}).sort(([aKey, aVal], [bKey, bVal]) => {
                if (aKey === baseCurrency) return -1;
                if (bKey === baseCurrency) return 1;
                return (bVal.baseValue || 0) - (aVal.baseValue || 0);
            })
        );

        // Calculate PNL if enabled and data is available
        if (pnlConfig.enabled && pnlData.start && pnlData.balance) {
            const startDate = new Date(pnlData.start);
            const secondsSinceStart = (now - startDate) / 1000;
            const startBalance = parseFloat(pnlData.balance) || 0;
            const currentBalance = parseFloat(accountData.total) || 0;

            const totalPNL = calculatePercentageChange(startBalance, currentBalance);
            const weeklyPNL = calculateWeeklyPNL(totalPNL, secondsSinceStart);

            accountData.pnlP = totalPNL;
            accountData.pnlW = weeklyPNL;
            accountData.startTime = Math.floor(startDate.getTime() / 1000); // UNIX timestamp in seconds
        } else {
            accountData.pnlP = 0;
            accountData.pnlW = 0;
            accountData.startTime = null;
            // Removed console.warn to eliminate debugging outputs
        }

        // Aggregate total for all pools
        allPoolsTotal += accountData.total || 0;
    }

    // Add All Pools summary
    balances['All Pools'] = {
        total: allPoolsTotal,
    };

    return balances;
}

/**
 * Formats the admin message with balances and PNL information, including pool icons.
 * Icons are determined based on priority:
 * 1. Per-pool icon from pnl section
 * 2. Global poolIcon from tg section
 * 3. No icon if neither is available
 * @param {Object} balances - The balances object with PNL calculations.
 * @returns {string} The formatted admin message.
 */
function formatAdminMessage(balances) {
    let message = '';
    const accountNames = Object.keys(balances).filter(account => account !== 'All Pools');

    for (const account of accountNames) {
        const { balances: accountBalances, total, pnlW, pnlP } = balances[account];
        
        // Determine icon: pnl icon > tg.poolIcon > no icon
        let icon = '';
        if (config.pnl && config.pnl.enabled && config.pnl[account] && config.pnl[account].icon) {
            icon = config.pnl[account].icon;
        } else if (config.tg && config.tg.poolIcon) {
            icon = config.tg.poolIcon;
        }

        // Bold Title with icon if exists
        const title = icon ? `\`${icon} ${account}\`` : `\`${account}\``;
        message += `${title}\n\`─────────────────────\`\n`;

        for (const symbol in accountBalances) {
            const value = accountBalances[symbol]?.baseValue || 0;
            const formattedSymbol = symbol.padEnd(6).slice(0, 6);
            const formattedValue = formatNumber(value).padStart(14);
            message += `\`${formattedSymbol}│${formattedValue}\`\n`;
        }

        const formattedTotal = formatNumber(total || 0).padStart(14);
        message += `\`      ├──────────────\`\n`;
        message += `\`      │${formattedTotal}\`\n`;

        const formattedWeeklyPNL = `${pnlW >= 0 ? '+' : ''}${formatNumber(pnlW)}%`.padStart(14);
        const formattedTotalPNL = `${pnlP >= 0 ? '+' : ''}${formatNumber(pnlP)}%`.padStart(14);
        message += `\` W:   │ ${formattedWeeklyPNL}\`\n`;
        message += `\` P:   │ ${formattedTotalPNL}\`\n`;

        message += `\n`;
    }

    const allPools = balances['All Pools'];
    if (allPools) {
        // Determine totalIcon for "All Pools"
        let allPoolsIcon = '';
        if (config.tg && config.tg.totalIcon) {
            allPoolsIcon = config.tg.totalIcon;
        }

        // Bold Title with totalIcon if exists
        const title = allPoolsIcon ? `\`${allPoolsIcon} All Pools\`` : `**All Pools**`;
        message += `${title}\n\`─────────────────────\`\n`;

        const formattedTotal = formatNumber(allPools.total || 0).padStart(17);
        message += `\` T: ${formattedTotal}\`\n`;
    }

    // Italicize timestamp
    const formattedTimestamp = `⟳ ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`;
    message += `\n*${formattedTimestamp}*`;

    return message;
}

/**
 * Formats the user message with balance and percentage change information.
 * @param {number} balance - The user's current balance.
 * @param {number} percentageChange - The percentage change in balance.
 * @returns {string} The formatted user message.
 */
function formatUserMessage(balance, percentageChange) {
    const formattedBalance = formatNumber(balance);
    const formattedChange = `${percentageChange >= 0 ? '+' : ''}${formatNumber(percentageChange)}%`;
    const formattedTimestamp = `⟳ ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`;
    return `Your current balance is:\n\`${formattedBalance} (${formattedChange})\`\n\n*${formattedTimestamp}*`;
}

module.exports = {
    formatNumber,
    calculatePercentageChange,
    calculateWeeklyPNL,
    prepareBalancesForDisplay,
    formatAdminMessage,
    formatUserMessage,
};