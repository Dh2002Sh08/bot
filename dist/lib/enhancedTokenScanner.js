"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedTokenScanner = void 0;
const web3_1 = require("web3");
const web3_js_1 = require("@solana/web3.js");
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Factory ABIs
const FACTORY_ABI = [
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
// Network configurations
const NETWORK_CONFIGS = {
    ETH: {
        factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        wsProvider: `wss://aged-cosmological-mound.quiknode.pro/${process.env.QUICKNODE_KEY}/`,
        rpcProvider: `https://aged-cosmological-mound.quiknode.pro/${process.env.QUICKNODE_KEY}/`,
        explorer: 'https://etherscan.io/token/',
        dexScreenerBase: 'https://api.dexscreener.com/latest/dex/tokens/'
    },
    BSC: {
        factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        wsProvider: `wss://aged-cosmological-mound.bsc.quiknode.pro/${process.env.QUICKNODE_KEY}`,
        rpcProvider: `https://aged-cosmological-mound.bsc.quiknode.pro/${process.env.QUICKNODE_KEY}`,
        explorer: 'https://bscscan.com/token/',
        dexScreenerBase: 'https://api.dexscreener.com/latest/dex/tokens/'
    },
    SOL: {
        raydiumProgram: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        wsProvider: `https://rpc.shyft.to?api_key=${process.env.SHYFT_KEY}`,
        fallbackProvider: 'https://rpc.shyft.to?api_key=44XIeTj8OY_hlPwN',
        explorer: 'https://solscan.io/token/',
        dexScreenerBase: 'https://api.dexscreener.com/latest/dex/pairs/solana/'
    }
};
class EnhancedTokenScanner {
    constructor(validationCriteria, onTokenDetected, onError) {
        this.web3Instances = new Map();
        this.solanaConnection = null;
        this.subscriptions = new Map();
        this.isRunning = false;
        this.validationCriteria = validationCriteria;
        this.onTokenDetected = onTokenDetected;
        this.onError = onError;
    }
    // Initialize connections
    async initialize() {
        try {
            // Initialize Web3 instances for ETH and BSC
            const ethWeb3 = new web3_1.Web3(NETWORK_CONFIGS.ETH.wsProvider);
            const bscWeb3 = new web3_1.Web3(NETWORK_CONFIGS.BSC.wsProvider);
            // Test connections
            await ethWeb3.eth.net.isListening();
            await bscWeb3.eth.net.isListening();
            this.web3Instances.set('ETH', ethWeb3);
            this.web3Instances.set('BSC', bscWeb3);
            // Initialize Solana connection
            try {
                this.solanaConnection = new web3_js_1.Connection(NETWORK_CONFIGS.SOL.wsProvider, 'confirmed');
                await this.solanaConnection.getVersion();
            }
            catch (error) {
                console.log('Falling back to Solana fallback provider...');
                this.solanaConnection = new web3_js_1.Connection(NETWORK_CONFIGS.SOL.fallbackProvider, 'confirmed');
            }
            console.log('✅ Enhanced Token Scanner initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize Enhanced Token Scanner:', error);
            throw error;
        }
    }
    // Start scanning for all networks
    async startScanning() {
        if (this.isRunning) {
            console.log('⚠️ Token scanner is already running');
            return;
        }
        this.isRunning = true;
        console.log('🚀 Starting Enhanced Token Scanner...');
        // Start scanning for each network
        await this.startEthScanning();
        await this.startBscScanning();
        await this.startSolanaScanning();
    }
    // Stop scanning
    async stopScanning() {
        this.isRunning = false;
        // Unsubscribe from all subscriptions
        for (const [network, subscription] of this.subscriptions) {
            try {
                if (network === 'SOL') {
                    this.solanaConnection?.removeProgramAccountChangeListener(subscription);
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
        console.log('🛑 Enhanced Token Scanner stopped');
    }
    // Update validation criteria
    updateValidationCriteria(criteria) {
        this.validationCriteria = { ...this.validationCriteria, ...criteria };
        console.log('📊 Updated validation criteria:', this.validationCriteria);
    }
    // ETH Scanning
    async startEthScanning() {
        try {
            const web3 = this.web3Instances.get('ETH');
            const eventSignature = web3.eth.abi.encodeEventSignature('PairCreated(address,address,address,uint256)');
            console.log('🔌 Starting ETH token scanning...');
            const subscription = await web3.eth.subscribe('logs', {
                address: NETWORK_CONFIGS.ETH.factory,
                topics: [eventSignature]
            });
            this.subscriptions.set('ETH', subscription);
            subscription.on('data', async (log) => {
                try {
                    const decoded = web3.eth.abi.decodeLog(FACTORY_ABI[0].inputs, log.data, log.topics.slice(1));
                    // Determine which token is the new token (not WETH)
                    const newTokenAddress = decoded.token0.toLowerCase() === NETWORK_CONFIGS.ETH.weth.toLowerCase()
                        ? decoded.token1
                        : decoded.token0;
                    await this.processNewToken('ETH', newTokenAddress, decoded.pair);
                }
                catch (error) {
                    console.error('Error processing ETH token:', error);
                }
            });
            subscription.on('connected', (subscriptionId) => {
                console.log('✅ Subscription connected:', subscriptionId);
            });
            subscription.on('error', (err) => {
                console.error('❌ Subscription error:', err);
            });
        }
        catch (error) {
            console.error('Failed to start ETH scanning:', error);
            this.onError(error);
        }
    }
    // BSC Scanning
    async startBscScanning() {
        try {
            const web3 = this.web3Instances.get('BSC');
            const eventSignature = web3.eth.abi.encodeEventSignature('PairCreated(address,address,address,uint256)');
            console.log('🔌 Starting BSC token scanning...');
            const subscription = await web3.eth.subscribe('logs', {
                address: NETWORK_CONFIGS.BSC.factory,
                topics: [eventSignature]
            });
            this.subscriptions.set('BSC', subscription);
            subscription.on('data', async (log) => {
                try {
                    const decoded = web3.eth.abi.decodeLog(FACTORY_ABI[0].inputs, log.data, log.topics.slice(1));
                    // Determine which token is the new token (not WBNB)
                    const newTokenAddress = decoded.token0.toLowerCase() === NETWORK_CONFIGS.BSC.weth.toLowerCase()
                        ? decoded.token1
                        : decoded.token0;
                    await this.processNewToken('BSC', newTokenAddress, decoded.pair);
                }
                catch (error) {
                    console.error('Error processing BSC token:', error);
                }
            });
            subscription.on('error', (error) => {
                console.error('BSC subscription error:', error);
                this.onError(error);
            });
        }
        catch (error) {
            console.error('Failed to start BSC scanning:', error);
            this.onError(error);
        }
    }
    // Solana Scanning
    async startSolanaScanning() {
        try {
            console.log('🔌 Starting Solana token scanning...');
            const raydiumProgramId = new web3_js_1.PublicKey(NETWORK_CONFIGS.SOL.raydiumProgram);
            const subscriptionId = this.solanaConnection.onProgramAccountChange(raydiumProgramId, async (info) => {
                try {
                    const poolAddress = info.accountId.toBase58();
                    await this.processSolanaPool(poolAddress);
                }
                catch (error) {
                    console.error('Error processing Solana pool:', error);
                }
            }, 'confirmed');
            this.subscriptions.set('SOL', subscriptionId);
        }
        catch (error) {
            console.error('Failed to start Solana scanning:', error);
            this.onError(error);
        }
    }
    // Process new token from EVM chains
    async processNewToken(network, tokenAddress, pairAddress) {
        try {
            // Get token data from DexScreener
            const tokenData = await this.getTokenDataFromDexScreener(network, tokenAddress);
            if (!tokenData) {
                return;
            }
            // Validate token
            if (await this.validateToken(tokenData)) {
                const enrichedToken = {
                    ...tokenData,
                    network,
                    pairAddress,
                    timestamp: Date.now()
                };
                console.log(`🎯 Valid token detected on ${network}:`, tokenData.symbol);
                this.onTokenDetected(enrichedToken);
            }
        }
        catch (error) {
            console.error(`Error processing ${network} token:`, error);
        }
    }
    // Process Solana pool
    async processSolanaPool(poolAddress) {
        try {
            const tokenData = await this.getSolanaTokenData(poolAddress);
            if (!tokenData) {
                return;
            }
            // Validate token
            if (await this.validateToken(tokenData)) {
                const enrichedToken = {
                    ...tokenData,
                    network: 'SOL',
                    pairAddress: poolAddress,
                    timestamp: Date.now()
                };
                console.log('🎯 Valid Solana token detected:', tokenData.symbol);
                this.onTokenDetected(enrichedToken);
            }
        }
        catch (error) {
            console.error('Error processing Solana pool:', error);
        }
    }
    // Get token data from DexScreener
    async getTokenDataFromDexScreener(network, tokenAddress) {
        try {
            const response = await (0, node_fetch_1.default)(`${NETWORK_CONFIGS[network].dexScreenerBase}${tokenAddress}`);
            const data = await response.json();
            if (!data.pairs || data.pairs.length === 0) {
                return null;
            }
            // Get the most liquid pair
            const pair = data.pairs[0];
            return {
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
                dexScreenerUrl: `https://dexscreener.com/${network.toLowerCase()}/${tokenAddress}`,
                timestamp: Date.now()
            };
        }
        catch (error) {
            console.error(`Error fetching ${network} token data:`, error);
            return null;
        }
    }
    // Get Solana token data
    async getSolanaTokenData(poolAddress) {
        try {
            const response = await (0, node_fetch_1.default)(`${NETWORK_CONFIGS.SOL.dexScreenerBase}${poolAddress}`);
            const data = await response.json();
            if (!data.pair) {
                return null;
            }
            const pair = data.pair;
            return {
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
                dexScreenerUrl: `https://dexscreener.com/solana/${pair.baseToken.address}`,
                timestamp: Date.now()
            };
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
    // Format age
    formatAge(createdAtMs) {
        const diff = Math.floor((Date.now() - createdAtMs) / 1000);
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
    // Get current validation criteria
    getValidationCriteria() {
        return { ...this.validationCriteria };
    }
    // Check if scanner is running
    isScanning() {
        return this.isRunning;
    }
}
exports.EnhancedTokenScanner = EnhancedTokenScanner;
