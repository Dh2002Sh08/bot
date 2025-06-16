import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

interface Wallet {
    address: string;
    privateKey: string;
    network: string;
}

export class BSCWalletManager {
    private static instance: BSCWalletManager;
    private wallets: Wallet[] = [];
    private readonly WALLET_FILE = path.join(__dirname, '../data/wallets.json');

    private constructor() {
        this.loadWallets();
    }

    public static getInstance(): BSCWalletManager {
        if (!BSCWalletManager.instance) {
            BSCWalletManager.instance = new BSCWalletManager();
        }
        return BSCWalletManager.instance;
    }

    private loadWallets() {
        try {
            if (fs.existsSync(this.WALLET_FILE)) {
                const data = fs.readFileSync(this.WALLET_FILE, 'utf8');
                this.wallets = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading wallets:', error);
            this.wallets = [];
        }
    }

    private saveWallets() {
        try {
            const dir = path.dirname(this.WALLET_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.WALLET_FILE, JSON.stringify(this.wallets, null, 2));
        } catch (error) {
            console.error('Error saving wallets:', error);
        }
    }

    createWallet(network: string): Wallet {
        let wallet: Wallet;

        switch (network.toLowerCase()) {
            case 'bsc':
                const bscWallet = ethers.Wallet.createRandom();
                wallet = {
                    address: bscWallet.address,
                    privateKey: bscWallet.privateKey,
                    network: 'BSC'
                };
                break;

            case 'eth':
                const ethWallet = ethers.Wallet.createRandom();
                wallet = {
                    address: ethWallet.address,
                    privateKey: ethWallet.privateKey,
                    network: 'ETH'
                };
                break;

            case 'sol':
                const solWallet = Keypair.generate();
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

    getWallets(): Wallet[] {
        return this.wallets;
    }

    getWalletsByNetwork(network: string): Wallet[] {
        return this.wallets.filter(w => w.network.toLowerCase() === network.toLowerCase());
    }

    deleteWallet(address: string): boolean {
        const initialLength = this.wallets.length;
        this.wallets = this.wallets.filter(w => w.address !== address);
        if (this.wallets.length !== initialLength) {
            this.saveWallets();
            return true;
        }
        return false;
    }

    async getBalance(address: string): Promise<string> {
        try {
            const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
            const balance = await provider.getBalance(address);
            return ethers.formatEther(balance);
        } catch (error) {
            console.error('Error getting balance:', error);
            throw new Error('Failed to get wallet balance');
        }
    }
} 