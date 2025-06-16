// lib/walletManager.js
import { Keypair } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

const WALLETS_FILE = path.join(process.cwd(), 'data', 'wallets.json');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(WALLETS_FILE))) {
  fs.mkdirSync(path.dirname(WALLETS_FILE), { recursive: true });
}

// Initialize wallet store from file or create empty
let walletStore = {};
try {
  if (fs.existsSync(WALLETS_FILE)) {
    const data = fs.readFileSync(WALLETS_FILE, 'utf8');
    const storedWallets = JSON.parse(data);
    
    // Convert stored wallets back to Keypair objects
    walletStore = Object.entries(storedWallets).reduce((acc, [id, wallet]) => {
      acc[id] = {
        ...wallet,
        keypair: Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
      };
      return acc;
    }, {});
  }
} catch (error) {
  console.error('Error loading wallets:', error);
  walletStore = {};
}

// Save wallets to file
function saveWallets() {
  try {
    // Convert wallets to storable format (without Keypair objects)
    const storableWallets = Object.entries(walletStore).reduce((acc, [id, wallet]) => {
      acc[id] = {
        id: wallet.id,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey
      };
      return acc;
    }, {});
    
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(storableWallets, null, 2));
  } catch (error) {
    console.error('Error saving wallets:', error);
  }
}

/**
 * Create multiple new wallets
 * @param {number} count
 * @returns {Array} Wallets with ID, pubkey, and privateKey (base58)
 */
export async function createWallets(count) {
  const created = [];

  for (let i = 0; i < count; i++) {
    const keypair = Keypair.generate();
    const id = uuidv4();

    const wallet = {
      id,
      publicKey: keypair.publicKey.toBase58(),
      privateKey: bs58.encode(keypair.secretKey),
      keypair, // Store actual Keypair object for later usage (NOT sent to frontend)
    };

    walletStore[id] = wallet;
    created.push({
      id,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
    });
  }

  // Save wallets after creating new ones
  saveWallets();

  return created;
}

/**
 * Get all stored wallets (only ID and publicKey shown)
 */
export function getWalletList() {
  return Object.values(walletStore).map(wallet => ({
    id: wallet.id,
    publicKey: wallet.publicKey,
  }));
}

/**
 * Get full wallet data (including Keypair) by ID
 */
export function getWalletById(id) {
  return walletStore[id] || null;
}

/**
 * Delete a wallet by ID
 */
export function deleteWallet(id) {
  if (walletStore[id]) {
    delete walletStore[id];
    saveWallets();
    return true;
  }
  return false;
}

/**
 * Delete all wallets
 */
export function deleteAllWallets() {
  walletStore = {};
  saveWallets();
}

/**
 * Load all wallet keypairs for bot usage
 * @returns {Array} Array of Keypair objects
 */
export function loadWallets() {
  return Object.values(walletStore).map(wallet => wallet.keypair);
}
