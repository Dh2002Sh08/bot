"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSCWalletManager = void 0;
const ethers_1 = require("ethers");
const web3_js_1 = require("@solana/web3.js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class BSCWalletManager {
    constructor() {
        this.wallets = [];
        this.WALLET_FILE = path.join(__dirname, '../data/wallets.json');
        this.loadWallets();
    }
    static getInstance() {
        if (!BSCWalletManager.instance) {
            BSCWalletManager.instance = new BSCWalletManager();
        }
        return BSCWalletManager.instance;
    }
    loadWallets() {
        try {
            if (fs.existsSync(this.WALLET_FILE)) {
                const data = fs.readFileSync(this.WALLET_FILE, 'utf8');
                this.wallets = JSON.parse(data);
            }
        }
        catch (error) {
            console.error('Error loading wallets:', error);
            this.wallets = [];
        }
    }
    saveWallets() {
        try {
            const dir = path.dirname(this.WALLET_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.WALLET_FILE, JSON.stringify(this.wallets, null, 2));
        }
        catch (error) {
            console.error('Error saving wallets:', error);
        }
    }
    createWallet(network) {
        let wallet;
        switch (network.toLowerCase()) {
            case 'bsc':
                const bscWallet = ethers_1.ethers.Wallet.createRandom();
                wallet = {
                    address: bscWallet.address,
                    privateKey: bscWallet.privateKey,
                    network: 'BSC'
                };
                break;
            case 'eth':
                const ethWallet = ethers_1.ethers.Wallet.createRandom();
                wallet = {
                    address: ethWallet.address,
                    privateKey: ethWallet.privateKey,
                    network: 'ETH'
                };
                break;
            case 'sol':
                const solWallet = web3_js_1.Keypair.generate();
                wallet = {
                    address: solWallet.publicKey.toString(),
                    privateKey: Buffer.from(solWallet.secretKey).toString('hex'),
                    network: 'SOL'
                };
                break;
            default:
                throw new Error(`Unsupported network: ${network}`);
        }
        this.wallets.push(wallet);
        this.saveWallets();
        return wallet;
    }
    getWallets() {
        return this.wallets;
    }
    getWalletsByNetwork(network) {
        return this.wallets.filter(w => w.network.toLowerCase() === network.toLowerCase());
    }
    deleteWallet(address) {
        const initialLength = this.wallets.length;
        this.wallets = this.wallets.filter(w => w.address !== address);
        if (this.wallets.length !== initialLength) {
            this.saveWallets();
            return true;
        }
        return false;
    }
    async getBalance(address) {
        try {
            const provider = new ethers_1.ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
            const balance = await provider.getBalance(address);
            return ethers_1.ethers.formatEther(balance);
        }
        catch (error) {
            console.error('Error getting balance:', error);
            throw new Error('Failed to get wallet balance');
        }
    }
}
exports.BSCWalletManager = BSCWalletManager;
