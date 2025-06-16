// sniperBot.ts - Enhanced Telegram Sniper Bot

import { ethers, TransactionResponse } from 'ethers';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair } from '@solana/web3.js';
// Removed SNIPER_BOT_ABI, SNIPER_BOT_ADDRESS, BSC_SNIPER_BOT_ADDRESS if not used internally by SniperBot class
import dotenv from 'dotenv';
// Removed Telegraf, Markup, Scenes, session, message imports

dotenv.config();

// Removed MySession and MyContext interfaces

// Define DEX Router ABIs (kept as they are core to sniping logic)
export const UNISWAP_ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function WETH() external pure returns (address)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
] as const;

export const PANCAKESWAP_ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function WETH() external pure returns (address)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
] as const;

// Network-specific configurations (kept as they are core to sniping logic)
export const NETWORK_CONFIGS = {
    ETH: {
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        rpc: 'https://eth.llamarpc.com',
        explorer: 'https://etherscan.io/tx/',
        factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
    },
    BSC: {
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        rpc: 'https://bsc-dataseed.binance.org/',
        explorer: 'https://bscscan.com/tx/',
        factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'
    },
    SOL: {
        rpc: 'https://api.mainnet-beta.solana.com',
        explorer: 'https://solscan.io/tx/'
    }
} as const;

// --- STATE (Now entirely within SniperBot class) ---

export interface SniperBotConfig {
    // These configs are general and passed to SniperBot's constructor
    amount: number;
    slippage: number;
    stopLoss: number;
    takeProfit: number;
    onError: (error: Error, userId: number) => void;
    onLog: (message: string, userId: number) => void;
}

interface TokenPosition {
    tokenAddress: string;
    amount: bigint;
    entryPrice: bigint;
    stopLoss: number;
    takeProfit: number;
    network: 'ETH' | 'BSC' | 'SOL';
}

export class SniperBot {
    private isRunning: boolean = false;
    private stopFlag: boolean = false;
    private positions: Map<string, TokenPosition> = new Map();
    private userWallets: Map<number, Map<'ETH' | 'BSC' | 'SOL', any>> = new Map();
    private monitoringIntervals: Map<number, NodeJS.Timeout> = new Map(); // Track intervals per user
    
    // Global bot configuration initialized in constructor
    private botConfig: SniperBotConfig;

    constructor(config: SniperBotConfig) {
        this.botConfig = config;
    }

