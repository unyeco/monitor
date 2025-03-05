// ws.js

const ccxt = require('ccxt');

// Function to monitor balances
async function monitorBalances(account, groupName, balancesObj, callback) {
    const { e, k, p, baseCurrency, options } = account;
    const exchangeId = e;

    const exchangeClass = ccxt[exchangeId];
    if (!exchangeClass) {
        console.error(`Exchange ${exchangeId} not found.`);
        return;
    }

    const exchange = new exchangeClass({
        apiKey: k,
        secret: p,
        enableRateLimit: true,
        options: options || {},
        password: account.password || undefined,
    });

    // Mark as Fund account if the account name ends with " Fund" and defaultType is "swap"
    if (account.n.endsWith(' Fund') && account.options?.defaultType === 'swap') {
        exchange.isFundAccount = true;
    }

    // Initialize groupBalances entry if not exists
    if (!balancesObj[groupName]) {
        balancesObj[groupName] = {
            exchange: groupName,
            balances: {},
            baseCurrency: baseCurrency,
            total: 0,
        };
    }

    // Initialize balanceCache for this exchange
    const balanceCache = {};

    // Start monitoring
    startPollingOrSubscribe(exchange, groupName, balancesObj, callback, balanceCache);
}

// Function to start polling or websocket subscription for balances
function startPollingOrSubscribe(exchange, groupName, balancesObj, callback, balanceCache) {
    if (exchange.has['watchBalance']) {
        (async function watchBalance() {
            try {
                while (true) {
                    const balanceData = await exchange.watchBalance();
                    // Merge WebSocket data and update in one go
                    await compileAndUpdateBalances(exchange, balanceData, groupName, balancesObj, balanceCache);
                    callback();
                }
            } catch (e) {
                console.error(`Error watching balance data: ${e.message}`);
                startPolling(exchange, groupName, balancesObj, callback, balanceCache);
            }
        })();
    } else {
        startPolling(exchange, groupName, balancesObj, callback, balanceCache);
    }
}

// Function to start polling balances every 5 seconds
function startPolling(exchange, groupName, balancesObj, callback, balanceCache) {
    (async function monitor() {
        while (true) {
            try {
                const balanceData = await fetchCompleteBalance(exchange);
                await processBalanceData(exchange, balanceData, groupName, balancesObj, balanceCache);
                callback();
            } catch (e) {
                console.error(`Error fetching balance data: ${e.message}`);
            }
            await sleep(5000);
        }
    })();
}

// Function to fetch complete balance
async function fetchCompleteBalance(exchange) {
    let balanceData;
    try {
        if (exchange.id === 'coinbase') {
            // Fetch balances for both 'cash' and detailed accounts
            balanceData = await exchange.fetchBalance();
            const accounts = await exchange.fetchAccounts();
            let totalBalances = {};

            for (const account of accounts) {
                const currencyCode = account.code;
                const available = parseFloat(account.info.available_balance.value || 0);
                const hold = parseFloat(account.info.hold.value || 0);
                const total = available + hold;

                if (!totalBalances[currencyCode]) {
                    totalBalances[currencyCode] = 0;
                }
                totalBalances[currencyCode] += total;
            }

            balanceData.total = totalBalances;
        } else if (exchange.id === 'gateio') {
            // Use the defaultType from account options (spot or swap)
            const type = exchange.options?.defaultType || 'swap';
            balanceData = await exchange.fetchBalance({ type });
        } else {
            balanceData = await exchange.fetchBalance();
        }
    } catch (e) {
        console.error(`Error fetching balances for ${exchange.id}: ${e.message}`);
        balanceData = { total: {} };
    }

    return balanceData;
}

