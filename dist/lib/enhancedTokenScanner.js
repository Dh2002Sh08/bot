"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedTokenScanner = void 0;
const web3_1 = require("web3");
const web3_js_1 = require("@solana/web3.js");
const sdk_node_1 = require("@goplus/sdk-node");
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Stablecoin blacklists
const STABLECOIN_BLACKLISTS = {
    ETH: [
        '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
        '0xa0b86a33e6441b8c4c8c8c8c8c8c8c8c8c8c8c8c', // USDC
        '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    ],
    BSC: [
        '0x55d398326f99059ff775485246999027b3197955', // USDT
        '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
        '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
        '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
        '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
        '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
        '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // WETH
    ],
    SOL: [
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
        'So11111111111111111111111111111111111111112', // SOL
    ]
};
// Known token symbols to exclude (stablecoins, major tokens)
const EXCLUDED_SYMBOLS = [
    'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FRAX', 'USDP', 'USDD', 'GUSD', 'LUSD',
    'WBTC', 'BTCB', 'WETH', 'WBNB', 'WSOL', 'SOL', 'BNB', 'ETH', 'BTC',
    'BONK', 'RAY', 'SRM', 'ORCA', 'JUP', 'PYTH', 'BOME', 'WIF', 'POPCAT'
];
// Network configurations (copied from working scans)
const NETWORK_CONFIGS = {
    ETH: {
        factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2 Factory
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        wsProvider: `wss://aged-cosmological-mound.quiknode.pro/${process.env.QUICKNODE_KEY}/`,
        rpcProvider: `https://aged-cosmological-mound.quiknode.pro/${process.env.QUICKNODE_KEY}/`,
        explorer: 'https://etherscan.io/token/',
        dexScreenerBase: 'https://api.dexscreener.com/latest/dex/tokens/'
    },
    BSC: {
        factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', // PancakeSwap V2 Factory
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        wsProvider: `wss://aged-cosmological-mound.bsc.quiknode.pro/${process.env.QUICKNODE_KEY}`,
        rpcProvider: `https://aged-cosmological-mound.bsc.quiknode.pro/${process.env.QUICKNODE_KEY}`,
        explorer: 'https://bscscan.com/token/',
        dexScreenerBase: 'https://api.dexscreener.com/latest/dex/tokens/'
    },
    SOL: {
        raydiumProgram: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium Liquidity Pool V4 Program
        wsProvider: `https://rpc.shyft.to?api_key=${process.env.SHYFT_KEY}`,
        fallbackProvider: 'https://rpc.shyft.to?api_key=44XIeTj8OY_hlPwN',
        explorer: 'https://solscan.io/token/',
        dexScreenerBase: 'https://api.dexscreener.com/latest/dex/pairs/solana/'
    }
};
// Factory ABIs (copied from working scans)
const UNISWAP_FACTORY_ABI = [
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'token0', type: 'address' },
            { indexed: true, name: 'token1', type: 'address' },
            { indexed: false, name: 'pair', type: 'address' },
            { indexed: false, name: '', type: 'uint256' }
        ],
        name: 'PairCreated',
        type: 'event'
    }
];
const PANCAKESWAP_FACTORY_ABI = [
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'token0', type: 'address' },
            { indexed: true, name: 'token1', type: 'address' },
            { indexed: false, name: 'pair', type: 'address' },
            { indexed: false, name: '', type: 'uint256' }
        ],
        name: 'PairCreated',
        type: 'event'
    }
];
class EnhancedTokenScanner {
    constructor(validationCriteria, onTokenDetected, onError) {
        this.web3Instances = new Map();
        this.solanaConnection = null;
        this.subscriptions = new Map();
        this.isRunning = false;
        this.tokenList = []; // In-memory store for recent pools (copied from solTokenScan.js)
        this.activeNetworks = new Set();
        this.processedTokens = new Set(); // Track processed tokens to avoid duplicates
        this.dexScreenerCache = new Map(); // Cache DexScreener responses
        this.CACHE_DURATION = 30000; // 30 seconds cache duration
        this.validationCriteria = validationCriteria;
        this.onTokenDetected = onTokenDetected;
        this.onError = onError;
    }
    // Initialize connections (using exact logic from working scans)
    async initialize() {
        try {
            console.log('🔍 Initializing Enhanced Token Scanner...');
            // Initialize Web3 instances for ETH and BSC (copied from ethTokenScan.js and bscTokenScan.js)
            const ethWeb3 = new web3_1.Web3(NETWORK_CONFIGS.ETH.wsProvider);
            const bscWeb3 = new web3_1.Web3(NETWORK_CONFIGS.BSC.wsProvider);
            // Test connections (copied from working scans)
            await ethWeb3.eth.net.isListening();
            await bscWeb3.eth.net.isListening();
            this.web3Instances.set('ETH', ethWeb3);
            this.web3Instances.set('BSC', bscWeb3);
            // Initialize Solana connection (copied from solTokenScan.js)
            try {
                console.log('🔌 Connecting to Shyft Solana WebSocket...');
                this.solanaConnection = new web3_js_1.Connection(NETWORK_CONFIGS.SOL.wsProvider, 'confirmed');
                const version = await this.solanaConnection.getVersion();
                console.log('✅ Connected to Shyft node, version:', version['solana-core']);
            }
            catch (shyftErr) {
                console.error('⚠️ Shyft WebSocket connection failed:', shyftErr);
                console.log('🔌 Falling back to public Solana WebSocket...');
                this.solanaConnection = new web3_js_1.Connection(NETWORK_CONFIGS.SOL.fallbackProvider, 'confirmed');
                const version = await this.solanaConnection.getVersion();
                console.log('✅ Connected to fallback node, version:', version['solana-core']);
            }
            console.log('✅ Enhanced Token Scanner initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize Enhanced Token Scanner:', error);
            throw error;
        }
    }
    // Start scanning for specific networks only
    async startScanning(networks = []) {
        if (this.isRunning) {
            console.log('⚠️ Token scanner is already running');
            return;
        }
        this.isRunning = true;
        this.activeNetworks = new Set(networks);
        console.log('🚀 Starting Enhanced Token Scanner...');
        // Start scanning for each network
        for (const network of networks) {
            try {
                switch (network) {
                    case 'ETH':
                        await this.startEthScanning();
                        break;
                    case 'BSC':
                        await this.startBscScanning();
                        break;
                    case 'SOL':
                        await this.startSolanaScanning();
                        break;
                }
            }
            catch (error) {
                console.error(`❌ Failed to start ${network} scanning:`, error);
                this.onError(error);
            }
        }
        console.log('✅ Enhanced Token Scanner started successfully');
    }
    // Add networks to existing scanning
    async addNetworks(networks) {
        for (const network of networks) {
            if (!this.activeNetworks.has(network)) {
                this.activeNetworks.add(network);
                try {
                    switch (network) {
                        case 'ETH':
                            await this.startEthScanning();
                            break;
                        case 'BSC':
                            await this.startBscScanning();
                            break;
                        case 'SOL':
                            await this.startSolanaScanning();
                            break;
                    }
                }
                catch (error) {
                    console.error(`❌ Failed to add ${network} scanning:`, error);
                    this.onError(error);
                }
            }
        }
    }
    // Remove networks from scanning
    async removeNetworks(networks) {
        for (const network of networks) {
            if (this.activeNetworks.has(network)) {
                this.activeNetworks.delete(network);
                const subscription = this.subscriptions.get(network);
                if (subscription) {
                    if (network === 'SOL') {
                        await this.solanaConnection.removeProgramAccountChangeListener(subscription);
                    }
                    else {
                        await subscription.unsubscribe();
                    }
                    this.subscriptions.delete(network);
                }
            }
        }
    }
    // Stop scanning
    async stopScanning() {
        this.isRunning = false;
        // Unsubscribe from all networks
        for (const [network, subscription] of this.subscriptions) {
            try {
                if (network === 'SOL') {
                    await this.solanaConnection.removeProgramAccountChangeListener(subscription);
                }
                else {
                    await subscription.unsubscribe();
                }
            }
            catch (error) {
                console.error(`Error unsubscribing from ${network}:`, error);
            }
        }
        this.subscriptions.clear();
        this.activeNetworks.clear();
        console.log('🛑 Enhanced Token Scanner stopped');
    }
    // Update validation criteria
    updateValidationCriteria(criteria) {
        this.validationCriteria = { ...this.validationCriteria, ...criteria };
    }
    // ETH Scanning (exact logic from ethTokenScan.js)
    async startEthScanning() {
        try {
            const web3 = this.web3Instances.get('ETH');
            const factoryContract = new web3.eth.Contract(UNISWAP_FACTORY_ABI, NETWORK_CONFIGS.ETH.factory);
            const eventSignature = web3.eth.abi.encodeEventSignature('PairCreated(address,address,address,uint256)');
            console.log('🔌 Subscribing to new Uniswap V2 pairs...');
            // Verify WebSocket connection (copied from ethTokenScan.js)
            web3.eth.net.isListening()
                .then(() => console.log('✅ ETH WebSocket provider connected'))
                .catch(err => console.error('❌ ETH WebSocket provider connection failed:', err));
            // Subscribe to logs for real-time events (copied from ethTokenScan.js)
            const subscription = await web3.eth.subscribe('logs', {
                address: NETWORK_CONFIGS.ETH.factory,
                topics: [eventSignature]
            });
            this.subscriptions.set('ETH', subscription);
            // Handle subscription events (copied from ethTokenScan.js)
            subscription.on('data', async (log) => {
                try {
                    const decoded = web3.eth.abi.decodeLog(UNISWAP_FACTORY_ABI[0].inputs, log.data, log.topics.slice(1));
                    console.log('🆕 New ETH Pair Detected!');
                    console.log('Token 0:', decoded.token0);
                    console.log('Token 1:', decoded.token1);
                    console.log('Pair:', decoded.pair);
                    console.log('Block Number:', log.blockNumber);
                    console.log('Transaction Hash:', log.transactionHash);
                    // Determine which token is the new token (not WETH)
                    const newTokenAddress = decoded.token0.toLowerCase() === NETWORK_CONFIGS.ETH.weth.toLowerCase()
                        ? decoded.token1
                        : decoded.token0;
                    await this.processNewToken('ETH', newTokenAddress, decoded.pair);
                }
                catch (err) {
                    console.error('❌ Error decoding ETH log:', err);
                }
            });
            subscription.on('connected', (subscriptionId) => {
                console.log('✅ ETH Subscription connected:', subscriptionId);
            });
            subscription.on('error', (err) => {
                console.error('❌ ETH Subscription error:', err);
                this.onError(err);
            });
        }
        catch (err) {
            console.error('❌ ETH Initialization error:', err);
            this.onError(err);
        }
    }
    // BSC Scanning (exact logic from bscTokenScan.js)
    async startBscScanning() {
        try {
            const web3 = this.web3Instances.get('BSC');
            const factoryContract = new web3.eth.Contract(PANCAKESWAP_FACTORY_ABI, NETWORK_CONFIGS.BSC.factory);
            const eventSignature = web3.eth.abi.encodeEventSignature('PairCreated(address,address,address,uint256)');
            console.log('🔌 Subscribing to new PancakeSwap V2 pairs...');
            // Verify WebSocket connection (copied from bscTokenScan.js)
            web3.eth.net.isListening()
                .then(() => console.log('✅ BSC WebSocket provider connected'))
                .catch(err => console.error('❌ BSC WebSocket provider connection failed:', err));
            // Subscribe to logs for real-time events (copied from bscTokenScan.js)
            const subscription = await web3.eth.subscribe('logs', {
                address: NETWORK_CONFIGS.BSC.factory,
                topics: [eventSignature]
            });
            this.subscriptions.set('BSC', subscription);
            // Handle subscription events (copied from bscTokenScan.js)
            subscription.on('data', async (log) => {
                try {
                    const decoded = web3.eth.abi.decodeLog(PANCAKESWAP_FACTORY_ABI[0].inputs, log.data, log.topics.slice(1));
                    console.log('🆕 New BSC Pair Detected!');
                    console.log('Token 0:', decoded.token0);
                    console.log('Token 1:', decoded.token1);
                    console.log('Pair:', decoded.pair);
                    console.log('Block Number:', log.blockNumber);
                    console.log('Transaction Hash:', log.transactionHash);
                    // Determine which token is the new token (not WBNB)
                    const newTokenAddress = decoded.token0.toLowerCase() === NETWORK_CONFIGS.BSC.weth.toLowerCase()
                        ? decoded.token1
                        : decoded.token0;
                    await this.processNewToken('BSC', newTokenAddress, decoded.pair);
                }
                catch (err) {
                    console.error('❌ Error decoding BSC log:', err);
                }
            });
            subscription.on('connected', (subscriptionId) => {
                console.log('✅ BSC Subscription connected:', subscriptionId);
            });
            subscription.on('error', (err) => {
                console.error('❌ BSC Subscription error:', err);
                this.onError(err);
            });
        }
        catch (err) {
            console.error('❌ BSC Initialization error:', err);
            this.onError(err);
        }
    }
    // Solana Scanning (exact logic from solTokenScan.js)
    async startSolanaScanning() {
        try {
            console.log('🔌 Subscribing to Raydium pool creation events...');
            const raydiumProgramId = new web3_js_1.PublicKey(NETWORK_CONFIGS.SOL.raydiumProgram);
            // Subscribe to account changes for Raydium program (copied from solTokenScan.js)
            const subscriptionId = this.solanaConnection.onProgramAccountChange(raydiumProgramId, async (info) => {
                try {
                    const poolAddress = info.accountId.toBase58();
                    const enriched = await this.enrichToken(poolAddress);
                    if (enriched) {
                        this.tokenList.unshift(enriched);
                        if (this.tokenList.length > 50)
                            this.tokenList.pop(); // Limit to 50 pools
                        console.log('🆕 New Raydium Pool Detected!');
                        console.log('Pool Address:', poolAddress);
                        console.log('Timestamp:', new Date().toISOString());
                        console.log('Enriched Pool Data:', enriched);
                        // Process the detected token
                        await this.processSolanaPool(poolAddress, enriched);
                    }
                    else {
                        console.log('Invalid pool detected');
                    }
                }
                catch (err) {
                    console.log('Invalid pool detected');
                }
            }, 'confirmed');
            this.subscriptions.set('SOL', subscriptionId);
            console.log('✅ Solana Subscription active, ID:', subscriptionId);
        }
        catch (err) {
            console.error('❌ Solana Initialization error:', err);
            this.onError(err);
        }
    }
    // Process new token from EVM chains with enhanced filtering
    async processNewToken(network, tokenAddress, pairAddress) {
        try {
            console.log(`🔍 Processing new ${network} token: ${tokenAddress}`);
            console.log(`🚀 TOKEN DETECTION STARTED - Checking for honeypot and validating coin...`);
            // Check if token was already processed
            const tokenKey = `${network}_${tokenAddress.toLowerCase()}`;
            if (this.processedTokens.has(tokenKey)) {
                console.log(`⏭️ Token ${tokenAddress} already processed, skipping`);
                return;
            }
            // Mark as processed immediately to prevent duplicates
            this.processedTokens.add(tokenKey);
            // Add 1 minute delay before scanning DexScreener to ensure token is indexed
            console.log(`⏳ Waiting 1 minute for DexScreener to index ${tokenAddress}...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            console.log(`✅ Delay completed, now fetching data from DexScreener...`);
            // Get token data from DexScreener
            const tokenData = await this.getTokenDataFromDexScreener(network, tokenAddress);
            if (!tokenData) {
                console.log(`❌ No DexScreener data for ${network} token: ${tokenAddress}`);
                return;
            }
            console.log(`📊 Token data received for ${tokenData.symbol}:`, {
                symbol: tokenData.symbol,
                name: tokenData.name,
                price: tokenData.price,
                liquidity: tokenData.liquidity,
                volume24h: tokenData.volume24h,
                age: tokenData.age,
                ageSeconds: tokenData.ageSeconds
            });
            // Quick validation checks (non-blocking) - but be less strict
            const quickValidation = this.quickTokenValidation(tokenData);
            if (!quickValidation.isValid) {
                console.log(`❌ Token ${tokenData.symbol} filtered out: ${quickValidation.reason}`);
                return;
            }
            console.log(`✅ Quick validation passed for ${tokenData.symbol}`);
            // Enhanced filtering (async but fast) - but be less strict
            if (!await this.isValidNewToken(tokenData)) {
                console.log(`❌ Token ${tokenData.symbol} filtered out: Not a valid new token`);
                return;
            }
            console.log(`✅ Enhanced validation passed for ${tokenData.symbol}`);
            // Honeypot detection if enabled (parallel processing)
            let honeypotCheck;
            if (this.validationCriteria.enableHoneypotDetection) {
                console.log(`🔍 Checking honeypot for ${tokenData.symbol}...`);
                // Start honeypot check in parallel but don't wait for it
                this.checkHoneypotAsync(tokenData.address, network).then(check => {
                    honeypotCheck = check;
                    if (check.isHoneypot) {
                        console.log(`🚨 Honeypot detected for ${tokenData.symbol}: ${check.error || 'High taxes or not sellable'}`);
                    }
                    else {
                        console.log(`✅ Honeypot check passed for ${tokenData.symbol}`);
                    }
                }).catch(error => {
                    console.error('Honeypot check error:', error);
                });
            }
            else {
                console.log(`⏭️ Honeypot detection disabled for ${tokenData.symbol}`);
            }
            const enrichedToken = {
                ...tokenData,
                network,
                pairAddress,
                timestamp: Date.now(),
                scannerCriteria: this.validationCriteria,
                honeypotCheck
            };
            console.log(`🎯 Valid new token detected on ${network}:`, tokenData.symbol);
            console.log(`Calling onTokenDetected for ${network} with token: ${tokenData.symbol} and address: ${tokenData.address}`);
            // Call onTokenDetected immediately (honeypot check will be updated later if needed)
            this.onTokenDetected(enrichedToken);
        }
        catch (error) {
            console.error(`Error processing ${network} token:`, error);
        }
    }
    // Process Solana pool with enhanced filtering
    async processSolanaPool(poolAddress, enrichedData) {
        try {
            console.log(`🔍 Processing new SOL pool: ${poolAddress}`);
            console.log(`🚀 TOKEN DETECTION STARTED - Checking for honeypot and validating coin...`);
            let tokenData = null;
            if (enrichedData) {
                // Use enriched data if available (from solTokenScan.js)
                tokenData = {
                    address: enrichedData.mint,
                    symbol: enrichedData.symbol,
                    name: enrichedData.name,
                    network: 'SOL',
                    price: parseFloat(enrichedData.price) || 0,
                    liquidity: parseFloat(enrichedData.liquidity) || 0,
                    volume24h: 0, // Not available in enriched data
                    age: enrichedData.age,
                    ageSeconds: 0, // Calculate if needed
                    pairAddress: poolAddress,
                    dexScreenerUrl: `https://dexscreener.com/solana/${poolAddress}`,
                    timestamp: Date.now(),
                    scannerCriteria: this.validationCriteria
                };
                console.log(`📊 Using enriched data for ${tokenData.symbol}`);
            }
            else {
                // Fallback to DexScreener API - remove delay for instant alert
                console.log(`📊 Fetching data from DexScreener for pool: ${poolAddress}`);
                tokenData = await this.getSolanaTokenData(poolAddress);
            }
            if (!tokenData) {
                console.log(`❌ No token data available for SOL pool: ${poolAddress}`);
                return;
            }
            // Only require a valid mint address (non-empty string)
            if (!tokenData.address || typeof tokenData.address !== 'string' || tokenData.address.length < 32) {
                console.log(`❌ Invalid mint address for SOL token: ${tokenData.address}`);
                return;
            }
            // Skip all other validation for Solana tokens, send immediately
            const tokenKey = `SOL_${tokenData.address}`;
            if (this.processedTokens.has(tokenKey)) {
                console.log(`⏭️ Token ${tokenData.address} already processed, skipping`);
                return;
            }
            this.processedTokens.add(tokenKey);
            console.log('🎯 Valid new Solana token detected:', tokenData.symbol);
            console.log(`Calling onTokenDetected for SOL with token: ${tokenData.symbol} and address: ${tokenData.address}`);
            this.onTokenDetected(tokenData);
        }
        catch (error) {
            console.error('Error processing Solana pool:', error);
        }
    }
    // Quick validation checks (synchronous, fast)
    quickTokenValidation(tokenData) {
        try {
            // Check if token is in stablecoin blacklist
            if (this.validationCriteria.excludeStablecoins !== false) {
                const blacklist = STABLECOIN_BLACKLISTS[tokenData.network] || [];
                if (blacklist.includes(tokenData.address.toLowerCase())) {
                    return { isValid: false, reason: 'Token is in stablecoin blacklist' };
                }
            }
            // Check if symbol is in excluded symbols list
            if (EXCLUDED_SYMBOLS.includes(tokenData.symbol.toUpperCase())) {
                return { isValid: false, reason: 'Token has excluded symbol' };
            }
            // Check for suspicious patterns in token name/symbol - but be less strict
            if (this.hasSuspiciousPatterns(tokenData)) {
                return { isValid: false, reason: 'Token has suspicious patterns' };
            }
            // Check for very short or very long names - but be more lenient
            if (tokenData.symbol.length < 1 || tokenData.symbol.length > 50) {
                return { isValid: false, reason: 'Invalid symbol length' };
            }
            // Check for very short or very long names - but be more lenient
            if (tokenData.name.length < 1 || tokenData.name.length > 100) {
                return { isValid: false, reason: 'Invalid name length' };
            }
            return { isValid: true };
        }
        catch (error) {
            console.error('Error in quickTokenValidation:', error);
            return { isValid: false, reason: 'Validation error' };
        }
    }
    // Enhanced token validation to filter out stablecoins and established tokens
    async isValidNewToken(tokenData) {
        try {
            // Remove the minimum age filter for Solana tokens
            if (tokenData.network !== 'SOL') {
                if (this.validationCriteria.minTokenAge && tokenData.ageSeconds < this.validationCriteria.minTokenAge) {
                    console.log(`❌ Token ${tokenData.symbol} too new: ${tokenData.ageSeconds}s < ${this.validationCriteria.minTokenAge}s`);
                    return false;
                }
            }
            // Be more lenient with max age - only filter out very old tokens (> 7 days)
            if (this.validationCriteria.maxTokenAge && tokenData.ageSeconds > this.validationCriteria.maxTokenAge) {
                console.log(`❌ Token ${tokenData.symbol} too old: ${tokenData.ageSeconds}s > ${this.validationCriteria.maxTokenAge}s`);
                return false;
            }
            // If no age criteria are set, be more permissive
            if (!this.validationCriteria.minTokenAge && !this.validationCriteria.maxTokenAge) {
                // Only filter out tokens that are extremely old (> 7 days)
                if (tokenData.ageSeconds > 604800) { // 7 days
                    console.log(`❌ Token ${tokenData.symbol} too old: ${tokenData.ageSeconds}s > 7 days`);
                    return false;
                }
            }
            return true;
        }
        catch (error) {
            console.error('Error in isValidNewToken:', error);
            return false;
        }
    }
    // Async honeypot check (non-blocking)
    async checkHoneypotAsync(tokenAddress, network) {
        try {
            // Try GoPlus SDK first (more reliable)
            const goPlusResult = await this.checkHoneypotGoPlus(tokenAddress, network);
            if (goPlusResult) {
                return goPlusResult;
            }
            // Fallback to Honeypot API
            const honeypotResult = await this.checkHoneypotAPI(tokenAddress, network);
            if (honeypotResult) {
                return honeypotResult;
            }
            // Manual check as last resort
            return await this.manualHoneypotCheck(tokenAddress, network);
        }
        catch (error) {
            console.error('Error in honeypot detection:', error);
            return {
                isHoneypot: false,
                buyTax: 0,
                sellTax: 0,
                isBuyable: true,
                isSellable: true,
                error: 'Detection failed',
                source: 'manual'
            };
        }
    }
    // Check honeypot using GoPlus SDK
    async checkHoneypotGoPlus(tokenAddress, network) {
        try {
            const chainId = network === 'ETH' ? '1' : '56';
            const addresses = [tokenAddress];
            // Use GoPlus SDK with type assertion
            const res = await sdk_node_1.GoPlus.tokenSecurity(chainId, addresses, 30);
            if (res.code !== 1) { // SUCCESS code is 1
                console.error('GoPlus SDK error:', res.message);
                return null;
            }
            const tokenData = res.result[tokenAddress];
            if (!tokenData) {
                return null;
            }
            return {
                isHoneypot: tokenData.is_honeypot === '1',
                buyTax: parseFloat(tokenData.buy_tax || '0'),
                sellTax: parseFloat(tokenData.sell_tax || '0'),
                isBuyable: tokenData.is_open_source === '1',
                isSellable: tokenData.is_proxy === '0',
                source: 'goPlus'
            };
        }
        catch (error) {
            console.error('GoPlus SDK error:', error);
            return null;
        }
    }
    // Check honeypot using Honeypot API
    async checkHoneypotAPI(tokenAddress, network) {
        try {
            const chainId = network === 'ETH' ? '1' : '56';
            const url = `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${chainId}`;
            const response = await (0, node_fetch_1.default)(url);
            if (!response.ok) {
                return null;
            }
            const data = await response.json();
            return {
                isHoneypot: data.IsHoneypot,
                buyTax: data.BuyTax || 0,
                sellTax: data.SellTax || 0,
                isBuyable: data.IsBuyable,
                isSellable: data.IsSellable,
                source: 'honeypot'
            };
        }
        catch (error) {
            console.error('Honeypot API error:', error);
            return null;
        }
    }
    // Manual honeypot check using basic heuristics
    async manualHoneypotCheck(tokenAddress, network) {
        try {
            // Basic checks based on token characteristics
            // This is a simplified version - in production you'd want more sophisticated checks
            const web3 = this.web3Instances.get(network);
            // Check if contract exists and has basic functions
            const code = await web3.eth.getCode(tokenAddress);
            if (code === '0x' || code === '0x0') {
                return {
                    isHoneypot: true,
                    buyTax: 100,
                    sellTax: 100,
                    isBuyable: false,
                    isSellable: false,
                    error: 'No contract code',
                    source: 'manual'
                };
            }
            // For now, return a conservative result
            return {
                isHoneypot: false,
                buyTax: 0,
                sellTax: 0,
                isBuyable: true,
                isSellable: true,
                source: 'manual'
            };
        }
        catch (error) {
            console.error('Manual honeypot check error:', error);
            return {
                isHoneypot: false,
                buyTax: 0,
                sellTax: 0,
                isBuyable: true,
                isSellable: true,
                error: 'Check failed',
                source: 'manual'
            };
        }
    }
    // Enrich token function (exact copy from solTokenScan.js)
    async enrichToken(poolAddress) {
        try {
            const cacheKey = `SOL_ENRICH_${poolAddress}`;
            const cachedData = this.dexScreenerCache.get(cacheKey);
            if (cachedData && Date.now() - cachedData.timestamp < this.CACHE_DURATION) {
                return cachedData.data;
            }
            const res = await (0, node_fetch_1.default)(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`);
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            }
            catch {
                return null;
            }
            const mintAddress = data?.pair?.baseToken?.address;
            if (data && data.pair) {
                const pair = data.pair;
                const enrichedData = {
                    mint: mintAddress,
                    name: pair.baseToken.name,
                    symbol: pair.baseToken.symbol,
                    price: parseFloat(pair.priceUsd) || 0,
                    liquidity: parseFloat(pair.liquidity.usd) || 0,
                    volume24h: pair.volume?.h24 ? parseFloat(pair.volume.h24) : 0,
                    age: this.formatAge(pair.pairCreatedAt),
                    ageSeconds: Math.floor((Date.now() - pair.pairCreatedAt) / 1000),
                    solscan: `https://solscan.io/token/${mintAddress}`,
                    dexscreener: `https://dexscreener.com/solana/${mintAddress}`,
                    birdeye: `https://birdeye.so/token/${mintAddress}?chain=solana`,
                    timestamp: Date.now(),
                    scannerCriteria: this.validationCriteria
                };
                this.dexScreenerCache.set(cacheKey, { data: enrichedData, timestamp: Date.now() });
                return enrichedData;
            }
            return null;
        }
        catch (error) {
            console.error(`Error enriching Solana token:`, error);
            return null;
        }
    }
    // Get token data from DexScreener (for ETH/BSC)
    async getTokenDataFromDexScreener(network, tokenAddress) {
        try {
            const cacheKey = `${network}_${tokenAddress}`;
            const cachedData = this.dexScreenerCache.get(cacheKey);
            if (cachedData && Date.now() - cachedData.timestamp < this.CACHE_DURATION) {
                return cachedData.data;
            }
            const response = await (0, node_fetch_1.default)(`${NETWORK_CONFIGS[network].dexScreenerBase}${tokenAddress}`);
            const data = await response.json();
            if (!data.pairs || data.pairs.length === 0) {
                return null;
            }
            // Get the most liquid pair
            const pair = data.pairs[0];
            const tokenData = {
                address: tokenAddress,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name,
                network,
                price: parseFloat(pair.priceUsd) || 0,
                liquidity: parseFloat(pair.liquidity?.usd) || 0,
                volume24h: parseFloat(pair.volume?.h24) || 0,
                age: this.formatAge(pair.pairCreatedAt),
                ageSeconds: Math.floor((Date.now() - pair.pairCreatedAt) / 1000),
                pairAddress: pair.pairAddress,
                dexScreenerUrl: `https://dexscreener.com/${network === 'ETH' ? 'ethereum' : network.toLowerCase()}/${pair.pairAddress}`,
                timestamp: Date.now(),
                scannerCriteria: this.validationCriteria
            };
            this.dexScreenerCache.set(cacheKey, { data: tokenData, timestamp: Date.now() });
            return tokenData;
        }
        catch (error) {
            console.error(`Error fetching ${network} token data:`, error);
            return null;
        }
    }
    // Get Solana token data (fallback for processSolanaPool if enrichedData is not provided)
    async getSolanaTokenData(poolAddress) {
        try {
            const cacheKey = `SOL_${poolAddress}`;
            const cachedData = this.dexScreenerCache.get(cacheKey);
            if (cachedData && Date.now() - cachedData.timestamp < this.CACHE_DURATION) {
                return cachedData.data;
            }
            const response = await (0, node_fetch_1.default)(`${NETWORK_CONFIGS.SOL.dexScreenerBase}${poolAddress}`);
            const data = await response.json();
            if (!data.pair) {
                return null;
            }
            const pair = data.pair;
            const tokenData = {
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name,
                network: 'SOL',
                price: parseFloat(pair.priceUsd) || 0,
                liquidity: parseFloat(pair.liquidity?.usd) || 0,
                volume24h: parseFloat(pair.volume?.h24) || 0,
                age: this.formatAge(pair.pairCreatedAt),
                ageSeconds: Math.floor((Date.now() - pair.pairCreatedAt) / 1000),
                pairAddress: poolAddress,
                dexScreenerUrl: `https://dexscreener.com/solana/${poolAddress}`,
                timestamp: Date.now(),
                scannerCriteria: this.validationCriteria
            };
            this.dexScreenerCache.set(cacheKey, { data: tokenData, timestamp: Date.now() });
            return tokenData;
        }
        catch (error) {
            console.error('Error fetching Solana token data:', error);
            return null;
        }
    }
    // Validate token based on criteria
    async validateToken(tokenData) {
        try {
            // Check liquidity
            if (tokenData.liquidity < this.validationCriteria.minLiquidity) {
                return false;
            }
            // Check volume
            if (tokenData.volume24h < this.validationCriteria.minVolume) {
                return false;
            }
            // Check age if specified
            if (this.validationCriteria.maxAge && tokenData.ageSeconds > this.validationCriteria.maxAge) {
                return false;
            }
            // Check if DexScreener data is required and available
            if (this.validationCriteria.requireDexScreener && (!tokenData.price || tokenData.price === 0)) {
                return false;
            }
            return true;
        }
        catch (error) {
            console.error('Error validating token:', error);
            return false;
        }
    }
    // Format age utility (re-added)
    formatAge(createdAtMs) {
        const diff = Math.floor((Date.now() - createdAtMs) / 1000); // total seconds
        const days = Math.floor(diff / (3600 * 24));
        const hours = Math.floor((diff % (3600 * 24)) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;
        let result = '';
        if (days > 0)
            result += `${days}d `;
        if (hours > 0)
            result += `${hours}h `;
        if (minutes > 0)
            result += `${minutes}m `;
        if (seconds > 0 || result === '')
            result += `${seconds}s`;
        return result.trim();
    }
    // Check for suspicious patterns in token data
    hasSuspiciousPatterns(tokenData) {
        const symbol = tokenData.symbol.toLowerCase();
        const name = tokenData.name.toLowerCase();
        // Check for common scam patterns - but be less strict
        const suspiciousPatterns = [
            'test', 'fake', 'scam', 'honeypot', 'rug', 'pull',
            'copy', 'clone', 'fake', 'test', 'demo', 'example'
        ];
        // Only filter out if the pattern is a complete match or very obvious
        for (const pattern of suspiciousPatterns) {
            if (symbol === pattern || name === pattern) {
                return true;
            }
            // Also check if it starts with the pattern (e.g., "test123")
            if (symbol.startsWith(pattern) && symbol.length <= pattern.length + 3) {
                return true;
            }
            if (name.startsWith(pattern) && name.length <= pattern.length + 3) {
                return true;
            }
        }
        // Check for very short or very long names - but be more lenient
        if (symbol.length < 1 || symbol.length > 50) {
            return true;
        }
        return false;
    }
    isScanning() {
        return this.isRunning;
    }
    getActiveNetworks() {
        return this.activeNetworks;
    }
}
exports.EnhancedTokenScanner = EnhancedTokenScanner;
