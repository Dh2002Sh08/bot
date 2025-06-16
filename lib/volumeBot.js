// lib/volumeBot.js

import { Connection, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
// import fetch from 'node-fetch';

// Export botInstances Map for managing bot instances
export const botInstances = new Map();

// Setup Solana + Jupiter
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const jupiter = createJupiterApiClient({ basePath: 'https://public.jupiterapi.com' });

/**
 * Perform a real swap (SOL -> SPL token) using Jupiter API
 */
export async function performSwap(wallet, tokenAddress, amountSol, onLog) {
  try {
    const inputMint = 'So11111111111111111111111111111111111111112'; // wSOL
    const outputMint = tokenAddress;
    const amount = Math.floor(amountSol * 1e9); // Convert SOL to lamports

    onLog(`[Swap] Starting swap for wallet ${wallet.publicKey.toBase58()}`);
    onLog(`[Swap] Amount: ${amountSol} SOL (${amount} lamports)`);
    onLog(`[Swap] Token: ${tokenAddress}`);

    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    onLog(`[Swap] Wallet balance: ${balance / 1e9} SOL`);
    
    if (balance < amount) {
      throw new Error(`Insufficient balance. Required: ${amountSol} SOL, Available: ${balance / 1e9} SOL`);
    }

    // 1. Get Quote
    onLog('[Swap] Getting quote from Jupiter...');
    const quote = await jupiter.quoteGet({
      inputMint,
      outputMint,
      amount,
      slippageBps: 100,
    });

    if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
      throw new Error('No swap route found. Possibly due to zero SOL or illiquid token.');
    }

    onLog(`[Swap] Quote received. Output amount: ${quote.outAmount} tokens`);

    // 2. Build Swap Transaction
    onLog('[Swap] Building swap transaction...');
    const swapRes = await jupiter.swapPost({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
    });

    if (!swapRes.swapTransaction) {
      throw new Error('Failed to get swap transaction. Likely insufficient SOL.');
    }

    // 3. Deserialize & Sign
    onLog('[Swap] Deserializing and signing transaction...');
    const txBuf = Buffer.from(swapRes.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);

    // 4. Send Transaction
    onLog('[Swap] Sending transaction...');
    const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    onLog(`[Swap] Transaction sent: ${txid}`);
    
    onLog('[Swap] Waiting for confirmation...');
    const confirmation = await connection.confirmTransaction(txid, 'confirmed');
    onLog('[Swap] Transaction confirmed:', confirmation);

    return txid;
  } catch (error) {
    onLog(`[Swap] Error details: ${error.message}`);
    throw error;
  }
}

/**
 * Start volume bot: spreads transactions across multiple wallets
 */
export async function startVolumeBot({
  tokenAddress,
  walletKeypairs,
  totalTransactions,
  trxPerMinute,
  amountPerBuy,
  onError = () => {},
  onLog = () => {},
  onTransactionComplete = () => {},
}) {
  let sent = 0;
  let currentWalletIndex = 0;

  const intervalMs = Math.floor(60000 / trxPerMinute);
  onLog(`🚀 Starting Volume Bot: ${totalTransactions} total tx @ ${trxPerMinute}/min...`);
  onLog(`💰 Amount per buy: ${amountPerBuy} SOL`);
  onLog(`👛 Number of wallets: ${walletKeypairs.length}`);

  const interval = setInterval(async () => {
    if (sent >= totalTransactions) {
      clearInterval(interval);
      onLog('✅ All transactions completed.');
      return;
    }

    const keypair = walletKeypairs[currentWalletIndex % walletKeypairs.length];
    const pubkey = keypair.publicKey.toBase58();
    onLog(`[VolumeBot] 🔁 Wallet ${currentWalletIndex + 1}: ${pubkey}`);

    try {
      // Check wallet balance before attempting swap
      const balance = await connection.getBalance(keypair.publicKey);
      onLog(`[VolumeBot] Wallet balance: ${balance / 1e9} SOL`);

      if (balance < amountPerBuy * 1e9) {
        throw new Error(`Insufficient balance. Required: ${amountPerBuy} SOL, Available: ${balance / 1e9} SOL`);
      }

      const txid = await performSwap(keypair, tokenAddress, amountPerBuy, onLog);
      onLog(`✅ Transaction ${sent + 1}/${totalTransactions}: ${txid}`);
      sent++;
      onTransactionComplete({
        wallet: pubkey,
        txid,
        status: 'success'
      });
    } catch (err) {
      const reason = err?.message || 'Unknown error';
      onError(err, currentWalletIndex);
      onLog(`❌ Transaction failed for wallet[${currentWalletIndex}]: ${reason}`);
      onTransactionComplete({
        wallet: pubkey,
        status: 'failed',
        error: reason
      });
    }

    currentWalletIndex++;
  }, intervalMs);

  // Return cleanup function
  return () => {
    clearInterval(interval);
    onLog('🛑 Volume bot stopped.');
  };
}

// class VolumeBot {
//   constructor(config) {
//     this.config = config;
//     this.isRunning = false;
//     this.clients = new Set();
//     this.currentTransaction = 0;
//     this.stopRequested = false;
//   }

//   stop() {
//     this.isRunning = false;
//     this.stopRequested = true;
//     this.currentTransaction = 0;
    
//     // Clear any pending timeouts
//     if (this.timeoutId) {
//       clearTimeout(this.timeoutId);
//       this.timeoutId = null;
//     }

//     // Clear any pending intervals
//     if (this.intervalId) {
//       clearInterval(this.intervalId);
//       this.intervalId = null;
//     }

//     // Notify all clients
//     this.broadcast({ type: 'log', message: 'Bot stopped' });
//     this.broadcast({ type: 'status', status: 'stopped' });
//   }

//   async start() {
//     if (this.isRunning) return;
    
//     this.isRunning = true;
//     this.stopRequested = false;
//     this.currentTransaction = 0;

//     try {
//       // ... existing start code ...

//       // Process transactions
//       const processNextTransaction = async () => {
//         if (!this.isRunning || this.stopRequested || this.currentTransaction >= this.config.totalTransactions) {
//           this.stop();
//           return;
//         }

//         try {
//           // ... existing transaction code ...
//         } catch (error) {
//           console.error('Transaction error:', error);
//           this.broadcast({ type: 'error', message: error.message });
//         }

//         // Schedule next transaction only if still running
//         if (this.isRunning && !this.stopRequested) {
//           this.timeoutId = setTimeout(processNextTransaction, delayBetweenTransactions);
//         }
//       };

//       // Start processing transactions
//       processNextTransaction();
//     } catch (error) {
//       console.error('Bot error:', error);
//       this.broadcast({ type: 'error', message: error.message });
//       this.stop();
//     }
//   }

//   // ... rest of the existing code ...
// }
