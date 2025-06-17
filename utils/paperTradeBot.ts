import { ethers, TransactionResponse } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NETWORK_CONFIGS } from '../lib/sniperBot';
import { tokenScanner } from '../lib/tokenScanner';
import { EnhancedTokenScanner, TokenData, TokenValidationCriteria } from '../lib/enhancedTokenScanner';

// Paper Trading Configuration
export interface PaperTradeConfig {
    amount: number;
    slippage: number;
    stopLoss: number;
    takeProfit: number;
    onLog: (msg: string, userId: number, messageId?: number, deleteMessage?: boolean) => Promise<number>;
    onError: (error: Error, userId: number) => Promise<void>;
}

interface PaperTokenPosition {
    tokenAddress: string;
    tokenSymbol: string;
    amount: number;
    entryPrice: number;
    currentPrice: number;
    stopLoss: number;
    takeProfit: number;
    network: 'ETH' | 'BSC' | 'SOL';
    timestamp: number;
    status: 'ACTIVE' | 'SOLD' | 'STOPPED';
    entryTime: number;
}

interface PaperWallet {
    address: string;
    privateKey: string;
    network: 'ETH' | 'BSC' | 'SOL';
    balance: number;
    tokens: Map<string, PaperTokenPosition>;
}

export class PaperTradeBot {
    private isRunning: boolean = false;
    private stopFlag: boolean = false;
    private userWallets: Map<number, Map<'ETH' | 'BSC' | 'SOL', PaperWallet>> = new Map();
    private monitoringIntervals: Map<number, NodeJS.Timeout> = new Map();
    private botConfig: PaperTradeConfig;
    private userConfigs: Map<number, PaperTradeConfig> = new Map();
    private balanceUpdateIntervals: Map<number, NodeJS.Timeout> = new Map();
    private lastBalanceMessages: Map<number, number> = new Map();
    private priceUpdateIntervals: Map<number, NodeJS.Timeout> = new Map();
    private enhancedTokenScanner: EnhancedTokenScanner | null = null;
    private userValidationCriteria: Map<number, TokenValidationCriteria> = new Map();
    private paperTradedTokens: Map<number, TokenData[]> = new Map(); // Track paper traded tokens per user
    private positionMonitoringIntervals: Map<number, NodeJS.Timeout> = new Map();
    private lastPriceLogs: Map<string, number> = new Map();

    // Dummy coin amounts for paper trading
    private readonly DUMMY_BALANCES = {
        ETH: 10, // 10 ETH
        BSC: 50, // 50 BNB
        SOL: 100 // 100 SOL
    };

    constructor(config: PaperTradeConfig) {
        this.botConfig = config;
    }

    // Initialize enhanced token scanner
    async initializeEnhancedTokenScanner() {
        try {
            // Default validation criteria
            const defaultCriteria: TokenValidationCriteria = {
                minLiquidity: 1000,
                minVolume: 25,
                requireDexScreener: true
            };

            this.enhancedTokenScanner = new EnhancedTokenScanner(
                defaultCriteria,
                this.handleTokenDetected.bind(this),
                this.handleTokenScannerError.bind(this)
            );

            await this.enhancedTokenScanner.initialize();
            console.log('✅ Enhanced Token Scanner initialized in PaperTradeBot');
        } catch (error) {
            console.error('❌ Failed to initialize Enhanced Token Scanner:', error);
        }
    }

