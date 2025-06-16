// pages/api/wallets.js
import { getWalletList } from '../../lib/walletManager';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  try {
    const wallets = getWalletList();
    res.status(200).json({ wallets });
  } catch (error) {
    console.error('[wallets.js] Error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve wallet list.' });
  }
}
