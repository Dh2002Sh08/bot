// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createWallets, getWalletList } = require('./walletManager');
const { startVolumeBot } = require('./volumeBot');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

/**
 * @route POST /api/create-wallets
 * @desc Create multiple wallets (max 100)
 * @body { count: number }
 */
app.post('/api/create-wallets', async (req, res) => {
    const { count } = req.body;
    if (!count || count < 1 || count > 100) {
        return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }

    try {
        const wallets = await createWallets(count);
        res.json({ wallets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route POST /api/start-bot
 * @desc Start volume bot with wallets and configuration
 * @body { tokenAddress, wallets, totalTransactions, trxPerMinute, amountPerBuy }
 */
app.post('/api/start-bot', async (req, res) => {
    const { tokenAddress, wallets, totalTransactions, trxPerMinute, amountPerBuy } = req.body;

    if (!tokenAddress || !wallets || !Array.isArray(wallets) || wallets.length === 0) {
        return res.status(400).json({ error: 'Invalid token address or wallets list' });
    }

    try {
        await startVolumeBot({ tokenAddress, wallets, totalTransactions, trxPerMinute, amountPerBuy });
        res.json({ message: 'Volume bot started' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/wallets
 * @desc List all generated wallets
 */
app.get('/api/wallets', (req, res) => {
    try {
        const wallets = getWalletList();
        res.json({ wallets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Volume bot server running on http://localhost:${PORT}`);
});
