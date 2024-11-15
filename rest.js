// rest.js
const ccxt = require('ccxt');

// Function to monitor balances via REST API
async function monitorBalancesREST(accounts, balancesObj, callback) {
    for (const account of accounts) {
        const { e, k, p, baseCurrency, options, groupName } = account;
        const exchangeId = e;

        const exchangeClass = ccxt[exchangeId];
        if (!exchangeClass) {
            console.error(`Exchange ${exchangeId} not found.`);
            continue;
        }

        const exchange = new exchangeClass({
            apiKey: k,
            secret: p,
            enableRateLimit: true,
            options: options || {},
            password: account.password || undefined,
        });

        if (!balancesObj[groupName]) {
            balancesObj[groupName] = {
                exchange: groupName,
                balances: {},
                baseCurrency: baseCurrency,
                total: 0,
            };
        }

        // Load markets and start polling
        await exchange.loadMarkets();
        pollBalances(exchange, groupName, balancesObj, callback);
    }
}

// Function to poll balances every 5 seconds
function pollBalances(exchange, groupName, balancesObj, callback) {
    setInterval(async () => {
        try {
            const balanceData = await fetchCompleteBalance(exchange);
            await processBalanceData(exchange, balanceData, groupName, balancesObj);
            callback();
        } catch (error) {
            console.error(`Error polling balance for ${exchange.id}: ${error.message}`);
        }
    }, 5000);
}

// Function to fetch complete balance (similar to WebSocket script)
async function fetchCompleteBalance(exchange) {
    try {
        if (exchange.id === 'coinbase') {
            const balanceData = await exchange.fetchBalance();
            const cashBalance = await exchange.fetchBalance({ type: 'cash' });
            return { ...balanceData, total: { ...balanceData.total, ...cashBalance.total } };
        } else if (exchange.id === 'gateio') {
            return await exchange.fetchBalance({ type: 'swap' });
        } else {
            return await exchange.fetchBalance();
        }
    } catch (error) {
        console.error(`Error fetching balance for ${exchange.id}: ${error.message}`);
        return { total: {} };
    }
}

// Process balance data, similar to the WebSocket script
async function processBalanceData(exchange, balanceData, groupName, balancesObj) {
    const baseCurrency = balancesObj[groupName].baseCurrency;
    balancesObj[groupName].balances = {};
    const assets = balancesObj[groupName].balances;

    let totalBalances = balanceData.total || {};

    if (totalBalances['USDC']) {
        const usdcAmount = totalBalances['USDC'];
        delete totalBalances['USDC'];
        totalBalances = { 'USDC': usdcAmount, ...totalBalances };
    }

    for (const [currency, amount] of Object.entries(totalBalances)) {
        if (amount && Math.abs(amount) > 1e-8) {
            let baseValue = amount;
            let symbol = currency;
            let assetType = 'spot';

            if (currency !== baseCurrency) {
                let marketId = null;
                let invertPrice = false;
                const possiblePairs = [
                    `${currency}/${baseCurrency}`, `${baseCurrency}/${currency}`,
                    `${currency}/USD`, `USD/${currency}`,
                    `${currency}/USDT`, `USDT/${currency}`,
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
                    if (price === null) continue;
                } else {
                    const ticker = await exchange.fetchTicker(marketId);
                    price = ticker.last || ticker.close;
                    if (invertPrice) price = 1 / price;
                }

                if (price) {
                    baseValue = amount * price;
                } else {
                    continue;
                }
            }

            const assetKey = symbol;
            assets[assetKey] = {
                symbol,
                amount,
                baseValue,
                type: assetType,
            };
        }
    }

    if (exchange.has['fetchPositions']) {
        try {
            const positions = await exchange.fetchPositions();
            for (const position of positions) {
                if (position.contracts !== 0) {
                    const market = exchange.markets[position.symbol];
                    const ticker = await exchange.fetchTicker(position.symbol);
                    const price = ticker.last || ticker.close;
                    const UPNL = position.unrealizedPnl || 0;

                    const symbol = position.symbol;
                    const assetKey = symbol;

                    assets[assetKey] = {
                        symbol,
                        amount: position.contracts,
                        baseValue: UPNL,
                        type: 'futures',
                    };
                }
            }
        } catch (error) {
            console.error(`Error fetching positions for ${exchange.id}: ${error.message}`);
        }
    }

    balancesObj[groupName].total = Object.values(assets).reduce((acc, curr) => acc + curr.baseValue, 0);
}

// Function to fetch alternative prices
async function fetchPriceFromAlternativeExchange(currency, baseCurrency) {
    const alternativeExchanges = ['binance', 'kraken', 'coinbasepro'];
    for (const exchangeId of alternativeExchanges) {
        try {
            const altExchange = new ccxt[exchangeId]({ enableRateLimit: true });
            await altExchange.loadMarkets();
            const possiblePairs = [
                `${currency}/${baseCurrency}`, `${baseCurrency}/${currency}`,
                `${currency}/USD`, `USD/${currency}`,
                `${currency}/USDT`, `USDT/${currency}`,
            ];

            for (const pair of possiblePairs) {
                if (altExchange.markets[pair]) {
                    const ticker = await altExchange.fetchTicker(pair);
                    return ticker.last || ticker.close;
                }
            }
        } catch (error) {
            continue;
        }
    }
    return null;
}

// Export monitorBalancesREST function
module.exports = {
    monitorBalancesREST,
};
