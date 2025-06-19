# Enhanced Token Scanner - Improvements & New Features

## 🚀 What's New

### 1. Fixed BSC/SOL Stablecoin Detection Issue
- **Problem**: The scanner was detecting stablecoins (USDT, USDC, BNB, etc.) instead of new tokens on BSC and SOL networks
- **Solution**: Added comprehensive filtering system with:
  - Stablecoin blacklists for each network
  - Excluded symbol lists (USDT, USDC, BNB, SOL, etc.)
  - Token age filtering to focus on recent tokens
  - Suspicious pattern detection

### 2. Honeypot Detection System
- **Multi-API Approach**: Uses multiple APIs for reliable honeypot detection
  - GoPlus API (primary, most reliable)
  - Honeypot.is API (fallback)
  - Manual checks (last resort)
- **Detection Features**:
  - Buy/Sell tax analysis
  - Buyable/Sellable status
  - Contract code verification
  - Source attribution

### 3. Enhanced Token Filtering
- **Age-based filtering**: Focus on tokens between 1 minute and 24 hours old
- **Suspicious pattern detection**: Filters out tokens with suspicious names/symbols
- **Duplicate prevention**: Tracks processed tokens to avoid duplicates
- **Network-specific blacklists**: Comprehensive lists for ETH, BSC, and SOL

## 🔧 Configuration Options

### TokenValidationCriteria Interface
```typescript
interface TokenValidationCriteria {
    minLiquidity: number;           // Minimum liquidity in USD
    minVolume: number;              // Minimum 24h volume in USD
    maxAge?: number;                // Maximum token age in seconds
    requireDexScreener: boolean;    // Require DexScreener data
    enableHoneypotDetection?: boolean;  // Enable honeypot detection
    excludeStablecoins?: boolean;   // Exclude stablecoins and major tokens
    minTokenAge?: number;           // Minimum token age in seconds
    maxTokenAge?: number;           // Maximum token age in seconds
}
```

### Default Configuration
```typescript
const defaultCriteria = {
    minLiquidity: 1000,        // $1,000 minimum liquidity
    minVolume: 25,             // $25 minimum 24h volume
    requireDexScreener: true,  // Require DexScreener data
    enableHoneypotDetection: true,  // Enable honeypot detection
    excludeStablecoins: true,  // Exclude stablecoins
    minTokenAge: 60,           // Minimum 1 minute old
    maxTokenAge: 86400         // Maximum 24 hours old
};
```

## 🛡️ Honeypot Detection

### GoPlus SDK Integration
The enhanced token scanner now uses the **GoPlus SDK** for reliable honeypot detection:

```typescript
import { GoPlus } from "@goplus/sdk-node";

// Example usage in the scanner
const res = await (GoPlus as any).tokenSecurity(chainId, addresses, 30);
if (res.code === 1) { // SUCCESS
    const tokenData = res.result[tokenAddress];
    // Process honeypot data
}
```

### Supported APIs
1. **GoPlus SDK** (Primary) ✅
   - Most reliable and comprehensive
   - Uses official GoPlus SDK for Node.js
   - Provides detailed security analysis
   - Fast and efficient

2. **Honeypot.is API** (Fallback)
   - Free tier available
   - Basic honeypot detection
   - No API key required

3. **Manual Checks** (Last Resort)
   - Basic contract verification
   - Conservative approach
   - Always available

### HoneypotCheckResult Interface
```typescript
interface HoneypotCheckResult {
    isHoneypot: boolean;       // Whether token is a honeypot
    buyTax: number;            // Buy tax percentage
    sellTax: number;           // Sell tax percentage
    isBuyable: boolean;        // Can tokens be bought
    isSellable: boolean;       // Can tokens be sold
    error?: string;            // Error message if detection failed
    source: 'goPlus' | 'honeypot' | 'manual';  // Detection source
}
```

## 📋 Stablecoin Blacklists

### ETH Network
- USDT, USDC, DAI, WBTC, WETH

### BSC Network
- USDT, USDC, DAI, BTCB, WBNB, BUSD, WETH

