// sniperBot.ts - Enhanced Telegram Sniper Bot

import { ethers, TransactionResponse } from 'ethers';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, ParsedAccountData } from '@solana/web3.js';
import { Liquidity, LiquidityPoolInfo, Token, TokenAmount, Percent, CurrencyAmount } from '@raydium-io/raydium-sdk';
import { deserializeMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { WSOL_ADDRESS } from './constants';
// Removed SNIPER_BOT_ABI, SNIPER_BOT_ADDRESS, BSC_SNIPER_BOT_ADDRESS if not used internally by SniperBot class
import dotenv from 'dotenv';
import { UNISWAP_ROUTER_ABI } from '../Address/uniswapRouterABI';
import { PANCAKESWAP_ROUTER_ABI } from '../Address/pancakeswapRouterABI';
import { tokenScanner } from './tokenScanner';
// Removed Telegraf, Markup, Scenes, session, message imports
import { RaydiumSwap } from './raydiumSwap';
import { VersionedTransaction } from '@solana/web3.js';

dotenv.config();

// Network-specific configurations (kept as they are core to sniping logic)
export const NETWORK_CONFIGS = {
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

// --- STATE (Now entirely within SniperBot class) ---

export interface SniperBotConfig {
    // These configs are general and passed to SniperBot's constructor
    amount: number;
    slippage: number;
    stopLoss: number;
    takeProfit: number;
    onLog: (msg: string, userId: number, messageId?: number, deleteMessage?: boolean) => Promise<number>;
    onError: (error: Error, userId: number) => Promise<void>;
}

interface TokenPosition {
    tokenAddress: string;
    amount: bigint;
    entryPrice: bigint;
    stopLoss: number;
    takeProfit: number;
    network: 'ETH' | 'BSC' | 'SOL';
}

interface JupiterPriceResponse {
    data: {
        [key: string]: {
            price: number;
        };
    };
}

interface BirdeyePriceResponse {
    success: boolean;
    data: {
        value: number;
    };
}

export class SniperBot {
    private isRunning: boolean = false;
    private stopFlag: boolean = false;
    private positions: Map<string, TokenPosition> = new Map();
    private userWallets: Map<number, Map<'ETH' | 'BSC' | 'SOL', any>> = new Map();
    private monitoringIntervals: Map<number, NodeJS.Timeout> = new Map(); // Track intervals per user
    private botConfig: SniperBotConfig;
    private userConfigs: Map<number, SniperBotConfig> = new Map(); // Store user-specific configs
    private balanceUpdateIntervals: Map<number, NodeJS.Timeout> = new Map();
    private lastBalanceMessages: Map<number, number> = new Map();

    constructor(config: SniperBotConfig) {
        this.botConfig = config;
    }

    // Add public getter methods for callbacks
    getErrorCallback() {
        return this.botConfig.onError;
    }

    getLogCallback() {
        return this.botConfig.onLog;
    }

    // Add user configuration methods
    updateUserConfig(userId: number, config: SniperBotConfig) {
        this.userConfigs.set(userId, config);
    }

    getUserConfig(userId: number): SniperBotConfig | undefined {
        return this.userConfigs.get(userId);
    }

    // --- Wallet Management ---
    private async updateWalletBalances(userId: number, network?: 'ETH' | 'BSC' | 'SOL') {
        try {
            const balances = [];
            const networks = network ? [network] : ['ETH', 'BSC', 'SOL'] as const;
            
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
                    } catch (error) {
                        console.error('Error deleting previous balance message:', error);
                    }
                }

                // Send new balance message and store its ID
                const newMessageId = await this.botConfig.onLog(message, userId);
                this.lastBalanceMessages.set(userId, newMessageId);
            }
        } catch (error) {
            console.error('Error updating wallet balances:', error);
        }
    }

    setUserWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL', privateKey: string) {
        if (!this.userWallets.has(userId)) {
            this.userWallets.set(userId, new Map());
        }

        if (network === 'SOL') {
            // For Solana, create a keypair from the stored secret key
            const secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
            const keypair = Keypair.fromSecretKey(secretKey);
            const provider = new Connection(NETWORK_CONFIGS[network].rpc);
            // Create a custom wallet object for Solana
            const solWallet = {
                address: keypair.publicKey.toString(),
                privateKey: privateKey,
                provider: provider,
                keypair: keypair
            };
            this.userWallets.get(userId)?.set(network, solWallet);
        } else {
            // For EVM chains, use ethers wallet
            const provider = new ethers.JsonRpcProvider(NETWORK_CONFIGS[network].rpc);
            this.userWallets.get(userId)?.set(network, new ethers.Wallet(privateKey, provider));
        }

        // Initial balance update
        this.updateWalletBalances(userId, network);
    }

    getUserWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL'): any {
        return this.userWallets.get(userId)?.get(network);
    }

    hasUserWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL'): boolean {
        return this.userWallets.has(userId) && this.userWallets.get(userId)!.has(network);
    }

    // Add removeUserWallet method
    removeUserWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL') {
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
    private detectNetworkFromAddress(tokenAddress: string): 'ETH' | 'BSC' | 'SOL' | null {
        // These are simple heuristic checks, a real implementation might use more robust methods.
        if (tokenAddress.startsWith('0x') && tokenAddress.length === 42) return 'ETH';
        if (tokenAddress.length === 44) return 'SOL';
        return null; // Could also return 'BSC' if specific BSC address patterns are known
    }

    async getWalletBalance(userId: number, network: 'ETH' | 'BSC' | 'SOL'): Promise<string> {
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
            } else {
                const provider = wallet.provider;
                if (!provider) return `No provider for ${network}.`;
                balance = await provider.getBalance(wallet.address);
                return `${ethers.formatEther(balance)} ${network === 'ETH' ? 'ETH' : 'BNB'}`;
            }
        } catch (error) {
            return `Error getting ${network} balance: ${(error as Error).message}`;
        }
    }

    // --- SNIPE FUNCTIONS ---
    private async snipeEvmToken(userId: number, network: 'ETH' | 'BSC', tokenAddress: string, amount: number, slippage: number): Promise<TransactionResponse> {
        const wallet = this.getUserWallet(userId, network);
        if (!wallet) {
            throw new Error(`No wallet configured for ${network} for this user.`);
        }

        const provider = wallet.provider;
        const networkConfig = NETWORK_CONFIGS[network];
        const routerAddress = networkConfig.router;
        const weth = networkConfig.weth;
        const abi = network === 'ETH' ? UNISWAP_ROUTER_ABI : PANCAKESWAP_ROUTER_ABI;

        const router = new ethers.Contract(routerAddress, abi, provider);

        const path = [weth, tokenAddress];
        const amountIn = ethers.parseEther(amount.toString());
        const amounts = await (router as ethers.Contract & { getAmountsOut: Function }).getAmountsOut(amountIn, path);
        const minOut = amounts[1] * BigInt(100 - slippage) / BigInt(100);

        const tx = await (router.connect(wallet) as ethers.Contract & { swapExactETHForTokens: Function }).swapExactETHForTokens(
            minOut,
            path,
            wallet.address,
            Math.floor(Date.now() / 1000) + 60 * 20,
            { value: amountIn }
        );

        await tx.wait();
        return tx;
    }

    // --- AUTO SCAN FUNCTION ---
    async startBackgroundMonitoring(userId: number) {
        if (this.monitoringIntervals.has(userId)) {
            this.botConfig.onLog('Sniper Bot is already running in background for this user.', userId);
            return;
        }

        // Get user's configuration
        const config = this.userConfigs.get(userId) || this.botConfig;

        // Check wallet balances
        let hasEnoughFunds = false;
        for (const network of ['ETH', 'BSC', 'SOL'] as const) {
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

        // Start token scanner
        await tokenScanner.startScanning();

        const interval = setInterval(async () => {
            try {
                // Check for new tokens
                const tokens = tokenScanner.getTokenList();
                if (tokens.length > 0) {
                    this.botConfig.onLog(`🔍 Found ${tokens.length} potential tokens.`, userId);
                }

                for (const token of tokens) {
                    if (this.hasUserWallet(userId, token.network)) {
                        try {
                            // Validate token before attempting to buy
                            if (await this.validateToken(token.mint, token.network)) {
                                this.botConfig.onLog(`Attempting to snipe ${token.name} (${token.mint}) on ${token.network}...`, userId);
                                if (token.network === 'SOL') {
                                    const wallet = this.getUserWallet(userId, token.network);
                                    await this.executeSolSnipe(wallet, token.mint, config.amount, config.slippage);
                                } else {
                                    await this.snipeEvmToken(userId, token.network, token.mint, config.amount, config.slippage);
                                }
                                this.botConfig.onLog(`🎯 Successfully sniped ${token.name} on ${token.network}.`, userId);
                            } else {
                                this.botConfig.onLog(`⚠️ Token ${token.mint} on ${token.network} failed validation.`, userId);
                            }
                        } catch (error) {
                            this.botConfig.onLog(`❌ Failed to snipe ${token.mint} on ${token.network}: ${(error as Error).message}`, userId);
                            this.botConfig.onError(error as Error, userId);
                        }
                    }
                }
            } catch (error) {
                this.botConfig.onError(error as Error, userId);
            }
        }, 15000);

        this.monitoringIntervals.set(userId, interval);
    }

    stopBackgroundMonitoring(userId: number) {
        const interval = this.monitoringIntervals.get(userId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(userId);
            tokenScanner.stopScanning();
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
    private async executeSolSnipe(wallet: any, tokenAddress: string, amount: number, slippage: number): Promise<string> {
        try {
            const raydiumSwap = new RaydiumSwap(NETWORK_CONFIGS.SOL.rpc, wallet.privateKey);
            await raydiumSwap.loadPoolKeys();

            // Find pool info
            const poolKeys = await raydiumSwap.findRaydiumPoolInfo(WSOL_ADDRESS, tokenAddress);
            if (!poolKeys) {
                throw new Error('Pool not found for token');
            }

            // Get swap transaction
            const swapTx = await raydiumSwap.getSwapTransaction(
                tokenAddress,
                amount,
                poolKeys,
                true, // use versioned transaction
                slippage
            );

            // Send transaction
            if (swapTx instanceof VersionedTransaction) {
                const { blockhash, lastValidBlockHeight } = await raydiumSwap.connection.getLatestBlockhash();
                return await raydiumSwap.sendVersionedTransaction(swapTx, blockhash, lastValidBlockHeight);
            } else {
                return await raydiumSwap.sendLegacyTransaction(swapTx as Transaction);
            }
        } catch (error) {
            throw error;
        }
    }

    // --- DUMMY AI & API MOCK ---
    private async fetchPotentialTokens(userId: number): Promise<string[]> {
        // Replace with real API or AI model
        return [
            // '0x123FakeEthToken...',
            // '0x456FakeBscToken...'
        ];
    }

    private async getTokenPrice(tokenAddress: string, network: 'ETH' | 'BSC'): Promise<bigint> {
        const config = NETWORK_CONFIGS[network];
        const provider = new ethers.JsonRpcProvider(config.rpc);
        const abi = network === 'ETH' ? UNISWAP_ROUTER_ABI : PANCAKESWAP_ROUTER_ABI;
        const router = new ethers.Contract(config.router, abi, provider);
        const path = [config.weth, tokenAddress];
        const amounts = await (router as ethers.Contract & { getAmountsOut: Function }).getAmountsOut(ethers.parseEther('1'), path);
        return amounts[1];
    }

    private async sellToken(userId: number, tokenAddress: string, position: TokenPosition) {
        if (position.network !== 'ETH' && position.network !== 'BSC') return; // Only EVM
        const networkConfig = NETWORK_CONFIGS[position.network];
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const abi = position.network === 'ETH' ? UNISWAP_ROUTER_ABI : PANCAKESWAP_ROUTER_ABI;
        const router = new ethers.Contract(networkConfig.router, abi, provider);

        const wallet = this.getUserWallet(userId, position.network);
        if (!wallet) {
            this.botConfig.onLog(`⚠️ No ${position.network} wallet found for selling.`, userId);
            return;
        }

        try {
            const path = [tokenAddress, networkConfig.weth];
            const tx = await (router.connect(wallet) as ethers.Contract & { swapExactTokensForETH: Function }).swapExactTokensForETH(
                position.amount,
                0, // Accept any amount of ETH
                path,
                wallet.address,
                Math.floor(Date.now() / 1000) + 60 * 20
            );
            await tx.wait();
            this.botConfig.onLog(`Sold ${tokenAddress} for wallet ${wallet.address}: ${networkConfig.explorer}${tx.hash}`, userId);
        } catch (error) {
            this.botConfig.onError(error as Error, userId);
        }
    }

    // Improve token detection
    private async detectNetworkByAddress(tokenAddress: string): Promise<'ETH' | 'BSC' | 'SOL' | null> {
        // Check ETH
        try {
            const ethProvider = new ethers.JsonRpcProvider(NETWORK_CONFIGS.ETH.rpc);
            const code = await ethProvider.getCode(tokenAddress);
            if (code !== '0x') {
                // Additional check for ETH token
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ['function name() view returns (string)', 'function symbol() view returns (string)'],
                    ethProvider
                );
                try {
                    const [name, symbol] = await Promise.all([
                        tokenContract.name(),
                        tokenContract.symbol()
                    ]);
                    return 'ETH';
                } catch (e) {
                    // If name/symbol calls fail, it might still be an ETH contract
                    return 'ETH';
                }
            }
        } catch (e) { /* console.error('ETH network detection error:', e); */ }

        // Check BSC
        try {
            const bscProvider = new ethers.JsonRpcProvider(NETWORK_CONFIGS.BSC.rpc);
            const code = await bscProvider.getCode(tokenAddress);
            if (code !== '0x') {
                // Additional check for BSC token
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ['function name() view returns (string)', 'function symbol() view returns (string)'],
                    bscProvider
                );
                try {
                    const [name, symbol] = await Promise.all([
                        tokenContract.name(),
                        tokenContract.symbol()
                    ]);
                    return 'BSC';
                } catch (e) {
                    // If name/symbol calls fail, it might still be a BSC contract
                    return 'BSC';
                }
            }
        } catch (e) { /* console.error('BSC network detection error:', e); */ }

        // Check SOL
        try {
            const connection = new Connection(NETWORK_CONFIGS.SOL.rpc);
            const account = await connection.getAccountInfo(new PublicKey(tokenAddress));
            if (account) {
                return 'SOL';
            }
        } catch (e) { /* console.error('SOL network detection error:', e); */ }

        return null;
    }

    private async validateToken(tokenAddress: string, network: 'ETH' | 'BSC' | 'SOL'): Promise<boolean> {
        try {
            if (network === 'SOL') {
                const connection = new Connection(NETWORK_CONFIGS.SOL.rpc);
                const account = await connection.getAccountInfo(new PublicKey(tokenAddress));
                return account !== null;
            } else {
                const provider = new ethers.JsonRpcProvider(NETWORK_CONFIGS[network].rpc);
                const code = await provider.getCode(tokenAddress);
                return code !== '0x';
            }
        } catch (error) {
            return false;
        }
    }

    async buyTokenFromUserInput(userId: number, tokenAddress: string) {
        const network = await this.detectNetworkByAddress(tokenAddress);
        if (!network) {
            throw new Error('Could not detect token network for the given address.');
        }

        // Get token info before proceeding
        let tokenName = 'Unknown';
        try {
            if (network === 'SOL') {
                const connection = new Connection(NETWORK_CONFIGS.SOL.rpc);
                const metadata = await connection.getAccountInfo(new PublicKey(tokenAddress));
                
                // Get token metadata from Metaplex
                try {
                    const metadataPDA = await PublicKey.findProgramAddressSync(
                        [
                            Buffer.from('metadata'),
                            new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
                            new PublicKey(tokenAddress).toBuffer(),
                        ],
                        new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
                    );
                    
                    const metadataAccount = await connection.getAccountInfo(metadataPDA[0]);
                    if (metadataAccount) {
                        try {
                            const metadata = deserializeMetadata(metadataAccount as any);
                            tokenName = metadata.name || 'Unknown';
                        } catch (e) {
                            // If deserialization fails, try to get basic token info
                            const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(tokenAddress));
                            if (tokenInfo.value && 'data' in tokenInfo.value && 'parsed' in tokenInfo.value.data) {
                                const parsedData = tokenInfo.value.data as ParsedAccountData;
                                if (parsedData.parsed && parsedData.parsed.info && parsedData.parsed.info.name) {
                                    tokenName = parsedData.parsed.info.name;
                                }
                            }
                        }
                    }
                } catch (e) {
                    // If metadata fetch fails, try to get basic token info
                    const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(tokenAddress));
                    if (tokenInfo.value && 'data' in tokenInfo.value && 'parsed' in tokenInfo.value.data) {
                        const parsedData = tokenInfo.value.data as ParsedAccountData;
                        if (parsedData.parsed && parsedData.parsed.info && parsedData.parsed.info.name) {
                            tokenName = parsedData.parsed.info.name;
                        }
                    }
                }
            } else {
                const provider = new ethers.JsonRpcProvider(NETWORK_CONFIGS[network].rpc);
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    [
                        'function name() view returns (string)',
                        'function symbol() view returns (string)'
                    ],
                    provider
                );
                
                const [name, symbol] = await Promise.all([
                    tokenContract.name(),
                    tokenContract.symbol()
                ]);
                
                tokenName = `${name} (${symbol})`;
            }
        } catch (error) {
            this.botConfig.onLog(`Warning: Could not fetch complete token info: ${(error as Error).message}`, userId);
        }

        // Log token info before proceeding
        this.botConfig.onLog(
            `🔍 Token Information:\n` +
            `Network: ${network}\n` +
            `Name: ${tokenName}\n` +
            `Address: ${tokenAddress}`,
            userId
        );

        const wallet = this.getUserWallet(userId, network);
        if (!wallet) {
            throw new Error(`No ${network} wallet configured for this user.`);
        }

        // Check wallet balance before buying
        let hasEnoughFunds = false;
        if (network === 'ETH' || network === 'BSC') {
            const balance = await wallet.provider?.getBalance(wallet.address);
            if (balance && balance >= ethers.parseEther(this.botConfig.amount.toString())) {
                hasEnoughFunds = true;
            }
        } else if (network === 'SOL') {
            const connection = new Connection(NETWORK_CONFIGS.SOL.rpc);
            const balance = await connection.getBalance(new PublicKey(wallet.address));
            if (balance && balance >= parseFloat(ethers.parseEther(this.botConfig.amount.toString()).toString())) {
                hasEnoughFunds = true;
            }
        }

        if (!hasEnoughFunds) {
            throw new Error(`Insufficient funds in your ${network} wallet to buy this token. Current amount required: ${this.botConfig.amount} ${network === 'SOL' ? 'SOL' : 'ETH/BNB'}`);
        }

        try {
            let txResult: TransactionResponse | string;

            if (network === 'SOL') {
                txResult = await this.executeSolSnipe(wallet, tokenAddress, this.botConfig.amount, this.botConfig.slippage);
            } else if (network === 'ETH' || network === 'BSC') {
                txResult = await this.snipeEvmToken(userId, network, tokenAddress, this.botConfig.amount, this.botConfig.slippage);
            } else {
                throw new Error('Unsupported network for buying');
            }

            // Store position (if EVM)
            if (network === 'ETH' || network === 'BSC') {
                this.positions.set(tokenAddress, {
                    tokenAddress,
                    amount: ethers.parseEther(this.botConfig.amount.toString()),
                    entryPrice: await this.getTokenPrice(tokenAddress, network),
                    stopLoss: this.botConfig.stopLoss,
                    takeProfit: this.botConfig.takeProfit,
                    network
                });
            }

            // Determine the explorer link based on network and transaction type
            let explorerLink = '';
            if (network === 'SOL') {
                explorerLink = `${NETWORK_CONFIGS[network].explorer}${txResult}`;
            } else if (network === 'ETH' || network === 'BSC') {
                explorerLink = `${NETWORK_CONFIGS[network].explorer}${(txResult as TransactionResponse).hash}`;
            }

            this.botConfig.onLog(`✅ Successfully bought ${tokenName} (${tokenAddress}): ${explorerLink}`, userId);
        } catch (error) {
            this.botConfig.onError(error as Error, userId);
            throw error; // Re-throw to be caught by Telegram handler
        }
    }
}