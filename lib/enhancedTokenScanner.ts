import { Web3 } from 'web3';
import { Connection, PublicKey } from '@solana/web3.js';
import { ShyftSdk, Network } from '@shyft-to/js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Token validation criteria interface
export interface TokenValidationCriteria {
    minLiquidity: number;
    minVolume: number;
    maxAge?: number; // in seconds
    requireDexScreener: boolean;
}

// Token data interface
export interface TokenData {
    address: string;
    symbol: string;
    name: string;
    network: 'ETH' | 'BSC' | 'SOL';
    price: number;
    liquidity: number;
    volume24h: number;
    age: string;
    ageSeconds: number;
    pairAddress: string;
    dexScreenerUrl: string;
    timestamp: number;
    scannerCriteria: TokenValidationCriteria;
}

// Interface for decoded event data
interface DecodedPairCreated {
    token0: string;
    token1: string;
    pair: string;
}

// Interface for DexScreener response
interface DexScreenerResponse {
    pairs?: Array<{
        baseToken: {
            symbol: string;
            name: string;
            address: string;
        };
        priceUsd: string;
        liquidity: {
            usd: string;
        };
        volume: {
            h24: string;
        };
        pairCreatedAt: number;
        pairAddress: string;
    }>;
    pair?: {
        baseToken: {
            symbol: string;
            name: string;
            address: string;
        };
        priceUsd: string;
        liquidity: {
            usd: string;
        };
        volume: {
            h24: string;
        };
        pairCreatedAt: number;
    };
}

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

export class EnhancedTokenScanner {
    private web3Instances: Map<'ETH' | 'BSC', Web3> = new Map();
    private solanaConnection: Connection | null = null;
    private subscriptions: Map<string, any> = new Map();
    private isRunning: boolean = false;
    private validationCriteria: TokenValidationCriteria;
    private onTokenDetected: (token: TokenData) => void;
    private onError: (error: Error) => void;
    private tokenList: any[] = []; // In-memory store for recent pools (copied from solTokenScan.js)
    private activeNetworks: Set<'ETH' | 'BSC' | 'SOL'> = new Set();

    constructor(
        validationCriteria: TokenValidationCriteria,
        onTokenDetected: (token: TokenData) => void,
        onError: (error: Error) => void
    ) {
        this.validationCriteria = validationCriteria;
        this.onTokenDetected = onTokenDetected;
        this.onError = onError;
    }

    // Initialize connections (using exact logic from working scans)
    async initialize() {
        try {
            console.log('🔍 Initializing Enhanced Token Scanner...');

            // Initialize Web3 instances for ETH and BSC (copied from ethTokenScan.js and bscTokenScan.js)
            const ethWeb3 = new Web3(NETWORK_CONFIGS.ETH.wsProvider);
            const bscWeb3 = new Web3(NETWORK_CONFIGS.BSC.wsProvider);

            // Test connections (copied from working scans)
            await ethWeb3.eth.net.isListening();
            await bscWeb3.eth.net.isListening();

            this.web3Instances.set('ETH', ethWeb3);
            this.web3Instances.set('BSC', bscWeb3);

            // Initialize Solana connection (copied from solTokenScan.js)
            try {
                console.log('🔌 Connecting to Shyft Solana WebSocket...');
                this.solanaConnection = new Connection(NETWORK_CONFIGS.SOL.wsProvider, 'confirmed');
                const version = await this.solanaConnection.getVersion();
                console.log('✅ Connected to Shyft node, version:', version['solana-core']);
            } catch (shyftErr) {
                console.error('⚠️ Shyft WebSocket connection failed:', shyftErr);
                console.log('🔌 Falling back to public Solana WebSocket...');
                this.solanaConnection = new Connection(NETWORK_CONFIGS.SOL.fallbackProvider, 'confirmed');
                const version = await this.solanaConnection.getVersion();
                console.log('✅ Connected to fallback node, version:', version['solana-core']);
            }

            console.log('✅ Enhanced Token Scanner initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Enhanced Token Scanner:', error);
            throw error;
        }
    }

