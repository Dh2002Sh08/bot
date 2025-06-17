import { ShyftSdk, Network } from '@shyft-to/js';
import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();
// Raydium Liquidity Pool V4 Program Address
const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
// Shyft API key (replace with your valid key)
const SHYFT_API_KEY = process.env.SHYFT_KEY; // Obtain from https://shyft.to
const SHYFT_WS_PROVIDER = `https://rpc.shyft.to?api_key=${SHYFT_API_KEY}`;
// Fallback public Solana mainnet WebSocket (replace with QuickNode/Helius for production)
const FALLBACK_WS_PROVIDER = 'https://rpc.shyft.to?api_key=44XIeTj8OY_hlPwN';

// In-memory store for recent pools
const tokenList = [];

(async () => {
  try {
    // Test Shyft API key
    console.log('🔍 Validating Shyft API key...');
    let shyft;
    try {
      shyft = new ShyftSdk({ apiKey: SHYFT_API_KEY, network: Network.Mainnet });
      await shyft.wallet.getBalance({ wallet: '2fmz8SuNVyxEP6QwKQs6LNaT2ATszySPEJdhUDesxktc' });
      console.log('✅ Shyft API key is valid');
    } catch (apiErr) {
      console.error('⚠️ Shyft API key validation failed:', apiErr.message);
      console.log('Continuing with raw transaction parsing and fallback provider...');
    }

    // Initialize Solana connection (try Shyft first, then fallback)
    let connection;
    try {
      console.log('🔌 Connecting to Shyft Solana WebSocket...');
      connection = new Connection(SHYFT_WS_PROVIDER, 'confirmed');
      const version = await connection.getVersion();
      console.log('✅ Connected to Shyft node, version:', version['solana-core']);
    } catch (shyftErr) {
      console.error('⚠️ Shyft WebSocket connection failed:', shyftErr.message);
      console.log('🔌 Falling back to public Solana WebSocket...');
      connection = new Connection(FALLBACK_WS_PROVIDER, 'confirmed');
      const version = await connection.getVersion();
      console.log('✅ Connected to fallback node, version:', version['solana-core']);
    }

    // Subscribe to account changes for Raydium program
    console.log('🔌 Subscribing to Raydium pool creation events...');
    const subscriptionId = connection.onProgramAccountChange(
      RAYDIUM_PROGRAM_ID,
      async (info) => {
        try {
          const poolAddress = info.accountId.toBase58();
          const enriched = await enrichToken(poolAddress);
          if (enriched) {
            tokenList.unshift(enriched);
            if (tokenList.length > 50) tokenList.pop(); // Limit to 50 pools
            console.log('🆕 New Raydium Pool Detected!');
            console.log('Pool Address:', poolAddress);
            console.log('Timestamp:', new Date().toISOString());
            console.log('Enriched Pool Data:', enriched);
            console.log('------------------------');
          } else {
            console.log('Invalid pool detected');
          }
        } catch (err) {
          console.log('Invalid pool detected');
        }
      },
      'confirmed'
    );

    console.log('✅ Subscription active, ID:', subscriptionId);

    // Fetch recent past pool creations to verify
    console.log('🔍 Checking recent Raydium pool creations...');
    const signatures = await connection.getSignaturesForAddress(
      RAYDIUM_PROGRAM_ID,
      { limit: 10 } // Check last 10 transactions
    );

    if (signatures.length > 0) {
      console.log(`✅ Found ${signatures.length} recent transactions:`);
      for (const sig of signatures) {
        try {
          const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
          if (tx && tx.meta?.logMessages?.some(log => log.includes('initialize2'))) {
            const accounts = tx.transaction.message.instructions.find(
              inst => inst.programId.equals(RAYDIUM_PROGRAM_ID)
            )?.accounts || [];

            if (accounts.length >= 10) {
              const poolAddress = accounts[4]?.toBase58();
              const enriched = await enrichToken(poolAddress);
              if (enriched) {
                tokenList.unshift(enriched);
                if (tokenList.length > 50) tokenList.pop();
                console.log('🕒 Past Pool Detected!');
                console.log('Transaction Signature:', sig.signature);
                console.log('Timestamp:', new Date((sig.blockTime || 0) * 1000).toISOString());
                console.log('Enriched Pool Data:', enriched);
                console.log('------------------------');
              } else {
                console.log('Invalid pool detected');
              }
            } else {
              console.log('Invalid pool detected');
            }
          }
        } catch (err) {
          console.log('Invalid pool detected');
        }
      }
    } else {
      console.log('ℹ️ No recent pool creation events found.');
    }

    // Handle process termination to unsubscribe gracefully
    process.on('SIGINT', async () => {
      console.log('Unsubscribing and exiting...');
      await connection.removeProgramAccountChangeListener(subscriptionId);
      process.exit();
    });
  } catch (err) {
    console.error('❌ Initialization error:', err);
  }
})();

async function enrichToken(poolAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }

    const mintAddress = data?.pair?.baseToken?.address;

    if (data && data.pair) {
      const pair = data.pair;
      return {
        mint: mintAddress,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
        price: pair.priceUsd,
        liquidity: pair.liquidity.usd,
        age: formatAge(pair.pairCreatedAt),
        solscan: `https://solscan.io/token/${mintAddress}`,
        dexscreener: `https://dexscreener.com/solana/${mintAddress}`,
        birdeye: `https://birdeye.so/token/${mintAddress}?chain=solana`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function formatAge(createdAtMs) {
  const diff = Math.floor((Date.now() - createdAtMs) / 1000); // total seconds
  const days = Math.floor(diff / (3600 * 24));
  const hours = Math.floor((diff % (3600 * 24)) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0 || result === '') result += `${seconds}s`;

  return result.trim();
}