"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaydiumSwap = void 0;
const web3_js_1 = require("@solana/web3.js");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const anchor_1 = require("@project-serum/anchor");
const bs58_1 = __importDefault(require("bs58"));
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const spl_token_1 = require("@solana/spl-token");
class RaydiumSwap {
    constructor(RPC_URL, WALLET_SECRET_KEY) {
        this.allPoolKeysJson = [];
        if (!RPC_URL.startsWith('http://') && !RPC_URL.startsWith('https://')) {
            throw new Error('Invalid RPC URL. Must start with http:// or https://');
        }
        this.connection = new web3_js_1.Connection(RPC_URL, 'confirmed');
        try {
            if (!WALLET_SECRET_KEY) {
                throw new Error('WALLET_SECRET_KEY is not provided');
            }
            const secretKey = bs58_1.default.decode(WALLET_SECRET_KEY);
            if (secretKey.length !== 64) {
                throw new Error('Invalid secret key length. Expected 64 bytes.');
            }
            this.wallet = new anchor_1.Wallet(web3_js_1.Keypair.fromSecretKey(secretKey));
            console.log('Wallet initialized with public key:', this.wallet.publicKey.toBase58());
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`Failed to create wallet: ${error.message}`);
            }
            else {
                throw new Error('Failed to create wallet: Unknown error');
            }
        }
    }
    async loadPoolKeys() {
        try {
            if ((0, fs_1.existsSync)('mainnet.json')) {
                const data = JSON.parse((await (0, promises_1.readFile)('mainnet.json')).toString());
                this.allPoolKeysJson = data.official;
                return;
            }
            throw new Error('mainnet.json file not found');
        }
        catch (error) {
            this.allPoolKeysJson = [];
        }
    }
    findPoolInfoForTokens(mintA, mintB) {
        const poolData = this.allPoolKeysJson.find((i) => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA));
        return poolData ? (0, raydium_sdk_1.jsonInfo2PoolKeys)(poolData) : null;
    }
    async getProgramAccounts(baseMint, quoteMint) {
        const layout = raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4;
        return this.connection.getProgramAccounts(new web3_js_1.PublicKey(RaydiumSwap.RAYDIUM_V4_PROGRAM_ID), {
            filters: [
                { dataSize: layout.span },
                {
                    memcmp: {
                        offset: layout.offsetOf('baseMint'),
                        bytes: new web3_js_1.PublicKey(baseMint).toBase58(),
                    },
                },
                {
                    memcmp: {
                        offset: layout.offsetOf('quoteMint'),
                        bytes: new web3_js_1.PublicKey(quoteMint).toBase58(),
                    },
                },
            ],
        });
    }
    async findRaydiumPoolInfo(baseMint, quoteMint) {
        const baseMintPubkey = typeof baseMint === 'string' ? new web3_js_1.PublicKey(baseMint) : baseMint;
        const quoteMintPubkey = typeof quoteMint === 'string' ? new web3_js_1.PublicKey(quoteMint) : quoteMint;
        const layout = raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4;
        const programData = await this.getProgramAccounts(baseMintPubkey.toBase58(), quoteMintPubkey.toBase58());
        const collectedPoolResults = programData
            .map((info) => ({
            id: new web3_js_1.PublicKey(info.pubkey),
            version: 4,
            programId: new web3_js_1.PublicKey(RaydiumSwap.RAYDIUM_V4_PROGRAM_ID),
            ...layout.decode(info.account.data),
        }))
            .flat();
        const pool = collectedPoolResults[0];
        if (!pool)
            return null;
        const market = await this.connection.getAccountInfo(pool.marketId).then((item) => {
            if (!item) {
                throw new Error('Market account not found');
            }
            return {
                programId: item.owner,
                ...raydium_sdk_1.MARKET_STATE_LAYOUT_V3.decode(item.data),
            };
        });
        const authority = raydium_sdk_1.Liquidity.getAssociatedAuthority({
            programId: new web3_js_1.PublicKey(RaydiumSwap.RAYDIUM_V4_PROGRAM_ID),
        }).publicKey;
        const marketProgramId = market.programId;
        return {
            id: pool.id,
            baseMint: pool.baseMint,
            quoteMint: pool.quoteMint,
            lpMint: pool.lpMint,
            baseDecimals: Number.parseInt(pool.baseDecimal.toString()),
            quoteDecimals: Number.parseInt(pool.quoteDecimal.toString()),
            lpDecimals: Number.parseInt(pool.baseDecimal.toString()),
            version: pool.version,
            programId: pool.programId,
            openOrders: pool.openOrders,
            targetOrders: pool.targetOrders,
            baseVault: pool.baseVault,
            quoteVault: pool.quoteVault,
            marketVersion: 3,
            authority: authority,
            marketProgramId,
            marketId: market.ownAddress,
            marketAuthority: raydium_sdk_1.Market.getAssociatedAuthority({
                programId: marketProgramId,
                marketId: market.ownAddress,
            }).publicKey,
            marketBaseVault: market.baseVault,
            marketQuoteVault: market.quoteVault,
            marketBids: market.bids,
            marketAsks: market.asks,
            marketEventQueue: market.eventQueue,
            withdrawQueue: pool.withdrawQueue,
            lpVault: pool.lpVault,
            lookupTableAccount: web3_js_1.PublicKey.default,
        };
    }
    async getOwnerTokenAccounts() {
        const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
            programId: raydium_sdk_1.TOKEN_PROGRAM_ID,
        });
        return walletTokenAccount.value.map((i) => ({
            pubkey: i.pubkey,
            programId: i.account.owner,
            accountInfo: raydium_sdk_1.SPL_ACCOUNT_LAYOUT.decode(i.account.data),
        }));
    }
    getSwapSide(poolKeys, wantFrom, wantTo) {
        if (poolKeys.baseMint.equals(wantFrom) && poolKeys.quoteMint.equals(wantTo)) {
            return "in";
        }
        else if (poolKeys.baseMint.equals(wantTo) && poolKeys.quoteMint.equals(wantFrom)) {
            return "out";
        }
        else {
            throw new Error("Not suitable pool fetched. Can't determine swap side");
        }
    }
    async getSwapTransaction(toToken, amount, poolKeys, useVersionedTransaction = true, slippage = 5) {
        const poolInfo = await raydium_sdk_1.Liquidity.fetchInfo({ connection: this.connection, poolKeys });
        const fromToken = poolKeys.baseMint.toString() === spl_token_1.NATIVE_MINT.toString() ? spl_token_1.NATIVE_MINT.toString() : poolKeys.quoteMint.toString();
        const swapSide = this.getSwapSide(poolKeys, new web3_js_1.PublicKey(fromToken), new web3_js_1.PublicKey(toToken));
        const baseToken = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, poolKeys.baseMint, poolInfo.baseDecimals);
        const quoteToken = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, poolKeys.quoteMint, poolInfo.quoteDecimals);
        const currencyIn = swapSide === "in" ? baseToken : quoteToken;
        const currencyOut = swapSide === "in" ? quoteToken : baseToken;
        const amountIn = new raydium_sdk_1.TokenAmount(currencyIn, amount, false);
        const slippagePercent = new raydium_sdk_1.Percent(slippage, 100);
        const { amountOut, minAmountOut } = raydium_sdk_1.Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut,
            slippage: slippagePercent,
        });
        const userTokenAccounts = await this.getOwnerTokenAccounts();
        const swapTransaction = await raydium_sdk_1.Liquidity.makeSwapInstructionSimple({
            connection: this.connection,
            makeTxVersion: useVersionedTransaction ? 0 : 1,
            poolKeys: {
                ...poolKeys,
            },
            userKeys: {
                tokenAccounts: userTokenAccounts,
                owner: this.wallet.publicKey,
            },
            amountIn,
            amountOut: minAmountOut,
            fixedSide: swapSide,
            config: {
                bypassAssociatedCheck: false,
            },
            computeBudgetConfig: {
                units: 300000,
                microLamports: 0,
            },
        });
        const recentBlockhashForSwap = await this.connection.getLatestBlockhash();
        const instructions = swapTransaction.innerTransactions[0].instructions.filter((instruction) => Boolean(instruction));
        if (useVersionedTransaction) {
            const versionedTransaction = new web3_js_1.VersionedTransaction(new web3_js_1.TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: recentBlockhashForSwap.blockhash,
                instructions: instructions,
            }).compileToV0Message());
            versionedTransaction.sign([this.wallet.payer]);
            return versionedTransaction;
        }
        const legacyTransaction = new web3_js_1.Transaction({
            blockhash: recentBlockhashForSwap.blockhash,
            lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
            feePayer: this.wallet.publicKey,
        });
        legacyTransaction.add(...instructions);
        return legacyTransaction;
    }
    async sendLegacyTransaction(tx) {
        const signature = await this.connection.sendTransaction(tx, [this.wallet.payer], {
            skipPreflight: true,
            preflightCommitment: 'confirmed',
        });
        const latestBlockhash = await this.connection.getLatestBlockhash();
        const confirmationStrategy = {
            signature: signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        };
        const confirmation = await this.connection.confirmTransaction(confirmationStrategy, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
        }
        return signature;
    }
    async sendVersionedTransaction(tx, blockhash, lastValidBlockHeight) {
        const rawTransaction = tx.serialize();
        const signature = await this.connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            preflightCommitment: 'confirmed',
        });
        const confirmationStrategy = {
            signature: signature,
            blockhash: blockhash,
            lastValidBlockHeight: lastValidBlockHeight,
        };
        const confirmation = await this.connection.confirmTransaction(confirmationStrategy, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
        }
        return signature;
    }
    async simulateLegacyTransaction(tx) {
        const { value } = await this.connection.simulateTransaction(tx);
        return value;
    }
    async simulateVersionedTransaction(tx) {
        const { value } = await this.connection.simulateTransaction(tx);
        return value;
    }
    getTokenAccountByOwnerAndMint(mint) {
        return {
            programId: raydium_sdk_1.TOKEN_PROGRAM_ID,
            pubkey: web3_js_1.PublicKey.default,
            accountInfo: {
                mint: mint,
                amount: 0,
            },
        };
    }
    async createWrappedSolAccountInstruction(amount) {
        const lamports = amount * web3_js_1.LAMPORTS_PER_SOL;
        const wrappedSolAccount = web3_js_1.Keypair.generate();
        const transaction = new web3_js_1.Transaction();
        const rentExemptBalance = await (0, spl_token_1.getMinimumBalanceForRentExemptAccount)(this.connection);
        transaction.add(web3_js_1.SystemProgram.createAccount({
            fromPubkey: this.wallet.publicKey,
            newAccountPubkey: wrappedSolAccount.publicKey,
            lamports: rentExemptBalance,
            space: 165,
            programId: raydium_sdk_1.TOKEN_PROGRAM_ID,
        }), (0, spl_token_1.createInitializeAccountInstruction)(wrappedSolAccount.publicKey, spl_token_1.NATIVE_MINT, this.wallet.publicKey), web3_js_1.SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: wrappedSolAccount.publicKey,
            lamports,
        }), (0, spl_token_1.createSyncNativeInstruction)(wrappedSolAccount.publicKey));
        return { transaction, wrappedSolAccount };
    }
}
exports.RaydiumSwap = RaydiumSwap;
RaydiumSwap.RAYDIUM_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
