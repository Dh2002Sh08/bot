import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

import { SniperBot, NETWORK_CONFIGS } from '../lib/sniperBot';
import { volumeBot } from '../lib/volumeBot';
import { BSCWalletManager } from './walletManager';
import { PaperTradeBot } from './paperTradeBot';
// import { walletStorage } from './walletStorage';

dotenv.config();

// Define session interface
interface MySession extends Scenes.WizardSession {
    network?: 'ETH' | 'BSC' | 'SOL';
    privateKey?: string;
    amount?: number;
    slippage?: number;
    stopLoss?: number;
    takeProfit?: number;
}

// Define context interface
interface MyContext extends Scenes.WizardContext {
    session: MySession;
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new Telegraf<MyContext>(TELEGRAM_BOT_TOKEN);

// Add wallet activation state tracking
interface WalletState {
    isActive: boolean;
    privateKey: string;
}

// Add to the top of the file after imports
const userWallets: Map<number, Map<'ETH' | 'BSC' | 'SOL', WalletState>> = new Map();

// Initialize SniperBot with callbacks that send messages to the user
export const sniperBot = new SniperBot({
    amount: 0.01, // Default amount for buys
    slippage: 10, // Default slippage
    stopLoss: 20, // Default stop loss
    takeProfit: 200, // Default take profit
    onLog: async (msg: string, userId: number, messageId?: number, deleteMessage?: boolean) => {
        try {
            if (deleteMessage && messageId) {
                await bot.telegram.deleteMessage(userId, messageId);
                return 0;
            }
            const message = await bot.telegram.sendMessage(userId, `📝 ${msg}`);
            return message.message_id;
        } catch (error) {
            console.error(`Error sending log message to user ${userId}:`, error);
            return 0;
        }
    },
    onError: async (error: Error, userId: number) => {
        console.error(`Error for user ${userId}:`, error);
        try {
            await bot.telegram.sendMessage(userId, `❌ An error occurred: ${error.message}`);
        } catch (err) {
            console.error(`Error sending error message to user ${userId}:`, err);
        }
    }
});

// Initialize Paper Trading Bot with callbacks that send messages to the user
export const paperTradeBot = new PaperTradeBot({
    amount: 0.01, // Default amount for buys
    slippage: 10, // Default slippage
    stopLoss: 20, // Default stop loss
    takeProfit: 200, // Default take profit
    onLog: async (msg: string, userId: number, messageId?: number, deleteMessage?: boolean) => {
        try {
            if (deleteMessage && messageId) {
                await bot.telegram.deleteMessage(userId, messageId);
                return 0;
            }
            const message = await bot.telegram.sendMessage(userId, `📝 ${msg}`);
            return message.message_id;
        } catch (error) {
            console.error(`Error sending log message to user ${userId}:`, error);
            return 0;
        }
    },
    onError: async (error: Error, userId: number) => {
        console.error(`Error for user ${userId}:`, error);
        try {
            await bot.telegram.sendMessage(userId, `❌ An error occurred: ${error.message}`);
        } catch (err) {
            console.error(`Error sending error message to user ${userId}:`, err);
        }
    }
});

// Middleware for session and stage
bot.use(session());
const stage = new Scenes.Stage<MyContext>([]); // Scenes registered below
bot.use(stage.middleware());

// --- KEYBOARD LAYOUTS ---
const mainKeyboard = Markup.keyboard([
    ['🔄 Start Sniper Bot', '👛 Create Wallet'],
    ['📈 User Sniped Token', '⚙️ Settings'],
    ['📊 Paper Trading', '❌ Stop Bot'],
    ['/loadwallet']
]).resize();

// Modify the wallet network keyboard to include activate/deactivate buttons
const walletNetworkKeyboard = Markup.keyboard([
    [
        Markup.button.text('🔷 ETH Wallet'),
        Markup.button.text('👛 Create ETH Wallet'),
        Markup.button.text('🔷 Activate ETH')
    ],
    [
        Markup.button.text('🟡 BSC Wallet'),
        Markup.button.text('👛 Create BSC Wallet'),
        Markup.button.text('🟡 Activate BSC')
    ],
    [
        Markup.button.text('🟣 SOL Wallet'),
        Markup.button.text('👛 Create SOL Wallet'),
        Markup.button.text('🟣 Activate SOL')
    ],
    ['🔙 Back to Main']
]).resize();

const backToMainKeyboard = Markup.keyboard([
    ['🔙 Back to Main']
]).resize();

// Inline keyboard for /start command suggestions
const startSuggestionsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🚀 Start Sniper Bot', 'start_sniper')],
    [Markup.button.callback('👛 Create/View Wallet', 'manage_wallets')],
    [Markup.button.callback('📈 Buy Token', 'buy_token')],
    [Markup.button.callback('📊 Paper Trading', 'paper_trading')],
    [Markup.button.callback('⚙️ Settings', 'settings')]
]);