    // Handle token detection from enhanced scanner
    private async handleTokenDetected(tokenData: TokenData) {
        try {
            // Send token detection message to ALL users who have configurations
            for (const [userId, userConfig] of this.userConfigs) {
                await this.botConfig.onLog(
                    `🔎 Token detected! Checking for paper trade...\n\n` +
                    `🪙 ${tokenData.symbol} (${tokenData.name})\n` +
                    `🌐 Network: ${tokenData.network}\n` +
                    `💰 Price: $${tokenData.price.toFixed(8)}\n` +
                    `💧 Liquidity: $${tokenData.liquidity.toLocaleString()}\n` +
                    `📊 24h Volume: $${tokenData.volume24h.toLocaleString()}\n` +
                    `⏰ Age: ${tokenData.age}\n` +
                    `📍 Address: \`${tokenData.address}\`\n` +
                    `🔗 [DexScreener](${tokenData.dexScreenerUrl})`,
                    userId
                );

                // Perform validation here using the scanner's criteria (or user's if set)
                const userCriteria = this.userValidationCriteria.get(userId) || tokenData.scannerCriteria; // Use scanner's criteria as fallback
                
                let validationMessage = '✅ Token passed all criteria!';
                let isValid = true;

                if (tokenData.liquidity < userCriteria.minLiquidity) {
                    isValid = false;
                    validationMessage = `❌ Failed: Liquidity ($${tokenData.liquidity.toLocaleString()}) below minimum ($${userCriteria.minLiquidity.toLocaleString()})`;
                } else if (tokenData.volume24h < userCriteria.minVolume) {
                    isValid = false;
                    validationMessage = `❌ Failed: 24h Volume ($${tokenData.volume24h.toLocaleString()}) below minimum ($${userCriteria.minVolume.toLocaleString()})`;
                } else if (userCriteria.maxAge && tokenData.ageSeconds > userCriteria.maxAge) {
                    isValid = false;
                    validationMessage = `❌ Failed: Age (${tokenData.age}) above maximum (${userCriteria.maxAge}s)`;
                } else if (userCriteria.requireDexScreener && (!tokenData.price || tokenData.price === 0)) {
                    isValid = false;
                    validationMessage = `❌ Failed: DexScreener data required but not available or price is zero.`;
                }

                await this.botConfig.onLog(`🔍 Paper Trading Validation: ${validationMessage}`, userId);

                // Only attempt to paper trade if user has a wallet for this network AND token is valid
                if (isValid && this.hasUserWallet(userId, tokenData.network)) {
                    await this.attemptPaperTrade(userId, tokenData);
                } else if (!this.hasUserWallet(userId, tokenData.network)) {
                    await this.botConfig.onLog(`⚠️ No ${tokenData.network} paper wallet configured. Cannot paper trade this token.`, userId);
                } else {
                    await this.botConfig.onLog('➡️ Not paper trading this token.', userId);
                }
            }
        } catch (error) {
            console.error('Error handling token detection in paper trading:', error);
        }
    }

    // Handle token scanner errors
    private async handleTokenScannerError(error: Error) {
        console.error('Enhanced Token Scanner error in paper trading:', error);
    }

    // Set user validation criteria
    setUserValidationCriteria(userId: number, criteria: TokenValidationCriteria) {
        this.userValidationCriteria.set(userId, criteria);
        
        // Update scanner criteria if it exists
        if (this.enhancedTokenScanner) {
            this.enhancedTokenScanner.updateValidationCriteria(criteria);
        }
    }

    // Get user validation criteria
    getUserValidationCriteria(userId: number): TokenValidationCriteria | undefined {
        return this.userValidationCriteria.get(userId);
    }

    // Get user's paper traded tokens
    getUserPaperTradedTokens(userId: number): TokenData[] {
        return this.paperTradedTokens.get(userId) || [];
    }

