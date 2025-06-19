import { EnhancedTokenScanner } from './lib/enhancedTokenScanner.js';

// Test configuration
const testConfig = {
    minLiquidity: 1000,
    minVolume: 25,
    requireDexScreener: true,
    enableHoneypotDetection: true,
    excludeStablecoins: true,
    minTokenAge: 60, // 1 minute
    maxTokenAge: 86400 // 24 hours
};

// Test token detection callback
const onTokenDetected = (token) => {
    console.log('🎯 Token Detected:');
    console.log(`Symbol: ${token.symbol}`);
    console.log(`Name: ${token.name}`);
    console.log(`Network: ${token.network}`);
    console.log(`Price: $${token.price}`);
    console.log(`Liquidity: $${token.liquidity}`);
    console.log(`Age: ${token.age}`);
    
    if (token.honeypotCheck) {
        console.log('🔍 Honeypot Check:');
        console.log(`Is Honeypot: ${token.honeypotCheck.isHoneypot}`);
        console.log(`Buy Tax: ${token.honeypotCheck.buyTax}%`);
        console.log(`Sell Tax: ${token.honeypotCheck.sellTax}%`);
        console.log(`Source: ${token.honeypotCheck.source}`);
    }
    
    console.log('---');
};

// Test error callback
const onError = (error) => {
    console.error('❌ Scanner Error:', error);
};

async function testEnhancedScanner() {
    try {
        console.log('🧪 Testing Enhanced Token Scanner...');
        
        // Create scanner instance
        const scanner = new EnhancedTokenScanner(testConfig, onTokenDetected, onError);
        
        // Initialize
        await scanner.initialize();
        console.log('✅ Scanner initialized');
        
        // Start scanning for BSC and SOL (the networks with issues)
        await scanner.startScanning(['BSC', 'SOL']);
        console.log('✅ Scanner started for BSC and SOL');
        
        // Let it run for 30 seconds to see if it detects any tokens
        console.log('⏰ Running for 30 seconds to test token detection...');
        
        setTimeout(async () => {
            console.log('🛑 Stopping scanner...');
            await scanner.stopScanning();
            console.log('✅ Test completed');
            process.exit(0);
        }, 30000);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testEnhancedScanner(); 