// Add wallet management keyboard
const walletManagementKeyboard = Markup.keyboard([
    [Markup.button.text('🔷 ETH Wallet'), Markup.button.text('🔷 Deactivate ETH')],
    [Markup.button.text('🟡 BSC Wallet'), Markup.button.text('🟡 Deactivate BSC')],
    [Markup.button.text('🟣 SOL Wallet'), Markup.button.text('🟣 Deactivate SOL')],
    ['🔙 Back to Main']
]).resize();

// --- COMMAND HANDLERS ---
bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Load existing wallets
    // const storedWallets = walletStorage.loadWallets(userId);
    // if (storedWallets) {
    //     // Initialize wallets in SniperBot
    //     // for (const [network, walletData] of Object.entries(storedWallets)) {
    //     //     if (walletData.isActive) {
    //     //         sniperBot.setUserWallet(userId, network as 'ETH' | 'BSC' | 'SOL', walletData.privateKey);
    //     //     }
    //     // }

    //     // Show wallet balances
    //     let balanceMessage = '📊 Your Wallets:\n\n';
    //     for (const network of ['ETH', 'BSC', 'SOL'] as const) {
    //         const wallet = sniperBot.getUserWallet(userId, network);
    //         if (wallet) {
    //             const balance = await sniperBot.getWalletBalance(userId, network);
    //             balanceMessage += `${network === 'ETH' ? '🔷' : network === 'BSC' ? '🟡' : '🟣'} ${network}:\n`;
    //             balanceMessage += `Address: \`${wallet.address}\`\n`;
    //             balanceMessage += `Balance: ${balance}\n\n`;
    //         }
    //     }
    //     await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
    // }

    // Show configuration status
    const userConfig = sniperBot.getUserConfig(userId);
    if (userConfig) {
        await ctx.reply(
            '📊 Current Configuration:\n\n' +
            `Amount: ${userConfig.amount} ETH/BNB/SOL\n` +
            `Slippage: ${userConfig.slippage}%\n` +
            `Stop Loss: ${userConfig.stopLoss}%\n` +
            `Take Profit: ${userConfig.takeProfit}%`
        );
    } else {
        await ctx.reply('⚠️ No configuration set. Please set your configuration first.');
        await ctx.scene.enter('config');
    }

    await ctx.reply('Welcome to the Sniper Bot! 🚀 Please choose an option:', startSuggestionsKeyboard);
});

bot.command('config', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await ctx.reply('⚙️ Let\'s set up your trading configuration!');
    await ctx.scene.enter('configWizard');
});

// --- ACTION HANDLERS for inline keyboard --- //
bot.action('start_sniper', async (ctx) => {
    await ctx.answerCbQuery(); // Dismiss the loading spinner on the button
        const userId = ctx.from?.id;
        if (!userId) return;

    const hasEthWallet = sniperBot.hasUserWallet(userId, 'ETH');
    const hasBscWallet = sniperBot.hasUserWallet(userId, 'BSC');
    const hasSolWallet = sniperBot.hasUserWallet(userId, 'SOL');

    if (!hasEthWallet && !hasBscWallet && !hasSolWallet) {
        await ctx.reply('⚠️ No wallets configured. Please create a wallet first.', walletNetworkKeyboard);
            return;
        }

    // Ensure user has a default configuration to receive token detection messages
    const existingConfig = sniperBot.getUserConfig(userId);
    if (!existingConfig) {
        const defaultConfig = {
            amount: 0.01, // Default amount for buys
            slippage: 10, // Default slippage
            stopLoss: 20, // Default stop loss
            takeProfit: 200, // Default take profit
            onLog: sniperBot.getLogCallback(),
            onError: sniperBot.getErrorCallback()
        };
        sniperBot.updateUserConfig(userId, defaultConfig);
        console.log(`✅ Set default configuration for user ${userId}`);
    }

    // Ensure user has default validation criteria
    const existingCriteria = sniperBot.getUserValidationCriteria(userId);
    if (!existingCriteria) {
        const defaultCriteria = {
            minLiquidity: 1000,
            minVolume: 25,
            requireDexScreener: true
        };
        sniperBot.setUserValidationCriteria(userId, defaultCriteria);
        console.log(`✅ Set default validation criteria for user ${userId}`);
        }

    await ctx.reply('🚀 Starting Sniper Bot in background...');
    sniperBot.startBackgroundMonitoring(userId);
    await ctx.reply('✅ Sniper Bot is now running in the background!\n\n' +
        '📊 Status:\n' +
        `🔷 ETH: ${hasEthWallet ? '✅' : '❌'}\n` +
        `🟡 BSC: ${hasBscWallet ? '✅' : '❌'}\n` +
        `🟣 SOL: ${hasSolWallet ? '✅' : '❌'}\n\n` +
        'The bot will notify you of all activities (token detection, sniping, balance updates).', mainKeyboard);
});

