import { EnhancedTokenScanner } from './lib/enhancedTokenScanner.js';

// Test configuration
const testConfig = {
    minLiquidity: 1000,
    minVolume: 25,
    requireDexScreener: true,
    enableHoneypotDetection: true,
    excludeStablecoins: true,
    minTokenAge: 60,
    maxTokenAge: 86400
};

// Performance tracking
let tokenCount = 0;
let startTime = Date.now();
let processingTimes = [];

// Test token detection callback with performance tracking
const onTokenDetected = (token) => {
    const currentTime = Date.now();
    const processingTime = currentTime - startTime;
    processingTimes.push(processingTime);
    
    tokenCount++;
    console.log(`⚡ Token ${tokenCount} detected in ${processingTime}ms:`);
    console.log(`Symbol: ${token.symbol}`);
    console.log(`Network: ${token.network}`);
    console.log(`Processing Time: ${processingTime}ms`);
    
    if (token.honeypotCheck) {
        console.log(`Honeypot Check: ${token.honeypotCheck.isHoneypot ? '🚨 HONEYPOT' : '✅ SAFE'}`);
    }
    
    console.log('---');
    
    // Reset timer for next token
    startTime = currentTime;
};

// Test error callback
const onError = (error) => {
    console.error('❌ Scanner Error:', error);
};

async function testPerformance() {
    try {
        console.log('🚀 Performance Testing Enhanced Token Scanner...');
        console.log('⏱️  Measuring token detection and processing speed...\n');
        
        // Create scanner instance
        const scanner = new EnhancedTokenScanner(testConfig, onTokenDetected, onError);
        
        // Initialize
        const initStart = Date.now();
        await scanner.initialize();
        const initTime = Date.now() - initStart;
        console.log(`✅ Scanner initialized in ${initTime}ms`);
        
        // Start scanning for all networks
        const scanStart = Date.now();
        await scanner.startScanning(['ETH', 'BSC', 'SOL']);
        const scanTime = Date.now() - scanStart;
        console.log(`✅ Scanner started in ${scanTime}ms`);
        
        // Let it run for 60 seconds to collect performance data
        console.log('⏰ Running for 60 seconds to collect performance data...\n');
        
        setTimeout(async () => {
            console.log('🛑 Stopping scanner...');
            await scanner.stopScanning();
            
            // Calculate performance metrics
            const avgProcessingTime = processingTimes.length > 0 
                ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length 
                : 0;
            
            const minProcessingTime = processingTimes.length > 0 ? Math.min(...processingTimes) : 0;
            const maxProcessingTime = processingTimes.length > 0 ? Math.max(...processingTimes) : 0;
            
            console.log('\n📊 Performance Results:');
            console.log(`Total Tokens Detected: ${tokenCount}`);
            console.log(`Average Processing Time: ${avgProcessingTime.toFixed(2)}ms`);
            console.log(`Fastest Processing Time: ${minProcessingTime}ms`);
            console.log(`Slowest Processing Time: ${maxProcessingTime}ms`);
            console.log(`Tokens per Second: ${(tokenCount / 60).toFixed(2)}`);
            
            if (avgProcessingTime < 1000) {
                console.log('✅ Excellent performance! Processing time < 1 second');
            } else if (avgProcessingTime < 3000) {
                console.log('✅ Good performance! Processing time < 3 seconds');
            } else {
                console.log('⚠️  Performance could be improved');
            }
            
            console.log('\n✅ Performance test completed');
            process.exit(0);
        }, 60000);
        
    } catch (error) {
        console.error('❌ Performance test failed:', error);
        process.exit(1);
    }
}

// Run the performance test
testPerformance(); 