### SOL Network
- USDC, USDT, BONK, SOL

## 🚫 Excluded Symbols
Common stablecoins and major tokens that are automatically filtered out:
- USDT, USDC, DAI, BUSD, TUSD, FRAX, USDP, USDD, GUSD, LUSD
- WBTC, BTCB, WETH, WBNB, WSOL, SOL, BNB, ETH, BTC
- BONK, RAY, SRM, ORCA, JUP, PYTH, BOME, WIF, POPCAT

## 🔍 Suspicious Pattern Detection
Filters out tokens with suspicious patterns in names/symbols:
- test, fake, scam, honeypot, rug, pull
- copy, clone, demo, example
- Very short (<2 chars) or very long (>20 chars) symbols

## 📊 Usage Examples

### Basic Usage
```typescript
import { EnhancedTokenScanner } from './lib/enhancedTokenScanner';

const scanner = new EnhancedTokenScanner(
    defaultCriteria,
    (token) => console.log('Token detected:', token.symbol),
    (error) => console.error('Error:', error)
);

await scanner.initialize();
await scanner.startScanning(['ETH', 'BSC', 'SOL']);
```

### Custom Configuration
```typescript
const customCriteria = {
    minLiquidity: 5000,        // Higher liquidity requirement
    minVolume: 100,            // Higher volume requirement
    enableHoneypotDetection: true,
    excludeStablecoins: true,
    minTokenAge: 300,          // Minimum 5 minutes old
    maxTokenAge: 3600          // Maximum 1 hour old
};

scanner.updateValidationCriteria(customCriteria);
```

### Paper Trading Integration
```typescript
// In paper trading bot
const paperBot = new PaperTradeBot(config);

// Enable honeypot detection for a user
paperBot.setUserHoneypotDetection(userId, true);

// Set stablecoin filtering
paperBot.setUserStablecoinFiltering(userId, true);

// Set token age preferences
paperBot.setUserTokenAgePreferences(userId, 60, 3600); // 1 min to 1 hour
```

## 🧪 Testing

Run the test script to verify functionality:
```bash
node test-enhanced-scanner.js
```

This will:
1. Initialize the scanner
2. Start scanning BSC and SOL networks
3. Run for 30 seconds
4. Display detected tokens with honeypot analysis
5. Stop automatically

## 🔧 Environment Variables

Add these to your `.env` file:
```env
# Required for WebSocket connections
QUICKNODE_KEY=your_quicknode_api_key

# Required for Solana connections
SHYFT_KEY=your_shyft_api_key

# Optional for enhanced honeypot detection
GOPLUS_API_KEY=your_goplus_api_key
```

## 📈 Performance Improvements

- **Duplicate Prevention**: Tracks processed tokens to avoid duplicates
- **Efficient Filtering**: Early filtering to reduce API calls
- **Network-Specific Logic**: Optimized for each blockchain's characteristics
- **Fallback Mechanisms**: Multiple detection methods for reliability

## 🎯 Expected Results

With these improvements, you should now see:
- ✅ Only new, legitimate tokens (no stablecoins)
- ✅ Honeypot detection for ETH and BSC tokens
- ✅ Better token quality with age and pattern filtering
- ✅ Reduced false positives
- ✅ More accurate token detection across all networks

## 🚨 Important Notes

1. **API Keys**: Some features require API keys (GoPlus, QuickNode, Shyft)
2. **Rate Limits**: Be mindful of API rate limits
3. **Network Stability**: WebSocket connections may need reconnection logic
4. **False Positives**: Honeypot detection is not 100% accurate
5. **Token Age**: Very new tokens (<1 minute) are filtered out to avoid scams

## 🔄 Migration Guide

If you're upgrading from the old scanner:

1. Update your imports to use the new `EnhancedTokenScanner`
2. Add honeypot detection configuration if desired
3. Set up stablecoin filtering preferences
4. Configure token age requirements
5. Test with the provided test script
6. Monitor results and adjust criteria as needed 