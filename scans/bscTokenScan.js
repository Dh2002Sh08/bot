import { Web3 } from 'web3';
import dotenv from 'dotenv';

dotenv.config();
// Minimal ABI with only PairCreated event
const PANCAKESWAP_FACTORY_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token0', type: 'address' },
      { indexed: true, name: 'token1', type: 'address' },
      { indexed: false, name: 'pair', type: 'address' },
      { indexed: false, name: '', type: 'uint256' }
    ],
    name: 'PairCreated',
    type: 'event'
  }
];

const FACTORY_ADDRESS = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'; // PancakeSwap V2 Factory (BSC Mainnet)
const WS_PROVIDER = `wss://aged-cosmological-mound.bsc.quiknode.pro/${process.env.QUICKNODE_KEY}`; // Replace with your BSC WebSocket provider (e.g., QuickNode, Ankr)

(async () => {
  try {
    // Initialize Web3 with WebSocket provider
    const web3 = new Web3(WS_PROVIDER);

    // Create contract instance (optional, kept for potential future use)
    const factoryContract = new web3.eth.Contract(PANCAKESWAP_FACTORY_ABI, FACTORY_ADDRESS);

    const EVENT_SIGNATURE = web3.eth.abi.encodeEventSignature('PairCreated(address,address,address,uint256)');

    console.log('🔌 Subscribing to new PancakeSwap V2 pairs...');

    // Verify WebSocket connection
    web3.eth.net.isListening()
      .then(() => console.log('✅ WebSocket provider connected'))
      .catch(err => console.error('❌ WebSocket provider connection failed:', err));

    // Subscribe to logs for real-time events
    const subscription = await web3.eth.subscribe('logs', {
      address: FACTORY_ADDRESS,
      topics: [EVENT_SIGNATURE]
    });

    // Handle subscription events
    subscription.on('data', (log) => {
      try {
        const decoded = web3.eth.abi.decodeLog(
          PANCAKESWAP_FACTORY_ABI[0].inputs,
          log.data,
          log.topics.slice(1)
        );

        console.log('🆕 New Pair Detected!');
        console.log('Token 0:', decoded.token0);
        console.log('Token 1:', decoded.token1);
        console.log('Pair:', decoded.pair);
        console.log('Block Number:', log.blockNumber);
        console.log('Transaction Hash:', log.transactionHash);
        console.log('------------------------');
      } catch (err) {
        console.error('❌ Error decoding log:', err);
      }
    });

    subscription.on('connected', (subscriptionId) => {
      console.log('✅ Subscription connected:', subscriptionId);
    });

    subscription.on('error', (err) => {
      console.error('❌ Subscription error:', err);
    });

    // Fetch recent past events to verify if pools were missed
    console.log('🔍 Checking recent PairCreated events...');
    const latestBlock = await web3.eth.getBlockNumber();
    const pastEvents = await web3.eth.getPastLogs({
      fromBlock: latestBlock - 1000n, // Check last 1000 blocks
      toBlock: 'latest',
      address: FACTORY_ADDRESS,
      topics: [EVENT_SIGNATURE]
    });

    if (pastEvents.length > 0) {
      console.log(`✅ Found ${pastEvents.length} recent PairCreated events:`);
      for (const log of pastEvents) {
        try {
          const decoded = web3.eth.abi.decodeLog(
            PANCAKESWAP_FACTORY_ABI[0].inputs,
            log.data,
            log.topics.slice(1)
          );
          console.log('🕒 Past Pair Detected!');
          console.log('Token 0:', decoded.token0);
          console.log('Token 1:', decoded.token1);
          console.log('Pair:', decoded.pair);
          console.log('Block Number:', log.blockNumber);
          console.log('------------------------');
        } catch (err) {
          console.error('❌ Error decoding past log:', err);
        }
      }
    } else {
      console.log('ℹ️ No recent PairCreated events found in the last 1000 blocks.');
    }

    // Handle process termination to unsubscribe gracefully
    process.on('SIGINT', async () => {
      console.log('Unsubscribing and exiting...');
      await subscription.unsubscribe();
      process.exit();
    });
  } catch (err) {
    console.error('❌ Initialization error:', err);
  }
})();