bot.action('manage_wallets', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Select network for wallet management:', walletNetworkKeyboard);
});

bot.action('buy_token', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('tokenInput');
});

bot.action('settings', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Settings menu is under development.', backToMainKeyboard);
});

bot.action('paper_trading', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const paperTradingKeyboard = Markup.keyboard([
        ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
        ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
        ['📈 Active Positions', '📊 Trading History'],
        ['📈 Trading Statistics', '💰 Check Paper Balance'],
        ['📊 Set Paper Trading Config', '🔙 Back to Main']
    ]).resize();

    await ctx.reply('📊 Welcome to Paper Trading!\n\n' +
        'This feature allows you to test the sniper bot with dummy coins.\n' +
        'You\'ll get:\n' +
        '🔷 10 ETH\n' +
        '🟡 50 BNB\n' +
        '🟣 100 SOL\n\n' +
        'Choose an option:', paperTradingKeyboard);
});

// --- HEARS HANDLERS FOR MAIN MENU AND WALLET CREATION/VIEW ---
bot.hears('🔄 Start Sniper Bot', async (ctx) => {
    await ctx.reply('Please use the inline button for "Start Sniper Bot".', startSuggestionsKeyboard);
});

bot.hears('👛 Create Wallet', async (ctx) => {
    await ctx.reply('Please use the inline button for "Create/View Wallet".', startSuggestionsKeyboard);
});

// Modify the wallet creation handler
bot.hears(['👛 Create ETH Wallet', '👛 Create BSC Wallet', '👛 Create SOL Wallet'], async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const networkText = ctx.message.text;
    const network: 'ETH' | 'BSC' | 'SOL' = networkText.includes('ETH') ? 'ETH' :
                                          networkText.includes('BSC') ? 'BSC' :
                                          'SOL';
    try {
        let wallet;
        if (network === 'SOL') {
            const keypair = Keypair.generate();
            wallet = {
                address: keypair.publicKey.toString(),
                privateKey: Buffer.from(keypair.secretKey).toString('hex')
            };
        } else {
            const evmWallet = ethers.Wallet.createRandom();
            wallet = {
                address: evmWallet.address,
                privateKey: evmWallet.privateKey
            };
        }
        
        // Initialize user's wallet map if it doesn't exist
        if (!userWallets.has(userId)) {
            userWallets.set(userId, new Map());
        }
        
        // Store wallet with active state
        userWallets.get(userId)?.set(network, {
            isActive: true,
            privateKey: wallet.privateKey
        });
        
        // Set wallet in SniperBot
        sniperBot.setUserWallet(userId, network, wallet.privateKey);

        // Create keyboard with balance check button
        const keyboard = Markup.keyboard([
            [Markup.button.text(`💰 Check ${network} Balance`)],
            ['🔙 Back to Main']
        ]).resize();

        const replyMessage = await ctx.reply(
            `✅ ${network} Wallet Created!\n\n` +
            `Address: \`${wallet.address}\`\n` +
            `Private Key: \`${wallet.privateKey}\`\n\n` +
            '⚠️ **IMPORTANT:** Save these details securely! This message will be deleted automatically in 2 minutes.',
            {
                parse_mode: 'Markdown',
                ...keyboard
            }
        );

        // Auto-delete message after 2 minutes
        setTimeout(async () => {
            try {
                await ctx.deleteMessage(replyMessage.message_id);
            } catch (error) {
                console.error('Error deleting message for user (', userId, '):', error);
            }
        }, 120000);

    } catch (error) {
        await ctx.reply(`❌ Failed to create ${network} wallet: ${(error as Error).message}`, walletNetworkKeyboard);
    }
});

