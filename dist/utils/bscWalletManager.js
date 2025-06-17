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
const ethers_1 = require("ethers");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class BSCWalletManager {
    constructor() {
        this.STORAGE_KEY = 'bsc_wallets';
        this.STORAGE_PATH = path.join(process.cwd(), 'data', 'wallets.json');
        this.wallets = new Map();
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
            if (fs.existsSync(this.STORAGE_PATH)) {
                const storedWallets = fs.readFileSync(this.STORAGE_PATH, 'utf-8');
                const loadedWallets = JSON.parse(storedWallets);
                this.wallets = new Map(Object.entries(loadedWallets));
            }
        }
        catch (error) {
            console.error('Error loading wallets:', error);
        }
    }
    saveWallets() {
        try {
            const data = JSON.stringify(Object.fromEntries(this.wallets));
            fs.mkdirSync(path.dirname(this.STORAGE_PATH), { recursive: true });
            fs.writeFileSync(this.STORAGE_PATH, data);
        }
        catch (error) {
            console.error('Error saving wallets:', error);
        }
    }
    async createWallet() {
        const wallet = ethers_1.ethers.Wallet.createRandom();
        const bscWallet = {
            address: wallet.address,
            privateKey: wallet.privateKey,
            balance: '0'
        };
        this.wallets.set(wallet.address, bscWallet);
        this.saveWallets();
        return bscWallet;
    }
    async createMultipleWallets(count) {
        const wallets = [];
        for (let i = 0; i < count; i++) {
            const wallet = await this.createWallet();
            wallets.push(wallet);
        }
        return wallets;
    }
    async deleteWallet(address) {
        if (this.wallets.has(address)) {
            this.wallets.delete(address);
            this.saveWallets();
            return true;
        }
        return false;
    }
    async getWalletBalance(address) {
        try {
            const provider = new ethers_1.ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
            const balance = await provider.getBalance(address);
            return ethers_1.ethers.formatEther(balance);
        }
        catch (error) {
            console.error('Error getting wallet balance:', error);
            return '0';
        }
    }
    async updateAllBalances() {
        for (const [address, wallet] of this.wallets.entries()) {
            const balance = await this.getWalletBalance(address);
            wallet.balance = balance;
            this.wallets.set(address, wallet);
        }
        this.saveWallets();
    }
    getWallets() {
        return Array.from(this.wallets.values());
    }
    getWallet(address) {
        return this.wallets.get(address);
    }
    async transferFunds(fromAddress, toAddress, amount) {
        try {
            const wallet = this.wallets.get(fromAddress);
            if (!wallet)
                return false;
            const provider = new ethers_1.ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
            const signer = new ethers_1.ethers.Wallet(wallet.privateKey, provider);
            const tx = await signer.sendTransaction({
                to: toAddress,
                value: ethers_1.ethers.parseEther(amount)
            });
            await tx.wait();
            await this.updateAllBalances();
            return true;
        }
        catch (error) {
            console.error('Error transferring funds:', error);
            return false;
        }
    }
}
exports.default = BSCWalletManager;
