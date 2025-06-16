// pages/api/start-bot.js
import { startVolumeBot } from '../../lib/volumeBot';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Store active bot instances
const activeBots = new Map();

export default async function handler(req, res) {
  // Handle GET requests for EventSource
  if (req.method === 'GET') {
    const { botId } = req.query;
    
    if (!botId || !activeBots.has(botId)) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const bot = activeBots.get(botId);
    bot.clients.add(res);

    // Send initial status
    const initialMessage = { type: 'status', status: 'connected' };
    console.log('[API] Sending initial status:', initialMessage);
    res.write(`data: ${JSON.stringify(initialMessage)}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
      bot.clients.delete(res);
      if (bot.clients.size === 0) {
        // If no clients are connected, stop the bot
        if (bot.stop) {
          bot.stop();
        }
        activeBots.delete(botId);
      }
    });

    return;
  }

  // Handle POST requests for starting the bot
  if (req.method === 'POST') {
    try {
      const { tokenAddress, totalTransactions, trxPerMinute, amountPerBuy, wallets } = req.body;

      if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
        return res.status(400).json({ error: 'No wallets provided' });
      }

      // Convert wallet data to Keypairs
      const walletKeypairs = wallets.map(wallet => {
        try {
          return Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
        } catch (error) {
          console.error('Error converting wallet:', error);
          return null;
        }
      }).filter(Boolean);

      if (walletKeypairs.length === 0) {
        return res.status(400).json({ error: 'No valid wallets provided' });
      }

      console.log('[API] Using wallets:', walletKeypairs.length);

      // Generate a unique ID for this bot instance
      const botId = Date.now().toString();

      // Create a Set to store connected clients
      const clients = new Set();

      // Function to broadcast to all clients
      const broadcast = (data) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        clients.forEach(client => {
          try {
            client.write(message);
          } catch (error) {
            console.error('Error broadcasting to client:', error);
            clients.delete(client);
          }
        });
      };

      // Start the bot
      const stopBot = await startVolumeBot({
        tokenAddress,
        walletKeypairs,
        totalTransactions,
        trxPerMinute,
        amountPerBuy,
        onError: (error, walletIndex) => {
          const message = `Error: ❌ Wallet[${walletIndex}] failed: ${error.message}`;
          console.error('[API] Error:', message);
          broadcast({ type: 'error', message });
        },
        onLog: (message) => {
          console.log('[API] Log:', message);
          broadcast({ type: 'log', message });
        },
        onTransactionComplete: (data) => {
          console.log('[API] Transaction complete:', data);
          broadcast({ type: 'transaction_complete', ...data });
        }
      });

      // Store the bot instance
      activeBots.set(botId, {
        stop: stopBot,
        clients,
        broadcast
      });

      console.log('[API] Bot started successfully with ID:', botId);
      return res.status(200).json({ botId });
    } catch (err) {
      console.error('[API] Error starting bot:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { botId } = req.query;

    if (!botId || !activeBots.has(botId)) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const bot = activeBots.get(botId);
    
    // Stop the bot
    if (bot.stop) {
      bot.stop();
    }

    // Notify all clients
    bot.broadcast({ type: 'status', status: 'stopped' });

    // Close all client connections
    bot.clients.forEach(client => {
      try {
        client.end();
      } catch (error) {
        console.error('Error closing client connection:', error);
      }
    });

    // Remove the bot instance
    activeBots.delete(botId);

    return res.status(200).json({ message: 'Bot stopped successfully' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
