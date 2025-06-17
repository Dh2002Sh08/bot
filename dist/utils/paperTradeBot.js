"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaperTradeBot = void 0;
const ethers_1 = require("ethers");
const web3_js_1 = require("@solana/web3.js");
const enhancedTokenScanner_1 = require("../lib/enhancedTokenScanner");
class PaperTradeBot {
    constructor(config) {
        this.isRunning = false;
        this.stopFlag = false;
        this.userWallets = new Map();
        this.monitoringIntervals = new Map();
        this.userConfigs = new Map();
        this.balanceUpdateIntervals = new Map();
        this.lastBalanceMessages = new Map();
        this.priceUpdateIntervals = new Map();
        this.enhancedTokenScanner = null;
        this.userValidationCriteria = new Map();
        this.paperTradedTokens = new Map(); // Track paper traded tokens per user
        // Dummy coin amounts for paper trading
        this.DUMMY_BALANCES = {
            ETH: 10, // 10 ETH
            BSC: 50, // 50 BNB
            SOL: 100 // 100 SOL
        };
        this.botConfig = config;
    }
    // Initialize enhanced token scanner
    async initializeEnhancedTokenScanner() {
        try {
            // Default validation criteria
            const defaultCriteria = {
                minLiquidity: 1000,
                minVolume: 25,
                requireDexScreener: true
            };
            this.enhancedTokenScanner = new enhancedTokenScanner_1.EnhancedTokenScanner(defaultCriteria, this.handleTokenDetected.bind(this), this.handleTokenScannerError.bind(this));
            await this.enhancedTokenScanner.initialize();
            console.log('✅ Enhanced Token Scanner initialized in PaperTradeBot');
        }
        catch (error) {
            console.error('❌ Failed to initialize Enhanced Token Scanner:', error);
        }
    }
    // Handle token detection from enhanced scanner
    async handleTokenDetected(tokenData) {
        try {
            // Notify all active users about the detected token
            for (const [userId, userConfig] of this.userConfigs) {
                if (this.hasUserWallet(userId, tokenData.network)) {
                    const criteria = this.userValidationCriteria.get(userId) || {
                        minLiquidity: 1000,
                        minVolume: 25,
                        requireDexScreener: true
                    };
                    // Check if token meets user's criteria
                    if (tokenData.liquidity >= criteria.minLiquidity &&
                        tokenData.volume24h >= criteria.minVolume) {
                        await this.botConfig.onLog(`🎯 Paper Trading: New Token Detected!\n\n` +
                            `🪙 ${tokenData.symbol} (${tokenData.name})\n` +
                            `🌐 Network: ${tokenData.network}\n` +
                            `💰 Price: $${tokenData.price.toFixed(8)}\n` +
                            `💧 Liquidity: $${tokenData.liquidity.toLocaleString()}\n` +
                            `📊 24h Volume: $${tokenData.volume24h.toLocaleString()}\n` +
                            `⏰ Age: ${tokenData.age}\n` +
                            `📍 Address: \`${tokenData.address}\`\n` +
                            `🔗 [DexScreener](${tokenData.dexScreenerUrl})`, userId);
                        // Attempt to paper trade the token
                        await this.attemptPaperTrade(userId, tokenData);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error handling token detection in paper trading:', error);
        }
    }
    // Handle token scanner errors
    async handleTokenScannerError(error) {
        console.error('Enhanced Token Scanner error in paper trading:', error);
    }
    // Set user validation criteria
    setUserValidationCriteria(userId, criteria) {
        this.userValidationCriteria.set(userId, criteria);
        // Update scanner criteria if it exists
        if (this.enhancedTokenScanner) {
            this.enhancedTokenScanner.updateValidationCriteria(criteria);
        }
    }
    // Get user validation criteria
    getUserValidationCriteria(userId) {
        return this.userValidationCriteria.get(userId);
    }
    // Get user's paper traded tokens
    getUserPaperTradedTokens(userId) {
        return this.paperTradedTokens.get(userId) || [];
    }
    // Attempt to paper trade a detected token
    async attemptPaperTrade(userId, tokenData) {
        try {
            const userConfig = this.getUserConfig(userId);
            if (!userConfig) {
                console.log(`No config found for user ${userId} in paper trading`);
                return;
            }
            const wallet = this.getUserWallet(userId, tokenData.network);
            if (!wallet) {
                console.log(`No ${tokenData.network} wallet found for user ${userId} in paper trading`);
                return;
            }
            // Check if we have enough balance
            if (wallet.balance < userConfig.amount) {
                await this.botConfig.onLog(`⚠️ Insufficient ${tokenData.network} balance for paper trading ${tokenData.symbol}`, userId);
                return;
            }
            // Simulate paper trading
            const entryPrice = tokenData.price;
            const tokenAmount = userConfig.amount / entryPrice;
            // Deduct from wallet balance
            wallet.balance -= userConfig.amount;
            // Create paper trading position
            const position = {
                tokenAddress: tokenData.address,
                tokenSymbol: tokenData.symbol,
                amount: tokenAmount,
                entryPrice,
                currentPrice: entryPrice,
                stopLoss: userConfig.stopLoss,
                takeProfit: userConfig.takeProfit,
                network: tokenData.network,
                timestamp: Date.now(),
                status: 'ACTIVE'
            };
            wallet.tokens.set(tokenData.address, position);
            // Store paper traded token
            if (!this.paperTradedTokens.has(userId)) {
                this.paperTradedTokens.set(userId, []);
            }
            this.paperTradedTokens.get(userId).push(tokenData);
            await this.botConfig.onLog(`✅ Paper Trading: Successfully Sniped ${tokenData.symbol}!\n\n` +
                `💰 Amount: ${userConfig.amount} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${entryPrice.toFixed(8)}\n` +
                `🪙 Tokens: ${tokenAmount.toFixed(2)}\n` +
                `📊 Stop Loss: ${userConfig.stopLoss}%\n` +
                `🎯 Take Profit: ${userConfig.takeProfit}%\n` +
                `⏰ Entry Time: ${new Date().toLocaleString()}`, userId);
        }
        catch (error) {
            console.error(`Error paper trading token for user ${userId}:`, error);
            await this.botConfig.onError(error, userId);
        }
    }
    // Add public getter methods for callbacks
    getErrorCallback() {
        return this.botConfig.onError;
    }
    getLogCallback() {
        return this.botConfig.onLog;
    }
    // User configuration methods
    updateUserConfig(userId, config) {
        this.userConfigs.set(userId, config);
    }
    getUserConfig(userId) {
        return this.userConfigs.get(userId);
    }
    // Create paper trading wallet
    createPaperWallet(userId, network) {
        if (!this.userWallets.has(userId)) {
            this.userWallets.set(userId, new Map());
        }
        let wallet;
        if (network === 'SOL') {
            const keypair = web3_js_1.Keypair.generate();
            wallet = {
                address: keypair.publicKey.toString(),
                privateKey: Buffer.from(keypair.secretKey).toString('hex'),
                network: 'SOL',
                balance: this.DUMMY_BALANCES.SOL,
                tokens: new Map()
            };
        }
        else {
            const ethersWallet = ethers_1.ethers.Wallet.createRandom();
            wallet = {
                address: ethersWallet.address,
                privateKey: ethersWallet.privateKey,
                network: network,
                balance: network === 'ETH' ? this.DUMMY_BALANCES.ETH : this.DUMMY_BALANCES.BSC,
                tokens: new Map()
            };
        }
        this.userWallets.get(userId).set(network, wallet);
        return wallet;
    }
    getUserWallet(userId, network) {
        return this.userWallets.get(userId)?.get(network);
    }
    hasUserWallet(userId, network) {
        return this.userWallets.has(userId) && this.userWallets.get(userId).has(network);
    }
    // Get paper wallet balance
    async getWalletBalance(userId, network) {
        const wallet = this.getUserWallet(userId, network);
        if (!wallet)
            return '0';
        const symbol = network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL';
        return `${wallet.balance.toFixed(4)} ${symbol}`;
    }
    // Update wallet balances display
    async updateWalletBalances(userId, network) {
        try {
            const balances = [];
            const networks = network ? [network] : ['ETH', 'BSC', 'SOL'];
            for (const net of networks) {
                if (this.hasUserWallet(userId, net)) {
                    const balance = await this.getWalletBalance(userId, net);
                    const emoji = net === 'ETH' ? '🔷' : net === 'BSC' ? '🟡' : '🟣';
                    balances.push(`${emoji} ${net}: ${balance}`);
                }
            }
            if (balances.length > 0) {
                const message = `💰 Paper Trading Balances:\n${balances.join('\n')}`;
                const lastMessageId = this.lastBalanceMessages.get(userId);
                if (lastMessageId) {
                    try {
                        await this.botConfig.onLog('', userId, lastMessageId, true);
                    }
                    catch (error) {
                        console.error('Error deleting previous balance message:', error);
                    }
                }
                const newMessageId = await this.botConfig.onLog(message, userId);
                this.lastBalanceMessages.set(userId, newMessageId);
            }
        }
        catch (error) {
            console.error('Error updating wallet balances:', error);
        }
    }
    // Start paper trading monitoring
    async startPaperTrading(userId) {
        if (this.isRunning) {
            await this.botConfig.onLog('⚠️ Paper Trading is already running!', userId);
            return;
        }
        const hasEthWallet = this.hasUserWallet(userId, 'ETH');
        const hasBscWallet = this.hasUserWallet(userId, 'BSC');
        const hasSolWallet = this.hasUserWallet(userId, 'SOL');
        if (!hasEthWallet && !hasBscWallet && !hasSolWallet) {
            await this.botConfig.onLog('⚠️ No paper trading wallets configured. Please create wallets first.', userId);
            return;
        }
        this.isRunning = true;
        this.stopFlag = false;
        await this.botConfig.onLog('🚀 Starting Paper Trading Bot...', userId);
        // Initialize enhanced token scanner if not already done
        if (!this.enhancedTokenScanner) {
            await this.initializeEnhancedTokenScanner();
        }
        // Start enhanced token scanner
        if (this.enhancedTokenScanner && !this.enhancedTokenScanner.isScanning()) {
            await this.enhancedTokenScanner.startScanning();
        }
        // Set default validation criteria for user if not set
        if (!this.userValidationCriteria.has(userId)) {
            this.setUserValidationCriteria(userId, {
                minLiquidity: 1000,
                minVolume: 25,
                requireDexScreener: true
            });
        }
        await this.botConfig.onLog('🔍 Enhanced Token Scanner is now monitoring for new tokens with validation criteria:\n' +
            `💧 Min Liquidity: $${this.userValidationCriteria.get(userId)?.minLiquidity || 1000}\n` +
            `📊 Min Volume: $${this.userValidationCriteria.get(userId)?.minVolume || 25}\n` +
            `✅ DexScreener Required: ${this.userValidationCriteria.get(userId)?.requireDexScreener || true}`, userId);
        // Start balance updates
        const balanceInterval = setInterval(async () => {
            if (this.stopFlag) {
                clearInterval(balanceInterval);
                return;
            }
            await this.updateWalletBalances(userId);
        }, 60000); // Update every minute
        this.balanceUpdateIntervals.set(userId, balanceInterval);
        // Start price monitoring for active positions
        const priceInterval = setInterval(async () => {
            if (this.stopFlag) {
                clearInterval(priceInterval);
                return;
            }
            await this.monitorPositions(userId);
        }, 15000); // Check every 15 seconds
        this.priceUpdateIntervals.set(userId, priceInterval);
        await this.botConfig.onLog('✅ Paper Trading Bot is now running!\n\n' +
            '📊 Status:\n' +
            `🔷 ETH: ${hasEthWallet ? '✅' : '❌'}\n` +
            `🟡 BSC: ${hasBscWallet ? '✅' : '❌'}\n` +
            `🟣 SOL: ${hasSolWallet ? '✅' : '❌'}\n\n` +
            'The bot will simulate sniping real tokens with dummy coins.', userId);
    }
    // Stop paper trading
    stopPaperTrading(userId) {
        this.isRunning = false;
        this.stopFlag = true;
        const monitoringInterval = this.monitoringIntervals.get(userId);
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            this.monitoringIntervals.delete(userId);
        }
        const balanceInterval = this.balanceUpdateIntervals.get(userId);
        if (balanceInterval) {
            clearInterval(balanceInterval);
            this.balanceUpdateIntervals.delete(userId);
        }
        const priceInterval = this.priceUpdateIntervals.get(userId);
        if (priceInterval) {
            clearInterval(priceInterval);
            this.priceUpdateIntervals.delete(userId);
        }
        // Stop enhanced token scanner if no other users are monitoring
        if (this.monitoringIntervals.size === 0 && this.enhancedTokenScanner) {
            this.enhancedTokenScanner.stopScanning();
        }
        this.botConfig.onLog('🛑 Paper Trading Bot stopped.', userId);
    }
    // Monitor for new tokens to snipe
    async monitorForNewTokens(userId) {
        try {
            // Get user config
            const config = this.getUserConfig(userId);
            if (!config) {
                await this.botConfig.onLog('⚠️ No configuration set for paper trading.', userId);
                return;
            }
            // Simulate finding new tokens (in real implementation, this would use tokenScanner)
            const networks = ['ETH', 'BSC', 'SOL'];
            for (const network of networks) {
                if (!this.hasUserWallet(userId, network))
                    continue;
                // Simulate random token detection (1% chance every 30 seconds)
                if (Math.random() < 0.01) {
                    const mockTokenAddress = this.generateMockTokenAddress(network);
                    const mockTokenSymbol = this.generateMockTokenSymbol();
                    await this.botConfig.onLog(`🔍 Paper Trading: Detected new token ${mockTokenSymbol} on ${network}`, userId);
                    // Simulate sniping
                    await this.simulateSnipe(userId, network, mockTokenAddress, mockTokenSymbol, config);
                }
            }
        }
        catch (error) {
            console.error('Error monitoring for new tokens:', error);
        }
    }
    // Simulate sniping a token
    async simulateSnipe(userId, network, tokenAddress, tokenSymbol, config) {
        try {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet)
                return;
            // Check if we have enough balance
            if (wallet.balance < config.amount) {
                await this.botConfig.onLog(`⚠️ Insufficient ${network} balance for paper trading snipe.`, userId);
                return;
            }
            // Simulate entry price (random price between 0.0001 and 0.01)
            const entryPrice = Math.random() * 0.0099 + 0.0001;
            // Calculate token amount based on config amount
            const tokenAmount = config.amount / entryPrice;
            // Deduct from wallet balance
            wallet.balance -= config.amount;
            // Create position
            const position = {
                tokenAddress,
                tokenSymbol,
                amount: tokenAmount,
                entryPrice,
                currentPrice: entryPrice,
                stopLoss: config.stopLoss,
                takeProfit: config.takeProfit,
                network,
                timestamp: Date.now(),
                status: 'ACTIVE'
            };
            wallet.tokens.set(tokenAddress, position);
            await this.botConfig.onLog(`🎯 Paper Trading: Sniped ${tokenSymbol}!\n` +
                `💰 Amount: ${config.amount} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${entryPrice.toFixed(6)}\n` +
                `🪙 Tokens: ${tokenAmount.toFixed(2)}\n` +
                `📊 Stop Loss: ${config.stopLoss}%\n` +
                `🎯 Take Profit: ${config.takeProfit}%`, userId);
        }
        catch (error) {
            console.error('Error simulating snipe:', error);
            await this.botConfig.onError(error, userId);
        }
    }
    // Monitor active positions
    async monitorPositions(userId) {
        try {
            const networks = ['ETH', 'BSC', 'SOL'];
            for (const network of networks) {
                const wallet = this.getUserWallet(userId, network);
                if (!wallet)
                    continue;
                for (const [tokenAddress, position] of wallet.tokens) {
                    if (position.status !== 'ACTIVE')
                        continue;
                    // Simulate price movement (random walk)
                    const priceChange = (Math.random() - 0.5) * 0.1; // ±5% change
                    position.currentPrice = Math.max(0.000001, position.currentPrice * (1 + priceChange));
                    // Calculate profit/loss
                    const priceChangePercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
                    const profitLoss = position.amount * (position.currentPrice - position.entryPrice);
                    // Check stop loss
                    if (priceChangePercent <= -position.stopLoss) {
                        await this.simulateSell(userId, network, tokenAddress, 'STOP_LOSS', position);
                    }
                    // Check take profit
                    else if (priceChangePercent >= position.takeProfit) {
                        await this.simulateSell(userId, network, tokenAddress, 'TAKE_PROFIT', position);
                    }
                    // Random sell (1% chance every 15 seconds for demo purposes)
                    else if (Math.random() < 0.01) {
                        await this.simulateSell(userId, network, tokenAddress, 'RANDOM_SELL', position);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error monitoring positions:', error);
        }
    }
    // Simulate selling a token
    async simulateSell(userId, network, tokenAddress, reason, position) {
        try {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet)
                return;
            // Calculate profit/loss
            const profitLoss = position.amount * (position.currentPrice - position.entryPrice);
            const profitLossPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
            // Add back to wallet balance
            const sellAmount = position.amount * position.currentPrice;
            wallet.balance += sellAmount;
            // Mark position as sold
            position.status = 'SOLD';
            const emoji = profitLoss >= 0 ? '✅' : '❌';
            const reasonText = reason === 'STOP_LOSS' ? 'Stop Loss' :
                reason === 'TAKE_PROFIT' ? 'Take Profit' : 'Manual Sell';
            await this.botConfig.onLog(`${emoji} Paper Trading: Sold ${position.tokenSymbol}!\n` +
                `📊 Reason: ${reasonText}\n` +
                `💰 Profit/Loss: ${profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Percentage: ${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%\n` +
                `🎯 Entry: $${position.entryPrice.toFixed(6)} → Exit: $${position.currentPrice.toFixed(6)}`, userId);
        }
        catch (error) {
            console.error('Error simulating sell:', error);
            await this.botConfig.onError(error, userId);
        }
    }
    // Utility methods
    generateMockTokenAddress(network) {
        if (network === 'SOL') {
            return web3_js_1.Keypair.generate().publicKey.toString();
        }
        else {
            return ethers_1.ethers.Wallet.createRandom().address;
        }
    }
    generateMockTokenSymbol() {
        const symbols = ['PEPE', 'DOGE', 'SHIB', 'MOON', 'ROCKET', 'LAMBO', 'APE', 'BULL', 'BEAR', 'PUMP'];
        return symbols[Math.floor(Math.random() * symbols.length)];
    }
    // Get active positions
    getActivePositions(userId) {
        const positions = [];
        const networks = ['ETH', 'BSC', 'SOL'];
        for (const network of networks) {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet)
                continue;
            for (const position of wallet.tokens.values()) {
                if (position.status === 'ACTIVE') {
                    positions.push(position);
                }
            }
        }
        return positions;
    }
    // Get trading history
    getTradingHistory(userId) {
        const positions = [];
        const networks = ['ETH', 'BSC', 'SOL'];
        for (const network of networks) {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet)
                continue;
            for (const position of wallet.tokens.values()) {
                if (position.status === 'SOLD') {
                    positions.push(position);
                }
            }
        }
        return positions.sort((a, b) => b.timestamp - a.timestamp);
    }
}
exports.PaperTradeBot = PaperTradeBot;
