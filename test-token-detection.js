const { EnhancedTokenScanner } = require('./dist/lib/enhancedTokenScanner');

// Test configuration
const testConfig = {
    minLiquidity: 100,
    minVolume: 1,
    requireDexScreener: true,
    enableHoneypotDetection: false,
    excludeStablecoins: true,
    minTokenAge: 30,
    maxTokenAge: 604800
};

// Token detection callback
const onTokenDetected = (tokenData) => {
    console.log('🎯 TOKEN DETECTED!');
    console.log('Symbol:', tokenData.symbol);
    console.log('Name:', tokenData.name);
    console.log('Network:', tokenData.network);
    console.log('Price:', tokenData.price);
    console.log('Liquidity:', tokenData.liquidity);
    console.log('Volume:', tokenData.volume24h);
    console.log('Age:', tokenData.age);
    console.log('Address:', tokenData.address);
    console.log('DexScreener URL:', tokenData.dexScreenerUrl);
    console.log('---');
};

// Error callback
const onError = (error) => {
    console.error('❌ Scanner error:', error);
};

async function testTokenDetection() {
    try {
        console.log('🧪 Testing Enhanced Token Scanner...');
        
        // Create scanner instance
        const scanner = new EnhancedTokenScanner(testConfig, onTokenDetected, onError);
        
        // Initialize
        console.log('🔧 Initializing scanner...');
        await scanner.initialize();
        console.log('✅ Scanner initialized');
        
        // Start scanning for all networks
        console.log('🚀 Starting scanner for all networks...');
        await scanner.startScanning(['ETH', 'BSC', 'SOL']);
        console.log('✅ Scanner started for all networks');
        
        // Let it run for 60 seconds to see if it detects any tokens
        console.log('⏰ Running for 60 seconds to test token detection...');
        
        setTimeout(async () => {
            console.log('🛑 Stopping scanner...');
            await scanner.stopScanning();
            console.log('✅ Test completed');
            process.exit(0);
        }, 60000);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testTokenDetection(); 