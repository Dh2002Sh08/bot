import { botInstances } from '../../lib/volumeBot';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { botId } = req.body;

    if (!botId) {
      return res.status(400).json({ error: 'Bot ID is required' });
    }

    const bot = botInstances.get(botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Force stop the bot
    bot.stop();
    botInstances.delete(botId);

    // Notify all connected clients
    if (bot.clients) {
      bot.clients.forEach(client => {
        client.write(`data: ${JSON.stringify({ type: 'status', status: 'stopped' })}\n\n`);
      });
    }

    return res.status(200).json({ message: 'Bot stopped successfully' });
  } catch (error) {
    console.error('Error stopping bot:', error);
    return res.status(500).json({ error: 'Failed to stop bot' });
  }
} 