// Function to process balance data
async function processBalanceData(exchange, balanceData, groupName, balancesObj, balanceCache) {
    const baseCurrency = balancesObj[groupName].baseCurrency;
    const newAssets = {};

    let totalBalances = balanceData.total || {};

    // Update balanceCache with new data
    for (const [currency, amount] of Object.entries(totalBalances)) {
        if (amount && Math.abs(amount) > 1e-6) {
            balanceCache[currency] = amount;
        } else if (balanceCache[currency]) {
            delete balanceCache[currency];
        }
    }

    // Process balanceCache to update assets
    for (const [currency, amount] of Object.entries(balanceCache)) {
        let baseValue = amount;
        let symbol = currency;
        let assetType = 'spot';

        if (currency !== baseCurrency) {
            let marketId = null;
            let invertPrice = false;

            const possiblePairs = [
                `${currency}/${baseCurrency}`,
                `${baseCurrency}/${currency}`,
                `${currency}/USD`,
                `USD/${currency}`,
                `${currency}/USDT`,
                `USDT/${currency}`,
            ];

            for (const pair of possiblePairs) {
                if (exchange.markets[pair]) {
                    marketId = pair;
                    invertPrice = pair.startsWith(`${baseCurrency}/`) || pair.startsWith('USD/') || pair.startsWith('USDT/');
                    break;
                }
            }

            let price = null;
            if (!marketId) {
                price = await fetchPriceFromAlternativeExchange(currency, baseCurrency);
                if (price === null) {
                    continue;
                }
            } else {
                try {
                    let ticker = await exchange.fetchTicker(marketId);
                    const priceValue = ticker.last || ticker.close;
                    if (invertPrice) {
                        price = 1 / priceValue;
                    } else {
                        price = priceValue;
                    }
                } catch (e) {
                    price = await fetchPriceFromAlternativeExchange(currency, baseCurrency);
                    if (price === null) {
                        continue;
                    }
                }
            }

            if (price) {
                baseValue = amount * price;
            } else {
                continue;
            }
        } else {
            baseValue = amount;
        }

        if (Math.abs(baseValue) < 0.01) {
            continue;
        }

        const assetKey = symbol;
        newAssets[assetKey] = {
            symbol,
            amount,
            baseValue,
            type: assetType,
        };
    }

    // Include futures positions only if defaultType is 'swap'
    if (exchange.has['fetchPositions'] && exchange.options?.defaultType === 'swap') {
        try {
            const positions = await exchange.fetchPositions();
            for (const position of positions) {
                if (position.contracts !== 0) {
                    const market = exchange.markets[position.symbol];
                    if (market) {
                        let ticker = await exchange.fetchTicker(position.symbol);
                        const price = ticker.last || ticker.close;
                        const UPNL = position.unrealizedPnl || 0;

                        if (Math.abs(UPNL) < 0.01) {
                            continue;
                        }

                        const symbol = position.symbol;
                        const assetKey = symbol;

                        newAssets[assetKey] = {
                            symbol,
                            amount: position.contracts,
                            baseValue: UPNL,
                            type: 'futures',
                        };
                    }
                }
            }
        } catch (e) {
            if (e.message.includes('requires a "portfolio" value')) {
                // Gracefully handle the missing portfolio error
            } else {
                console.error(`Error fetching positions: ${e.message}`);
            }
        }
    }

    // Update balances and total for this group
    balancesObj[groupName].balances = newAssets;
    balancesObj[groupName].total = Object.values(newAssets).reduce((acc, curr) => acc + curr.baseValue, 0);

    // --- New: Additional Fund account logic ---
    if (exchange.isFundAccount) {
        let spotBalance = 0;
        let earnBalance = 0;
        try {
            const spotData = await exchange.fetchBalance({ type: 'spot' });
            spotBalance = spotData.total[balancesObj[groupName].baseCurrency] || 0;
        } catch (e) {
            console.error(`Error fetching spot balance for ${exchange.id} fund account: ${e.message}`);
        }
        if (exchange.id === 'gateio') {
            try {
                earnBalance = await fetchGateioEarnBalance(exchange);
            } catch (e) {
                console.error(`Error fetching earn balance for ${exchange.id} fund account: ${e.message}`);
            }
        }
        balancesObj[groupName].spotBalance = spotBalance;
        balancesObj[groupName].earnBalance = earnBalance;
    }
}

