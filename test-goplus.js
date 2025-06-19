import { GoPlus } from "@goplus/sdk-node";
import dotenv from 'dotenv';

dotenv.config();

async function testGoPlusSDK() {
    try {
        console.log('🧪 Testing GoPlus SDK Integration...');
        
        // Test parameters
        const chainId = "1"; // Ethereum
        const addresses = ["0x408e41876cccdc0f92210600ef50372656052a38"]; // Example token
        
        console.log(`Testing token: ${addresses[0]} on chain: ${chainId}`);
        
        // Test GoPlus SDK
        const res = await (GoPlus as any).tokenSecurity(chainId, addresses, 30);
        
        console.log('Response code:', res.code);
        console.log('Response message:', res.message);
        
        if (res.code === 1) {
            console.log('✅ GoPlus SDK working correctly!');
            const tokenData = res.result[addresses[0]];
            if (tokenData) {
                console.log('Token Security Data:');
                console.log('- Is Honeypot:', tokenData.is_honeypot);
                console.log('- Buy Tax:', tokenData.buy_tax);
                console.log('- Sell Tax:', tokenData.sell_tax);
                console.log('- Is Open Source:', tokenData.is_open_source);
                console.log('- Is Proxy:', tokenData.is_proxy);
            }
        } else {
            console.log('❌ GoPlus SDK error:', res.message);
        }
        
    } catch (error) {
        console.error('❌ GoPlus SDK test failed:', error);
    }
}

// Run the test
testGoPlusSDK(); 