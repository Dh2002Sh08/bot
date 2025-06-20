"use strict";
// sniperBot.ts - Enhanced Telegram Sniper Bot
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SniperBot = exports.NETWORK_CONFIGS = void 0;
const ethers_1 = require("ethers");
const web3_js_1 = require("@solana/web3.js");
const mpl_token_metadata_1 = require("@metaplex-foundation/mpl-token-metadata");
const constants_1 = require("./constants");
// Removed SNIPER_BOT_ABI, SNIPER_BOT_ADDRESS, BSC_SNIPER_BOT_ADDRESS if not used internally by SniperBot class
const dotenv_1 = __importDefault(require("dotenv"));
const uniswapRouterABI_1 = require("../Address/uniswapRouterABI");
const pancakeswapRouterABI_1 = require("../Address/pancakeswapRouterABI");
const enhancedTokenScanner_1 = require("./enhancedTokenScanner");
// Removed Telegraf, Markup, Scenes, session, message imports
const raydiumSwap_1 = require("./raydiumSwap");
const web3_js_2 = require("@solana/web3.js");
dotenv_1.default.config();
// Network-specific configurations (kept as they are core to sniping logic)
exports.NETWORK_CONFIGS = {
    ETH: {
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        rpc: `https://aged-cosmological-mound.quiknode.pro/${process.env.QUICKNODE_KEY}`,
        explorer: 'https://etherscan.io/tx/',
        factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
    },
    BSC: {
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        rpc: `https://aged-cosmological-mound.bsc.quiknode.pro/${process.env.QUICKNODE_KEY}`,
        explorer: 'https://bscscan.com/tx/',
        factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'
    },
    SOL: {
        router: 'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS', // Raydium AMM Pool
        rpc: `https://rpc.shyft.to?api_key=${process.env.SHYFT_KEY}`,
        explorer: 'https://solscan.io/tx/',
        factory: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' // Raydium Program ID for pool creation
    }
};
class SniperBot {
    constructor(config) {
        this.isRunning = false;
        this.stopFlag = false;
        this.positions = new Map();
        this.userWallets = new Map();
        this.monitoringIntervals = new Map(); // Track intervals per user
        this.userConfigs = new Map(); // Store user-specific configs
        this.balanceUpdateIntervals = new Map();
        this.lastBalanceMessages = new Map();
        this.enhancedTokenScanner = null;
        this.userValidationCriteria = new Map();
        this.snipedTokens = new Map(); // Track sniped tokens per user
        this.positionMonitoringIntervals = new Map();
        this.lastPriceLogs = new Map(); // Re-trigger linter
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
            console.log('✅ Enhanced Token Scanner initialized in SniperBot');
        }
        catch (error) {
            console.error('❌ Failed to initialize Enhanced Token Scanner:', error);
        }
    }
    // Handle token detection from enhanced scanner
    async handleTokenDetected(tokenData) {
        try {
            console.log(`🎯 SniperBot received token detection: ${tokenData.symbol} on ${tokenData.network}`);
            console.log(`📊 Token details:`, {
                symbol: tokenData.symbol,
                name: tokenData.name,
                price: tokenData.price,
                liquidity: tokenData.liquidity,
                volume24h: tokenData.volume24h,
                age: tokenData.age,
                ageSeconds: tokenData.ageSeconds
            });
            // Send token detection message to ALL users who have configurations
            for (const [userId, userConfig] of this.userConfigs) {
                console.log(`📱 Processing token for user ${userId}`);
                await this.botConfig.onLog(`🔎 Token detected! Checking for snipe...\n\n` +
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
                console.log(`🔍 Validation criteria for user ${userId}:`, userCriteria);
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
                console.log(`🔍 Validation result for user ${userId}: ${validationMessage}`);
                await this.botConfig.onLog(`🔍 Sniper Bot Validation: ${validationMessage}`, userId);
                // Only attempt to snipe if user has a wallet for this network AND token is valid
                if (isValid && this.hasUserWallet(userId, tokenData.network)) {
                    console.log(`🚀 Attempting to snipe ${tokenData.symbol} for user ${userId}`);
                    await this.attemptSnipe(userId, tokenData);
                }
                else if (!this.hasUserWallet(userId, tokenData.network)) {
                    console.log(`⚠️ User ${userId} has no ${tokenData.network} wallet configured`);
                    await this.botConfig.onLog(`⚠️ No ${tokenData.network} wallet configured. Cannot snipe this token.`, userId);
                }
                else {
                    console.log(`➡️ Not sniping ${tokenData.symbol} for user ${userId} - validation failed`);
                    await this.botConfig.onLog('➡️ Not sniping this token.', userId);
                }
            }
        }
        catch (error) {
            console.error('Error handling token detection:', error);
        }
    }
    // Handle token scanner errors
    async handleTokenScannerError(error) {
        console.error('Enhanced Token Scanner error:', error);
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
    // Get user's sniped tokens
    getUserSnipedTokens(userId) {
        return this.snipedTokens.get(userId) || [];
    }
    // Attempt to snipe a detected token
    async attemptSnipe(userId, tokenData) {
        try {
            console.log(`🚀 Starting snipe attempt for ${tokenData.symbol} (${tokenData.address}) on ${tokenData.network} for user ${userId}`);
            const userConfig = this.getUserConfig(userId);
            if (!userConfig) {
                console.log(`❌ No config found for user ${userId}`);
                return;
            }
            const wallet = this.getUserWallet(userId, tokenData.network);
            if (!wallet) {
                console.log(`❌ No ${tokenData.network} wallet found for user ${userId}`);
                return;
            }
            // Check if we have enough balance
            const balance = await this.getWalletBalance(userId, tokenData.network);
            const balanceNum = parseFloat(balance.split(' ')[0]);
            console.log(`💰 User ${userId} balance: ${balance} ${tokenData.network}, required: ${userConfig.amount}`);
            if (balanceNum < userConfig.amount) {
                console.log(`❌ Insufficient balance for user ${userId}: ${balanceNum} < ${userConfig.amount}`);
                await this.botConfig.onLog(`⚠️ Insufficient ${tokenData.network} balance for sniping ${tokenData.symbol}`, userId);
                return;
            }
            console.log(`✅ Sufficient balance confirmed. Executing snipe...`);
            // Attempt to snipe based on network
            let txHash;
            if (tokenData.network === 'SOL') {
                console.log(`🔗 Executing Solana snipe for ${tokenData.symbol}`);
                txHash = await this.executeSolSnipe(wallet, tokenData.address, userConfig.amount, userConfig.slippage);
            }
            else {
                console.log(`🔗 Executing EVM snipe for ${tokenData.symbol} on ${tokenData.network}`);
                txHash = await this.snipeEvmToken(userId, tokenData.network, tokenData.address, userConfig.amount, userConfig.slippage);
            }
            console.log(`✅ Snipe transaction successful for ${tokenData.symbol}! Transaction: ${typeof txHash === 'string' ? txHash : txHash.hash}`);
            // Store sniped token
            if (!this.snipedTokens.has(userId)) {
                this.snipedTokens.set(userId, []);
            }
            this.snipedTokens.get(userId).push(tokenData);
            // Create position
            const position = {
                tokenAddress: tokenData.address,
                amount: BigInt(Math.floor(userConfig.amount * 1e18)), // Convert to wei
                entryPrice: BigInt(Math.floor(tokenData.price * 1e18)),
                stopLoss: userConfig.stopLoss,
                takeProfit: userConfig.takeProfit,
                network: tokenData.network,
                tokenSymbol: tokenData.symbol,
                tokenName: tokenData.name,
                entryTime: Math.floor(Date.now() / 1000),
                currentPrice: 0
            };
            this.positions.set(`${userId}_${tokenData.address}`, position);
            console.log(`📊 Position created for ${tokenData.symbol}: Entry Price: $${tokenData.price}, Stop Loss: ${userConfig.stopLoss}%, Take Profit: ${userConfig.takeProfit}%`);
            await this.botConfig.onLog(`✅ Successfully Sniped ${tokenData.symbol}!\n\n` +
                `💰 Amount: ${userConfig.amount} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${tokenData.price.toFixed(8)}\n` +
                `📊 Stop Loss: ${userConfig.stopLoss}%\n` +
                `🎯 Take Profit: ${userConfig.takeProfit}%\n` +
                `🔗 [View Transaction](${exports.NETWORK_CONFIGS[tokenData.network].explorer}${typeof txHash === 'string' ? txHash : txHash.hash})`, userId);
            console.log(`🎉 TOKEN SUCCESSFULLY BOUGHT! ${tokenData.symbol} has been sniped and position is being monitored.`);
        }
        catch (error) {
            console.error(`❌ Error sniping token ${tokenData.symbol} for user ${userId}:`, error);
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
    // Add user configuration methods
    updateUserConfig(userId, config) {
        this.userConfigs.set(userId, config);
    }
    getUserConfig(userId) {
        return this.userConfigs.get(userId);
    }
    // --- Wallet Management ---
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
                const message = `💰 Wallet Balances:\n${balances.join('\n')}`;
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
        }
        catch (error) {
            console.error('Error updating wallet balances:', error);
        }
    }
    setUserWallet(userId, network, privateKey) {
        if (!this.userWallets.has(userId)) {
            this.userWallets.set(userId, new Map());
        }
        if (network === 'SOL') {
            // For Solana, create a keypair from the stored secret key
            const secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
            const keypair = web3_js_1.Keypair.fromSecretKey(secretKey);
            const provider = new web3_js_1.Connection(exports.NETWORK_CONFIGS[network].rpc);
            // Create a custom wallet object for Solana
            const solWallet = {
                address: keypair.publicKey.toString(),
                privateKey: privateKey,
                provider: provider,
                keypair: keypair
            };
            this.userWallets.get(userId)?.set(network, solWallet);
        }
        else {
            // For EVM chains, use ethers wallet
            const provider = new ethers_1.ethers.JsonRpcProvider(exports.NETWORK_CONFIGS[network].rpc);
            this.userWallets.get(userId)?.set(network, new ethers_1.ethers.Wallet(privateKey, provider));
        }
        // Initial balance update
        this.updateWalletBalances(userId, network);
        // Update scanner if bot is running and user has sufficient funds
        if (this.isRunning && this.enhancedTokenScanner) {
            this.updateScannerForUser(userId);
        }
    }
    getUserWallet(userId, network) {
        return this.userWallets.get(userId)?.get(network);
    }
    hasUserWallet(userId, network) {
        return this.userWallets.has(userId) && this.userWallets.get(userId).has(network);
    }
    // Add removeUserWallet method
    removeUserWallet(userId, network) {
        this.userWallets.get(userId)?.delete(network);
        // Update scanner if bot is running
        if (this.isRunning && this.enhancedTokenScanner) {
            this.updateScannerForUser(userId);
        }
        // If no wallets left, stop balance updates
        if (!this.hasUserWallet(userId, 'ETH') && !this.hasUserWallet(userId, 'BSC') && !this.hasUserWallet(userId, 'SOL')) {
            const interval = this.balanceUpdateIntervals.get(userId);
            if (interval) {
                clearInterval(interval);
                this.balanceUpdateIntervals.delete(userId);
            }
            this.lastBalanceMessages.delete(userId);
        }
    }
    // Helper method to update scanner networks for a user
    async updateScannerForUser(userId) {
        if (!this.enhancedTokenScanner)
            return;
        const config = this.userConfigs.get(userId) || this.botConfig;
        const networksToScan = [];
        for (const network of ['ETH', 'BSC', 'SOL']) {
            if (this.hasUserWallet(userId, network)) {
                try {
                    const balanceStr = await this.getWalletBalance(userId, network);
                    const balance = parseFloat(balanceStr.split(' ')[0]);
                    if (balance >= config.amount) {
                        networksToScan.push(network);
                    }
                }
                catch (error) {
                    console.error(`Error checking balance for ${network}:`, error);
                }
            }
        }
        // Get current active networks
        const currentNetworks = Array.from(this.enhancedTokenScanner.getActiveNetworks());
        // Find networks to add
        const networksToAdd = networksToScan.filter(network => !currentNetworks.includes(network));
        // Find networks to remove (if no other users have wallets for them)
        const networksToRemove = currentNetworks.filter(network => !networksToScan.includes(network));
        if (networksToAdd.length > 0) {
            await this.enhancedTokenScanner.addNetworks(networksToAdd);
            console.log(`➕ Added networks to scanner for user ${userId}:`, networksToAdd);
        }
        if (networksToRemove.length > 0) {
            await this.enhancedTokenScanner.removeNetworks(networksToRemove);
            console.log(`➖ Removed networks from scanner for user ${userId}:`, networksToRemove);
        }
    }
    // --- UTILS ---
    detectNetworkFromAddress(tokenAddress) {
        // These are simple heuristic checks, a real implementation might use more robust methods.
        if (tokenAddress.startsWith('0x') && tokenAddress.length === 42)
            return 'ETH';
        if (tokenAddress.length === 44)
            return 'SOL';
        return null; // Could also return 'BSC' if specific BSC address patterns are known
    }
    async getWalletBalance(userId, network) {
        const wallet = this.getUserWallet(userId, network);
        if (!wallet) {
            return `No ${network} wallet.`;
        }
        let balance;
        try {
            if (network === 'SOL') {
                const connection = wallet.provider;
                balance = await connection.getBalance(wallet.keypair.publicKey);
                return `${(balance / 10 ** 9).toFixed(4)} SOL`; // Convert lamports to SOL
            }
            else {
                const provider = wallet.provider;
                if (!provider)
                    return `No provider for ${network}.`;
                balance = await provider.getBalance(wallet.address);
                return `${ethers_1.ethers.formatEther(balance)} ${network === 'ETH' ? 'ETH' : 'BNB'}`;
            }
        }
        catch (error) {
            return `Error getting ${network} balance: ${error.message}`;
        }
    }
    // --- SNIPE FUNCTIONS ---
    async snipeEvmToken(userId, network, tokenAddress, amount, slippage) {
        const wallet = this.getUserWallet(userId, network);
        if (!wallet) {
            throw new Error(`No wallet configured for ${network} for this user.`);
        }
        const provider = wallet.provider;
        const networkConfig = exports.NETWORK_CONFIGS[network];
        const routerAddress = networkConfig.router;
        const weth = networkConfig.weth;
        const abi = network === 'ETH' ? uniswapRouterABI_1.UNISWAP_ROUTER_ABI : pancakeswapRouterABI_1.PANCAKESWAP_ROUTER_ABI;
        const router = new ethers_1.ethers.Contract(routerAddress, abi, provider);
        const path = [weth, tokenAddress];
        const amountIn = ethers_1.ethers.parseEther(amount.toString());
        const amounts = await router.getAmountsOut(amountIn, path);
        const minOut = amounts[1] * BigInt(100 - slippage) / BigInt(100);
        const tx = await router.connect(wallet).swapExactETHForTokens(minOut, path, wallet.address, Math.floor(Date.now() / 1000) + 60 * 20, { value: amountIn });
        await tx.wait();
        return tx;
    }
    // --- AUTO SCAN FUNCTION ---
    async startBackgroundMonitoring(userId) {
        if (this.monitoringIntervals.has(userId)) {
            this.botConfig.onLog('Sniper Bot is already running in background for this user.', userId);
            return;
        }
        // Get user's configuration
        const config = this.userConfigs.get(userId) || this.botConfig;
        // Check wallet balances and determine which networks to scan
        let hasEnoughFunds = false;
        const networksToScan = [];
        for (const network of ['ETH', 'BSC', 'SOL']) {
            if (this.hasUserWallet(userId, network)) {
                const balanceStr = await this.getWalletBalance(userId, network);
                const balance = parseFloat(balanceStr.split(' ')[0]);
                if (balance >= config.amount) {
                    hasEnoughFunds = true;
                    networksToScan.push(network);
                }
            }
        }
        if (!hasEnoughFunds) {
            this.botConfig.onLog('🛑 Sniper Bot cannot start: Insufficient funds in all wallets.', userId);
            return;
        }
        this.isRunning = true;
        this.stopFlag = false;
        this.botConfig.onLog('🚀 Sniper Bot started in background. Searching for tokens...', userId);
        // Show initial wallet balances
        const ethBalance = await this.getWalletBalance(userId, 'ETH');
        const bscBalance = await this.getWalletBalance(userId, 'BSC');
        const solBalance = await this.getWalletBalance(userId, 'SOL');
        this.botConfig.onLog(`💰 Initial Balances:\n🔷 ETH: ${ethBalance}\n🟡 BSC: ${bscBalance}\n🟣 SOL: ${solBalance}`, userId);
        // Initialize enhanced token scanner if not already done
        if (!this.enhancedTokenScanner) {
            await this.initializeEnhancedTokenScanner();
        }
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
        this.botConfig.onLog('🔍 Enhanced Token Scanner is now monitoring for new tokens with validation criteria:\n' +
            `💧 Min Liquidity: $${this.userValidationCriteria.get(userId)?.minLiquidity || 100}\n` +
            `📊 Min Volume: $${this.userValidationCriteria.get(userId)?.minVolume || 1}\n` +
            `✅ DexScreener Required: ${this.userValidationCriteria.get(userId)?.requireDexScreener || true}\n\n` +
            `📡 Scanning networks: ${networksToScan.join(', ')}`, userId);
        // Start position monitoring
        this.startPositionMonitoring(userId);
        // Set up balance update interval
        const balanceInterval = setInterval(async () => {
            if (this.stopFlag) {
                clearInterval(balanceInterval);
                return;
            }
            await this.updateWalletBalances(userId);
        }, 60000); // Update every minute
        this.balanceUpdateIntervals.set(userId, balanceInterval);
        this.monitoringIntervals.set(userId, balanceInterval);
    }
    stopBackgroundMonitoring(userId) {
        const interval = this.monitoringIntervals.get(userId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(userId);
            // Stop enhanced token scanner if no other users are monitoring
            if (this.monitoringIntervals.size === 0 && this.enhancedTokenScanner) {
                this.enhancedTokenScanner.stopScanning();
            }
            this.botConfig.onLog('🛑 Sniper Bot stopped for this user.', userId);
        }
        // Stop position monitoring
        this.stopPositionMonitoring(userId);
        // Clear balance update interval
        const balanceInterval = this.balanceUpdateIntervals.get(userId);
        if (balanceInterval) {
            clearInterval(balanceInterval);
            this.balanceUpdateIntervals.delete(userId);
        }
        this.lastBalanceMessages.delete(userId);
    }
    // --- SWAP FUNCTIONS ---
    async executeSolSnipe(wallet, tokenAddress, amount, slippage) {
        try {
            const raydiumSwap = new raydiumSwap_1.RaydiumSwap(exports.NETWORK_CONFIGS.SOL.rpc, wallet.privateKey);
            await raydiumSwap.loadPoolKeys();
            // Find pool info
            const poolKeys = await raydiumSwap.findRaydiumPoolInfo(tokenAddress, constants_1.WSOL_ADDRESS.toString());
            if (!poolKeys) {
                throw new Error('Pool not found for token');
            }
            // Get swap transaction
            const swapTx = await raydiumSwap.getSwapTransaction(tokenAddress, amount, poolKeys, true, // use versioned transaction
            slippage);
            // Send transaction
            if (swapTx instanceof web3_js_2.VersionedTransaction) {
                const { blockhash, lastValidBlockHeight } = await raydiumSwap.connection.getLatestBlockhash();
                return await raydiumSwap.sendVersionedTransaction(swapTx, blockhash, lastValidBlockHeight);
            }
            else {
                return await raydiumSwap.sendLegacyTransaction(swapTx);
            }
        }
        catch (error) {
            throw error;
        }
    }
    // --- DUMMY AI & API MOCK ---
    async fetchPotentialTokens(userId) {
        // Replace with real API or AI model
        return [
        // '0x123FakeEthToken...',
        // '0x456FakeBscToken...'
        ];
    }
    async getTokenPrice(tokenAddress, network) {
        const config = exports.NETWORK_CONFIGS[network];
        const provider = new ethers_1.ethers.JsonRpcProvider(config.rpc);
        const abi = network === 'ETH' ? uniswapRouterABI_1.UNISWAP_ROUTER_ABI : pancakeswapRouterABI_1.PANCAKESWAP_ROUTER_ABI;
        const router = new ethers_1.ethers.Contract(config.router, abi, provider);
        const path = [config.weth, tokenAddress];
        const amounts = await router.getAmountsOut(ethers_1.ethers.parseEther('1'), path);
        return amounts[1];
    }
    async sellToken(userId, tokenAddress, position) {
        if (position.network !== 'ETH' && position.network !== 'BSC')
            return; // Only EVM
        const networkConfig = exports.NETWORK_CONFIGS[position.network];
        const provider = new ethers_1.ethers.JsonRpcProvider(networkConfig.rpc);
        const abi = position.network === 'ETH' ? uniswapRouterABI_1.UNISWAP_ROUTER_ABI : pancakeswapRouterABI_1.PANCAKESWAP_ROUTER_ABI;
        const router = new ethers_1.ethers.Contract(networkConfig.router, abi, provider);
        const wallet = this.getUserWallet(userId, position.network);
        if (!wallet) {
            this.botConfig.onLog(`⚠️ No ${position.network} wallet found for selling.`, userId);
            return;
        }
        try {
            const path = [tokenAddress, networkConfig.weth];
            const tx = await router.connect(wallet).swapExactTokensForETH(position.amount, 0, // Accept any amount of ETH
            path, wallet.address, Math.floor(Date.now() / 1000) + 60 * 20);
            await tx.wait();
            this.botConfig.onLog(`Sold ${tokenAddress} for wallet ${wallet.address}: ${networkConfig.explorer}${tx.hash}`, userId);
        }
        catch (error) {
            this.botConfig.onError(error, userId);
        }
    }
    // Improve token detection
    async detectNetworkByAddress(tokenAddress) {
        // Check ETH
        try {
            const ethProvider = new ethers_1.ethers.JsonRpcProvider(exports.NETWORK_CONFIGS.ETH.rpc);
            const code = await ethProvider.getCode(tokenAddress);
            if (code !== '0x') {
                // Additional check for ETH token
                const tokenContract = new ethers_1.ethers.Contract(tokenAddress, ['function name() view returns (string)', 'function symbol() view returns (string)'], ethProvider);
                try {
                    const [name, symbol] = await Promise.all([
                        tokenContract.name(),
                        tokenContract.symbol()
                    ]);
                    return 'ETH';
                }
                catch (e) {
                    // If name/symbol calls fail, it might still be an ETH contract
                    return 'ETH';
                }
            }
        }
        catch (e) { /* console.error('ETH network detection error:', e); */ }
        // Check BSC
        try {
            const bscProvider = new ethers_1.ethers.JsonRpcProvider(exports.NETWORK_CONFIGS.BSC.rpc);
            const code = await bscProvider.getCode(tokenAddress);
            if (code !== '0x') {
                // Additional check for BSC token
                const tokenContract = new ethers_1.ethers.Contract(tokenAddress, ['function name() view returns (string)', 'function symbol() view returns (string)'], bscProvider);
                try {
                    const [name, symbol] = await Promise.all([
                        tokenContract.name(),
                        tokenContract.symbol()
                    ]);
                    return 'BSC';
                }
                catch (e) {
                    // If name/symbol calls fail, it might still be a BSC contract
                    return 'BSC';
                }
            }
        }
        catch (e) { /* console.error('BSC network detection error:', e); */ }
        // Check SOL
        try {
            const connection = new web3_js_1.Connection(exports.NETWORK_CONFIGS.SOL.rpc);
            const account = await connection.getAccountInfo(new web3_js_1.PublicKey(tokenAddress));
            if (account) {
                return 'SOL';
            }
        }
        catch (e) { /* console.error('SOL network detection error:', e); */ }
        return null;
    }
    async validateToken(tokenAddress, network) {
        try {
            if (network === 'SOL') {
                const connection = new web3_js_1.Connection(exports.NETWORK_CONFIGS.SOL.rpc);
                const account = await connection.getAccountInfo(new web3_js_1.PublicKey(tokenAddress));
                return account !== null;
            }
            else {
                const provider = new ethers_1.ethers.JsonRpcProvider(exports.NETWORK_CONFIGS[network].rpc);
                const code = await provider.getCode(tokenAddress);
                return code !== '0x';
            }
        }
        catch (error) {
            return false;
        }
    }
    async buyTokenFromUserInput(userId, tokenAddress) {
        const network = await this.detectNetworkByAddress(tokenAddress);
        if (!network) {
            throw new Error('Could not detect token network for the given address.');
        }
        // Get token info before proceeding
        let tokenName = 'Unknown';
        try {
            if (network === 'SOL') {
                const connection = new web3_js_1.Connection(exports.NETWORK_CONFIGS.SOL.rpc);
                const metadata = await connection.getAccountInfo(new web3_js_1.PublicKey(tokenAddress));
                // Get token metadata from Metaplex
                try {
                    const metadataPDA = await web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from('metadata'),
                        new web3_js_1.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
                        new web3_js_1.PublicKey(tokenAddress).toBuffer(),
                    ], new web3_js_1.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'));
                    const metadataAccount = await connection.getAccountInfo(metadataPDA[0]);
                    if (metadataAccount) {
                        try {
                            const metadata = (0, mpl_token_metadata_1.deserializeMetadata)(metadataAccount);
                            tokenName = metadata.name || 'Unknown';
                        }
                        catch (e) {
                            // If deserialization fails, try to get basic token info
                            const tokenInfo = await connection.getParsedAccountInfo(new web3_js_1.PublicKey(tokenAddress));
                            if (tokenInfo.value && 'data' in tokenInfo.value && 'parsed' in tokenInfo.value.data) {
                                const parsedData = tokenInfo.value.data;
                                if (parsedData.parsed && parsedData.parsed.info && parsedData.parsed.info.name) {
                                    tokenName = parsedData.parsed.info.name;
                                }
                            }
                        }
                    }
                }
                catch (e) {
                    // If metadata fetch fails, try to get basic token info
                    const tokenInfo = await connection.getParsedAccountInfo(new web3_js_1.PublicKey(tokenAddress));
                    if (tokenInfo.value && 'data' in tokenInfo.value && 'parsed' in tokenInfo.value.data) {
                        const parsedData = tokenInfo.value.data;
                        if (parsedData.parsed && parsedData.parsed.info && parsedData.parsed.info.name) {
                            tokenName = parsedData.parsed.info.name;
                        }
                    }
                }
            }
            else {
                const provider = new ethers_1.ethers.JsonRpcProvider(exports.NETWORK_CONFIGS[network].rpc);
                const tokenContract = new ethers_1.ethers.Contract(tokenAddress, [
                    'function name() view returns (string)',
                    'function symbol() view returns (string)'
                ], provider);
                const [name, symbol] = await Promise.all([
                    tokenContract.name(),
                    tokenContract.symbol()
                ]);
                tokenName = `${name} (${symbol})`;
            }
        }
        catch (error) {
            this.botConfig.onLog(`Warning: Could not fetch complete token info: ${error.message}`, userId);
        }
        // Log token info before proceeding
        this.botConfig.onLog(`🔍 Token Information:\n` +
            `Network: ${network}\n` +
            `Name: ${tokenName}\n` +
            `Address: ${tokenAddress}`, userId);
        const wallet = this.getUserWallet(userId, network);
        if (!wallet) {
            throw new Error(`No ${network} wallet configured for this user.`);
        }
        // Check wallet balance before buying
        let hasEnoughFunds = false;
        if (network === 'ETH' || network === 'BSC') {
            const balance = await wallet.provider?.getBalance(wallet.address);
            if (balance && balance >= ethers_1.ethers.parseEther(this.botConfig.amount.toString())) {
                hasEnoughFunds = true;
            }
        }
        else if (network === 'SOL') {
            const connection = new web3_js_1.Connection(exports.NETWORK_CONFIGS.SOL.rpc);
            const balance = await connection.getBalance(new web3_js_1.PublicKey(wallet.address));
            if (balance && balance >= parseFloat(ethers_1.ethers.parseEther(this.botConfig.amount.toString()).toString())) {
                hasEnoughFunds = true;
            }
        }
        if (!hasEnoughFunds) {
            throw new Error(`Insufficient funds in your ${network} wallet to buy this token. Current amount required: ${this.botConfig.amount} ${network === 'SOL' ? 'SOL' : 'ETH/BNB'}`);
        }
        try {
            let txResult;
            if (network === 'SOL') {
                txResult = await this.executeSolSnipe(wallet, tokenAddress, this.botConfig.amount, this.botConfig.slippage);
            }
            else if (network === 'ETH' || network === 'BSC') {
                txResult = await this.snipeEvmToken(userId, network, tokenAddress, this.botConfig.amount, this.botConfig.slippage);
            }
            else {
                throw new Error('Unsupported network for buying');
            }
            // Store position (if EVM)
            if (network === 'ETH' || network === 'BSC') {
                this.positions.set(tokenAddress, {
                    tokenAddress,
                    amount: ethers_1.ethers.parseEther(this.botConfig.amount.toString()),
                    entryPrice: await this.getTokenPrice(tokenAddress, network),
                    stopLoss: this.botConfig.stopLoss,
                    takeProfit: this.botConfig.takeProfit,
                    network,
                    tokenSymbol: '',
                    tokenName: '',
                    entryTime: 0,
                    currentPrice: 0
                });
            }
            // Determine the explorer link based on network and transaction type
            let explorerLink = '';
            if (network === 'SOL') {
                explorerLink = `${exports.NETWORK_CONFIGS[network].explorer}${txResult}`;
            }
            else if (network === 'ETH' || network === 'BSC') {
                explorerLink = `${exports.NETWORK_CONFIGS[network].explorer}${txResult.hash}`;
            }
            this.botConfig.onLog(`✅ Successfully bought ${tokenName} (${tokenAddress}): ${explorerLink}`, userId);
        }
        catch (error) {
            this.botConfig.onError(error, userId);
            throw error; // Re-throw to be caught by Telegram handler
        }
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
            await this.monitorPositions(userId);
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
    // Monitor all positions for a user
    async monitorPositions(userId) {
        try {
            const userPositions = Array.from(this.positions.entries())
                .filter(([key]) => key.startsWith(`${userId}_`));
            for (const [positionKey, position] of userPositions) {
                await this.checkPositionPrice(userId, positionKey, position);
            }
        }
        catch (error) {
            console.error(`Error monitoring positions for user ${userId}:`, error);
        }
    }
    // Check price for a specific position
    async checkPositionPrice(userId, positionKey, position) {
        try {
            // Get current price from DexScreener
            const currentPrice = await this.getCurrentTokenPrice(position.tokenAddress, position.network);
            if (currentPrice === null) {
                return; // Skip if price couldn't be fetched
            }
            // Update position with current price
            position.currentPrice = currentPrice;
            this.positions.set(positionKey, position);
            const entryPrice = Number(position.entryPrice) / 1e18;
            const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
            // Check take profit
            if (priceChange >= position.takeProfit) {
                await this.executeSell(userId, positionKey, position, 'TAKE_PROFIT', priceChange);
                return;
            }
            // Check stop loss
            if (priceChange <= -position.stopLoss) {
                await this.executeSell(userId, positionKey, position, 'STOP_LOSS', priceChange);
                return;
            }
            // Log significant price movements (every 5% change)
            const lastLoggedChange = this.lastPriceLogs.get(positionKey) || 0;
            if (Math.abs(priceChange - lastLoggedChange) >= 5) {
                await this.botConfig.onLog(`📊 ${position.tokenSymbol} Price Update:\n` +
                    `💰 Current Price: $${currentPrice.toFixed(8)}\n` +
                    `📈 Entry Price: $${entryPrice.toFixed(8)}\n` +
                    `📊 Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%\n` +
                    `🎯 TP: ${position.takeProfit}% | 🛑 SL: ${position.stopLoss}%`, userId);
                this.lastPriceLogs.set(positionKey, priceChange);
            }
        }
        catch (error) {
            console.error(`Error checking price for position ${positionKey}:`, error);
        }
    }
    // Execute sell order
    async executeSell(userId, positionKey, position, reason, priceChange) {
        try {
            const entryPrice = Number(position.entryPrice) / 1e18;
            const currentPrice = position.currentPrice;
            const profitLoss = ((currentPrice - entryPrice) / entryPrice) * 100;
            // Attempt to sell the token
            if (position.network === 'SOL') {
                await this.executeSolSell(userId, position);
            }
            else {
                await this.sellToken(userId, position.tokenAddress, position);
            }
            // Remove position from tracking
            this.positions.delete(positionKey);
            this.lastPriceLogs.delete(positionKey);
            // Calculate profit/loss in USD
            const investedAmount = Number(position.amount) / 1e18;
            const profitLossUSD = (investedAmount * profitLoss) / 100;
            const emoji = reason === 'TAKE_PROFIT' ? '🎯' : '🛑';
            const reasonText = reason === 'TAKE_PROFIT' ? 'Take Profit Reached!' : 'Stop Loss Triggered!';
            await this.botConfig.onLog(`${emoji} ${reasonText}\n\n` +
                `🪙 Token: ${position.tokenSymbol} (${position.tokenName})\n` +
                `💰 Invested: ${investedAmount.toFixed(4)} ${position.network === 'ETH' ? 'ETH' : position.network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${entryPrice.toFixed(8)}\n` +
                `📊 Exit Price: $${currentPrice.toFixed(8)}\n` +
                `📊 P&L: ${profitLoss > 0 ? '+' : ''}${profitLoss.toFixed(2)}% (${profitLossUSD > 0 ? '+' : ''}$${profitLossUSD.toFixed(2)})\n` +
                `🌐 Network: ${position.network}`, userId);
        }
        catch (error) {
            console.error(`Error executing sell for position ${positionKey}:`, error);
            await this.botConfig.onError(error, userId);
        }
    }
    // Get current token price from DexScreener
    async getCurrentTokenPrice(tokenAddress, network) {
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
            return null;
        }
    }
    // Execute Solana sell
    async executeSolSell(userId, position) {
        try {
            const wallet = this.getUserWallet(userId, 'SOL');
            if (!wallet) {
                throw new Error('No SOL wallet found');
            }
            // Use RaydiumSwap for selling
            const raydiumSwap = new raydiumSwap_1.RaydiumSwap(exports.NETWORK_CONFIGS.SOL.rpc, wallet.privateKey);
            await raydiumSwap.loadPoolKeys();
            // Find pool info
            const poolKeys = await raydiumSwap.findRaydiumPoolInfo(position.tokenAddress, constants_1.WSOL_ADDRESS.toString());
            if (!poolKeys) {
                throw new Error('Pool not found for token');
            }
            // Get swap transaction (selling token for SOL)
            const swapTx = await raydiumSwap.getSwapTransaction(constants_1.WSOL_ADDRESS.toString(), // Selling token for SOL
            Number(position.amount) / 1e9, // Convert from lamports
            poolKeys, true, // use versioned transaction
            5 // 5% slippage
            );
            // Send transaction
            let txHash;
            if (swapTx instanceof web3_js_2.VersionedTransaction) {
                const { blockhash, lastValidBlockHeight } = await raydiumSwap.connection.getLatestBlockhash();
                txHash = await raydiumSwap.sendVersionedTransaction(swapTx, blockhash, lastValidBlockHeight);
            }
            else {
                txHash = await raydiumSwap.sendLegacyTransaction(swapTx);
            }
            await this.botConfig.onLog(`✅ Sold ${position.tokenSymbol} on Solana\n` +
                `🔗 [View Transaction](${exports.NETWORK_CONFIGS.SOL.explorer}${txHash})`, userId);
        }
        catch (error) {
            throw error;
        }
    }
}
exports.SniperBot = SniperBot;