    // --- Wallet Management ---
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
                return `${(balance / 10**9).toFixed(4)} SOL`; // Convert lamports to SOL
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
        if (network !== 'ETH' && network !== 'BSC') throw new Error('snipeEvmToken only supports ETH or BSC');
        
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
        this.botConfig.onLog(`✅ Sniped ${tokenAddress} on ${network}: ${networkConfig.explorer}${tx.hash}`, userId);
        return tx;
    }

    // --- AUTO SCAN FUNCTION ---
    async startBackgroundMonitoring(userId: number) {
        if (this.monitoringIntervals.has(userId)) {
            this.botConfig.onLog('Sniper Bot is already running in background for this user.', userId);
            return;
        }
        this.isRunning = true;
        this.stopFlag = false;
        this.botConfig.onLog('🚀 Sniper Bot started in background. Searching for tokens...', userId);

        const interval = setInterval(async () => {
            try {
                // Log wallet balances periodically
                const ethBalance = await this.getWalletBalance(userId, 'ETH');
                const bscBalance = await this.getWalletBalance(userId, 'BSC');
                const solBalance = await this.getWalletBalance(userId, 'SOL');
                this.botConfig.onLog(`💰 Current Balances:\n🔷 ETH: ${ethBalance}\n🟡 BSC: ${bscBalance}\n🟣 SOL: ${solBalance}`, userId);

                // Check for new tokens (replace with real API or AI model)
                const tokens = await this.fetchPotentialTokens();
                if (tokens.length > 0) {
                    this.botConfig.onLog(`🔍 Found ${tokens.length} potential tokens.`, userId);
                }
                for (const token of tokens) {
                    const network = this.detectNetworkFromAddress(token);
                    if (network && (network === 'ETH' || network === 'BSC')) {
                        const wallet = this.getUserWallet(userId, network);
                        if (wallet) {
                            try {
                                this.botConfig.onLog(`Attempting to snipe ${token} on ${network}...`, userId);
                                await this.snipeEvmToken(userId, network, token, this.botConfig.amount, this.botConfig.slippage);
                                this.botConfig.onLog(`🎯 Successfully sniped ${token} on ${network}.`, userId);
                                // Add logic to check updated balance here later
                            } catch (error) {
                                this.botConfig.onLog(`❌ Failed to snipe ${token} on ${network}: ${(error as Error).message}`, userId);
                                this.botConfig.onError(error as Error, userId);
                            }
                        } else {
                            this.botConfig.onLog(`⚠️ No ${network} wallet configured for auto-snipe.`, userId);
                        }
                    }
                }
            } catch (error) {
                console.error('Monitoring error:', error);
                this.botConfig.onError(error as Error, userId);
            }
        }, 15000); // Check every 15 seconds

        this.monitoringIntervals.set(userId, interval);
    }

    stopBackgroundMonitoring(userId: number) {
        const interval = this.monitoringIntervals.get(userId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(userId);
            this.botConfig.onLog('🛑 Sniper Bot stopped for this user.', userId);
        }
    }

    // --- DUMMY AI & API MOCK ---
    private async fetchPotentialTokens(): Promise<string[]> {
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
                    this.botConfig.onLog(`Token Info (ETH):\nName: ${name}\nSymbol: ${symbol}`, 0);
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
                    this.botConfig.onLog(`Token Info (BSC):\nName: ${name}\nSymbol: ${symbol}`, 0);
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
                // For SOL, we can check if it's an SPL token
                try {
                    const tokenInfo = await connection.getTokenSupply(new PublicKey(tokenAddress));
                    this.botConfig.onLog(`Token Info (SOL):\nSupply: ${tokenInfo.value.amount}`, 0);
                    return 'SOL';
                } catch (e) {
                    // If token supply check fails, it might still be a SOL address
                    return 'SOL';
                }
            }
        } catch (e) { /* console.error('SOL network detection error:', e); */ }

        return null;
    }

    async buyTokenFromUserInput(userId: number, tokenAddress: string) {
        const network = await this.detectNetworkByAddress(tokenAddress);
        if (!network) {
            throw new Error('Could not detect token network for the given address.');
        }

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
            if (balance && balance >= parseFloat(ethers.parseEther(this.botConfig.amount.toString()).toString())) { // Convert BigInt to number for SOL lamports
                hasEnoughFunds = true;
            }
        }

        if (!hasEnoughFunds) {
            throw new Error(`Insufficient funds in your ${network} wallet to buy this token. Current amount required: ${this.botConfig.amount} ${network === 'SOL' ? 'SOL' : 'ETH/BNB'}`);
        }

        try {
            let txResult: TransactionResponse | string;

            if (network === 'SOL') {
                txResult = await this.executeSolSnipe(wallet, 0, tokenAddress, this.botConfig.amount);
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

            this.botConfig.onLog(`Bought ${tokenAddress} for wallet ${wallet.address}: ${explorerLink}`, userId);
        } catch (error) {
            this.botConfig.onError(error as Error, userId);
            throw error; // Re-throw to be caught by Telegram handler
        }
    }

    private async executeSolSnipe(wallet: ethers.Wallet, index: number, tokenAddress: string, amount: number): Promise<string> {
        const connection = new Connection(NETWORK_CONFIGS.SOL.rpc);
        let walletKeypair: Keypair;
        try {
            const rawPrivateKey = wallet.privateKey.startsWith('0x') ? wallet.privateKey.slice(2) : wallet.privateKey;
            walletKeypair = Keypair.fromSecretKey(Buffer.from(rawPrivateKey, 'hex'));
        } catch (e) {
            console.error("Error converting private key for Solana. Ensure wallet.privateKey is raw hex.", e);
            throw new Error('Invalid Solana private key provided.');
        }

        const transaction = new Transaction().add(
            SystemProgram.transfer({ 
                fromPubkey: walletKeypair.publicKey,
                toPubkey: new PublicKey(tokenAddress), 
                lamports: BigInt(ethers.parseEther(amount.toString()).toString()) 
            })
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = walletKeypair.publicKey;

        const signature = await connection.sendTransaction(transaction, [walletKeypair]);
        await connection.confirmTransaction(signature);
        return signature;
    }
}