// Function to compile WebSocket balances and update in one go
async function compileAndUpdateBalances(exchange, balanceData, groupName, balancesObj, balanceCache) {
    let totalBalances = balanceData.total || {};

    // Update balanceCache with new data
    for (const [currency, amount] of Object.entries(totalBalances)) {
        if (amount && Math.abs(amount) > 1e-6) {
            balanceCache[currency] = amount;
        } else if (balanceCache[currency]) {
            delete balanceCache[currency];
        }
    }

    const newAssets = {};

    for (const [currency, amount] of Object.entries(balanceCache)) {
        let baseValue = amount;
        let symbol = currency;
        let assetType = 'spot';

        if (currency !== balancesObj[groupName].baseCurrency) {
            let marketId = null;
            let invertPrice = false;

            const possiblePairs = [
                `${currency}/${balancesObj[groupName].baseCurrency}`,
                `${balancesObj[groupName].baseCurrency}/${currency}`,
                `${currency}/USD`,
                `USD/${currency}`,
                `${currency}/USDT`,
                `USDT/${currency}`,
            ];

            for (const pair of possiblePairs) {
                if (exchange.markets[pair]) {
                    marketId = pair;
                    invertPrice = pair.startsWith(`${balancesObj[groupName].baseCurrency}/`) || pair.startsWith('USD/') || pair.startsWith('USDT/');
                    break;
                }
            }

            let price = null;
            if (!marketId) {
                price = await fetchPriceFromAlternativeExchange(currency, balancesObj[groupName].baseCurrency);
                if (price === null) {
                    continue;
                }
            } else {
                try {
                    let ticker = await exchange.fetchTicker(marketId);
                    const priceValue = ticker.last || ticker.close;
                    if (invertPrice) {
                        price = 1 / priceValue;
                    } else {
                        price = priceValue;
                    }
                } catch (e) {
                    price = await fetchPriceFromAlternativeExchange(currency, balancesObj[groupName].baseCurrency);
                    if (price === null) {
                        continue;
                    }
                }
            }

            if (price) {
                baseValue = amount * price;
            } else {
                continue;
            }
        } else {
            baseValue = amount;
        }

        if (Math.abs(baseValue) < 0.01) {
            continue;
        }

        const assetKey = symbol;
        newAssets[assetKey] = {
            symbol,
            amount,
            baseValue,
            type: assetType,
        };
    }

    // Include futures positions only if defaultType is 'swap'
    if (exchange.has['fetchPositions'] && exchange.options?.defaultType === 'swap') {
        try {
            const positions = await exchange.fetchPositions();
            for (const position of positions) {
                if (position.contracts !== 0) {
                    const market = exchange.markets[position.symbol];
                    if (market) {
                        let ticker = await exchange.fetchTicker(position.symbol);
                        const price = ticker.last || ticker.close;
                        const UPNL = position.unrealizedPnl || 0;

                        if (Math.abs(UPNL) < 0.01) {
                            continue;
                        }

                        const symbol = position.symbol;
                        const assetKey = symbol;

                        newAssets[assetKey] = {
                            symbol,
                            amount: position.contracts,
                            baseValue: UPNL,
                            type: 'futures',
                        };
                    }
                }
            }
        } catch (e) {
            if (e.message.includes('requires a "portfolio" value')) {
                // Gracefully handle the missing portfolio error
            } else {
                console.error(`Error fetching positions: ${e.message}`);
            }
        }
    }

    // Update balances and total for this group
    balancesObj[groupName].balances = newAssets;
    balancesObj[groupName].total = Object.values(newAssets).reduce((acc, curr) => acc + curr.baseValue, 0);

    // --- New: Additional Fund account logic ---
    if (exchange.isFundAccount) {
        let spotBalance = 0;
        let earnBalance = 0;
        try {
            const spotData = await exchange.fetchBalance({ type: 'spot' });
            spotBalance = spotData.total[balancesObj[groupName].baseCurrency] || 0;
        } catch (e) {
            console.error(`Error fetching spot balance for ${exchange.id} fund account: ${e.message}`);
        }
        if (exchange.id === 'gateio') {
            try {
                earnBalance = await fetchGateioEarnBalance(exchange);
            } catch (e) {
                console.error(`Error fetching earn balance for ${exchange.id} fund account: ${e.message}`);
            }
        }
        balancesObj[groupName].spotBalance = spotBalance;
        balancesObj[groupName].earnBalance = earnBalance;
    }
}

// Function to fetch price from an alternative exchange (e.g., Binance)
async function fetchPriceFromAlternativeExchange(currency, baseCurrency) {
    const alternativeExchanges = ['binance', 'kraken', 'coinbasepro'];
    for (const exchangeId of alternativeExchanges) {
        try {
            const altExchange = new ccxt[exchangeId]({ enableRateLimit: true });
            await altExchange.loadMarkets();
            const possiblePairs = [
                `${currency}/${baseCurrency}`,
                `${baseCurrency}/${currency}`,
                `${currency}/USD`,
                `USD/${currency}`,
                `${currency}/USDT`,
                `USDT/${currency}`,
            ];
            for (const pair of possiblePairs) {
                if (altExchange.markets[pair]) {
                    let invertPrice = pair.startsWith(`${baseCurrency}/`) || pair.startsWith('USD/') || pair.startsWith('USDT/');
                    const ticker = await altExchange.fetchTicker(pair);
                    let price = ticker.last || ticker.close;
                    if (invertPrice) {
                        price = 1 / price;
                    }
                    return price;
                }
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

// --- New: Custom function to fetch Gate.io Earn balance ---
async function fetchGateioEarnBalance(exchange) {
    try {
        await exchange.loadMarkets(); // Ensure markets are loaded

        const response = await exchange.privateEarnGetUniLends({});
        let totalUSDTValue = 0;

        for (const lend of response) {
            const currency = lend.currency;
            const amount = parseFloat(lend.amount);

            if (amount > 0) {
                if (currency === 'USDT' || currency === 'USDC') {
                    totalUSDTValue += amount;
                } else {
                    try {
                        const ticker = await exchange.fetchTicker(`${currency}/USDT`);
                        totalUSDTValue += amount * parseFloat(ticker.last);
                    } catch (err) {
                        continue; // Skip assets without a valid price
                    }
                }
            }
        }

        return totalUSDTValue;
    } catch (error) {
        console.error('Error fetching Earn balance:', error);
        return 0; // Return 0 on failure
    }
}

// Sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    monitorBalances,
};