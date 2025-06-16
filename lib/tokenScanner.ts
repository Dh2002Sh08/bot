import { Connection, PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import fetch from "node-fetch";

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
} as const;

// Factory addresses
const FACTORY_ADDRESSES = {
    SOL: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), // Raydium
    ETH: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Uniswap V2
    BSC: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"  // PancakeSwap
};

// Event signatures for EVM chains
// const PAIR_CREATED_EVENT = "PairCreated(address,address,address,uint256)";
interface TokenInfo {
    network: 'SOL' | 'ETH' | 'BSC';
    mint: string;
    name: string;
    symbol: string;
    price?: string;
    liquidity?: string;
    age?: string;
    links: {
        explorer: string;
        dexscreener?: string;
        birdeye?: string;
    };
}

interface DexScreenerResponse {
    pair?: {
        baseToken: {
            address: string;
            name: string;
            symbol: string;
        };
        priceUsd: string;
        liquidity: {
            usd: string;
        };
        pairCreatedAt: number;
    };
}

class TokenScanner {
    private tokenList: TokenInfo[] = [];
    private isRunning: boolean = false;
    private providers: {
        SOL: Connection;
        ETH: ethers.JsonRpcProvider;
        BSC: ethers.JsonRpcProvider;
    };
    private listenerId: number | null = null;

    constructor() {
        this.providers = {
            SOL: new Connection(NETWORK_CONFIGS.SOL.rpc),
            ETH: new ethers.JsonRpcProvider(NETWORK_CONFIGS.ETH.rpc),
            BSC: new ethers.JsonRpcProvider(NETWORK_CONFIGS.BSC.rpc)
        };
    }

    async startScanning() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Start Solana listener
        this.startSolanaListener();
        
        // Start EVM listeners
        this.startEvmListener('ETH');
        this.startEvmListener('BSC');
    }

    private startSolanaListener() {
        this.listenerId = this.providers.SOL.onProgramAccountChange(
            FACTORY_ADDRESSES.SOL,
            async (info) => {
                const pool = info.accountId.toBase58();
                const enriched = await this.enrichSolanaToken(pool);
                if (enriched) {
                    this.tokenList.unshift(enriched);
                    if (this.tokenList.length > 50) this.tokenList.pop();
                }
            },
            "confirmed"
        );
    }

    private startEvmListener(network: 'ETH' | 'BSC') {
        const provider = this.providers[network];
        const factory = new ethers.Contract(
            FACTORY_ADDRESSES[network],
            ['event PairCreated(address indexed token0, address indexed token1, address pair, uint)'],
            provider
        );

        factory.on("PairCreated", async (token0, token1, pairAddress) => {
            const enriched = await this.enrichEvmToken(network, pairAddress);
            if (enriched) {
                this.tokenList.unshift(enriched);
                if (this.tokenList.length > 50) this.tokenList.pop();
            }
        });
    }

    private async enrichSolanaToken(poolAddress: string): Promise<TokenInfo | null> {
        try {
            const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`);
            const data = await res.json() as DexScreenerResponse;

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
        } catch (err) {
            console.error("Error enriching Solana token:", err);
        }
        return null;
    }

    private async enrichEvmToken(network: 'ETH' | 'BSC', pairAddress: string): Promise<TokenInfo | null> {
        try {
            const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${network.toLowerCase()}/${pairAddress}`);
            const data = await res.json() as DexScreenerResponse;

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
        } catch (err) {
            console.error(`Error enriching ${network} token:`, err);
        }
        return null;
    }

    private formatAge(createdAtMs: number): string {
        const diff = Math.floor((Date.now() - createdAtMs) / 1000);
        const days = Math.floor(diff / (3600 * 24));
        const hours = Math.floor((diff % (3600 * 24)) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;

        let result = "";
        if (days > 0) result += `${days}d `;
        if (hours > 0) result += `${hours}h `;
        if (minutes > 0) result += `${minutes}m `;
        if (seconds > 0 || result === "") result += `${seconds}s`;

        return result.trim();
    }

    getTokenList(): TokenInfo[] {
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

export const tokenScanner = new TokenScanner(); 