// Update wallet activation/deactivation handlers
bot.hears(['🔷 Activate ETH', '🟡 Activate BSC', '🟣 Activate SOL', '🔷 Deactivate ETH', '🟡 Deactivate BSC', '🟣 Deactivate SOL'], async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const networkText = ctx.message.text;
    const network: 'ETH' | 'BSC' | 'SOL' = networkText.includes('ETH') ? 'ETH' :
                                          networkText.includes('BSC') ? 'BSC' :
                                          'SOL';
    const isActivate = networkText.includes('Activate');

    const userWalletMap = userWallets.get(userId);
    if (!userWalletMap || !userWalletMap.has(network)) {
        await ctx.reply(`❌ No ${network} wallet found. Please create one first.`, walletNetworkKeyboard);
        return;
    }

    const walletState = userWalletMap.get(network)!;
    
    // Only allow activation if wallet is inactive, and deactivation if wallet is active
    if (isActivate && walletState.isActive) {
        await ctx.reply(`ℹ️ ${network} wallet is already active.`, walletManagementKeyboard);
        return;
    }
    if (!isActivate && !walletState.isActive) {
        await ctx.reply(`ℹ️ ${network} wallet is already inactive.`, walletNetworkKeyboard);
        return;
    }

    walletState.isActive = isActivate;

    if (isActivate) {
        sniperBot.setUserWallet(userId, network, walletState.privateKey);
        await ctx.reply(`✅ ${network} wallet activated!`, walletManagementKeyboard);
    } else {
        sniperBot.removeUserWallet(userId, network);
        await ctx.reply(`🛑 ${network} wallet deactivated!`, walletNetworkKeyboard);
    }
});

// Modify the wallet view handler to show activation status
bot.hears(['🔷 ETH Wallet', '🟡 BSC Wallet', '🟣 SOL Wallet'], async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;

    const networkText = ctx.message.text;
    const network: 'ETH' | 'BSC' | 'SOL' = networkText.includes('ETH') ? 'ETH' :
                                          networkText.includes('BSC') ? 'BSC' :
                                          'SOL';
    
    const userWalletMap = userWallets.get(userId);
    if (!userWalletMap || !userWalletMap.has(network)) {
        await ctx.reply(`❌ No ${network} wallet found. Please create one.`, walletNetworkKeyboard);
                            return;
                        }

    const walletState = userWalletMap.get(network)!;
    const wallet = sniperBot.getUserWallet(userId, network);
    
    if (wallet) {
        const replyMessage = await ctx.reply(
            `✅ ${network} Wallet:\n\n` +
            `Address: \`${wallet.address}\`\n` +
            `Balance: ${wallet.balance} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n\n` +
            `Status: ${walletState.isActive ? 'Active' : 'Inactive'}`
        );

        // Auto-delete message after 2 minutes
        setTimeout(async () => {
            try {
                await ctx.deleteMessage(replyMessage.message_id);
            } catch (error) {
                console.error('Error deleting message for user (', userId, '):', error);
            }
        }, 120000);
    }
});

// --- PAPER TRADING HANDLERS ---
bot.hears('📊 Paper Trading', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const paperTradingKeyboard = Markup.keyboard([
        ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
        ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
        ['📈 Active Positions', '📊 Trading History'],
        ['📈 Trading Statistics', '💰 Check Paper Balance'],
        ['📊 Set Paper Trading Config', '🔙 Back to Main']
    ]).resize();

    await ctx.reply('📊 Welcome to Paper Trading!\n\n' +
        'This feature allows you to test the sniper bot with dummy coins.\n' +
        'You\'ll get:\n' +
        '🔷 10 ETH\n' +
        '🟡 50 BNB\n' +
        '🟣 100 SOL\n\n' +
        'Choose an option:', paperTradingKeyboard);
});

// Paper Trading Wallet Creation
bot.hears('👛 Create Paper Wallet', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const paperWalletKeyboard = Markup.keyboard([
        ['🔷 Create ETH Paper Wallet', '🟡 Create BSC Paper Wallet', '🟣 Create SOL Paper Wallet'],
        ['🔙 Back to Paper Trading']
    ]).resize();

    await ctx.reply('Choose network for paper trading wallet:', paperWalletKeyboard);
});

bot.hears(['🔷 Create ETH Paper Wallet', '🟡 Create BSC Paper Wallet', '🟣 Create SOL Paper Wallet'], async (ctx) => {
        const userId = ctx.from?.id;
    if (!userId) return;

    const networkText = ctx.message.text;
    const network: 'ETH' | 'BSC' | 'SOL' = networkText.includes('ETH') ? 'ETH' :
                                          networkText.includes('BSC') ? 'BSC' :
                                          'SOL';

    try {
        const wallet = paperTradeBot.createPaperWallet(userId, network);
        
        const paperTradingKeyboard = Markup.keyboard([
            ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
            ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
            ['📈 Active Positions', '📊 Trading History'],
            ['📈 Trading Statistics', '💰 Check Paper Balance'],
            ['📊 Set Paper Trading Config', '🔙 Back to Main']
        ]).resize();

        await ctx.reply(
            `✅ ${network} Paper Trading Wallet Created!\n\n` +
                    `Address: \`${wallet.address}\`\n` +
            `Balance: ${wallet.balance} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n\n` +
            'This is a paper trading wallet with dummy coins for testing.',
                    {
                        parse_mode: 'Markdown',
                ...paperTradingKeyboard
                    }
                );

                    } catch (error) {
        await ctx.reply(`❌ Failed to create ${network} paper trading wallet: ${(error as Error).message}`);
    }
});

