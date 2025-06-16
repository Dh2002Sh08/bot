// pages/volumeBot.js
"use client";
import React, { useState, useEffect, useCallback } from 'react';

export default function VolumeBot() {
  const [walletCount, setWalletCount] = useState(1);
  const [wallets, setWallets] = useState([]);
  const [form, setForm] = useState({
    tokenAddress: '',
    totalTransactions: 10,
    trxPerMinute: 5,
    amountPerBuy: 0.01,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [tokenInfo, setTokenInfo] = useState(null);
  const [transactionStatus, setTransactionStatus] = useState({
    completed: 0,
    failed: 0,
    pending: 0,
    errors: [],
    warnings: []
  });
  const [logs, setLogs] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [eventSource, setEventSource] = useState(null);
  const [botId, setBotId] = useState(null);
  const [walletBalances, setWalletBalances] = useState({});

  useEffect(() => {
    const fetchTokenInfo = async () => {
      if (form.tokenAddress.length > 0) {
        try {
          const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${form.tokenAddress}`);
          const data = await res.json();
          
          if (data.pairs && data.pairs.length > 0) {
            const pair = data.pairs[0];
            setTokenInfo({
              name: pair.baseToken.name,
              symbol: pair.baseToken.symbol,
              image: pair.baseToken.image,
              price: parseFloat(pair.priceUsd).toFixed(6),
              createdAt: new Date(pair.pairCreatedAt).toLocaleDateString(),
              dex: pair.dexId,
              marketCap: parseFloat(pair.marketCap).toLocaleString(),
              liquidity: parseFloat(pair.liquidity.usd).toLocaleString(),
              volume24h: parseFloat(pair.volume24h).toLocaleString(),
              priceChange24h: pair.priceChange24h
            });
          } else {
            setTokenInfo(null);
          }
        } catch (error) {
          console.error('Error fetching token info:', error);
          setTokenInfo(null);
        }
      } else {
        setTokenInfo(null);
      }
    };

    const debounceTimer = setTimeout(fetchTokenInfo, 500);
    return () => clearTimeout(debounceTimer);
  }, [form.tokenAddress]);

  const createWallets = async () => {
    setMessage('hello');
    setLoading(true);
    const res = await fetch('/api/create-wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: walletCount }),
    });
    const data = await res.json();
    setWallets(data.wallets || []);
    setLoading(false);
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    // Format the message based on its content
    let formattedMessage = message;
    let messageType = type;

    if (message.includes('[Swap]')) {
      messageType = 'info';
      formattedMessage = message.replace('[Swap]', '🔄 Swap:');
    } else if (message.includes('[VolumeBot]')) {
      messageType = 'info';
      formattedMessage = message.replace('[VolumeBot]', '🤖 Bot:');
    } else if (message.includes('Error:')) {
      messageType = 'error';
      formattedMessage = message.replace('Error:', '❌ Error:');
    } else if (message.includes('Transaction failed')) {
      messageType = 'error';
      formattedMessage = message.replace('Transaction failed', '❌ Transaction failed');
    } else if (message.includes('Transaction completed')) {
      messageType = 'success';
      formattedMessage = message.replace('Transaction completed', '✅ Transaction completed');
    }

    setLogs(prev => {
      const newLogs = [...prev, { type: messageType, message: formattedMessage, timestamp }].slice(-100);
      // Scroll to bottom after adding new log
      setTimeout(() => {
        const logContainer = document.getElementById('log-container');
        if (logContainer) {
          logContainer.scrollTop = logContainer.scrollHeight;
        }
      }, 0);
      return newLogs;
    });
  };

  const addTransaction = (transaction) => {
    setTransactions(prev => [...prev, transaction].slice(-50)); // Keep last 50 transactions
  };

  // Cleanup function for EventSource
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const fetchWalletBalances = useCallback(async () => {
    try {
      const balances = {};
      for (const wallet of wallets) {
        const response = await fetch(`/api/wallet-balance?address=${wallet.publicKey}`);
        const data = await response.json();
        balances[wallet.publicKey] = data.balance;
      }
      setWalletBalances(balances);
    } catch (error) {
      console.error('Error fetching wallet balances:', error);
    }
  }, [wallets]);

  useEffect(() => {
    if (wallets.length > 0) {
      fetchWalletBalances();
      const interval = setInterval(fetchWalletBalances, 30000); // Update every 30 seconds
      return () => clearInterval(interval);
    }
  }, [wallets, fetchWalletBalances]);

  const startBot = async () => {
    if (!form.tokenAddress) {
      addLog('Please enter a token address', 'error');
      return;
    }

    // Reset states
    setIsRunning(true);
    setLogs([]);
    setTransactions([]);
    setTransactionStatus({
      completed: 0,
      failed: 0,
      pending: form.totalTransactions,
      errors: [],
      warnings: []
    });

    try {
      const response = await fetch('/api/start-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress: form.tokenAddress,
          totalTransactions: form.totalTransactions,
          trxPerMinute: form.trxPerMinute,
          amountPerBuy: form.amountPerBuy,
          wallets: wallets.map(w => ({
            publicKey: w.publicKey,
            privateKey: w.privateKey
          }))
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start bot');
      }

      const { botId } = await response.json();
      setBotId(botId);
      addLog(`Starting bot with configuration: • Token: ${form.tokenAddress} • Total Transactions: ${form.totalTransactions} • Transactions/Minute: ${form.trxPerMinute} • Amount per Buy: ${form.amountPerBuy} SOL • Number of Wallets: ${wallets.length}`);
      addLog('Bot started successfully');

      // Close any existing EventSource connection
      if (eventSource) {
        eventSource.close();
      }

      // Create new EventSource connection
      const newEventSource = new EventSource(`/api/start-bot?botId=${botId}`);
      
      newEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'log':
              addLog(data.message);
              break;
            case 'error':
              addLog(data.message, 'error');
              setTransactionStatus(prev => ({
                ...prev,
                failed: prev.failed + 1,
                pending: prev.pending - 1,
                errors: [...prev.errors.slice(-4), data.message]
              }));
              break;
            case 'transaction_complete':
              if (data.status === 'success') {
                addLog(`Transaction completed: ${data.txid}`, 'success');
                setTransactionStatus(prev => ({
                  ...prev,
                  completed: prev.completed + 1,
                  pending: prev.pending - 1
                }));
                addTransaction({
                  time: new Date(),
                  wallet: data.wallet,
                  txid: data.txid,
                  status: 'success'
                });
              } else if (data.status === 'failed') {
                addLog(`Transaction failed: ${data.error}`, 'error');
                setTransactionStatus(prev => ({
                  ...prev,
                  failed: prev.failed + 1,
                  pending: prev.pending - 1,
                  errors: [...prev.errors.slice(-4), data.error]
                }));
                addTransaction({
                  time: new Date(),
                  wallet: data.wallet,
                  status: 'failed',
                  error: data.error
                });
              }
              break;
            case 'status':
              if (data.status === 'connected') {
                addLog('Connected to bot server', 'success');
              } else if (data.status === 'stopped') {
                addLog('Bot stopped by server', 'warning');
                setIsRunning(false);
                if (eventSource) {
                  eventSource.close();
                  setEventSource(null);
                }
              }
              break;
          }
        } catch (error) {
          console.error('Error processing message:', error);
          addLog('Error processing message: ' + error.message, 'error');
        }
      };

      newEventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        addLog('Lost connection to bot server', 'error');
        newEventSource.close();
        setIsRunning(false);
      };

      setEventSource(newEventSource);
    } catch (error) {
      console.error('Error starting bot:', error);
      addLog(error.message, 'error');
      setIsRunning(false);
    }
  };

  const stopBot = async () => {
    try {
      if (!botId) {
        throw new Error('No active bot to stop');
      }

      if (eventSource) {
        // Send DELETE request to stop the bot
        const response = await fetch(`/api/start-bot?botId=${botId}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          throw new Error('Failed to stop bot');
        }

        // Close EventSource
        eventSource.close();
        setEventSource(null);
      }

      setIsRunning(false);
      setBotId(null);
      addLog('Bot stopped by user', 'warning');
    } catch (error) {
      console.error('Error stopping bot:', error);
      addLog('Error stopping bot: ' + error.message, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-gray-100 p-6">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-5xl font-extrabold text-white mb-12 text-center tracking-tight drop-shadow-md">
          📈 Solana Volume Bot
        </h2>
  
        <div className="bg-gray-950 shadow-2xl rounded-3xl p-10 mb-10 transform transition-all hover:shadow-3xl border border-gray-700">
          <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
            <span className="bg-blue-900 p-3 rounded-xl text-xl">🧱</span>
            Create Wallets
          </h3>
          <div className="flex items-center gap-5 mb-8">
            <input
              type="number"
              min={1}
              max={100}
              value={walletCount}
              onChange={(e) => setWalletCount(parseInt(e.target.value))}
              className="border-2 border-gray-600 rounded-xl px-5 py-3.5 w-36 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-800 text-white shadow-sm"
            />
            <button
              onClick={createWallets}
              disabled={loading}
              className="bg-blue-600 text-white px-8 py-3.5 rounded-xl font-semibold hover:bg-blue-500 disabled:opacity-50 transform hover:scale-105 active:scale-95 shadow-md"
            >
              Generate
            </button>
          </div>
  
          {wallets.length > 0 && (
            <div className="mt-8">
              <h4 className="font-bold text-white mb-4 text-lg">Generated Wallets:</h4>
              <ul className="max-h-96 overflow-y-auto text-sm bg-gray-800 p-6 rounded-2xl border border-gray-600 shadow-inner">
                {wallets.map((w, idx) => (
                  <li
                    key={idx}
                    className="mb-4 p-4 bg-gray-900 rounded-xl shadow-sm hover:shadow-lg transition-all"
                  >
                    <b className="text-white">{idx + 1}</b>:{' '}
                    <span className="text-gray-300 font-mono">{w.publicKey}</span>
                    <br />
                    <span className="text-gray-400">
                      🗝️{' '}
                      <code className="break-all font-mono text-gray-300">{w.privateKey}</code>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
  
        <div className="bg-gray-950 shadow-2xl rounded-3xl p-10 transform transition-all hover:shadow-3xl border border-gray-700">
          <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
            <span className="bg-green-900 p-3 rounded-xl text-xl">🚀</span>
            Start Volume Bot
          </h3>
  
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="block font-semibold text-white mb-3">Token Address (SPL)</label>
              <input
                type="text"
                value={form.tokenAddress}
                onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })}
                className="border-2 border-gray-600 rounded-xl px-5 py-3.5 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-800 text-white shadow-sm"
              />
              {tokenInfo && (
                <div className="mt-4 p-6 bg-gray-800 rounded-2xl border border-gray-600 shadow-sm">
                  <div className="flex items-center gap-4 mb-4">
                    {tokenInfo.image && (
                      <img
                        src={tokenInfo.image}
                        alt={tokenInfo.name}
                        className="w-10 h-10 rounded-full"
                      />
                    )}
                    <div>
                      <h4 className="font-bold text-white">{tokenInfo.name}</h4>
                      <p className="text-sm text-gray-400">{tokenInfo.symbol}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-400">Price:</span>
                      <span className="ml-2 text-white">${tokenInfo.price}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Created:</span>
                      <span className="ml-2 text-white">{tokenInfo.createdAt}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">DEX:</span>
                      <span className="ml-2 text-white capitalize">{tokenInfo.dex}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Market Cap:</span>
                      <span className="ml-2 text-white">${tokenInfo.marketCap}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Liquidity:</span>
                      <span className="ml-2 text-white">${tokenInfo.liquidity}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">24h Volume:</span>
                      <span className="ml-2 text-white">${tokenInfo.volume24h}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">24h Change:</span>
                      <span
                        className={`ml-2 ${
                          tokenInfo.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {tokenInfo.priceChange24h}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
  
            <div>
              <label className="block font-semibold text-white mb-3">Total Transactions</label>
              <input
                type="number"
                value={form.totalTransactions}
                onChange={(e) =>
                  setForm({ ...form, totalTransactions: parseInt(e.target.value) })
                }
                className="border-2 border-gray-600 rounded-xl px-5 py-3.5 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-800 text-white shadow-sm"
              />
            </div>
  
            <div>
              <label className="block font-semibold text-white mb-3">
                Transactions Per Minute
              </label>
              <input
                type="number"
                value={form.trxPerMinute}
                onChange={(e) =>
                  setForm({ ...form, trxPerMinute: parseInt(e.target.value) })
                }
                className="border-2 border-gray-600 rounded-xl px-5 py-3.5 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-800 text-white shadow-sm"
              />
            </div>
  
            <div>
              <label className="block font-semibold text-white mb-3">Amount Per Buy (SOL)</label>
              <input
                type="number"
                value={form.amountPerBuy}
                onChange={(e) =>
                  setForm({ ...form, amountPerBuy: parseFloat(e.target.value) })
                }
                className="border-2 border-gray-600 rounded-xl px-5 py-3.5 w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-800 text-white shadow-sm"
              />
            </div>
          </div>
  
          {(transactionStatus.pending > 0 || transactionStatus.completed > 0 || transactionStatus.failed > 0) && (
            <div className="mt-8 bg-gray-900 shadow-2xl rounded-3xl p-6 border border-gray-700">
              <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="bg-purple-900 p-2 rounded-lg">📊</span>
                Transaction Status
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center p-4 bg-green-900 rounded-xl">
                  <div className="text-3xl font-bold text-green-400">{transactionStatus.completed}</div>
                  <div className="text-sm text-green-300">Completed</div>
                </div>
                <div className="text-center p-4 bg-yellow-900 rounded-xl">
                  <div className="text-3xl font-bold text-yellow-400">{transactionStatus.pending}</div>
                  <div className="text-sm text-yellow-300">Pending</div>
                </div>
                <div className="text-center p-4 bg-red-900 rounded-xl">
                  <div className="text-3xl font-bold text-red-400">{transactionStatus.failed}</div>
                  <div className="text-sm text-red-300">Failed</div>
                </div>
              </div>
  
              {transactionStatus.errors.length > 0 && (
                <div className="mt-4 p-4 bg-red-900 rounded-xl">
                  <h4 className="font-semibold text-red-300 mb-2">Recent Errors:</h4>
                  <ul className="text-sm text-red-200 space-y-1">
                    {transactionStatus.errors.slice(-4).map((error, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span>❌</span>
                        <span>{error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
  
              {transactionStatus.warnings.length > 0 && (
                <div className="mt-4 p-4 bg-yellow-900 rounded-xl">
                  <h4 className="font-semibold text-yellow-300 mb-2">Warnings:</h4>
                  <ul className="text-sm text-yellow-200 space-y-1">
                    {transactionStatus.warnings.slice(-4).map((warning, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span>⚠️</span>
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
  
          <div className="flex gap-4 mt-10">
            <button
              onClick={startBot}
              disabled={loading || wallets.length === 0 || isRunning}
              className="flex-1 bg-green-600 text-white px-10 py-4 rounded-xl font-bold text-lg hover:bg-green-500 disabled:opacity-50 transform hover:scale-105 active:scale-95 shadow-md"
            >
              {isRunning ? 'Running...' : 'Start Bot'}
            </button>
            {isRunning && (
              <button
                onClick={stopBot}
                className="flex-1 bg-red-600 text-white px-10 py-4 rounded-xl font-bold text-lg hover:bg-red-500 transform hover:scale-105 active:scale-95 shadow-md"
              >
                Stop Bot
              </button>
            )}
          </div>
  
          {message && (
            <div
              className={`mt-8 p-6 rounded-2xl font-semibold text-center ${
                message.startsWith('❌')
                  ? 'bg-red-900 text-red-300 border border-red-700'
                  : 'bg-green-900 text-green-300 border border-green-700'
              } shadow-sm`}
            >
              {message}
            </div>
          )}
        </div>
  
        <div className="bg-gray-950 shadow-2xl rounded-3xl p-10 mb-10 transform transition-all hover:shadow-3xl border border-gray-700">
          <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
            <span className="bg-blue-900 p-3 rounded-xl text-xl">👛</span>
            Wallets
          </h3>
          <div className="space-y-4">
            {wallets.map((wallet, index) => (
              <div key={index} className="p-6 bg-gray-800 rounded-xl border border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-white">{wallet.publicKey}</span>
                    <a
                      href={`https://solscan.io/account/${wallet.publicKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm flex items-center"
                    >
                      <span>View on Solscan</span>
                      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                  <button
                    onClick={() => handleRemoveWallet(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2">
                  <div className="text-sm text-gray-400">
                    Balance: <span className="font-semibold text-white">{walletBalances[wallet.publicKey] || 'Loading...'} SOL</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Note: Click View on Solscan to track wallet activity and transactions
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
  
        {transactions.length > 0 && (
          <div className="mt-8 bg-gray-950 shadow-2xl rounded-3xl p-6 border border-gray-700">
            <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="bg-purple-900 p-2 rounded-lg">💫</span>
              Transaction History
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800 text-gray-400">
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Wallet</th>
                    <th className="px-4 py-3 text-left">Transaction ID</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {transactions.map((tx, index) => (
                    <tr key={index} className="hover:bg-gray-800">
                      <td className="px-4 py-3 text-gray-400">{tx.time.toLocaleTimeString()}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-gray-300">
                          {tx.wallet.slice(0, 4)}...{tx.wallet.slice(-4)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {tx.txid ? (
                          <a
                            href={`https://solscan.io/tx/${tx.txid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono"
                          >
                            {tx.txid.slice(0, 8)}...{tx.txid.slice(-8)}
                          </a>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            tx.status === 'success'
                              ? 'bg-green-900 text-green-300'
                              : 'bg-red-900 text-red-300'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {tx.error ? (
                          <span className="text-red-400">{tx.error}</span>
                        ) : (
                          <span className="text-green-400">Success</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
  
        <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl p-6 border border-gray-700/50">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2 text-purple-300">
            <div className="w-6 h-6">📝</div>
            Bot Activity Log
          </h2>
          <div className="space-y-2 max-h-60 overflow-y-auto" id="log-container">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`p-2 rounded ${
                  log.type === 'error'
                    ? 'bg-red-900/20 text-red-300'
                    : log.type === 'success'
                    ? 'bg-green-900/20 text-green-300'
                    : log.type === 'warning'
                    ? 'bg-yellow-900/20 text-yellow-300'
                    : 'bg-gray-800/50 text-gray-300'
                }`}
              >
                <span className="text-xs text-gray-500">{log.timestamp}</span>
                <p className="text-sm">{log.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
