import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

import { SniperBot, NETWORK_CONFIGS } from '../lib/sniperBot';
import { volumeBot } from '../lib/volumeBot';
import { BSCWalletManager } from './walletManager';
// import { walletStorage } from './walletStorage';

dotenv.config();

// Define session interface
interface MySession extends Scenes.WizardSession {
    network?: 'ETH' | 'BSC' | 'SOL';
    privateKey?: string;
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
const sniperBot = new SniperBot({
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
    ['❌ Stop Bot'],
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
            `📊 Your ${network} Wallet:\n\n` +
            `Status: ${walletState.isActive ? '✅ Active' : '❌ Inactive'}\n` +
            `Address: \`${wallet.address}\`\n` +
            `Private Key: \`${walletState.privateKey}\`\n\n` +
            '⚠️ **IMPORTANT:** Save these details securely! This message will be deleted automatically in 2 minutes.',
            {
                parse_mode: 'Markdown',
                ...walletManagementKeyboard
            }
        );

        setTimeout(async () => {
            try {
                await ctx.deleteMessage(replyMessage.message_id);
            } catch (error) {
                console.error('Error deleting message for user (', userId, '):', error);
            }
        }, 120000);
    }
});

bot.hears('📈 User Sniped Token', async (ctx) => {
    await ctx.scene.enter('tokenInput');
});

bot.hears('❌ Stop Bot', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    sniperBot.stopBackgroundMonitoring(userId);
    await ctx.reply('🛑 Sniper Bot stopped.', mainKeyboard);
});

bot.hears('🔙 Back to Main', async (ctx) => {
    await ctx.reply('Main Menu:', mainKeyboard);
});

bot.hears('⚙️ Settings', async (ctx) => {
    await ctx.reply('Settings menu is under development.', backToMainKeyboard);
});

// --- WIZARD SCENES ---

// Token Input Wizard Scene for "My Sniped Tokens"
const tokenInputScene = new Scenes.WizardScene<MyContext>(
    'tokenInput',
    async (ctx) => {
        await ctx.reply('Please enter the token address you want to buy:', backToMainKeyboard);
        return ctx.wizard.next();
    },
    async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return ctx.scene.leave();

        // Ensure the message is text and has content
        if (!ctx.message || !('text' in ctx.message)) {
            await ctx.reply('❌ Invalid input. Please send a text message with the token address.');
            return ctx.wizard.back(); // Go back to the previous step (ask again)
        }

        const tokenAddress = ctx.message.text.trim();
        if (!tokenAddress) {
            await ctx.reply('❌ Token address cannot be empty.');
            return ctx.wizard.back();
        }

        try {
            await ctx.reply(`🔍 Checking token ${tokenAddress} on DEX Screener and wallet funds...`);
            await sniperBot.buyTokenFromUserInput(userId, tokenAddress);
            await ctx.reply(`✅ Successfully processed token: ${tokenAddress}`);
        } catch (error) {
            await ctx.reply(`❌ Failed to process token: ${(error as Error).message}`);
        } finally {
            return ctx.scene.leave();
        }
    }
);

// Load Wallet Wizard Scene
const loadWalletScene = new Scenes.WizardScene<MyContext>(
    'loadWallet',
    async (ctx) => {
        await ctx.reply('Please enter the network (ETH, BSC, SOL):', backToMainKeyboard);
        return ctx.wizard.next();
    },
    async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return ctx.scene.leave();

        // Ensure the message is text and has content
        if (!ctx.message || !('text' in ctx.message)) {
            await ctx.reply('❌ Invalid input. Please send a text message with the network (ETH, BSC, or SOL).');
            return ctx.wizard.back();
        }

        const networkInput = ctx.message.text.trim().toUpperCase();
        if (networkInput !== 'ETH' && networkInput !== 'BSC' && networkInput !== 'SOL') {
            await ctx.reply('❌ Invalid network. Please enter ETH, BSC, or SOL.');
            return ctx.wizard.back();
        }
        ctx.session.network = networkInput as 'ETH' | 'BSC' | 'SOL';
        
        await ctx.reply('Please enter your private key:', backToMainKeyboard);
        return ctx.wizard.next();
    },
    async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return ctx.scene.leave();

        // Ensure the message is text and has content
        if (!ctx.message || !('text' in ctx.message)) {
            await ctx.reply('❌ Invalid input. Please send a text message with your private key.');
            return ctx.wizard.back();
        }

        const privateKey = ctx.message.text.trim();
        if (!privateKey) {
            await ctx.reply('❌ Private key cannot be empty.');
            return ctx.wizard.back();
        }

        const network = ctx.session.network;
        if (!network) {
            await ctx.reply('❌ Network information missing. Please restart the /loadwallet command.');
            return ctx.scene.leave();
        }

        try {
            sniperBot.setUserWallet(userId, network, privateKey);
            const wallet = sniperBot.getUserWallet(userId, network);
            if (wallet) {
                const replyMessage = await ctx.reply(
                    `✅ ${network} Wallet Loaded!\n\n` +
                    `Address: \`${wallet.address}\`\n` +
                    `Private Key: \`${wallet.privateKey}\`\n\n` +
                    '⚠️ **IMPORTANT:** Save these details securely! This message will be deleted automatically in 2 minutes.',
                    {
                        parse_mode: 'Markdown',
                        ...backToMainKeyboard
                    }
                );

                setTimeout(async () => {
                    try {
                        await ctx.deleteMessage(replyMessage.message_id);
                    } catch (error) {
                        console.error('Error deleting message for user (', userId, '):', error);
                    }
                }, 120000);
            } else {
                 await ctx.reply('❌ Failed to load wallet. Please check your private key.', backToMainKeyboard);
            }
        } catch (error) {
            await ctx.reply(`❌ Error loading wallet: ${(error as Error).message}`, backToMainKeyboard);
        } finally {
            return ctx.scene.leave();
        }
    }
);

