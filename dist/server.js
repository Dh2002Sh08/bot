"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegramBot_1 = require("./utils/telegramBot");
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
// Health check endpoint
app.get('/', (req, res) => {
    res.send('Bot is alive!');
});
// Handle bot launch with retries
const startBot = async (retryCount = 0) => {
    try {
        console.log('Starting bot...');
        // Add error handler before launching
        telegramBot_1.bot.catch((err) => {
            console.error('Bot error:', err);
            if (err.description === 'Conflict: terminated by other getUpdates request') {
                console.log('Bot conflict detected, attempting to restart...');
                setTimeout(async () => {
                    try {
                        await telegramBot_1.bot.stop();
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                        await telegramBot_1.bot.telegram.deleteWebhook();
                        await telegramBot_1.bot.launch();
                    }
                    catch (error) {
                        console.error('Failed to restart bot:', error);
                        process.exit(1);
                    }
                }, 1000);
            }
        });
        // Launch the bot
        await telegramBot_1.bot.launch();
        console.log('Bot started successfully');
        // Initialize and start enhanced token scanners for both bots
        await telegramBot_1.sniperBot.initializeEnhancedTokenScanner();
        await telegramBot_1.paperTradeBot.initializeEnhancedTokenScanner();
        console.log('Available networks:');
        console.log('🟡 BSC');
        console.log('🔷 ETH');
        console.log('🟣 SOL');
        // Enable graceful stop
        process.once('SIGINT', () => telegramBot_1.bot.stop('SIGINT'));
        process.once('SIGTERM', () => telegramBot_1.bot.stop('SIGTERM'));
    }
    catch (error) {
        console.error('Failed to start bot:', error);
        if (error.description === 'Conflict: terminated by other getUpdates request' && retryCount < 3) {
            console.log(`Retrying in 15 seconds... (Attempt ${retryCount + 1}/3)`);
            await new Promise(resolve => setTimeout(resolve, 15000));
            return startBot(retryCount + 1);
        }
        console.error('Max retries reached or fatal error. Exiting...');
        process.exit(1);
    }
};
// Start both the bot and Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
    // Start the bot after the server is running
    startBot();
});
