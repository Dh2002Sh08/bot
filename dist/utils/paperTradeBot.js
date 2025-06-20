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
        this.positionMonitoringIntervals = new Map();
        this.lastPriceLogs = new Map();
        this.activeUsers = new Set(); // Track active users
        this.activeStatusIntervals = new Map(); // Track status message intervals
        this.solanaPriceCache = new Map(); // Cache for SOL token prices
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
            // Default validation criteria - make them more lenient
            const defaultCriteria = {
                minLiquidity: 100, // Lower from 1000 to 100
                minVolume: 1, // Lower from 25 to 1
                requireDexScreener: true,
                enableHoneypotDetection: false, // Disable by default to avoid blocking tokens
                excludeStablecoins: true,
                minTokenAge: 30, // Only filter out tokens less than 30 seconds old
                maxTokenAge: 604800 // Only filter out tokens older than 7 days
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
            console.log(`🎯 PaperTradeBot received token detection: ${tokenData.symbol} on ${tokenData.network}`);
            console.log(`📊 Token details:`, {
                symbol: tokenData.symbol,
                name: tokenData.name,
                price: tokenData.price,
                liquidity: tokenData.liquidity,
                volume24h: tokenData.volume24h,
                age: tokenData.age,
                ageSeconds: tokenData.ageSeconds
            });
            // Only send token detection to active users
            for (const [userId, userConfig] of this.userConfigs) {
                if (!this.activeUsers.has(userId))
                    continue;
                console.log(`📱 Processing paper trade for user ${userId}`);
                await this.botConfig.onLog(`📊 Paper Trade Alert!\n\n` +
                    `🪙 ${tokenData.symbol} (${tokenData.name})\n` +
                    `🌐 Network: ${tokenData.network}\n` +
                    `💰 Price: $${tokenData.price.toFixed(8)}\n` +
                    `💧 Liquidity: $${tokenData.liquidity.toLocaleString()}\n` +
                    `📊 24h Volume: $${tokenData.volume24h.toLocaleString()}\n` +
                    `⏰ Age: ${tokenData.age}\n` +
                    `📍 Address: \`${tokenData.address}\`\n` +
                    `🔗 [DexScreener](${tokenData.dexScreenerUrl})`, userId);
                // Perform validation here using the scanner's criteria (or user's if set)
                const userCriteria = this.userValidationCriteria.get(userId) || tokenData.scannerCriteria; // Use scanner's criteria as fallback
                console.log(`🔍 Paper trade validation criteria for user ${userId}:`, userCriteria);
                let validationMessage = '✅ Token passed all criteria!';
                let isValid = true;
                if (tokenData.liquidity < userCriteria.minLiquidity) {
                    isValid = false;
                    validationMessage = `❌ Failed: Liquidity ($${tokenData.liquidity.toLocaleString()}) below minimum ($${userCriteria.minLiquidity.toLocaleString()})`;
                }
                else if (tokenData.volume24h < userCriteria.minVolume) {
                    isValid = false;
                    validationMessage = `❌ Failed: 24h Volume ($${tokenData.volume24h.toLocaleString()}) below minimum ($${userCriteria.minVolume.toLocaleString()})`;
                }
                else if (userCriteria.maxAge && tokenData.ageSeconds > userCriteria.maxAge) {
                    isValid = false;
                    validationMessage = `❌ Failed: Age (${tokenData.age}) above maximum (${userCriteria.maxAge}s)`;
                }
                else if (userCriteria.requireDexScreener && (!tokenData.price || tokenData.price === 0)) {
                    isValid = false;
                    validationMessage = `❌ Failed: DexScreener data required but not available or price is zero.`;
                }
                console.log(`🔍 Paper trade validation result for user ${userId}: ${validationMessage}`);
                await this.botConfig.onLog(`🔍 Paper Trade Validation: ${validationMessage}`, userId);
                // Only attempt to paper trade if user has a paper wallet for this network AND token is valid
                if ((tokenData.network === 'SOL' && this.hasUserWallet(userId, 'SOL')) || (isValid && this.hasUserWallet(userId, tokenData.network))) {
                    console.log(`🚀 Attempting paper trade for ${tokenData.symbol} for user ${userId}`);
                    await this.attemptPaperTrade(userId, tokenData);
                }
                else if (!this.hasUserWallet(userId, tokenData.network)) {
                    console.log(`⚠️ User ${userId} has no ${tokenData.network} paper wallet configured`);
                    await this.botConfig.onLog(`⚠️ No ${tokenData.network} paper wallet configured. Cannot paper trade this token.`, userId);
                }
                else {
                    console.log(`➡️ Not paper trading ${tokenData.symbol} for user ${userId} - validation failed`);
                    await this.botConfig.onLog('➡️ Not paper trading this token.', userId);
                }
            }
        }
        catch (error) {
            console.error('Error handling token detection in PaperTradeBot:', error);
        }
    }
    // Send initial token detection message (fast, non-blocking)
    async sendInitialTokenMessage(userId, tokenData) {
        try {
            await this.botConfig.onLog(`🔎 **New Token Detected!**\n\n` +
                `🪙 **${tokenData.symbol}** (${tokenData.name})\n` +
                `🌐 Network: ${tokenData.network}\n` +
                `💰 Price: $${tokenData.price.toFixed(8)}\n` +
                `💧 Liquidity: $${tokenData.liquidity.toLocaleString()}\n` +
                `📊 24h Volume: $${tokenData.volume24h.toLocaleString()}\n` +
                `⏰ Age: ${tokenData.age}\n` +
                `📍 Address: \`${tokenData.address}\`\n` +
                `🔗 [DexScreener](${tokenData.dexScreenerUrl})\n\n` +
                `🔍 **Validating token...**`, userId);
        }
        catch (error) {
            console.error('Error sending initial token message:', error);
        }
    }
    // Perform validation and trading in parallel (non-blocking)
    async performValidationAndTrading(userId, tokenData, userConfig) {
        try {
            // Perform validation here using the scanner's criteria (or user's if set)
            const userCriteria = this.userValidationCriteria.get(userId) || tokenData.scannerCriteria;
            let validationMessage = '✅ Token passed all criteria!';
            let isValid = true;
            // Quick validation checks (fast)
            if (tokenData.liquidity < userCriteria.minLiquidity) {
                isValid = false;
                validationMessage = `❌ Failed: Liquidity ($${tokenData.liquidity.toLocaleString()}) below minimum ($${userCriteria.minLiquidity.toLocaleString()})`;
            }
            else if (tokenData.volume24h < userCriteria.minVolume) {
                isValid = false;
                validationMessage = `❌ Failed: 24h Volume ($${tokenData.volume24h.toLocaleString()}) below minimum ($${userCriteria.minVolume.toLocaleString()})`;
            }
            else if (userCriteria.maxAge && tokenData.ageSeconds > userCriteria.maxAge) {
                isValid = false;
                validationMessage = `❌ Failed: Age (${tokenData.age}) above maximum (${userCriteria.maxAge}s)`;
            }
            else if (userCriteria.requireDexScreener && (!tokenData.price || tokenData.price === 0)) {
                isValid = false;
                validationMessage = `❌ Failed: DexScreener data required but not available or price is zero.`;
            }
            // Send validation result immediately
            await this.botConfig.onLog(`🔍 Paper Trading Validation: ${validationMessage}`, userId);
            // Check honeypot status if enabled (non-blocking)
            if (userCriteria.enableHoneypotDetection && tokenData.honeypotCheck) {
                if (tokenData.honeypotCheck.isHoneypot) {
                    isValid = false;
                    await this.botConfig.onLog(`🚨 HONEYPOT DETECTED: Token is not safe to trade!`, userId);
                }
                else {
                    // Send honeypot status message
                    await this.sendHoneypotStatus(userId, tokenData.honeypotCheck);
                }
            }
            // Only attempt to paper trade if user has a wallet for this network AND token is valid
            if (isValid && this.hasUserWallet(userId, tokenData.network)) {
                await this.attemptPaperTrade(userId, tokenData);
            }
            else if (!this.hasUserWallet(userId, tokenData.network)) {
                await this.botConfig.onLog(`⚠️ No ${tokenData.network} paper wallet configured. Cannot paper trade this token.`, userId);
            }
            else {
                await this.botConfig.onLog('➡️ Not paper trading this token.', userId);
            }
        }
        catch (error) {
            console.error('Error in validation and trading:', error);
            await this.botConfig.onError(error, userId);
        }
    }
    // Send honeypot status message
    async sendHoneypotStatus(userId, honeypotCheck) {
        try {
            if (honeypotCheck.isHoneypot) {
                await this.botConfig.onLog(`🚨 **HONEYPOT DETECTED!**\n` +
                    `❌ Buy Tax: ${honeypotCheck.buyTax}%\n` +
                    `❌ Sell Tax: ${honeypotCheck.sellTax}%\n` +
                    `❌ Buyable: ${honeypotCheck.isBuyable ? 'Yes' : 'No'}\n` +
                    `❌ Sellable: ${honeypotCheck.isSellable ? 'No' : 'Yes'}\n` +
                    `⚠️ Source: ${honeypotCheck.source}`, userId);
            }
            else {
                await this.botConfig.onLog(`✅ **SAFE TOKEN**\n` +
                    `✅ Buy Tax: ${honeypotCheck.buyTax}%\n` +
                    `✅ Sell Tax: ${honeypotCheck.sellTax}%\n` +
                    `✅ Buyable: ${honeypotCheck.isBuyable ? 'Yes' : 'No'}\n` +
                    `✅ Sellable: ${honeypotCheck.isSellable ? 'Yes' : 'No'}\n` +
                    `🔍 Source: ${honeypotCheck.source}`, userId);
            }
        }
        catch (error) {
            console.error('Error sending honeypot status:', error);
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
    // Set user honeypot detection preferences
    setUserHoneypotDetection(userId, enabled) {
        const currentCriteria = this.userValidationCriteria.get(userId) || {
            minLiquidity: 1000,
            minVolume: 25,
            requireDexScreener: true,
            enableHoneypotDetection: true,
            excludeStablecoins: true,
            minTokenAge: 60,
            maxTokenAge: 86400
        };
        currentCriteria.enableHoneypotDetection = enabled;
        this.setUserValidationCriteria(userId, currentCriteria);
    }
    // Set user stablecoin filtering preferences
    setUserStablecoinFiltering(userId, enabled) {
        const currentCriteria = this.userValidationCriteria.get(userId) || {
            minLiquidity: 1000,
            minVolume: 25,
            requireDexScreener: true,
            enableHoneypotDetection: true,
            excludeStablecoins: true,
            minTokenAge: 60,
            maxTokenAge: 86400
        };
        currentCriteria.excludeStablecoins = enabled;
        this.setUserValidationCriteria(userId, currentCriteria);
    }
    // Set user token age preferences
    setUserTokenAgePreferences(userId, minAge, maxAge) {
        const currentCriteria = this.userValidationCriteria.get(userId) || {
            minLiquidity: 1000,
            minVolume: 25,
            requireDexScreener: true,
            enableHoneypotDetection: true,
            excludeStablecoins: true,
            minTokenAge: 60,
            maxTokenAge: 86400
        };
        currentCriteria.minTokenAge = minAge;
        currentCriteria.maxTokenAge = maxAge;
        this.setUserValidationCriteria(userId, currentCriteria);
    }
    // Get user's paper traded tokens
    getUserPaperTradedTokens(userId) {
        return this.paperTradedTokens.get(userId) || [];
    }
    // Attempt to paper trade a detected token
    async attemptPaperTrade(userId, tokenData) {
        try {
            console.log(`🚀 Starting paper trade attempt for ${tokenData.symbol} (${tokenData.address}) on ${tokenData.network} for user ${userId}`);
            const userConfig = this.getUserConfig(userId);
            if (!userConfig) {
                console.log(`❌ No config found for user ${userId} in paper trading`);
                return;
            }
            const wallet = this.getUserWallet(userId, tokenData.network);
            if (!wallet) {
                console.log(`❌ No ${tokenData.network} wallet found for user ${userId} in paper trading`);
                return;
            }
            console.log(`💰 User ${userId} paper wallet balance: ${wallet.balance} ${tokenData.network}, required: ${userConfig.amount}`);
            // Check if we have enough balance (for real trading simulation)
            if (wallet.balance < userConfig.amount) {
                console.log(`⚠️ Insufficient paper balance for user ${userId}: ${wallet.balance} < ${userConfig.amount}`);
                await this.botConfig.onLog(`⚠️ Paper Trading: Insufficient ${tokenData.network} balance (You only have ${wallet.balance.toFixed(4)} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}, but tried to invest ${userConfig.amount}). Simulating trade anyway.`, userId);
                // Do not return here, continue with simulation
            }
            console.log(`✅ Proceeding with paper trade simulation...`);
            // Fetch real price from DexScreener, with retry for Solana
            let realPrice = await this.getCurrentTokenPrice(tokenData.address, tokenData.network);
            if (tokenData.network === 'SOL' && (!realPrice || realPrice === 0)) {
                let retries = 2;
                while ((!realPrice || realPrice === 0) && retries > 0) {
                    console.log(`🔄 Retrying DexScreener price for SOL token: ${tokenData.address} (${tokenData.symbol})...`);
                    await new Promise(res => setTimeout(res, 3000)); // Wait 3 seconds
                    realPrice = await this.getCurrentTokenPrice(tokenData.address, tokenData.network);
                    retries--;
                }
            }
            if (!realPrice || realPrice === 0) {
                await this.botConfig.onLog(`❌ Could not fetch real price for ${tokenData.symbol} on ${tokenData.network} after multiple attempts. Skipping paper trade.`, userId);
                return;
            }
            const entryPrice = realPrice;
            // Cache the entry price for Solana tokens
            if (tokenData.network === 'SOL') {
                this.solanaPriceCache.set(tokenData.address, entryPrice);
            }
            // Calculate token amount based on userConfig.amount, but cap it if paper balance is too low for simulation
            const amountToUse = Math.min(userConfig.amount, wallet.balance);
            const tokenAmount = amountToUse / entryPrice;
            console.log(`📊 Paper trade calculation: Amount to use: ${amountToUse}, Token amount: ${tokenAmount}, Entry price: $${entryPrice}`);
            // Deduct from wallet balance (only the amount actually used in simulation)
            wallet.balance -= amountToUse;
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
                status: 'ACTIVE',
                entryTime: Date.now()
            };
            wallet.tokens.set(tokenData.address, position);
            console.log(`📊 Paper position created for ${tokenData.symbol}: Entry Price: $${entryPrice}, Stop Loss: ${userConfig.stopLoss}%, Take Profit: ${userConfig.takeProfit}%`);
            // Store paper traded token
            if (!this.paperTradedTokens.has(userId)) {
                this.paperTradedTokens.set(userId, []);
            }
            this.paperTradedTokens.get(userId).push(tokenData);
            await this.botConfig.onLog(`📊 Paper Trade Executed!\n\n` +
                `🪙 ${tokenData.symbol} (${tokenData.name})\n` +
                `💰 Amount: ${amountToUse.toFixed(4)} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${entryPrice.toFixed(8)}\n` +
                `🪙 Tokens: ${tokenAmount.toFixed(2)}\n` +
                `📊 Stop Loss: ${userConfig.stopLoss}%\n` +
                `🎯 Take Profit: ${userConfig.takeProfit}%\n` +
                `📍 Address: \`${tokenData.address}\`\n` +
                `🔗 [DexScreener](${tokenData.dexScreenerUrl})`, userId);
            console.log(`🎉 PAPER TRADE SUCCESSFULLY EXECUTED! ${tokenData.symbol} has been paper traded and position is being monitored.`);
        }
        catch (error) {
            console.error(`❌ Error paper trading token ${tokenData.symbol} for user ${userId}:`, error);
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
        return `${wallet.balance.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}`;
    }
    // Manual check for all paper wallet balances for a user
    async checkPaperWalletBalances(userId) {
        try {
            const balances = [];
            const networks = ['ETH', 'BSC', 'SOL'];
            for (const net of networks) {
                if (this.hasUserWallet(userId, net)) {
                    const wallet = this.getUserWallet(userId, net);
                    if (wallet) {
                        const balance = wallet.balance;
                        const emoji = net === 'ETH' ? '🔷' : net === 'BSC' ? '🟡' : '🟣';
                        balances.push(`${emoji} ${net}: ${balance.toFixed(4)} ${net === 'ETH' ? 'ETH' : net === 'BSC' ? 'BNB' : 'SOL'}`);
                    }
                }
            }
            if (balances.length > 0) {
                const message = `💰 Paper Wallet Balances:\n${balances.join('\n')}`;
                // Delete previous balance message if it exists
                const lastMessageId = this.lastBalanceMessages.get(userId);
                if (lastMessageId) {
                    try {
                        await this.botConfig.onLog('', userId, lastMessageId, true); // Delete previous message
                    }
                    catch (error) {
                        console.error('Error deleting previous balance message:', error);
                    }
                }
                // Send new balance message and store its ID
                const newMessageId = await this.botConfig.onLog(message, userId);
                this.lastBalanceMessages.set(userId, newMessageId);
            }
            else {
                await this.botConfig.onLog('⚠️ No paper wallets found for balance check.', userId);
            }
        }
        catch (error) {
            console.error('Error checking paper wallet balances:', error);
            await this.botConfig.onError(error, userId);
        }
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
    // Show updated paper trading balances for all active wallets
    async showPaperTradingBalances(userId) {
        const networks = ['ETH', 'BSC', 'SOL'];
        let message = '💰 Paper Trading Balances:\n\n';
        let hasWallet = false;
        for (const network of networks) {
            const wallet = this.getUserWallet(userId, network);
            if (wallet && wallet.isActive !== false) {
                message += `${network === 'ETH' ? '🔷' : network === 'BSC' ? '🟡' : '🟣'} ${network}: ${wallet.balance.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n`;
                hasWallet = true;
            }
        }
        if (!hasWallet)
            message += 'No active paper wallets found.';
        await this.botConfig.onLog(message, userId);
    }
    // Start paper trading monitoring
    async startPaperTrading(userId) {
        if (this.isRunning) {
            await this.botConfig.onLog('⚠️ Paper Trading is already running!', userId);
            return;
        }
        this.activeUsers.add(userId); // Mark user as active
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
        // Determine which networks to scan based on user's wallets and activation status
        const networksToScan = [];
        const ethWallet = this.getUserWallet(userId, 'ETH');
        const bscWallet = this.getUserWallet(userId, 'BSC');
        const solWallet = this.getUserWallet(userId, 'SOL');
        const ethActive = ethWallet && ethWallet.isActive !== false;
        const bscActive = bscWallet && bscWallet.isActive !== false;
        const solActive = solWallet && solWallet.isActive !== false;
        if (ethActive)
            networksToScan.push('ETH');
        if (bscActive)
            networksToScan.push('BSC');
        if (solActive)
            networksToScan.push('SOL');
        // Start enhanced token scanner only for networks with active wallets
        if (this.enhancedTokenScanner && !this.enhancedTokenScanner.isScanning()) {
            await this.enhancedTokenScanner.startScanning(networksToScan);
        }
        else if (this.enhancedTokenScanner && this.enhancedTokenScanner.isScanning()) {
            // If scanner is already running, add the new networks
            await this.enhancedTokenScanner.addNetworks(networksToScan);
        }
        // Set default validation criteria for user if not set
        if (!this.userValidationCriteria.has(userId)) {
            this.setUserValidationCriteria(userId, {
                minLiquidity: 100, // Lower from 1000 to 100
                minVolume: 1, // Lower from 25 to 1
                requireDexScreener: true,
                enableHoneypotDetection: false, // Disable by default
                excludeStablecoins: true,
                minTokenAge: 30, // Only filter out tokens less than 30 seconds old
                maxTokenAge: 604800 // Only filter out tokens older than 7 days
            });
        }
        await this.botConfig.onLog('🔍 Enhanced Token Scanner is now monitoring for new tokens with validation criteria:\n' +
            `💧 Min Liquidity: $${this.userValidationCriteria.get(userId)?.minLiquidity || 100}\n` +
            `📊 Min Volume: $${this.userValidationCriteria.get(userId)?.minVolume || 1}\n` +
            `✅ DexScreener Required: ${this.userValidationCriteria.get(userId)?.requireDexScreener || true}`, userId);
        // Start price monitoring for active positions
        const priceInterval = setInterval(async () => {
            if (this.stopFlag) {
                clearInterval(priceInterval);
                return;
            }
            await this.monitorPositions(userId);
        }, 15000); // Check every 15 seconds
        this.priceUpdateIntervals.set(userId, priceInterval);
        // Start position monitoring
        this.startPositionMonitoring(userId);
        // Send periodic status message every 5 minutes
        const statusInterval = setInterval(async () => {
            if (!this.activeUsers.has(userId)) {
                clearInterval(statusInterval);
                this.activeStatusIntervals.delete(userId);
                return;
            }
            await this.sendActiveStatusMessage(userId);
        }, 5 * 60 * 1000); // 5 minutes
        this.activeStatusIntervals.set(userId, statusInterval);
        // Also send the first status message immediately
        await this.sendActiveStatusMessage(userId);
        await this.botConfig.onLog('✅ Paper Trading Bot is now running!\n\n' +
            '📊 Status:\n' +
            `🔷 ETH: ${ethActive ? '✅' : '❌'}\n` +
            `🟡 BSC: ${bscActive ? '✅' : '❌'}\n` +
            `🟣 SOL: ${solActive ? '✅' : '❌'}\n\n` +
            `📡 Scanning networks: ${networksToScan.join(', ')}\n\n` +
            'The bot will simulate sniping real tokens with dummy coins.', userId);
    }
    // Stop paper trading
    stopPaperTrading(userId) {
        this.isRunning = false;
        this.stopFlag = true;
        this.activeUsers.delete(userId); // Remove user from active set
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
        // Stop position monitoring
        this.stopPositionMonitoring(userId);
        // Stop enhanced token scanner if no other users are monitoring
        if (this.monitoringIntervals.size === 0 && this.enhancedTokenScanner) {
            this.enhancedTokenScanner.stopScanning();
        }
        // Clear periodic status message
        const statusInterval = this.activeStatusIntervals.get(userId);
        if (statusInterval) {
            clearInterval(statusInterval);
            this.activeStatusIntervals.delete(userId);
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
            // Fetch real price from DexScreener instead of using random price
            const realPrice = await this.getCurrentTokenPrice(tokenAddress, network);
            if (!realPrice) {
                await this.botConfig.onLog(`❌ Could not fetch real price for ${tokenSymbol} on ${network}. Skipping paper trade.`, userId);
                return;
            }
            const entryPrice = realPrice;
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
                status: 'ACTIVE',
                entryTime: Date.now()
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
                `🎯 Entry: $${position.entryPrice.toFixed(6)} → Exit: $${position.currentPrice.toFixed(6)}\n` +
                `💼 New Balance: ${wallet.balance.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}`, userId);
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
    // Start position monitoring for a user
    startPositionMonitoring(userId) {
        // Clear existing monitoring if any
        const existingInterval = this.positionMonitoringIntervals.get(userId);
        if (existingInterval) {
            clearInterval(existingInterval);
        }
        // Start new monitoring interval
        const monitoringInterval = setInterval(async () => {
            if (this.stopFlag) {
                clearInterval(monitoringInterval);
                return;
            }
            await this.monitorPaperPositions(userId);
        }, 10000); // Check every 10 seconds
        this.positionMonitoringIntervals.set(userId, monitoringInterval);
    }
    // Stop position monitoring for a user
    stopPositionMonitoring(userId) {
        const interval = this.positionMonitoringIntervals.get(userId);
        if (interval) {
            clearInterval(interval);
            this.positionMonitoringIntervals.delete(userId);
        }
    }
    // Monitor all paper positions for a user
    async monitorPaperPositions(userId) {
        try {
            const userWallets = this.userWallets.get(userId);
            if (!userWallets)
                return;
            for (const [network, wallet] of userWallets) {
                for (const [tokenAddress, position] of wallet.tokens) {
                    if (position.status === 'ACTIVE') {
                        await this.checkPaperPositionPrice(userId, network, tokenAddress, position);
                    }
                }
            }
        }
        catch (error) {
            console.error(`Error monitoring paper positions for user ${userId}:`, error);
        }
    }
    // Check price for a specific paper position
    async checkPaperPositionPrice(userId, network, tokenAddress, position) {
        try {
            // Get current price from DexScreener
            let currentPrice = await this.getCurrentTokenPrice(tokenAddress, network, userId);
            // For Solana, if price fetch fails, use cached price
            if (network === 'SOL' && (currentPrice === null || currentPrice === undefined)) {
                currentPrice = this.solanaPriceCache.get(tokenAddress) || position.entryPrice;
            }
            if (currentPrice === null || currentPrice === undefined) {
                return; // Skip if price couldn't be fetched and no cache
            }
            // Update position with current price
            position.currentPrice = currentPrice;
            const wallet = this.getUserWallet(userId, network);
            if (wallet) {
                wallet.tokens.set(tokenAddress, position);
            }
            const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
            // Check take profit
            if (priceChange >= position.takeProfit) {
                await this.executePaperSell(userId, network, tokenAddress, position, 'TAKE_PROFIT', priceChange);
                return;
            }
            // Check stop loss
            if (priceChange <= -position.stopLoss) {
                await this.executePaperSell(userId, network, tokenAddress, position, 'STOP_LOSS', priceChange);
                return;
            }
            // Log significant price movements (every 5% change)
            const positionKey = `${userId}_${network}_${tokenAddress}`;
            const lastLoggedChange = this.lastPriceLogs.get(positionKey) || 0;
            if (Math.abs(priceChange - lastLoggedChange) >= 5) {
                const balance = wallet ? wallet.balance.toFixed(4) : 'N/A';
                await this.botConfig.onLog(`📊 Paper Trading: ${position.tokenSymbol} Price Update:\n` +
                    `💰 Current Price: $${currentPrice.toFixed(8)}\n` +
                    `📈 Entry Price: $${position.entryPrice.toFixed(8)}\n` +
                    `📊 Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%\n` +
                    `🎯 TP: ${position.takeProfit}% | 🛑 SL: ${position.stopLoss}%\n` +
                    `💼 Balance: ${balance} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}`, userId);
                this.lastPriceLogs.set(positionKey, priceChange);
            }
        }
        catch (error) {
            console.error(`Error checking paper position price for ${tokenAddress}:`, error);
        }
    }
    // Execute paper sell
    async executePaperSell(userId, network, tokenAddress, position, reason, priceChange) {
        try {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet)
                return;
            // Remove cached price for Solana tokens
            if (network === 'SOL') {
                this.solanaPriceCache.delete(tokenAddress);
            }
            // Update position status
            position.status = reason === 'TAKE_PROFIT' ? 'SOLD' : 'STOPPED';
            position.currentPrice = position.currentPrice;
            wallet.tokens.set(tokenAddress, position);
            // Calculate profit/loss
            const profitLoss = priceChange;
            const profitLossUSD = (position.amount * profitLoss) / 100;
            // Add back to wallet balance
            const sellAmount = position.amount * position.currentPrice;
            wallet.balance += sellAmount;
            const emoji = reason === 'TAKE_PROFIT' ? '🎯' : '🛑';
            const reasonText = reason === 'TAKE_PROFIT' ? 'Take Profit Reached!' : 'Stop Loss Triggered!';
            await this.botConfig.onLog(`${emoji} Paper Trading: ${reasonText}\n\n` +
                `🪙 Token: ${position.tokenSymbol}\n` +
                `💰 Invested: $${(position.amount * position.entryPrice).toFixed(2)} (${position.amount.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'})\n` +
                `📈 Entry Price: $${position.entryPrice.toFixed(8)}\n` +
                `📊 Exit Price: $${position.currentPrice.toFixed(8)}\n` +
                `📊 P&L: ${profitLoss > 0 ? '+' : ''}${profitLoss.toFixed(2)}% (${profitLossUSD > 0 ? '+' : ''}$${profitLossUSD.toFixed(2)})\n` +
                `🌐 Network: ${network}\n` +
                `💼 New Balance: ${wallet.balance.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}`, userId);
        }
        catch (error) {
            console.error(`Error executing paper sell for ${tokenAddress}:`, error);
            await this.botConfig.onError(error, userId);
        }
    }
    // Get current token price from DexScreener
    async getCurrentTokenPrice(tokenAddress, network, userId) {
        try {
            let url;
            if (network === 'SOL') {
                url = `https://api.dexscreener.com/latest/dex/pairs/solana/${tokenAddress}`;
            }
            else {
                url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            if (network === 'SOL') {
                return data.pair ? parseFloat(data.pair.priceUsd) : null;
            }
            else {
                return data.pairs && data.pairs.length > 0 ? parseFloat(data.pairs[0].priceUsd) : null;
            }
        }
        catch (error) {
            console.error(`Error fetching price for ${tokenAddress}:`, error);
            // User-friendly notification (only if userId is provided)
            if (userId) {
                // Only notify once per token per session
                if (!this.lastPriceLogs.has(`fetchfail_${userId}_${tokenAddress}`)) {
                    this.botConfig.onLog(`⚠️ Could not fetch price for token (${tokenAddress}) on ${network}. The price API may be down or unreachable. Skipping this token for now.`, userId);
                    this.lastPriceLogs.set(`fetchfail_${userId}_${tokenAddress}`, Date.now());
                }
            }
            return null;
        }
    }
    // Send periodic status message every 5 minutes
    async sendActiveStatusMessage(userId) {
        // Determine active networks
        const ethWallet = this.getUserWallet(userId, 'ETH');
        const bscWallet = this.getUserWallet(userId, 'BSC');
        const solWallet = this.getUserWallet(userId, 'SOL');
        const ethActive = ethWallet && ethWallet.isActive !== false;
        const bscActive = bscWallet && bscWallet.isActive !== false;
        const solActive = solWallet && solWallet.isActive !== false;
        const activeNetworks = [];
        if (ethActive)
            activeNetworks.push('ETH');
        if (bscActive)
            activeNetworks.push('BSC');
        if (solActive)
            activeNetworks.push('SOL');
        await this.botConfig.onLog(`🤖 Paper Trading Bot is ACTIVE and searching for tokens on: ${activeNetworks.length > 0 ? activeNetworks.join(', ') : 'None'}`, userId);
    }
    // Activate or deactivate a paper wallet for a user and network
    setPaperWalletActive(userId, network, active) {
        const wallet = this.getUserWallet(userId, network);
        if (!wallet)
            return;
        wallet.isActive = active;
        // If the bot is running for this user, update the scanner's networks
        if (this.isRunning && this.activeUsers.has(userId) && this.enhancedTokenScanner) {
            // Determine which networks should be scanned now
            const ethWallet = this.getUserWallet(userId, 'ETH');
            const bscWallet = this.getUserWallet(userId, 'BSC');
            const solWallet = this.getUserWallet(userId, 'SOL');
            const ethActive = ethWallet && ethWallet.isActive !== false;
            const bscActive = bscWallet && bscWallet.isActive !== false;
            const solActive = solWallet && solWallet.isActive !== false;
            const networksToScan = [];
            if (ethActive)
                networksToScan.push('ETH');
            if (bscActive)
                networksToScan.push('BSC');
            if (solActive)
                networksToScan.push('SOL');
            // Restart the scanner with the new set of networks
            if (this.enhancedTokenScanner.isScanning()) {
                this.enhancedTokenScanner.stopScanning();
            }
            if (networksToScan.length > 0) {
                this.enhancedTokenScanner.startScanning(networksToScan);
            }
        }
        // Immediately update the status message
        this.sendActiveStatusMessage(userId);
    }
}
exports.PaperTradeBot = PaperTradeBot;