// Start Paper Trading
bot.hears('🚀 Start Paper Trading', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const hasEthWallet = paperTradeBot.hasUserWallet(userId, 'ETH');
    const hasBscWallet = paperTradeBot.hasUserWallet(userId, 'BSC');
    const hasSolWallet = paperTradeBot.hasUserWallet(userId, 'SOL');

    if (!hasEthWallet && !hasBscWallet && !hasSolWallet) {
        await ctx.reply('⚠️ No paper trading wallets configured. Please create wallets first.');
        return;
    }

    // Check if user has configuration set
    const userConfig = paperTradeBot.getUserConfig(userId);
    if (!userConfig) {
        await ctx.reply('⚠️ No paper trading configuration set. Please configure your trading parameters first.', 
            Markup.keyboard([
                ['📊 Set Paper Trading Config'],
                ['🔙 Back to Main']
            ]).resize()
        );
        return;
    }

    // Ensure user has default validation criteria for paper trading
    const existingCriteria = paperTradeBot.getUserValidationCriteria(userId);
    if (!existingCriteria) {
        const defaultCriteria = {
            minLiquidity: 1000,
            minVolume: 25,
            requireDexScreener: true
        };
        paperTradeBot.setUserValidationCriteria(userId, defaultCriteria);
        console.log(`✅ Set default validation criteria for paper trading user ${userId}`);
    }

    await paperTradeBot.startPaperTrading(userId);
    
    // Show current configuration
    await ctx.reply(
        '📊 Current Paper Trading Configuration:\n\n' +
        `💰 Amount per token: ${userConfig.amount} ETH/BNB/SOL\n` +
        `📊 Slippage: ${userConfig.slippage}%\n` +
        `🛑 Stop Loss: ${userConfig.stopLoss}%\n` +
        `🎯 Take Profit: ${userConfig.takeProfit}%\n\n` +
        'The bot will continuously detect and trade tokens based on these settings.',
        mainKeyboard
    );
});

// Stop Paper Trading
bot.hears('🛑 Stop Paper Trading', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    paperTradeBot.stopPaperTrading(userId);
});

// Handle Paper Trading Balance button
bot.hears('💰 Paper Trading Balance', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await paperTradeBot.checkPaperWalletBalances(userId);
});

// Handle Check Paper Balance button (manual update)
bot.hears('💰 Check Paper Balance', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await paperTradeBot.checkPaperWalletBalances(userId);
});

// Active Positions
bot.hears('📈 Active Positions', async (ctx) => {
        const userId = ctx.from?.id;
    if (!userId) return;

    const activePositions = paperTradeBot.getActivePositions(userId);
    
    if (activePositions.length === 0) {
        await ctx.reply('📈 No active positions in paper trading.');
        return;
    }

    let positionsMessage = '📈 Active Paper Trading Positions:\n\n';
    
    for (const position of activePositions) {
        const priceChangePercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
        const emoji = priceChangePercent >= 0 ? '📈' : '📉';
        
        positionsMessage += `${emoji} ${position.tokenSymbol} (${position.network})\n`;
        positionsMessage += `💰 Amount: ${position.amount.toFixed(2)} tokens\n`;
        positionsMessage += `📊 Entry: $${position.entryPrice.toFixed(6)}\n`;
        positionsMessage += `📈 Current: $${position.currentPrice.toFixed(6)}\n`;
        positionsMessage += `📊 P/L: ${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%\n\n`;
    }

    await ctx.reply(positionsMessage);
});

