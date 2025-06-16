import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { Liquidity, Token, TokenAmount, Percent } from '@raydium-io/raydium-sdk';
import fetch from 'cross-fetch';

// Configuration
const key = process.env.SHYFT_KEY;
console.log(`Using SHYFT key: ${key ? '✅' : '❌'}`);
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || `https://rpc.shyft.to?api_key=${key}`;
const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const WSOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');
const COMMITMENT = 'confirmed';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/pairs/solana/';
const TOKEN_LIST_URL = 'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json';

// Wallet Setup
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY environment variable is not set');
    process.exit(1);
}

let wallet;
try {
    const decodedKey = bs58.decode(PRIVATE_KEY);
    wallet = Keypair.fromSecretKey(decodedKey);
    console.log('✅ Wallet initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize wallet:', error.message);
    process.exit(1);
}

// Initialize Solana connection
const connection = new Connection(RPC_ENDPOINT, COMMITMENT);

// Token list and flags
const tokenList = [];
let trustedTokens = new Set();
let started = false;
let lastUpdateTime = Date.now();

// Function to broadcast token updates
function broadcastTokenUpdate(token) {
    if (Date.now() - lastUpdateTime > 1000) { // Rate limit updates
        console.log('📊 Token Update:', {
            mint: token.mint,
            name: token.name,
            symbol: token.symbol,
            price: token.price,
            liquidity: token.liquidity,
            age: token.age,
            status: token.status || 'monitoring'
        });
        lastUpdateTime = Date.now();
    }
}

async function loadTrustedTokens() {
    try {
        const res = await fetch(TOKEN_LIST_URL);
        const data = await res.json();
        trustedTokens = new Set(data.tokens.map(t => t.address));
        console.log(`✅ Loaded ${trustedTokens.size} trusted tokens`);
    } catch (err) {
        console.error('⚠️ Failed to load trusted token list:', err.message);
    }
}

async function getTokenAccount(tokenMint, owner) {
    return await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        new PublicKey(tokenMint),
        owner
    );
}

async function getWalletBalance() {
    const lamports = await connection.getBalance(wallet.publicKey);
    return lamports / 1e9;
}

async function executeSwap(tokenMint, amountIn, slippageBps = 500, isSell = false) {
    try {
        const amount = isSell ? amountIn : Math.floor(amountIn * 1e9);
        const slippage = new Percent(slippageBps, 10000);

        const wsolAccount = await getTokenAccount(WSOL_ADDRESS, wallet.publicKey);
        const tokenAccount = await getTokenAccount(tokenMint, wallet.publicKey);

        const poolKeys = await Liquidity.fetchPoolKeys(
            connection,
            new PublicKey(tokenMint),
            WSOL_ADDRESS
        );

        const inputToken = isSell
            ? new Token(TOKEN_PROGRAM_ID, new PublicKey(tokenMint), 9)
            : new Token(TOKEN_PROGRAM_ID, WSOL_ADDRESS, 9, 'WSOL', 'Wrapped SOL');

        const outputToken = isSell
            ? new Token(TOKEN_PROGRAM_ID, WSOL_ADDRESS, 9, 'WSOL', 'Wrapped SOL')
            : new Token(TOKEN_PROGRAM_ID, new PublicKey(tokenMint), 9);

        const amountInToken = new TokenAmount(inputToken, amount);

        const { minAmountOut } = await Liquidity.computeAmountOut({
            poolKeys,
            amountIn: amountInToken,
            slippage,
            connection,
        });

        const swapTx = await Liquidity.makeSwapInstructionSimple({
            connection,
            poolKeys,
            userKeys: {
                tokenAccountIn: isSell ? tokenAccount.address : wsolAccount.address,
                tokenAccountOut: isSell ? wsolAccount.address : tokenAccount.address,
                owner: wallet.publicKey,
            },
            amountIn: amountInToken,
            amountOut: minAmountOut,
            inputToken,
            outputToken,
            swapConfig: { slippage },
        });

        const transaction = new Transaction().add(...swapTx.instructions);
        const signature = await sendAndConfirmTransaction(connection, transaction, [wallet], { commitment: COMMITMENT });
        console.log(`✅ Swap successful: https://solscan.io/tx/${signature}`);
        return signature;
    } catch (error) {
        console.error('❌ Swap failed:', error.message);
        return null;
    }
}

async function sellToken(tokenMint, amount, slippageBps = 500) {
    console.log(`🔻 Selling ${amount} of token: ${tokenMint}`);
    return await executeSwap(tokenMint, amount, slippageBps, true);
}

