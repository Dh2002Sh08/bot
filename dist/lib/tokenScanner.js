"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenScanner = void 0;
const web3_js_1 = require("@solana/web3.js");
const ethers_1 = require("ethers");
const node_fetch_1 = __importDefault(require("node-fetch"));
// Network configurations
const NETWORK_CONFIGS = {
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
// Factory addresses
const FACTORY_ADDRESSES = {
    SOL: new web3_js_1.PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), // Raydium
    ETH: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Uniswap V2
    BSC: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" // PancakeSwap
};
class TokenScanner {
    constructor() {
        this.tokenList = [];
        this.isRunning = false;
        this.listenerId = null;
        this.providers = {
            SOL: new web3_js_1.Connection(NETWORK_CONFIGS.SOL.rpc),
            ETH: new ethers_1.ethers.JsonRpcProvider(NETWORK_CONFIGS.ETH.rpc),
            BSC: new ethers_1.ethers.JsonRpcProvider(NETWORK_CONFIGS.BSC.rpc)
        };
    }
    async startScanning() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        // Start Solana listener
        this.startSolanaListener();
        // Start EVM listeners
        this.startEvmListener('ETH');
        this.startEvmListener('BSC');
    }
    startSolanaListener() {
        this.listenerId = this.providers.SOL.onProgramAccountChange(FACTORY_ADDRESSES.SOL, async (info) => {
            const pool = info.accountId.toBase58();
            const enriched = await this.enrichSolanaToken(pool);
            if (enriched) {
                this.tokenList.unshift(enriched);
                if (this.tokenList.length > 50)
                    this.tokenList.pop();
            }
        }, "confirmed");
    }
    startEvmListener(network) {
        const provider = this.providers[network];
        const factory = new ethers_1.ethers.Contract(FACTORY_ADDRESSES[network], ['event PairCreated(address indexed token0, address indexed token1, address pair, uint)'], provider);
        factory.on("PairCreated", async (token0, token1, pairAddress) => {
            const enriched = await this.enrichEvmToken(network, pairAddress);
            if (enriched) {
                this.tokenList.unshift(enriched);
                if (this.tokenList.length > 50)
                    this.tokenList.pop();
            }
        });
    }
    async enrichSolanaToken(poolAddress) {
        try {
            const res = await (0, node_fetch_1.default)(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`);
            const data = await res.json();
            if (data?.pair) {
                const pair = data.pair;
                const mintAddress = pair.baseToken.address;
                return {
                    network: 'SOL',
                    mint: mintAddress,
                    name: pair.baseToken.name,
                    symbol: pair.baseToken.symbol,
                    price: pair.priceUsd,
                    liquidity: pair.liquidity.usd,
                    age: this.formatAge(pair.pairCreatedAt),
                    links: {
                        explorer: `https://solscan.io/token/${mintAddress}`,
                        dexscreener: `https://dexscreener.com/solana/${mintAddress}`,
                        birdeye: `https://birdeye.so/token/${mintAddress}?chain=solana`
                    }
                };
            }
        }
        catch (err) {
            console.error("Error enriching Solana token:", err);
        }
        return null;
    }
    async enrichEvmToken(network, pairAddress) {
        try {
            const res = await (0, node_fetch_1.default)(`https://api.dexscreener.com/latest/dex/pairs/${network.toLowerCase()}/${pairAddress}`);
            const data = await res.json();
            if (data?.pair) {
                const pair = data.pair;
                const tokenAddress = pair.baseToken.address;
                return {
                    network,
                    mint: tokenAddress,
                    name: pair.baseToken.name,
                    symbol: pair.baseToken.symbol,
                    price: pair.priceUsd,
                    liquidity: pair.liquidity.usd,
                    age: this.formatAge(pair.pairCreatedAt),
                    links: {
                        explorer: `${NETWORK_CONFIGS[network].explorer}token/${tokenAddress}`,
                        dexscreener: `https://dexscreener.com/${network.toLowerCase()}/${tokenAddress}`
                    }
                };
            }
        }
        catch (err) {
            console.error(`Error enriching ${network} token:`, err);
        }
        return null;
    }
    formatAge(createdAtMs) {
        const diff = Math.floor((Date.now() - createdAtMs) / 1000);
        const days = Math.floor(diff / (3600 * 24));
        const hours = Math.floor((diff % (3600 * 24)) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;
        let result = "";
        if (days > 0)
            result += `${days}d `;
        if (hours > 0)
            result += `${hours}h `;
        if (minutes > 0)
            result += `${minutes}m `;
        if (seconds > 0 || result === "")
            result += `${seconds}s`;
        return result.trim();
    }
    getTokenList() {
        return this.tokenList;
    }
    stopScanning() {
        this.isRunning = false;
        // Clean up listeners
        if (this.listenerId !== null) {
            this.providers.SOL.removeProgramAccountChangeListener(this.listenerId);
        }
        this.providers.ETH.removeAllListeners();
        this.providers.BSC.removeAllListeners();
    }
}
exports.tokenScanner = new TokenScanner();