// Trading History
bot.hears('📊 Trading History', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const tradingHistory = paperTradeBot.getTradingHistory(userId);
    
    if (tradingHistory.length === 0) {
        await ctx.reply('📊 No trading history in paper trading.');
        return;
    }

    let historyMessage = '📊 Paper Trading History (Last 10 trades):\n\n';
    
    const recentTrades = tradingHistory.slice(0, 10);
    for (const trade of recentTrades) {
        const priceChangePercent = ((trade.currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
        const profitLoss = trade.amount * (trade.currentPrice - trade.entryPrice);
        const emoji = profitLoss >= 0 ? '✅' : '❌';
        
        historyMessage += `${emoji} ${trade.tokenSymbol} (${trade.network})\n`;
        historyMessage += `💰 P/L: ${profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(4)} ${trade.network === 'ETH' ? 'ETH' : trade.network === 'BSC' ? 'BNB' : 'SOL'}\n`;
        historyMessage += `📊 ${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%\n`;
        historyMessage += `🎯 $${trade.entryPrice.toFixed(6)} → $${trade.currentPrice.toFixed(6)}\n\n`;
    }

    await ctx.reply(historyMessage);
});

// Trading Statistics
bot.hears('📈 Trading Statistics', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const tradingHistory = paperTradeBot.getTradingHistory(userId);
    const activePositions = paperTradeBot.getActivePositions(userId);
    
    if (tradingHistory.length === 0 && activePositions.length === 0) {
        await ctx.reply('📈 No trading activity found.');
        return;
    }

    // Calculate statistics
    let totalTrades = tradingHistory.length;
    let winningTrades = 0;
    let totalProfit = 0;
    let totalInvested = 0;

    for (const trade of tradingHistory) {
        const profitLoss = trade.amount * (trade.currentPrice - trade.entryPrice);
        totalProfit += profitLoss;
        totalInvested += trade.amount * trade.entryPrice;
        if (profitLoss > 0) winningTrades++;
    }

    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalReturn = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    let statsMessage = '📈 Paper Trading Statistics:\n\n';
    statsMessage += `📊 Total Trades: ${totalTrades}\n`;
    statsMessage += `✅ Winning Trades: ${winningTrades}\n`;
    statsMessage += `📈 Win Rate: ${winRate.toFixed(1)}%\n`;
    statsMessage += `💰 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(4)} ETH/BNB/SOL\n`;
    statsMessage += `📊 Total Return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%\n`;
    statsMessage += `📈 Active Positions: ${activePositions.length}\n\n`;
    
    if (activePositions.length > 0) {
        statsMessage += '🔄 Active Positions:\n';
        for (const position of activePositions.slice(0, 3)) { // Show first 3
            const priceChangePercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
            statsMessage += `• ${position.tokenSymbol}: ${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%\n`;
        }
    }

    await ctx.reply(statsMessage);
});

// Back to Paper Trading
bot.hears('🔙 Back to Paper Trading', async (ctx) => {
    const paperTradingKeyboard = Markup.keyboard([
        ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
        ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
        ['📈 Active Positions', '📊 Trading History'],
        ['📈 Trading Statistics', '💰 Check Paper Balance'],
        ['📊 Set Paper Trading Config', '🔙 Back to Main']
    ]).resize();

    await ctx.reply('📊 Paper Trading Menu:', paperTradingKeyboard);
});

// Back to Main
bot.hears('🔙 Back to Main', async (ctx) => {
    await ctx.reply('Main Menu:', mainKeyboard);
});

// --- VALIDATION CRITERIA HANDLERS ---
bot.hears('⚙️ Settings', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const settingsKeyboard = Markup.keyboard([
        ['📊 Set Validation Criteria', '📈 View Sniped Tokens'],
        ['📊 View Paper Trading Tokens', '⚙️ Set Trading Config'],
        ['🔙 Back to Main']
    ]).resize();

    await ctx.reply('⚙️ Settings Menu:', settingsKeyboard);
});

// Set validation criteria
bot.hears('📊 Set Validation Criteria', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const criteriaKeyboard = Markup.keyboard([
        ['💧 Set Min Liquidity', '📊 Set Min Volume'],
        ['⏰ Set Max Age', '🔙 Back to Settings']
        ]).resize();

    // Get current criteria
    const sniperCriteria = sniperBot.getUserValidationCriteria(userId);
    const paperCriteria = paperTradeBot.getUserValidationCriteria(userId);

    let message = '📊 Current Validation Criteria:\n\n';
    message += '🔫 Sniper Bot:\n';
    if (sniperCriteria) {
        message += `💧 Min Liquidity: $${sniperCriteria.minLiquidity}\n`;
        message += `📊 Min Volume: $${sniperCriteria.minVolume}\n`;
        message += `⏰ Max Age: ${sniperCriteria.maxAge ? `${sniperCriteria.maxAge}s` : 'No limit'}\n`;
    } else {
        message += 'Using default criteria\n';
    }

    message += '\n📊 Paper Trading:\n';
    if (paperCriteria) {
        message += `💧 Min Liquidity: $${paperCriteria.minLiquidity}\n`;
        message += `📊 Min Volume: $${paperCriteria.minVolume}\n`;
        message += `⏰ Max Age: ${paperCriteria.maxAge ? `${paperCriteria.maxAge}s` : 'No limit'}\n`;
    } else {
        message += 'Using default criteria\n';
    }

    message += '\nChoose an option to modify:';

    await ctx.reply(message, criteriaKeyboard);
});

