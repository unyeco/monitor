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
            balanceData = await exchange.fetchBalance({ type: 'swap' });
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

    // Now, process balanceCache to update assets
    for (const [currency, amount] of Object.entries(balanceCache)) {
        let baseValue = amount;
        let symbol = currency;
        let assetType = 'spot';

        if (currency !== baseCurrency) {
            // Fetch fresh ticker each time
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

        // Skip assets with baseValue less than $0.01
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

    // Include futures positions if applicable
    if (exchange.has['fetchPositions']) {
        try {
            const positions = await exchange.fetchPositions();
            for (const position of positions) {
                if (position.contracts !== 0) {
                    const market = exchange.markets[position.symbol];
                    if (market) {
                        let ticker = await exchange.fetchTicker(position.symbol);
                        const price = ticker.last || ticker.close;
                        const UPNL = position.unrealizedPnl || 0;

                        // Skip positions with baseValue less than $0.01
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
            console.error(`Error fetching positions: ${e.message}`);
        }
    }

    // Update balancesObj[groupName].balances
    balancesObj[groupName].balances = newAssets;

    // Update total for this group
    balancesObj[groupName].total = Object.values(newAssets).reduce((acc, curr) => acc + curr.baseValue, 0);
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

    // Now, process balanceCache to update assets
    const newAssets = {};

    for (const [currency, amount] of Object.entries(balanceCache)) {
        let baseValue = amount;
        let symbol = currency;
        let assetType = 'spot';

        if (currency !== balancesObj[groupName].baseCurrency) {
            // Fetch fresh ticker each time
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

        // Skip assets with baseValue less than $0.01
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

    // Update balancesObj[groupName].balances
    balancesObj[groupName].balances = newAssets;

    // Update total for this group
    balancesObj[groupName].total = Object.values(newAssets).reduce((acc, curr) => acc + curr.baseValue, 0);
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

// Sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    monitorBalances,
};
