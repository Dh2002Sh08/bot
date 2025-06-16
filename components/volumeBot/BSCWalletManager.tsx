// "use client";
// import React, { useState, useEffect } from 'react';
// import BSCWalletManager from '../../utils/bscWalletManager';

// interface BSCWallet {
//     address: string;
//     privateKey: string;
//     balance: string;
// }

// export function BSCWalletManagerComponent() {
//     const [wallets, setWallets] = useState<BSCWallet[]>([]);
//     const [selectedWallet, setSelectedWallet] = useState<string>('');
//     const [transferAmount, setTransferAmount] = useState<string>('');
//     const [transferTo, setTransferTo] = useState<string>('');
//     const [isLoading, setIsLoading] = useState<boolean>(false);
//     const [message, setMessage] = useState<string>('');
//     const [isInitialized, setIsInitialized] = useState<boolean>(false);
//     const [numWalletsToCreate, setNumWalletsToCreate] = useState<number>(1);
//     const [showPrivateKeys, setShowPrivateKeys] = useState<boolean>(false);

//     useEffect(() => {
//         if (typeof window !== 'undefined') {
//             const walletManager = BSCWalletManager.getInstance();
//             const loadedWallets = walletManager.getWallets();
//             setWallets(loadedWallets);
//             setIsInitialized(true);
//         }
//     }, []);

//     const loadWallets = async () => {
//         const walletManager = BSCWalletManager.getInstance();
//         const loadedWallets = walletManager.getWallets();
//         setWallets(loadedWallets);
//     };

//     const handleCreateWallets = async () => {
//         try {
//             setIsLoading(true);
//             const walletManager = BSCWalletManager.getInstance();
//             const newWallets = await walletManager.createMultipleWallets(numWalletsToCreate);
//             setWallets([...wallets, ...newWallets]);
//             setMessage(`${newWallets.length} wallet(s) created successfully!`);
//         } catch (error) {
//             setMessage('Error creating wallet(s)');
//             console.error(error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     const handleDeleteWallet = async (address: string) => {
//         try {
//             setIsLoading(true);
//             const walletManager = BSCWalletManager.getInstance();
//             const success = await walletManager.deleteWallet(address);
//             if (success) {
//                 setWallets(wallets.filter(w => w.address !== address));
//                 setMessage('Wallet deleted successfully!');
//             }
//         } catch (error) {
//             setMessage('Error deleting wallet');
//             console.error(error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     const handleTransfer = async () => {
//         if (!selectedWallet || !transferAmount || !transferTo) {
//             setMessage('Please fill in all transfer details');
//             return;
//         }

