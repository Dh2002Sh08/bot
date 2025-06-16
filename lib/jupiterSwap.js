// lib/jupiterSwap.js
import {
    VersionedTransaction
  } from '@solana/web3.js';
  
  const JUP_API = 'https://quote-api.jup.ag/v6';
  
  /**
   * Swap SOL → token using Jupiter Aggregator
   * @param {Object} options
   * @param {Connection} options.connection
   * @param {Keypair} options.wallet
   * @param {number} options.amountSol
   * @param {string} options.tokenAddress
   * @returns {string} Signature of the sent transaction
   */
  export async function jupiterSwap({ connection, wallet, amountSol, tokenAddress }) {
    const inputMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    const outputMint = tokenAddress;
    const amount = Math.floor(amountSol * 1e9); // Convert SOL → lamports
    const slippageBps = 100; // 1% slippage
  
    // 1. Get quote
    const quoteUrl = `${JUP_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
    const quoteRes = await fetch(quoteUrl);
    const quote = await quoteRes.json();
  
    if (!quote.routes || quote.routes.length === 0) {
      throw new Error('No quote available');
    }
  
    const route = quote.routes[0];
  
    // 2. Get swap transaction
    const swapRes = await fetch(`${JUP_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapUnwrapSOL: true,
        feeAccount: null,
      }),
    });
  
    const swapJson = await swapRes.json();
  
    if (!swapJson.swapTransaction) {
      throw new Error('Swap transaction not returned');
    }
  
    // 3. Decode and sign transaction
    const swapTxBuf = Buffer.from(swapJson.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTxBuf);
    transaction.sign([wallet]);
  
    // 4. Send transaction
    const sig = await connection.sendTransaction(transaction, {
      skipPreflight: true,
    });
    await connection.confirmTransaction(sig, 'confirmed');
  
    return sig;
  }
  