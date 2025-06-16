import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

interface BSCWallet {
    address: string;
    privateKey: string;
    balance: string;
}

class BSCWalletManager {
    private static instance: BSCWalletManager;
    private wallets: Map<string, BSCWallet>;
    private readonly STORAGE_KEY = 'bsc_wallets';
    private readonly STORAGE_PATH = path.join(process.cwd(), 'data', 'wallets.json');

    private constructor() {
        this.wallets = new Map();
        this.loadWallets();
    }

    public static getInstance(): BSCWalletManager {
        if (!BSCWalletManager.instance) {
            BSCWalletManager.instance = new BSCWalletManager();
        }
        return BSCWalletManager.instance;
    }

    private loadWallets(): void {
        try {
            if (fs.existsSync(this.STORAGE_PATH)) {
                const storedWallets = fs.readFileSync(this.STORAGE_PATH, 'utf-8');
                const loadedWallets = JSON.parse(storedWallets);
                this.wallets = new Map(Object.entries(loadedWallets));
            }
        } catch (error) {
            console.error('Error loading wallets:', error);
        }
    }

    private saveWallets(): void {
        try {
            const data = JSON.stringify(Object.fromEntries(this.wallets));
            fs.mkdirSync(path.dirname(this.STORAGE_PATH), { recursive: true });
            fs.writeFileSync(this.STORAGE_PATH, data);
        } catch (error) {
            console.error('Error saving wallets:', error);
        }
    }

    public async createWallet(): Promise<BSCWallet> {
        const wallet = ethers.Wallet.createRandom();
        const bscWallet: BSCWallet = {
            address: wallet.address,
            privateKey: wallet.privateKey,
            balance: '0'
        };

        this.wallets.set(wallet.address, bscWallet);
        this.saveWallets();
        return bscWallet;
    }

    public async createMultipleWallets(count: number): Promise<BSCWallet[]> {
        const wallets: BSCWallet[] = [];
        for (let i = 0; i < count; i++) {
            const wallet = await this.createWallet();
            wallets.push(wallet);
        }
        return wallets;
    }

    public async deleteWallet(address: string): Promise<boolean> {
        if (this.wallets.has(address)) {
            this.wallets.delete(address);
            this.saveWallets();
            return true;
        }
        return false;
    }

    public async getWalletBalance(address: string): Promise<string> {
        try {
            const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
            const balance = await provider.getBalance(address);
            return ethers.formatEther(balance);
        } catch (error) {
            console.error('Error getting wallet balance:', error);
            return '0';
        }
    }

    public async updateAllBalances(): Promise<void> {
        for (const [address, wallet] of this.wallets.entries()) {
            const balance = await this.getWalletBalance(address);
            wallet.balance = balance;
            this.wallets.set(address, wallet);
        }
        this.saveWallets();
    }

    public getWallets(): BSCWallet[] {
        return Array.from(this.wallets.values());
    }

    public getWallet(address: string): BSCWallet | undefined {
        return this.wallets.get(address);
    }

    public async transferFunds(
        fromAddress: string,
        toAddress: string,
        amount: string
    ): Promise<boolean> {
        try {
            const wallet = this.wallets.get(fromAddress);
            if (!wallet) return false;

            const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
            const signer = new ethers.Wallet(wallet.privateKey, provider);
            
            const tx = await signer.sendTransaction({
                to: toAddress,
                value: ethers.parseEther(amount)
            });

            await tx.wait();
            await this.updateAllBalances();
            return true;
        } catch (error) {
            console.error('Error transferring funds:', error);
            return false;
        }
    }
}

export default BSCWalletManager; 