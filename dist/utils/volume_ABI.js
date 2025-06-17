"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOLUME_ABI = void 0;
exports.VOLUME_ABI = [
    {
        "inputs": [
            {
                "internalType": "address[]",
                "name": "_addresses",
                "type": "address[]"
            },
            {
                "internalType": "uint256",
                "name": "_startIndex",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_endIndex",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_baseAmountPerBuy",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_amountVariation",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_minAmountOutBuy",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_minAmountOutSell",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_deadline",
                "type": "uint256"
            }
        ],
        "name": "executeBatch",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_uniswapRouter",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "reason",
                "type": "string"
            }
        ],
        "name": "OperationFailed",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            },
            {
                "internalType": "address[]",
                "name": "_buyAddresses",
                "type": "address[]"
            },
            {
                "internalType": "uint256",
                "name": "_numTx",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_txPerMinute",
                "type": "uint256"
            }
        ],
        "name": "setParameters",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "buyer",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountIn",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountOut",
                "type": "uint256"
            }
        ],
        "name": "TokensBought",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "seller",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountIn",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountOut",
                "type": "uint256"
            }
        ],
        "name": "TokensSold",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "withdrawETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            }
        ],
        "name": "withdrawTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "stateMutability": "payable",
        "type": "receive"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "UNISWAP_V2_ROUTER",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "WETH",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];
