// pages/api/create-wallets.js
import { createWallets } from '@/lib/walletManager';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { count } = req.body;

  if (!count || count < 1 || count > 100) {
    return res.status(400).json({ error: 'Count must be between 1 and 100' });
  }

  try {
    const wallets = await createWallets(count);
    res.status(200).json({ wallets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