// Add configuration scene
const configScene = new Scenes.WizardScene<MyContext>(
    'config',
    async (ctx) => {
        await ctx.reply(
            'Please configure your Sniper Bot settings:\n\n' +
            '1. Amount to trade (in ETH/BNB/SOL)\n' +
            '2. Slippage (%)\n' +
            '3. Stop Loss (%)\n' +
            '4. Take Profit (%)\n\n' +
            'Reply with values separated by spaces (e.g., "0.1 5 10 20")',
            backToMainKeyboard
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return ctx.scene.leave();

        if (!ctx.message || !('text' in ctx.message)) {
            await ctx.reply('❌ Invalid input. Please provide numbers separated by spaces.');
            return ctx.wizard.back();
        }

        const [amount, slippage, stopLoss, takeProfit] = ctx.message.text.split(' ').map(Number);
        
        if (isNaN(amount) || isNaN(slippage) || isNaN(stopLoss) || isNaN(takeProfit)) {
            await ctx.reply('❌ Invalid numbers. Please provide valid numbers separated by spaces.');
            return ctx.wizard.back();
        }

        // Update user's configuration
        sniperBot.updateUserConfig(userId, {
            amount,
            slippage,
            stopLoss,
            takeProfit,
            onError: sniperBot.getErrorCallback(),
            onLog: sniperBot.getLogCallback()
        });

        await ctx.reply(
            '✅ Configuration saved!\n\n' +
            `Amount: ${amount} ETH/BNB/SOL\n` +
            `Slippage: ${slippage}%\n` +
            `Stop Loss: ${stopLoss}%\n` +
            `Take Profit: ${takeProfit}%`,
            mainKeyboard
        );

        return ctx.scene.leave();
    }
);

// Register the config scene
stage.register(configScene);

stage.register(tokenInputScene, loadWalletScene);

// Command to enter the load wallet wizard
bot.command('loadwallet', (ctx) => ctx.scene.enter('loadWallet'));

// Add configuration command
bot.command('config', (ctx) => ctx.scene.enter('config'));

// Add command suggestions
bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'loadwallet', description: 'Load existing wallet' },
    { command: 'config', description: 'Configure bot settings' },
    { command: 'balance', description: 'Check wallet balances' },
    { command: 'stop', description: 'Stop the bot' }
]);

// Add balance check handler
bot.hears(/💰 Check (ETH|BSC|SOL) Balance/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const networkText = ctx.match[1];
    const network = networkText as 'ETH' | 'BSC' | 'SOL';

    try {
        const balance = await sniperBot.getWalletBalance(userId, network);
        const emoji = network === 'ETH' ? '🔷' : network === 'BSC' ? '🟡' : '🟣';
        
        // Create keyboard with balance check button
        const keyboard = Markup.keyboard([
            [Markup.button.text(`💰 Check ${network} Balance`)],
            ['🔙 Back to Main']
        ]).resize();

        await ctx.reply(`${emoji} ${network} Balance: ${balance}`, keyboard);
    } catch (error) {
        await ctx.reply(`❌ Failed to get balance: ${(error as Error).message}`);
    }
});

// Add balance command
bot.command('balance', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
        const balances = [];
        for (const network of ['ETH', 'BSC', 'SOL'] as const) {
            if (sniperBot.hasUserWallet(userId, network)) {
                const balance = await sniperBot.getWalletBalance(userId, network);
                const emoji = network === 'ETH' ? '🔷' : network === 'BSC' ? '🟡' : '🟣';
                balances.push(`${emoji} ${network}: ${balance}`);
            }
        }

        if (balances.length > 0) {
            const message = `💰 Wallet Balances:\n${balances.join('\n')}`;
            await ctx.reply(message);
        } else {
            await ctx.reply('❌ No wallets found. Please create a wallet first.');
        }
    } catch (error) {
        await ctx.reply(`❌ Failed to get balances: ${(error as Error).message}`);
    }
});

export default bot;