    // Start scanning for specific networks only
    async startScanning(networks: ('ETH' | 'BSC' | 'SOL')[] = []) {
        if (this.isRunning) {
            console.log('⚠️ Token scanner is already running');
            return;
        }

        this.isRunning = true;
        this.activeNetworks = new Set(networks);
        
        console.log('🚀 Starting Enhanced Token Scanner...');
        console.log(`📡 Active networks: ${networks.length > 0 ? networks.join(', ') : 'None'}`);

        // Start scanning for each specified network
        for (const network of networks) {
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
    }

    // Add networks to scan (for when users add wallets)
    async addNetworks(networks: ('ETH' | 'BSC' | 'SOL')[]) {
        for (const network of networks) {
            if (!this.activeNetworks.has(network)) {
                this.activeNetworks.add(network);
                console.log(`➕ Added ${network} to scanning networks`);
                
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
        }
    }

    // Remove networks from scan (for when users remove wallets)
    async removeNetworks(networks: ('ETH' | 'BSC' | 'SOL')[]) {
        for (const network of networks) {
            if (this.activeNetworks.has(network)) {
                this.activeNetworks.delete(network);
                console.log(`➖ Removed ${network} from scanning networks`);
                
                // Stop scanning for this network
                const subscription = this.subscriptions.get(network);
                if (subscription) {
                    try {
                        if (network === 'SOL') {
                            this.solanaConnection?.removeProgramAccountChangeListener(subscription);
                        } else {
                            await subscription.unsubscribe();
                        }
                        this.subscriptions.delete(network);
                    } catch (error) {
                        console.error(`Error unsubscribing from ${network}:`, error);
                    }
                }
            }
        }
    }

    // Stop scanning
    async stopScanning() {
        this.isRunning = false;
        this.activeNetworks.clear();
        
        // Unsubscribe from all subscriptions
        for (const [network, subscription] of this.subscriptions) {
            try {
                if (network === 'SOL') {
                    this.solanaConnection?.removeProgramAccountChangeListener(subscription);
                } else {
                    await subscription.unsubscribe();
                }
            } catch (error) {
                console.error(`Error unsubscribing from ${network}:`, error);
            }
        }
        
        this.subscriptions.clear();
        console.log('🛑 Enhanced Token Scanner stopped');
    }

    // Update validation criteria
    updateValidationCriteria(criteria: Partial<TokenValidationCriteria>) {
        this.validationCriteria = { ...this.validationCriteria, ...criteria };
        console.log('📊 Updated validation criteria:', this.validationCriteria);
    }

    // ETH Scanning (exact logic from ethTokenScan.js)
    private async startEthScanning() {
        try {
            const web3 = this.web3Instances.get('ETH')!;
            const factoryContract = new web3.eth.Contract(UNISWAP_FACTORY_ABI, NETWORK_CONFIGS.ETH.factory);
            const eventSignature = web3.eth.abi.encodeEventSignature('PairCreated(address,address,address,uint256)');

            console.log('🔌 Subscribing to new Uniswap V2 pairs...');

            // Verify WebSocket connection (copied from ethTokenScan.js)
            web3.eth.net.isListening()
                .then(() => console.log('✅ WebSocket provider connected'))
                .catch(err => console.error('❌ WebSocket provider connection failed:', err));

            // Subscribe to logs for real-time events (copied from ethTokenScan.js)
            const subscription = await web3.eth.subscribe('logs', {
                address: NETWORK_CONFIGS.ETH.factory,
                topics: [eventSignature]
            });

            this.subscriptions.set('ETH', subscription);

            // Handle subscription events (copied from ethTokenScan.js)
            subscription.on('data', async (log) => {
                try {
                    const decoded = web3.eth.abi.decodeLog(
                        UNISWAP_FACTORY_ABI[0].inputs,
                        log.data,
                        log.topics.slice(1)
                    ) as unknown as DecodedPairCreated;

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
                } catch (err) {
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

        } catch (err) {
            console.error('❌ ETH Initialization error:', err);
            this.onError(err as Error);
        }
    }

    // BSC Scanning (exact logic from bscTokenScan.js)
    private async startBscScanning() {
        try {
            const web3 = this.web3Instances.get('BSC')!;
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
                    const decoded = web3.eth.abi.decodeLog(
                        PANCAKESWAP_FACTORY_ABI[0].inputs,
                        log.data,
                        log.topics.slice(1)
                    ) as unknown as DecodedPairCreated;

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
                } catch (err) {
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

        } catch (err) {
            console.error('❌ BSC Initialization error:', err);
            this.onError(err as Error);
        }
    }

    // Solana Scanning (exact logic from solTokenScan.js)
    private async startSolanaScanning() {
        try {
            console.log('🔌 Subscribing to Raydium pool creation events...');

            const raydiumProgramId = new PublicKey(NETWORK_CONFIGS.SOL.raydiumProgram);

            // Subscribe to account changes for Raydium program (copied from solTokenScan.js)
            const subscriptionId = this.solanaConnection!.onProgramAccountChange(
                raydiumProgramId,
                async (info) => {
                    try {
                        const poolAddress = info.accountId.toBase58();
                        const enriched = await this.enrichToken(poolAddress);
                        if (enriched) {
                            this.tokenList.unshift(enriched);
                            if (this.tokenList.length > 50) this.tokenList.pop(); // Limit to 50 pools
                            console.log('🆕 New Raydium Pool Detected!');
                            console.log('Pool Address:', poolAddress);
                            console.log('Timestamp:', new Date().toISOString());
                            console.log('Enriched Pool Data:', enriched);

                            // Process the detected token
                            await this.processSolanaPool(poolAddress, enriched);
                        } else {
                            console.log('Invalid pool detected');
                        }
                    } catch (err) {
                        console.log('Invalid pool detected');
                    }
                },
                'confirmed'
            );

            this.subscriptions.set('SOL', subscriptionId);
            console.log('✅ Solana Subscription active, ID:', subscriptionId);

        } catch (err) {
            console.error('❌ Solana Initialization error:', err);
            this.onError(err as Error);
        }
    }

    // Process new token from EVM chains
    private async processNewToken(network: 'ETH' | 'BSC', tokenAddress: string, pairAddress: string) {
        try {
            // Get token data from DexScreener
            const tokenData = await this.getTokenDataFromDexScreener(network, tokenAddress);
            
            if (!tokenData) {
                return;
            }

            const enrichedToken: TokenData = {
                ...tokenData,
                network,
                pairAddress,
                timestamp: Date.now(),
                scannerCriteria: this.validationCriteria // Pass the scanner's criteria
            };

            console.log(`🎯 Token detected on ${network}:`, tokenData.symbol);
            console.log(`Calling onTokenDetected for ${network} with token: ${tokenData.symbol} and address: ${tokenData.address}`);
            this.onTokenDetected(enrichedToken);

        } catch (error) {
            console.error(`Error processing ${network} token:`, error);
        }
    }

    // Process Solana pool (using enriched data from solTokenScan.js)
    private async processSolanaPool(poolAddress: string, enrichedData?: any) {
        try {
            let tokenData: TokenData | null = null;

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
                    dexScreenerUrl: enrichedData.dexscreener,
                    timestamp: Date.now(),
                    scannerCriteria: this.validationCriteria
                };
            } else {
                // Fallback to DexScreener API
                tokenData = await this.getSolanaTokenData(poolAddress);
            }
            
            if (!tokenData) {
                return;
            }

            // Validate token
            if (await this.validateToken(tokenData)) {
                const enrichedToken: TokenData = {
                    ...tokenData,
                    network: 'SOL',
                    pairAddress: poolAddress,
                    timestamp: Date.now(),
                    scannerCriteria: this.validationCriteria
                };

                console.log('🎯 Valid Solana token detected:', tokenData.symbol);
                console.log(`Calling onTokenDetected for SOL with token: ${tokenData.symbol} and address: ${tokenData.address}`);
                this.onTokenDetected(enrichedToken);
            }

        } catch (error) {
            console.error('Error processing Solana pool:', error);
        }
    }

    // Enrich token function (exact copy from solTokenScan.js)
    private async enrichToken(poolAddress: string) {
        try {
            const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`);
            const text = await res.text();

            let data;
            try {
                data = JSON.parse(text);
            } catch {
                return null;
            }

            const mintAddress = data?.pair?.baseToken?.address;

            if (data && data.pair) {
                const pair = data.pair;
                return {
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
            }
            return null;
        } catch (error) {
            console.error(`Error enriching Solana token:`, error);
            return null;
        }
    }

    // Get token data from DexScreener (for ETH/BSC)
    private async getTokenDataFromDexScreener(network: 'ETH' | 'BSC', tokenAddress: string): Promise<TokenData | null> {
        try {
            const response = await fetch(`${NETWORK_CONFIGS[network].dexScreenerBase}${tokenAddress}`);
            const data = await response.json() as DexScreenerResponse;

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
                dexScreenerUrl: `https://dexscreener.com/${network.toLowerCase()}/pair/${pair.pairAddress}`,
                timestamp: Date.now(),
                scannerCriteria: this.validationCriteria
            };

        } catch (error) {
            console.error(`Error fetching ${network} token data:`, error);
            return null;
        }
    }

    // Get Solana token data (fallback for processSolanaPool if enrichedData is not provided)
    private async getSolanaTokenData(poolAddress: string): Promise<TokenData | null> {
        try {
            const response = await fetch(`${NETWORK_CONFIGS.SOL.dexScreenerBase}${poolAddress}`);
            const data = await response.json() as DexScreenerResponse;

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
                timestamp: Date.now(),
                scannerCriteria: this.validationCriteria
            };

        } catch (error) {
            console.error('Error fetching Solana token data:', error);
            return null;
        }
    }

    // Validate token based on criteria
    public async validateToken(tokenData: TokenData): Promise<boolean> {
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

        } catch (error) {
            console.error('Error validating token:', error);
            return false;
        }
    }

    // Format age utility (re-added)
    private formatAge(createdAtMs: number): string {
        const diff = Math.floor((Date.now() - createdAtMs) / 1000); // total seconds
        const days = Math.floor(diff / (3600 * 24));
        const hours = Math.floor((diff % (3600 * 24)) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;

        let result = '';
        if (days > 0) result += `${days}d `;
        if (hours > 0) result += `${hours}h `;
        if (minutes > 0) result += `${minutes}m `;
        if (seconds > 0 || result === '') result += `${seconds}s`;

        return result.trim();
    }

    isScanning(): boolean {
        return this.isRunning;
    }

    getActiveNetworks(): Set<'ETH' | 'BSC' | 'SOL'> {
        return this.activeNetworks;
    }
}