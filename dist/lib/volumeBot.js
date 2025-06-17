"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.volumeBot = void 0;
const ethers_1 = require("ethers");
class VolumeBot {
    constructor() {
        this.isRunning = false;
        this.stopFlag = false;
    }
    static getInstance() {
        if (!VolumeBot.instance) {
            VolumeBot.instance = new VolumeBot();
        }
        return VolumeBot.instance;
    }
    async start(config) {
        this.isRunning = true;
        this.stopFlag = false;
        // Log wallet information securely
        config.walletKeypairs.forEach((wallet, index) => {
            config.onLog(`Wallet ${index + 1} Information:`);
            config.onLog(`Address: ${wallet.address}`);
            config.onLog(`Private Key: **********${wallet.privateKey.slice(-6)}`);
            config.onLog('------------------------');
        });
        const provider = new ethers_1.ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
        const routerContract = new ethers_1.ethers.Contract('0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router
        [
            'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
            'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
        ], provider);
        const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
        let completedTransactions = 0;
        const executeTransaction = async (wallet, index) => {
            try {
                if (completedTransactions >= config.totalTransactions || this.stopFlag) {
                    return;
                }
                const path = [WBNB, config.tokenAddress];
                const amounts = await routerContract.getAmountsOut(ethers_1.ethers.parseEther(config.amountPerBuy.toString()), path);
                const minAmountOut = amounts[1] * BigInt(95) / BigInt(100); // 5% slippage
                const tx = await routerContract.connect(wallet).swapExactETHForTokens(minAmountOut, path, wallet.address, Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes deadline
                { value: ethers_1.ethers.parseEther(config.amountPerBuy.toString()) });
                await tx.wait();
                completedTransactions++;
                config.onLog(`Transaction ${completedTransactions}/${config.totalTransactions} completed: ${tx.hash}`);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                config.onError(new Error(`Transaction failed for wallet ${index + 1} (${wallet.address}): ${errorMessage}`), index);
            }
        };
        const run = async () => {
            while (this.isRunning && !this.stopFlag && completedTransactions < config.totalTransactions) {
                for (let i = 0; i < config.walletKeypairs.length; i++) {
                    if (this.stopFlag || completedTransactions >= config.totalTransactions)
                        break;
                    await executeTransaction(config.walletKeypairs[i], i);
                }
                if (!this.stopFlag && completedTransactions < config.totalTransactions) {
                    // Wait for the specified rate
                    await new Promise(resolve => setTimeout(resolve, (60 / config.trxPerMinute) * 1000));
                }
            }
        };
        run().catch(error => {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            config.onError(new Error(`Bot execution failed: ${errorMessage}`), -1);
        });
        return () => {
            this.stopFlag = true;
            this.isRunning = false;
        };
    }
}
exports.volumeBot = VolumeBot.getInstance();