    // Attempt to paper trade a detected token
    private async attemptPaperTrade(userId: number, tokenData: TokenData) {
        try {
            const userConfig = this.getUserConfig(userId);
            if (!userConfig) {
                console.log(`No config found for user ${userId} in paper trading`);
                return;
            }

            const wallet = this.getUserWallet(userId, tokenData.network);
            if (!wallet) {
                console.log(`No ${tokenData.network} wallet found for user ${userId} in paper trading`);
                return;
            }

            // Check if we have enough balance (for real trading simulation)
            if (wallet.balance < userConfig.amount) {
                await this.botConfig.onLog(
                    `⚠️ Paper Trading: Insufficient ${tokenData.network} balance (You only have ${wallet.balance.toFixed(4)} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}, but tried to invest ${userConfig.amount}). Simulating trade anyway.`,
                    userId
                );
                // Do not return here, continue with simulation
            }

            // Simulate paper trading
            const entryPrice = tokenData.price;
            // Calculate token amount based on userConfig.amount, but cap it if paper balance is too low for simulation
            const amountToUse = Math.min(userConfig.amount, wallet.balance);
            const tokenAmount = amountToUse / entryPrice;
            
            // Deduct from wallet balance (only the amount actually used in simulation)
            wallet.balance -= amountToUse;

            // Create paper trading position
            const position: PaperTokenPosition = {
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

            // Store paper traded token
            if (!this.paperTradedTokens.has(userId)) {
                this.paperTradedTokens.set(userId, []);
            }
            this.paperTradedTokens.get(userId)!.push(tokenData);

            await this.botConfig.onLog(
                `✅ Paper Trading: Successfully Sniped ${tokenData.symbol}!\n\n` +
                `💰 Amount: ${userConfig.amount} ${tokenData.network === 'ETH' ? 'ETH' : tokenData.network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${entryPrice.toFixed(8)}\n` +
                `🪙 Tokens: ${tokenAmount.toFixed(2)}\n` +
                `📊 Stop Loss: ${userConfig.stopLoss}%\n` +
                `🎯 Take Profit: ${userConfig.takeProfit}%\n` +
                `⏰ Entry Time: ${new Date().toLocaleString()}`,
                userId
            );

        } catch (error) {
            console.error(`Error paper trading token for user ${userId}:`, error);
            await this.botConfig.onError(error as Error, userId);
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
    updateUserConfig(userId: number, config: PaperTradeConfig) {
        this.userConfigs.set(userId, config);
    }

    getUserConfig(userId: number): PaperTradeConfig | undefined {
        return this.userConfigs.get(userId);
    }

    // Create paper trading wallet
    createPaperWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL'): PaperWallet {
        if (!this.userWallets.has(userId)) {
            this.userWallets.set(userId, new Map());
        }

        let wallet: PaperWallet;

        if (network === 'SOL') {
            const keypair = Keypair.generate();
            wallet = {
                address: keypair.publicKey.toString(),
                privateKey: Buffer.from(keypair.secretKey).toString('hex'),
                network: 'SOL',
                balance: this.DUMMY_BALANCES.SOL,
                tokens: new Map()
            };
        } else {
            const ethersWallet = ethers.Wallet.createRandom();
            wallet = {
                address: ethersWallet.address,
                privateKey: ethersWallet.privateKey,
                network: network,
                balance: network === 'ETH' ? this.DUMMY_BALANCES.ETH : this.DUMMY_BALANCES.BSC,
                tokens: new Map()
            };
        }

        this.userWallets.get(userId)!.set(network, wallet);
        return wallet;
    }

    getUserWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL'): PaperWallet | undefined {
        return this.userWallets.get(userId)?.get(network);
    }

    hasUserWallet(userId: number, network: 'ETH' | 'BSC' | 'SOL'): boolean {
        return this.userWallets.has(userId) && this.userWallets.get(userId)!.has(network);
    }

    // Get paper wallet balance
    async getWalletBalance(userId: number, network: 'ETH' | 'BSC' | 'SOL'): Promise<string> {
        const wallet = this.getUserWallet(userId, network);
        if (!wallet) return '0';

        return `${wallet.balance.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}`;
    }

    // Manual check for all paper wallet balances for a user
    async checkPaperWalletBalances(userId: number) {
        try {
            const balances = [];
            const networks = ['ETH', 'BSC', 'SOL'] as const;
            
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
                    } catch (error) {
                        console.error('Error deleting previous balance message:', error);
                    }
                }

                // Send new balance message and store its ID
                const newMessageId = await this.botConfig.onLog(message, userId);
                this.lastBalanceMessages.set(userId, newMessageId);
            } else {
                await this.botConfig.onLog('⚠️ No paper wallets found for balance check.', userId);
            }
        } catch (error) {
            console.error('Error checking paper wallet balances:', error);
            await this.botConfig.onError(error as Error, userId);
        }
    }

    // Update wallet balances display
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
                const message = `💰 Paper Trading Balances:\n${balances.join('\n')}`;
                
                const lastMessageId = this.lastBalanceMessages.get(userId);
                if (lastMessageId) {
                    try {
                        await this.botConfig.onLog('', userId, lastMessageId, true);
                    } catch (error) {
                        console.error('Error deleting previous balance message:', error);
                    }
                }

                const newMessageId = await this.botConfig.onLog(message, userId);
                this.lastBalanceMessages.set(userId, newMessageId);
            }
        } catch (error) {
            console.error('Error updating wallet balances:', error);
        }
    }

    // Start paper trading monitoring
    async startPaperTrading(userId: number) {
        if (this.isRunning) {
            await this.botConfig.onLog('⚠️ Paper Trading is already running!', userId);
            return;
        }

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

        // Determine which networks to scan based on user's wallets
        const networksToScan: ('ETH' | 'BSC' | 'SOL')[] = [];
        if (hasEthWallet) networksToScan.push('ETH');
        if (hasBscWallet) networksToScan.push('BSC');
        if (hasSolWallet) networksToScan.push('SOL');

        // Start enhanced token scanner only for networks with active wallets
        if (this.enhancedTokenScanner && !this.enhancedTokenScanner.isScanning()) {
            await this.enhancedTokenScanner.startScanning(networksToScan);
        } else if (this.enhancedTokenScanner && this.enhancedTokenScanner.isScanning()) {
            // If scanner is already running, add the new networks
            await this.enhancedTokenScanner.addNetworks(networksToScan);
        }

        // Set default validation criteria for user if not set
        if (!this.userValidationCriteria.has(userId)) {
            this.setUserValidationCriteria(userId, {
                minLiquidity: 1000,
                minVolume: 25,
                requireDexScreener: true
            });
        }

        await this.botConfig.onLog('🔍 Enhanced Token Scanner is now monitoring for new tokens with validation criteria:\n' +
            `💧 Min Liquidity: $${this.userValidationCriteria.get(userId)?.minLiquidity || 1000}\n` +
            `📊 Min Volume: $${this.userValidationCriteria.get(userId)?.minVolume || 25}\n` +
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

        await this.botConfig.onLog('✅ Paper Trading Bot is now running!\n\n' +
            '📊 Status:\n' +
            `🔷 ETH: ${hasEthWallet ? '✅' : '❌'}\n` +
            `🟡 BSC: ${hasBscWallet ? '✅' : '❌'}\n` +
            `🟣 SOL: ${hasSolWallet ? '✅' : '❌'}\n\n` +
            `📡 Scanning networks: ${networksToScan.join(', ')}\n\n` +
            'The bot will simulate sniping real tokens with dummy coins.', userId);
    }

    // Stop paper trading
    stopPaperTrading(userId: number) {
        this.isRunning = false;
        this.stopFlag = true;

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

        this.botConfig.onLog('🛑 Paper Trading Bot stopped.', userId);
    }

    // Monitor for new tokens to snipe
    private async monitorForNewTokens(userId: number) {
        try {
            // Get user config
            const config = this.getUserConfig(userId);
            if (!config) {
                await this.botConfig.onLog('⚠️ No configuration set for paper trading.', userId);
                return;
            }

            // Simulate finding new tokens (in real implementation, this would use tokenScanner)
            const networks = ['ETH', 'BSC', 'SOL'] as const;
            
            for (const network of networks) {
                if (!this.hasUserWallet(userId, network)) continue;

                // Simulate random token detection (1% chance every 30 seconds)
                if (Math.random() < 0.01) {
                    const mockTokenAddress = this.generateMockTokenAddress(network);
                    const mockTokenSymbol = this.generateMockTokenSymbol();
                    
                    await this.botConfig.onLog(`🔍 Paper Trading: Detected new token ${mockTokenSymbol} on ${network}`, userId);
                    
                    // Simulate sniping
                    await this.simulateSnipe(userId, network, mockTokenAddress, mockTokenSymbol, config);
                }
            }
        } catch (error) {
            console.error('Error monitoring for new tokens:', error);
        }
    }

    // Simulate sniping a token
    private async simulateSnipe(userId: number, network: 'ETH' | 'BSC' | 'SOL', tokenAddress: string, tokenSymbol: string, config: PaperTradeConfig) {
        try {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet) return;

            // Check if we have enough balance
            if (wallet.balance < config.amount) {
                await this.botConfig.onLog(`⚠️ Insufficient ${network} balance for paper trading snipe.`, userId);
                return;
            }

            // Simulate entry price (random price between 0.0001 and 0.01)
            const entryPrice = Math.random() * 0.0099 + 0.0001;
            
            // Calculate token amount based on config amount
            const tokenAmount = config.amount / entryPrice;
            
            // Deduct from wallet balance
            wallet.balance -= config.amount;

            // Create position
            const position: PaperTokenPosition = {
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

        } catch (error) {
            console.error('Error simulating snipe:', error);
            await this.botConfig.onError(error as Error, userId);
        }
    }

    // Monitor active positions
    private async monitorPositions(userId: number) {
        try {
            const networks = ['ETH', 'BSC', 'SOL'] as const;
            
            for (const network of networks) {
                const wallet = this.getUserWallet(userId, network);
                if (!wallet) continue;

                for (const [tokenAddress, position] of wallet.tokens) {
                    if (position.status !== 'ACTIVE') continue;

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
        } catch (error) {
            console.error('Error monitoring positions:', error);
        }
    }

    // Simulate selling a token
    private async simulateSell(userId: number, network: 'ETH' | 'BSC' | 'SOL', tokenAddress: string, reason: string, position: PaperTokenPosition) {
        try {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet) return;

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
                `🎯 Entry: $${position.entryPrice.toFixed(6)} → Exit: $${position.currentPrice.toFixed(6)}`, userId);

        } catch (error) {
            console.error('Error simulating sell:', error);
            await this.botConfig.onError(error as Error, userId);
        }
    }

    // Utility methods
    private generateMockTokenAddress(network: 'ETH' | 'BSC' | 'SOL'): string {
        if (network === 'SOL') {
            return Keypair.generate().publicKey.toString();
        } else {
            return ethers.Wallet.createRandom().address;
        }
    }

    private generateMockTokenSymbol(): string {
        const symbols = ['PEPE', 'DOGE', 'SHIB', 'MOON', 'ROCKET', 'LAMBO', 'APE', 'BULL', 'BEAR', 'PUMP'];
        return symbols[Math.floor(Math.random() * symbols.length)];
    }

    // Get active positions
    getActivePositions(userId: number): PaperTokenPosition[] {
        const positions: PaperTokenPosition[] = [];
        const networks = ['ETH', 'BSC', 'SOL'] as const;
        
        for (const network of networks) {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet) continue;

            for (const position of wallet.tokens.values()) {
                if (position.status === 'ACTIVE') {
                    positions.push(position);
                }
            }
        }
        
        return positions;
    }

    // Get trading history
    getTradingHistory(userId: number): PaperTokenPosition[] {
        const positions: PaperTokenPosition[] = [];
        const networks = ['ETH', 'BSC', 'SOL'] as const;
        
        for (const network of networks) {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet) continue;

            for (const position of wallet.tokens.values()) {
                if (position.status === 'SOLD') {
                    positions.push(position);
                }
            }
        }
        
        return positions.sort((a, b) => b.timestamp - a.timestamp);
    }

    // Start position monitoring for a user
    private startPositionMonitoring(userId: number) {
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
    private stopPositionMonitoring(userId: number) {
        const interval = this.positionMonitoringIntervals.get(userId);
        if (interval) {
            clearInterval(interval);
            this.positionMonitoringIntervals.delete(userId);
        }
    }

    // Monitor all paper positions for a user
    private async monitorPaperPositions(userId: number) {
        try {
            const userWallets = this.userWallets.get(userId);
            if (!userWallets) return;

            for (const [network, wallet] of userWallets) {
                for (const [tokenAddress, position] of wallet.tokens) {
                    if (position.status === 'ACTIVE') {
                        await this.checkPaperPositionPrice(userId, network, tokenAddress, position);
                    }
                }
            }
        } catch (error) {
            console.error(`Error monitoring paper positions for user ${userId}:`, error);
        }
    }

    // Check price for a specific paper position
    private async checkPaperPositionPrice(userId: number, network: 'ETH' | 'BSC' | 'SOL', tokenAddress: string, position: PaperTokenPosition) {
        try {
            // Get current price from DexScreener
            const currentPrice = await this.getCurrentTokenPrice(tokenAddress, network);
            if (currentPrice === null) {
                return; // Skip if price couldn't be fetched
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
                await this.botConfig.onLog(
                    `📊 Paper Trading: ${position.tokenSymbol} Price Update:\n` +
                    `💰 Current Price: $${currentPrice.toFixed(8)}\n` +
                    `📈 Entry Price: $${position.entryPrice.toFixed(8)}\n` +
                    `📊 Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%\n` +
                    `🎯 TP: ${position.takeProfit}% | 🛑 SL: ${position.stopLoss}%`,
                    userId
                );
                this.lastPriceLogs.set(positionKey, priceChange);
            }

        } catch (error) {
            console.error(`Error checking paper position price for ${tokenAddress}:`, error);
        }
    }

    // Execute paper sell
    private async executePaperSell(userId: number, network: 'ETH' | 'BSC' | 'SOL', tokenAddress: string, position: PaperTokenPosition, reason: 'TAKE_PROFIT' | 'STOP_LOSS', priceChange: number) {
        try {
            const wallet = this.getUserWallet(userId, network);
            if (!wallet) return;

            // Update position status
            position.status = reason === 'TAKE_PROFIT' ? 'SOLD' : 'STOPPED';
            position.currentPrice = position.currentPrice;
            wallet.tokens.set(tokenAddress, position);

            // Calculate profit/loss
            const profitLoss = priceChange;
            const profitLossUSD = (position.amount * profitLoss) / 100;

            // Add back to wallet balance (simulated)
            const sellValue = position.amount * (1 + profitLoss / 100);
            wallet.balance += sellValue;

            const emoji = reason === 'TAKE_PROFIT' ? '🎯' : '🛑';
            const reasonText = reason === 'TAKE_PROFIT' ? 'Take Profit Reached!' : 'Stop Loss Triggered!';

            await this.botConfig.onLog(
                `${emoji} Paper Trading: ${reasonText}\n\n` +
                `🪙 Token: ${position.tokenSymbol}\n` +
                `💰 Invested: ${position.amount.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n` +
                `📈 Entry Price: $${position.entryPrice.toFixed(8)}\n` +
                `📊 Exit Price: $${position.currentPrice.toFixed(8)}\n` +
                `📊 P&L: ${profitLoss > 0 ? '+' : ''}${profitLoss.toFixed(2)}% (${profitLossUSD > 0 ? '+' : ''}$${profitLossUSD.toFixed(2)})\n` +
                `🌐 Network: ${network}\n` +
                `💼 New Balance: ${wallet.balance.toFixed(4)} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}`,
                userId
            );

        } catch (error) {
            console.error(`Error executing paper sell for ${tokenAddress}:`, error);
            await this.botConfig.onError(error as Error, userId);
        }
    }

    // Get current token price from DexScreener
    private async getCurrentTokenPrice(tokenAddress: string, network: 'ETH' | 'BSC' | 'SOL'): Promise<number | null> {
        try {
            let url: string;
            if (network === 'SOL') {
                url = `https://api.dexscreener.com/latest/dex/pairs/solana/${tokenAddress}`;
            } else {
                url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
            }

            const response = await fetch(url);
            const data = await response.json() as any;

            if (network === 'SOL') {
                return data.pair ? parseFloat(data.pair.priceUsd) : null;
            } else {
                return data.pairs && data.pairs.length > 0 ? parseFloat(data.pairs[0].priceUsd) : null;
            }
        } catch (error) {
            console.error(`Error fetching price for ${tokenAddress}:`, error);
            return null;
        }
    }
}