// View sniped tokens
bot.hears('📈 View Sniped Tokens', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const snipedTokens = sniperBot.getUserSnipedTokens(userId);
    
    if (snipedTokens.length === 0) {
        await ctx.reply('📈 No sniped tokens found.');
        return;
    }

    let message = '📈 Your Sniped Tokens:\n\n';
    
    const recentTokens = snipedTokens.slice(0, 10); // Show last 10
    for (const token of recentTokens) {
        message += `🪙 ${token.symbol} (${token.name})\n`;
        message += `🌐 Network: ${token.network}\n`;
        message += `💰 Price: $${token.price.toFixed(8)}\n`;
        message += `💧 Liquidity: $${token.liquidity.toLocaleString()}\n`;
        message += `📊 Volume: $${token.volume24h.toLocaleString()}\n`;
        message += `⏰ Age: ${token.age}\n`;
        message += `📍 Address: \`${token.address}\`\n\n`;
    }

    if (snipedTokens.length > 10) {
        message += `... and ${snipedTokens.length - 10} more tokens`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// View paper trading tokens
bot.hears('📊 View Paper Trading Tokens', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const paperTokens = paperTradeBot.getUserPaperTradedTokens(userId);
    
    if (paperTokens.length === 0) {
        await ctx.reply('📊 No paper trading tokens found.');
        return;
    }

    let message = '📊 Your Paper Trading Tokens:\n\n';
    
    const recentTokens = paperTokens.slice(0, 10); // Show last 10
    for (const token of recentTokens) {
        message += `🪙 ${token.symbol} (${token.name})\n`;
        message += `🌐 Network: ${token.network}\n`;
        message += `💰 Price: $${token.price.toFixed(8)}\n`;
        message += `💧 Liquidity: $${token.liquidity.toLocaleString()}\n`;
        message += `📊 Volume: $${token.volume24h.toLocaleString()}\n`;
        message += `⏰ Age: ${token.age}\n`;
        message += `📍 Address: \`${token.address}\`\n\n`;
    }

    if (paperTokens.length > 10) {
        message += `... and ${paperTokens.length - 10} more tokens`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Back to Settings
bot.hears('🔙 Back to Settings', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const settingsKeyboard = Markup.keyboard([
        ['📊 Set Validation Criteria', '📈 View Sniped Tokens'],
        ['📊 View Paper Trading Tokens', '⚙️ Set Trading Config'],
        ['🔙 Back to Main']
    ]).resize();

    await ctx.reply('⚙️ Settings Menu:', settingsKeyboard);
});

// Handle Set Trading Config button
bot.hears('⚙️ Set Trading Config', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await ctx.scene.enter('configWizard');
});

// Handle Paper Trading Config button
bot.hears('📊 Set Paper Trading Config', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    const userConfig = paperTradeBot.getUserConfig(userId);
    if (userConfig) {
        await ctx.reply(
            '📊 Current Paper Trading Configuration:\n\n' +
            `💰 Amount per token: ${userConfig.amount} ETH/BNB/SOL\n` +
            `📊 Slippage: ${userConfig.slippage}%\n` +
            `🛑 Stop Loss: ${userConfig.stopLoss}%\n` +
            `🎯 Take Profit: ${userConfig.takeProfit}%\n\n` +
            'Would you like to update these settings?',
            Markup.keyboard([
                ['📊 Set Paper Trading Config'],
                ['🔙 Back to Main']
            ]).resize()
        );
    } else {
        await ctx.scene.enter('paperTradingConfigWizard');
    }
});

const configWizard = new Scenes.WizardScene<MyContext>(
    'configWizard',
    async (ctx) => {
        await ctx.reply('Please enter the default amount for trades (e.g., 0.01 for 0.01 ETH/BNB/SOL):');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const amount = parseFloat(ctx.message.text);
            if (isNaN(amount) || amount <= 0) {
                await ctx.reply('❌ Invalid amount. Please enter a positive number.');
                return;
            }
            ctx.session.amount = amount; // Store in session
            await ctx.reply('Please enter the slippage percentage (e.g., 10 for 10%):');
            return ctx.wizard.next();
        }
        await ctx.reply('Please enter a valid amount.');
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const slippage = parseFloat(ctx.message.text);
            if (isNaN(slippage) || slippage < 0 || slippage > 100) {
                await ctx.reply('❌ Invalid slippage. Please enter a number between 0 and 100.');
                return;
            }
            ctx.session.slippage = slippage; // Store in session
            await ctx.reply('Please enter the stop loss percentage (e.g., 20 for 20% loss):');
        return ctx.wizard.next();
        }
        await ctx.reply('Please enter a valid slippage.');
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const stopLoss = parseFloat(ctx.message.text);
            if (isNaN(stopLoss) || stopLoss < 0) {
                await ctx.reply('❌ Invalid stop loss. Please enter a positive number.');
                return;
            }
            ctx.session.stopLoss = stopLoss; // Store in session
            await ctx.reply('Please enter the take profit percentage (e.g., 200 for 200% profit):');
            return ctx.wizard.next();
        }
        await ctx.reply('Please enter a valid stop loss.');
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const takeProfit = parseFloat(ctx.message.text);
            if (isNaN(takeProfit) || takeProfit < 0) {
                await ctx.reply('❌ Invalid take profit. Please enter a positive number.');
                return;
            }
            ctx.session.takeProfit = takeProfit; // Store in session

            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Error: Could not get user ID.');
            return ctx.scene.leave();
        }

            // Update both sniper and paper trade bot configs
            const newConfig = {
                amount: ctx.session.amount!,
                slippage: ctx.session.slippage!,
                stopLoss: ctx.session.stopLoss!,
                takeProfit: ctx.session.takeProfit!,
                onLog: sniperBot.getLogCallback(), // Use sniper bot's log/error callbacks
                onError: sniperBot.getErrorCallback()
            };

            sniperBot.updateUserConfig(userId, newConfig);
            paperTradeBot.updateUserConfig(userId, newConfig);

            await ctx.reply('✅ Trading configuration updated for both bots!', Markup.removeKeyboard());
            await ctx.reply(
                '📊 Current Configuration:\n\n' +
                `Amount: ${newConfig.amount} ETH/BNB/SOL\n` +
                `Slippage: ${newConfig.slippage}%\n` +
                `Stop Loss: ${newConfig.stopLoss}%\n` +
                `Take Profit: ${newConfig.takeProfit}%`,
                mainKeyboard
            );
            return ctx.scene.leave();
        }
        await ctx.reply('Please enter a valid take profit.');
    }
);

