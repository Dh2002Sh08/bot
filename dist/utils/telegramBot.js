"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
const telegraf_1 = require("telegraf");
const dotenv_1 = __importDefault(require("dotenv"));
const ethers_1 = require("ethers");
const web3_js_1 = require("@solana/web3.js");
const sniperBot_1 = require("../lib/sniperBot");
const paperTradeBot_1 = require("./paperTradeBot");
// import { walletStorage } from './walletStorage';
dotenv_1.default.config();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new telegraf_1.Telegraf(TELEGRAM_BOT_TOKEN);
exports.bot = bot;
// Add to the top of the file after imports
const userWallets = new Map();
// Initialize SniperBot with callbacks that send messages to the user
const sniperBot = new sniperBot_1.SniperBot({
    amount: 0.01, // Default amount for buys
    slippage: 10, // Default slippage
    stopLoss: 20, // Default stop loss
    takeProfit: 200, // Default take profit
    onLog: async (msg, userId, messageId, deleteMessage) => {
        try {
            if (deleteMessage && messageId) {
                await bot.telegram.deleteMessage(userId, messageId);
                return 0;
            }
            const message = await bot.telegram.sendMessage(userId, `📝 ${msg}`);
            return message.message_id;
        }
        catch (error) {
            console.error(`Error sending log message to user ${userId}:`, error);
            return 0;
        }
    },
    onError: async (error, userId) => {
        console.error(`Error for user ${userId}:`, error);
        try {
            await bot.telegram.sendMessage(userId, `❌ An error occurred: ${error.message}`);
        }
        catch (err) {
            console.error(`Error sending error message to user ${userId}:`, err);
        }
    }
});
// Initialize Paper Trading Bot with callbacks that send messages to the user
const paperTradeBot = new paperTradeBot_1.PaperTradeBot({
    amount: 0.01, // Default amount for buys
    slippage: 10, // Default slippage
    stopLoss: 20, // Default stop loss
    takeProfit: 200, // Default take profit
    onLog: async (msg, userId, messageId, deleteMessage) => {
        try {
            if (deleteMessage && messageId) {
                await bot.telegram.deleteMessage(userId, messageId);
                return 0;
            }
            const message = await bot.telegram.sendMessage(userId, `📝 ${msg}`);
            return message.message_id;
        }
        catch (error) {
            console.error(`Error sending log message to user ${userId}:`, error);
            return 0;
        }
    },
    onError: async (error, userId) => {
        console.error(`Error for user ${userId}:`, error);
        try {
            await bot.telegram.sendMessage(userId, `❌ An error occurred: ${error.message}`);
        }
        catch (err) {
            console.error(`Error sending error message to user ${userId}:`, err);
        }
    }
});
// Middleware for session and stage
bot.use((0, telegraf_1.session)());
const stage = new telegraf_1.Scenes.Stage([]); // Scenes registered below
bot.use(stage.middleware());
// --- KEYBOARD LAYOUTS ---
const mainKeyboard = telegraf_1.Markup.keyboard([
    ['🔄 Start Sniper Bot', '👛 Create Wallet'],
    ['📈 User Sniped Token', '⚙️ Settings'],
    ['📊 Paper Trading', '❌ Stop Bot'],
    ['/loadwallet']
]).resize();
// Modify the wallet network keyboard to include activate/deactivate buttons
const walletNetworkKeyboard = telegraf_1.Markup.keyboard([
    [
        telegraf_1.Markup.button.text('🔷 ETH Wallet'),
        telegraf_1.Markup.button.text('👛 Create ETH Wallet'),
        telegraf_1.Markup.button.text('🔷 Activate ETH')
    ],
    [
        telegraf_1.Markup.button.text('🟡 BSC Wallet'),
        telegraf_1.Markup.button.text('👛 Create BSC Wallet'),
        telegraf_1.Markup.button.text('🟡 Activate BSC')
    ],
    [
        telegraf_1.Markup.button.text('🟣 SOL Wallet'),
        telegraf_1.Markup.button.text('👛 Create SOL Wallet'),
        telegraf_1.Markup.button.text('🟣 Activate SOL')
    ],
    ['🔙 Back to Main']
]).resize();
const backToMainKeyboard = telegraf_1.Markup.keyboard([
    ['🔙 Back to Main']
]).resize();
// Inline keyboard for /start command suggestions
const startSuggestionsKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback('🚀 Start Sniper Bot', 'start_sniper')],
    [telegraf_1.Markup.button.callback('👛 Create/View Wallet', 'manage_wallets')],
    [telegraf_1.Markup.button.callback('📈 Buy Token', 'buy_token')],
    [telegraf_1.Markup.button.callback('📊 Paper Trading', 'paper_trading')],
    [telegraf_1.Markup.button.callback('⚙️ Settings', 'settings')]
]);
// Add wallet management keyboard
const walletManagementKeyboard = telegraf_1.Markup.keyboard([
    [telegraf_1.Markup.button.text('🔷 ETH Wallet'), telegraf_1.Markup.button.text('🔷 Deactivate ETH')],
    [telegraf_1.Markup.button.text('🟡 BSC Wallet'), telegraf_1.Markup.button.text('🟡 Deactivate BSC')],
    [telegraf_1.Markup.button.text('🟣 SOL Wallet'), telegraf_1.Markup.button.text('🟣 Deactivate SOL')],
    ['🔙 Back to Main']
]).resize();
// --- COMMAND HANDLERS ---
bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
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
        await ctx.reply('📊 Current Configuration:\n\n' +
            `Amount: ${userConfig.amount} ETH/BNB/SOL\n` +
            `Slippage: ${userConfig.slippage}%\n` +
            `Stop Loss: ${userConfig.stopLoss}%\n` +
            `Take Profit: ${userConfig.takeProfit}%`);
    }
    else {
        await ctx.reply('⚠️ No configuration set. Please set your configuration first.');
        await ctx.scene.enter('config');
    }
    await ctx.reply('Welcome to the Sniper Bot! 🚀 Please choose an option:', startSuggestionsKeyboard);
});
// --- ACTION HANDLERS for inline keyboard --- //
bot.action('start_sniper', async (ctx) => {
    await ctx.answerCbQuery(); // Dismiss the loading spinner on the button
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const hasEthWallet = sniperBot.hasUserWallet(userId, 'ETH');
    const hasBscWallet = sniperBot.hasUserWallet(userId, 'BSC');
    const hasSolWallet = sniperBot.hasUserWallet(userId, 'SOL');
    if (!hasEthWallet && !hasBscWallet && !hasSolWallet) {
        await ctx.reply('⚠️ No wallets configured. Please create a wallet first.', walletNetworkKeyboard);
        return;
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
    if (!userId)
        return;
    const paperTradingKeyboard = telegraf_1.Markup.keyboard([
        ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
        ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
        ['📈 Active Positions', '📊 Trading History'],
        ['🔙 Back to Main']
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
    if (!userId)
        return;
    const networkText = ctx.message.text;
    const network = networkText.includes('ETH') ? 'ETH' :
        networkText.includes('BSC') ? 'BSC' :
            'SOL';
    try {
        let wallet;
        if (network === 'SOL') {
            const keypair = web3_js_1.Keypair.generate();
            wallet = {
                address: keypair.publicKey.toString(),
                privateKey: Buffer.from(keypair.secretKey).toString('hex')
            };
        }
        else {
            const evmWallet = ethers_1.ethers.Wallet.createRandom();
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
        const keyboard = telegraf_1.Markup.keyboard([
            [telegraf_1.Markup.button.text(`💰 Check ${network} Balance`)],
            ['🔙 Back to Main']
        ]).resize();
        const replyMessage = await ctx.reply(`✅ ${network} Wallet Created!\n\n` +
            `Address: \`${wallet.address}\`\n` +
            `Private Key: \`${wallet.privateKey}\`\n\n` +
            '⚠️ **IMPORTANT:** Save these details securely! This message will be deleted automatically in 2 minutes.', {
            parse_mode: 'Markdown',
            ...keyboard
        });
        // Auto-delete message after 2 minutes
        setTimeout(async () => {
            try {
                await ctx.deleteMessage(replyMessage.message_id);
            }
            catch (error) {
                console.error('Error deleting message for user (', userId, '):', error);
            }
        }, 120000);
    }
    catch (error) {
        await ctx.reply(`❌ Failed to create ${network} wallet: ${error.message}`, walletNetworkKeyboard);
    }
});
// Update wallet activation/deactivation handlers
bot.hears(['🔷 Activate ETH', '🟡 Activate BSC', '🟣 Activate SOL', '🔷 Deactivate ETH', '🟡 Deactivate BSC', '🟣 Deactivate SOL'], async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const networkText = ctx.message.text;
    const network = networkText.includes('ETH') ? 'ETH' :
        networkText.includes('BSC') ? 'BSC' :
            'SOL';
    const isActivate = networkText.includes('Activate');
    const userWalletMap = userWallets.get(userId);
    if (!userWalletMap || !userWalletMap.has(network)) {
        await ctx.reply(`❌ No ${network} wallet found. Please create one first.`, walletNetworkKeyboard);
        return;
    }
    const walletState = userWalletMap.get(network);
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
    }
    else {
        sniperBot.removeUserWallet(userId, network);
        await ctx.reply(`🛑 ${network} wallet deactivated!`, walletNetworkKeyboard);
    }
});
// Modify the wallet view handler to show activation status
bot.hears(['🔷 ETH Wallet', '🟡 BSC Wallet', '🟣 SOL Wallet'], async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const networkText = ctx.message.text;
    const network = networkText.includes('ETH') ? 'ETH' :
        networkText.includes('BSC') ? 'BSC' :
            'SOL';
    const userWalletMap = userWallets.get(userId);
    if (!userWalletMap || !userWalletMap.has(network)) {
        await ctx.reply(`❌ No ${network} wallet found. Please create one.`, walletNetworkKeyboard);
        return;
    }
    const walletState = userWalletMap.get(network);
    const wallet = sniperBot.getUserWallet(userId, network);
    if (wallet) {
        const replyMessage = await ctx.reply(`✅ ${network} Wallet:\n\n` +
            `Address: \`${wallet.address}\`\n` +
            `Balance: ${wallet.balance} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n\n` +
            `Status: ${walletState.isActive ? 'Active' : 'Inactive'}`);
        // Auto-delete message after 2 minutes
        setTimeout(async () => {
            try {
                await ctx.deleteMessage(replyMessage.message_id);
            }
            catch (error) {
                console.error('Error deleting message for user (', userId, '):', error);
            }
        }, 120000);
    }
});
// --- PAPER TRADING HANDLERS ---
bot.hears('📊 Paper Trading', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const paperTradingKeyboard = telegraf_1.Markup.keyboard([
        ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
        ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
        ['📈 Active Positions', '📊 Trading History'],
        ['🔙 Back to Main']
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
    if (!userId)
        return;
    const paperWalletKeyboard = telegraf_1.Markup.keyboard([
        ['🔷 Create ETH Paper Wallet', '🟡 Create BSC Paper Wallet', '🟣 Create SOL Paper Wallet'],
        ['🔙 Back to Paper Trading']
    ]).resize();
    await ctx.reply('Choose network for paper trading wallet:', paperWalletKeyboard);
});
bot.hears(['🔷 Create ETH Paper Wallet', '🟡 Create BSC Paper Wallet', '🟣 Create SOL Paper Wallet'], async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const networkText = ctx.message.text;
    const network = networkText.includes('ETH') ? 'ETH' :
        networkText.includes('BSC') ? 'BSC' :
            'SOL';
    try {
        const wallet = paperTradeBot.createPaperWallet(userId, network);
        const paperTradingKeyboard = telegraf_1.Markup.keyboard([
            ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
            ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
            ['📈 Active Positions', '📊 Trading History'],
            ['🔙 Back to Main']
        ]).resize();
        await ctx.reply(`✅ ${network} Paper Trading Wallet Created!\n\n` +
            `Address: \`${wallet.address}\`\n` +
            `Balance: ${wallet.balance} ${network === 'ETH' ? 'ETH' : network === 'BSC' ? 'BNB' : 'SOL'}\n\n` +
            'This is a paper trading wallet with dummy coins for testing.', {
            parse_mode: 'Markdown',
            ...paperTradingKeyboard
        });
    }
    catch (error) {
        await ctx.reply(`❌ Failed to create ${network} paper trading wallet: ${error.message}`);
    }
});
// Start Paper Trading
bot.hears('🚀 Start Paper Trading', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const hasEthWallet = paperTradeBot.hasUserWallet(userId, 'ETH');
    const hasBscWallet = paperTradeBot.hasUserWallet(userId, 'BSC');
    const hasSolWallet = paperTradeBot.hasUserWallet(userId, 'SOL');
    if (!hasEthWallet && !hasBscWallet && !hasSolWallet) {
        await ctx.reply('⚠️ No paper trading wallets configured. Please create wallets first.');
        return;
    }
    // Set default config if not set
    const userConfig = paperTradeBot.getUserConfig(userId);
    if (!userConfig) {
        paperTradeBot.updateUserConfig(userId, {
            amount: 0.01,
            slippage: 10,
            stopLoss: 20,
            takeProfit: 200,
            onLog: paperTradeBot.getLogCallback(),
            onError: paperTradeBot.getErrorCallback()
        });
    }
    await paperTradeBot.startPaperTrading(userId);
});
// Stop Paper Trading
bot.hears('🛑 Stop Paper Trading', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    paperTradeBot.stopPaperTrading(userId);
});
// Paper Trading Balance
bot.hears('💰 Paper Trading Balance', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const networks = ['ETH', 'BSC', 'SOL'];
    let balanceMessage = '💰 Paper Trading Balances:\n\n';
    for (const network of networks) {
        if (paperTradeBot.hasUserWallet(userId, network)) {
            const balance = await paperTradeBot.getWalletBalance(userId, network);
            const emoji = network === 'ETH' ? '🔷' : network === 'BSC' ? '🟡' : '🟣';
            balanceMessage += `${emoji} ${network}: ${balance}\n`;
        }
    }
    if (balanceMessage === '💰 Paper Trading Balances:\n\n') {
        balanceMessage = '❌ No paper trading wallets found. Please create wallets first.';
    }
    await ctx.reply(balanceMessage);
});
// Active Positions
bot.hears('📈 Active Positions', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
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
    if (!userId)
        return;
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
// Back to Paper Trading
bot.hears('🔙 Back to Paper Trading', async (ctx) => {
    const paperTradingKeyboard = telegraf_1.Markup.keyboard([
        ['🚀 Start Paper Trading', '🛑 Stop Paper Trading'],
        ['👛 Create Paper Wallet', '💰 Paper Trading Balance'],
        ['📈 Active Positions', '📊 Trading History'],
        ['🔙 Back to Main']
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
    if (!userId)
        return;
    const settingsKeyboard = telegraf_1.Markup.keyboard([
        ['📊 Set Validation Criteria', '📈 View Sniped Tokens'],
        ['📊 View Paper Trading Tokens', '🔙 Back to Main']
    ]).resize();
    await ctx.reply('⚙️ Settings Menu:', settingsKeyboard);
});
// Set validation criteria
bot.hears('📊 Set Validation Criteria', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const criteriaKeyboard = telegraf_1.Markup.keyboard([
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
    }
    else {
        message += 'Using default criteria\n';
    }
    message += '\n📊 Paper Trading:\n';
    if (paperCriteria) {
        message += `💧 Min Liquidity: $${paperCriteria.minLiquidity}\n`;
        message += `📊 Min Volume: $${paperCriteria.minVolume}\n`;
        message += `⏰ Max Age: ${paperCriteria.maxAge ? `${paperCriteria.maxAge}s` : 'No limit'}\n`;
    }
    else {
        message += 'Using default criteria\n';
    }
    message += '\nChoose an option to modify:';
    await ctx.reply(message, criteriaKeyboard);
});
// View sniped tokens
bot.hears('📈 View Sniped Tokens', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
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
    if (!userId)
        return;
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
    if (!userId)
        return;
    const settingsKeyboard = telegraf_1.Markup.keyboard([
        ['📊 Set Validation Criteria', '📈 View Sniped Tokens'],
        ['📊 View Paper Trading Tokens', '🔙 Back to Main']
    ]).resize();
    await ctx.reply('⚙️ Settings Menu:', settingsKeyboard);
});
