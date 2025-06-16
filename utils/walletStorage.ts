// import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
// import fs from 'fs';
// import path from 'path';

// interface StoredWallet {
//     isActive: boolean;
//     privateKey: string;
// }

// interface UserWallets {
//     [network: string]: StoredWallet;
// }

// interface WalletData {
//     [userId: string]: UserWallets;
// }

// class WalletStorage {
//     private readonly storagePath: string;
//     private readonly encryptionKey: Buffer;
//     private readonly iv: Buffer;

//     constructor() {
//         // Create .wallets directory if it doesn't exist
//         this.storagePath = path.join(process.cwd(), '.wallets');
//         if (!fs.existsSync(this.storagePath)) {
//             fs.mkdirSync(this.storagePath, { recursive: true });
//         }

//         // Use environment variable for encryption key or generate one
//         const key = process.env.WALLET_ENCRYPTION_KEY || randomBytes(32).toString('hex');
//         this.encryptionKey = Buffer.from(key, 'hex');
//         this.iv = randomBytes(16);
//     }

//     private encrypt(data: string): string {
//         const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, this.iv);
//         let encrypted = cipher.update(data, 'utf8', 'hex');
//         encrypted += cipher.final('hex');
//         return encrypted;
//     }

//     private decrypt(encrypted: string): string {
//         const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, this.iv);
//         let decrypted = decipher.update(encrypted, 'hex', 'utf8');
//         decrypted += decipher.final('utf8');
//         return decrypted;
//     }

//     private getWalletFilePath(userId: number): string {
//         return path.join(this.storagePath, `wallets_${userId}.enc`);
//     }

//     saveWallets(userId: number, wallets: UserWallets): void {
//         const filePath = this.getWalletFilePath(userId);
//         const encrypted = this.encrypt(JSON.stringify(wallets));
//         fs.writeFileSync(filePath, encrypted);
//     }

//     loadWallets(userId: number): UserWallets | null {
//         const filePath = this.getWalletFilePath(userId);
//         try {
//             if (!fs.existsSync(filePath)) {
//                 return null;
//             }
//             const encrypted = fs.readFileSync(filePath, 'utf8');
//             const decrypted = this.decrypt(encrypted);
//             return JSON.parse(decrypted);
//         } catch (error) {
//             console.error(`Error loading wallets for user ${userId}:`, error);
//             return null;
//         }
//     }

//     deleteWallets(userId: number): void {
//         const filePath = this.getWalletFilePath(userId);
//         if (fs.existsSync(filePath)) {
//             fs.unlinkSync(filePath);
//         }
//     }
// }

// export const walletStorage = new WalletStorage(); 