//         try {
//             setIsLoading(true);
//             const walletManager = BSCWalletManager.getInstance();
//             const success = await walletManager.transferFunds(
//                 selectedWallet,
//                 transferTo,
//                 transferAmount
//             );
//             if (success) {
//                 setMessage('Transfer successful!');
//                 await loadWallets(); // Refresh balances
//             } else {
//                 setMessage('Transfer failed');
//             }
//         } catch (error) {
//             setMessage('Error during transfer');
//             console.error(error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     const handleUpdateBalances = async () => {
//         try {
//             setIsLoading(true);
//             const walletManager = BSCWalletManager.getInstance();
//             await walletManager.updateAllBalances();
//             await loadWallets();
//             setMessage('Balances updated!');
//         } catch (error) {
//             setMessage('Error updating balances');
//             console.error(error);
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     if (!isInitialized) {
//         return <div>Loading...</div>;
//     }

//     return (
//         <div className="p-4 bg-gray-800 rounded-lg shadow-lg text-white">
//             <h2 className="text-xl font-bold mb-4">BSC Wallet Manager</h2>
            
//             {/* Create Wallet Section */}
//             <div className="mb-4 p-4 border border-gray-700 rounded bg-gray-700">
//                 <h3 className="font-semibold mb-2 text-lg">Create New Wallets</h3>
//                 <div className="flex items-center mb-2">
//                     <input
//                         type="number"
//                         value={numWalletsToCreate}
//                         onChange={(e) => setNumWalletsToCreate(Math.max(1, parseInt(e.target.value) || 1))}
//                         min="1"
//                         max="100"
//                         className="w-24 p-2 bg-gray-600 text-white border border-gray-500 rounded mr-2 focus:border-blue-500 focus:ring-blue-500"
//                     />
//                     <button
//                         onClick={handleCreateWallets}
//                         disabled={isLoading}
//                         className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 flex-grow"
//                     >
//                         Create Wallet(s)
//                     </button>
//                 </div>
//                 <label className="flex items-center text-sm text-gray-300">
//                     <input
//                         type="checkbox"
//                         checked={showPrivateKeys}
//                         onChange={() => setShowPrivateKeys(!showPrivateKeys)}
//                         className="mr-2"
//                     />
//                     Show Private Keys (use with caution)
//                 </label>
//             </div>

//             {/* Transfer Section */}
//             <div className="mb-4 p-4 border border-gray-700 rounded bg-gray-700">
//                 <h3 className="font-semibold mb-2 text-lg">Transfer Funds</h3>
//                 <select
//                     value={selectedWallet}
//                     onChange={(e) => setSelectedWallet(e.target.value)}
//                     className="w-full p-2 bg-gray-600 text-white border border-gray-500 rounded mb-2 focus:border-blue-500 focus:ring-blue-500"
//                 >
//                     <option value="" className="bg-gray-600">Select Source Wallet</option>
//                     {wallets.map((wallet) => (
//                         <option key={wallet.address} value={wallet.address} className="bg-gray-600">
//                             {wallet.address} (Balance: {wallet.balance} BNB)
//                         </option>
//                     ))}
//                 </select>
//                 <input
//                     type="text"
//                     value={transferTo}
//                     onChange={(e) => setTransferTo(e.target.value)}
//                     placeholder="Destination Address"
//                     className="w-full p-2 bg-gray-600 text-white border border-gray-500 rounded mb-2 focus:border-blue-500 focus:ring-blue-500"
//                 />
//                 <input
//                     type="text"
//                     value={transferAmount}
//                     onChange={(e) => setTransferAmount(e.target.value)}
//                     placeholder="Amount in Eth"
//                     className="w-full p-2 bg-gray-600 text-white border border-gray-500 rounded mb-2 focus:border-blue-500 focus:ring-blue-500"
//                 />
//                 <button
//                     onClick={handleTransfer}
//                     disabled={isLoading}
//                     className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-600 disabled:text-gray-400 w-full"
//                 >
//                     Transfer
//                 </button>
//             </div>

//             {/* Wallet List */}
//             <div className="mb-4">
//                 <div className="flex justify-between items-center mb-2">
//                     <h3 className="font-semibold text-lg">Your Wallets</h3>
//                     <button
//                         onClick={handleUpdateBalances}
//                         disabled={isLoading}
//                         className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700 disabled:bg-gray-600 disabled:text-gray-400"
//                     >
//                         Refresh Balances
//                     </button>
//                 </div>
//                 <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
//                     {wallets.length === 0 ? (
//                         <p className="text-gray-400">No wallets created yet.</p>
//                     ) : (
//                         wallets.map((wallet) => (
//                             <div key={wallet.address} className="p-3 border border-gray-700 rounded flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-700">
//                                 <div className="mb-2 sm:mb-0">
//                                     <p className="font-mono text-sm break-all">Address: {wallet.address}</p>
//                                     {showPrivateKeys && (
//                                         <p className="font-mono text-xs text-red-400 break-all mt-1">Private Key: {wallet.privateKey}</p>
//                                     )}
//                                     <p className="text-sm text-gray-400">Balance: {wallet.balance} BNB</p>
//                                 </div>
//                                 <button
//                                     onClick={() => handleDeleteWallet(wallet.address)}
//                                     disabled={isLoading}
//                                     className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 disabled:bg-gray-600 disabled:text-gray-400"
//                                 >
//                                     Delete
//                                 </button>
//                             </div>
//                         ))
//                     )}
//                 </div>
//             </div>

//             {/* Message Display */}
//             {message && (
//                 <div className="mt-4 p-2 bg-gray-700 rounded text-sm text-blue-300">
//                     <p>{message}</p>
//                 </div>
//             )}

//             {/* Loading Indicator */}
//             {isLoading && (
//                 <div className="mt-4 text-center text-gray-400">
//                     <p>Processing...</p>
//                 </div>
//             )}
//         </div>
//     );
// } 