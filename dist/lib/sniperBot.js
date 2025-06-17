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
            console.log('✅ Enhanced Token Scanner initialized in SniperBot');
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
                        await this.botConfig.onLog(`🎯 New Token Detected!\n\n` +
                            `🪙 ${tokenData.symbol} (${tokenData.name})\n` +
                            `🌐 Network: ${tokenData.network}\n` +
                            `💰 Price: $${tokenData.price.toFixed(8)}\n` +
                            `💧 Liquidity: $${tokenData.liquidity.toLocaleString()}\n` +
                            `📊 24h Volume: $${tokenData.volume24h.toLocaleString()}\n` +
                            `⏰ Age: ${tokenData.age}\n` +
                            `📍 Address: \`${tokenData.address}\`\n` +
                            `🔗 [DexScreener](${tokenData.dexScreenerUrl})`, userId);
                        // Attempt to snipe the token
                        await this.attemptSnipe(userId, tokenData);
                    }
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
            const userConfig = this.getUserConfig(userId);
            if (!userConfig) {
                console.log(`No config found for user ${userId}`);
                return;
            }
            const wallet = this.getUserWallet(userId, tokenData.network);
            if (!wallet) {
                console.log(`No ${tokenData.network} wallet found for user ${userId}`);
                return;
            }
            // Check if we have enough balance
            const balance = await this.getWalletBalance(userId, tokenData.network);
            const balanceNum = parseFloat(balance.split(' ')[0]);
            if (balanceNum < userConfig.amount) {
                await this.botConfig.onLog(`⚠️ Insufficient ${tokenData.network} balance for sniping ${tokenData.symbol}`, userId);
                return;
            }
            // Attempt to snipe based on network
            let txHash;
            if (tokenData.network === 'SOL') {
                txHash = await this.executeSolSnipe(wallet, tokenData.address, userConfig.amount, userConfig.slippage);
            }
            else {
                txHash = await this.snipeEvmToken(userId, tokenData.network, tokenData.address, userConfig.amount, userConfig.slippage);
            }
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
                network: tokenData.network
            };
            this.positions.set(`${userId}_${tokenData.address}`, position);
            await this.botConfig.onLog(`✅ Successfully Sniped ${tokenData.symbol}!\n\n` +
                `💰 Amount: ${userConfig.amount} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${tokenData.price.toFixed(8)}\n` +
                `📊 Stop Loss: ${userConfig.stopLoss}%\n` +
                `🎯 Take Profit: ${userConfig.takeProfit}%\n` +
                `🔗 [View Transaction](${exports.NETWORK_CONFIGS[tokenData.network].explorer}${typeof txHash === 'string' ? txHash : txHash.hash})`, userId);
        }
        catch (error) {
            console.error(`Error sniping token for user ${userId}:`, error);
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
        // Check wallet balances
        let hasEnoughFunds = false;
        for (const network of ['ETH', 'BSC', 'SOL']) {
            if (this.hasUserWallet(userId, network)) {
                const balanceStr = await this.getWalletBalance(userId, network);
                const balance = parseFloat(balanceStr.split(' ')[0]);
                if (balance >= config.amount) {
                    hasEnoughFunds = true;
                    break;
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
        this.botConfig.onLog('🔍 Enhanced Token Scanner is now monitoring for new tokens with validation criteria:\n' +
            `💧 Min Liquidity: $${this.userValidationCriteria.get(userId)?.minLiquidity || 1000}\n` +
            `📊 Min Volume: $${this.userValidationCriteria.get(userId)?.minVolume || 25}\n` +
            `✅ DexScreener Required: ${this.userValidationCriteria.get(userId)?.requireDexScreener || true}`, userId);
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
            const poolKeys = await raydiumSwap.findRaydiumPoolInfo(constants_1.WSOL_ADDRESS, tokenAddress);
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
                    network
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
}
exports.SniperBot = SniperBot;