async function snipeToken(tokenMint, amountInSOL, slippageBps = 500) {
    console.log(`🚀 Sniping token: ${tokenMint}`);

    try {
        const balanceBefore = await getWalletBalance();
        console.log(`💰 Wallet balance before: ${balanceBefore.toFixed(4)} SOL`);

        const mint = new PublicKey(tokenMint);
        const mintInfo = await connection.getParsedAccountInfo(mint);
        if (!mintInfo.value || mintInfo.value.owner.toString() !== TOKEN_PROGRAM_ID.toString()) {
            throw new Error('Invalid token mint');
        }

        if (!trustedTokens.has(tokenMint)) {
            console.warn(`⛔ Token not in trusted list: ${tokenMint}`);
            return { status: 'error', message: 'Token not in trusted list' };
        }

        if (mintInfo.value?.data?.parsed?.info?.freezeAuthority) {
            console.warn(`⚠️ Skipping frozen token: ${tokenMint}`);
            return { status: 'error', message: 'Token is frozen' };
        }

        const signature = await executeSwap(tokenMint, amountInSOL, slippageBps);
        if (signature) {
            const balanceAfter = await getWalletBalance();
            console.log(`💸 Wallet balance after: ${balanceAfter.toFixed(4)} SOL`);
            console.log(`🟢 Token sniped: ${tokenMint}`);
            
            // Update token status in the list
            const tokenIndex = tokenList.findIndex(t => t.mint === tokenMint);
            if (tokenIndex !== -1) {
                tokenList[tokenIndex].status = 'sniped';
                broadcastTokenUpdate(tokenList[tokenIndex]);
            }

            return {
                status: 'success',
                message: 'Token sniped successfully',
                signature,
                balanceBefore,
                balanceAfter
            };
        }
        return { status: 'error', message: 'Swap failed' };
    } catch (error) {
        console.error('❌ Sniping error:', error.message);
        return { status: 'error', message: error.message };
    }
}

async function enrichToken(poolAddress) {
    try {
        const res = await fetch(`${DEXSCREENER_API}${poolAddress}`);
        const text = await res.text();

        if (text.includes('<html') || text.includes('<!DOCTYPE html')) return null;

        let data = JSON.parse(text);
        const mintAddress = data?.pair?.baseToken?.address;
        if (!mintAddress) return null;

        const pair = data.pair;
        const enriched = {
            mint: mintAddress,
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            price: pair.priceUsd,
            liquidity: pair.liquidity.usd,
            age: formatAge(pair.pairCreatedAt),
            status: 'monitoring',
            solscan: `https://solscan.io/token/${mintAddress}`,
            dexscreener: `https://dexscreener.com/solana/${mintAddress}`,
            birdeye: `https://birdeye.so/token/${mintAddress}?chain=solana`,
        };

        tokenList.unshift(enriched);
        if (tokenList.length > 50) tokenList.pop();
        
        broadcastTokenUpdate(enriched);
        return enriched;
    } catch (err) {
        console.error('📡 Enrichment error:', err.message);
        return null;
    }
}

function formatAge(createdAtMs) {
    const diff = Math.floor((Date.now() - createdAtMs) / 1000);
    const days = Math.floor(diff / (3600 * 24));
    const hours = Math.floor((diff % (3600 * 24)) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;

    return `${days > 0 ? `${days}d ` : ''}${hours > 0 ? `${hours}h ` : ''}${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;
}

async function monitorLiquidityPools() {
    if (started) return;
    started = true;
    console.log('📡 Monitoring Raydium for new pools...');

    connection.onProgramAccountChange(
        RAYDIUM_PROGRAM_ID,
        async (info) => {
            const poolAddress = info.accountId.toBase58();
            console.log(`⚡ New pool detected: ${poolAddress}`);

            const enriched = await enrichToken(poolAddress);
            if (enriched && enriched.liquidity > 1000 && trustedTokens.has(enriched.mint)) {
                console.log(`💧 Pool passed filter: ${enriched.mint}, $${enriched.liquidity}`);
                await snipeToken(enriched.mint, 0.1, 500); // Auto-snipe 0.1 SOL
            } else {
                console.log('❌ Skipping pool - low liquidity or untrusted token');
            }
        },
        COMMITMENT
    );
}

async function startBot() {
    console.log('🤖 Starting Solana Sniper Bot...');

    await loadTrustedTokens();

    const balance = await getWalletBalance();
    console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`💰 Balance: ${balance.toFixed(4)} SOL`);

    await monitorLiquidityPools();
}

// API Handler
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action, tokenAddress, amount, slippage } = req.body;

        switch (action) {
            case 'start':
                if (!started) {
                    await startBot();
                    return res.status(200).json({ 
                        message: 'Bot started successfully',
                        tokens: tokenList 
                    });
                }
                return res.status(200).json({ 
                    message: 'Bot already running',
                    tokens: tokenList 
                });

            case 'snipe':
                if (!tokenAddress || !amount) {
                    return res.status(400).json({ error: 'Missing required parameters' });
                }
                const result = await snipeToken(tokenAddress, parseFloat(amount), slippage || 500);
                return res.status(result.status === 'success' ? 200 : 400).json(result);

            case 'status':
                return res.status(200).json({
                    status: started ? 'running' : 'stopped',
                    tokens: tokenList
                });

            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Export manual controls for CLI or GUI integration
export {
    snipeToken,
    sellToken,
};