// Register the scene
stage.register(configWizard);

// Paper Trading Configuration Wizard
const paperTradingConfigWizard = new Scenes.WizardScene<MyContext>(
    'paperTradingConfigWizard',
    async (ctx) => {
        await ctx.reply('📊 Paper Trading Configuration\n\nPlease enter the amount you want to invest per token (e.g., 0.01 for 0.01 ETH/BNB/SOL):');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const amount = parseFloat(ctx.message.text);
            if (isNaN(amount) || amount <= 0) {
                await ctx.reply('❌ Invalid amount. Please enter a positive number.');
                return;
            }
            ctx.session.amount = amount;
            await ctx.reply('Please enter the slippage percentage (e.g., 10 for 10%):');
            return ctx.wizard.next();
        }
        await ctx.reply('Please enter a valid amount.');
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const slippage = parseFloat(ctx.message.text);
            if (isNaN(slippage) || slippage < 0 || slippage > 100) {
                await ctx.reply('❌ Invalid slippage. Please enter a number between 0 and 100.');
                return;
            }
            ctx.session.slippage = slippage;
            await ctx.reply('Please enter the stop loss percentage (e.g., 20 for 20% loss):');
            return ctx.wizard.next();
        }
        await ctx.reply('Please enter a valid slippage.');
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const stopLoss = parseFloat(ctx.message.text);
            if (isNaN(stopLoss) || stopLoss < 0) {
                await ctx.reply('❌ Invalid stop loss. Please enter a positive number.');
                return;
            }
            ctx.session.stopLoss = stopLoss;
            await ctx.reply('Please enter the take profit percentage (e.g., 200 for 200% profit):');
            return ctx.wizard.next();
        }
        await ctx.reply('Please enter a valid stop loss.');
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message) {
            const takeProfit = parseFloat(ctx.message.text);
            if (isNaN(takeProfit) || takeProfit < 0) {
                await ctx.reply('❌ Invalid take profit. Please enter a positive number.');
                return;
            }
            ctx.session.takeProfit = takeProfit;

            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Error: Could not get user ID.');
                return ctx.scene.leave();
            }

            // Update paper trade bot config
            const newConfig = {
                amount: ctx.session.amount!,
                slippage: ctx.session.slippage!,
                stopLoss: ctx.session.stopLoss!,
                takeProfit: ctx.session.takeProfit!,
                onLog: paperTradeBot.getLogCallback(),
                onError: paperTradeBot.getErrorCallback()
            };

            paperTradeBot.updateUserConfig(userId, newConfig);

            await ctx.reply('✅ Paper Trading configuration updated!', Markup.removeKeyboard());
        await ctx.reply(
                '📊 Paper Trading Configuration:\n\n' +
                `💰 Amount per token: ${newConfig.amount} ETH/BNB/SOL\n` +
                `📊 Slippage: ${newConfig.slippage}%\n` +
                `🛑 Stop Loss: ${newConfig.stopLoss}%\n` +
                `🎯 Take Profit: ${newConfig.takeProfit}%`,
            mainKeyboard
        );
        return ctx.scene.leave();
        }
        await ctx.reply('Please enter a valid take profit.');
    }
);

// Register the paper trading config scene
stage.register(paperTradingConfigWizard);

// Export the bot instance
export { bot };