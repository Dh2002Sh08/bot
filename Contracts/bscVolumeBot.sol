// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IUniswapV2Router02 {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] memory path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] memory path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] memory path)
        external
        view
        returns (uint256[] memory amounts);

    function WETH() external pure returns (address);
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract VolumeBooster {
    address public owner;
    IUniswapV2Router02 public uniswapRouter;
    bool public paused;
    mapping(address => uint256) public ethBalances; // Tracks ETH deposits per user

    uint256 public constant BUY_AMOUNT = 0.01 ether; // Hardcoded buy amount

    event EthDeposited(address indexed sender, uint256 amount);
    event EthWithdrawn(address indexed user, uint256 amount);
    event ApproveToken(address indexed token, address router, uint256 amount);
    event BuySellExecuted(address indexed token, uint256 ethSpent, uint256 tokensBought);
    event BuyExecuted(address indexed user, address indexed token, uint256 ethSpent, uint256 tokensBought);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor(address _routerAddress) {
        owner = msg.sender;
        uniswapRouter = IUniswapV2Router02(_routerAddress);
    }

    // Function to accept ETH deposits and track them
    receive() external payable whenNotPaused {
        ethBalances[msg.sender] += msg.value;
        emit EthDeposited(msg.sender, msg.value);
    }

    // Function to allow users to withdraw their deposited ETH
    function withdrawEth(uint256 _amount) external whenNotPaused {
        require(ethBalances[msg.sender] >= _amount, "Insufficient balance");
        ethBalances[msg.sender] -= _amount;
        payable(msg.sender).transfer(_amount);
        emit EthWithdrawn(msg.sender, _amount);
    }

    // Function to approve token spending by Uniswap router
    function ensureApproval(address _tokenAddress, uint256 _amount) internal {
        uint256 allowance = IERC20(_tokenAddress).allowance(address(this), address(uniswapRouter));
        if (allowance < _amount) {
            IERC20(_tokenAddress).approve(address(uniswapRouter), type(uint256).max);
            emit ApproveToken(_tokenAddress, address(uniswapRouter), type(uint256).max);
        }
    }

    // Function for multiple wallets to buy tokens with 0.01 ETH
    function buyTokens(address _tokenAddress, uint256 _slippagePercent) external payable whenNotPaused {
        require(msg.value == BUY_AMOUNT, "Must send exactly 0.01 ETH");
        require(_slippagePercent <= 50, "Slippage percent too high");

        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = _tokenAddress;

        // Estimate minimum tokens to receive
        uint256[] memory amounts = uniswapRouter.getAmountsOut(BUY_AMOUNT, path);
        uint256 minTokens = amounts[1] * (100 - _slippagePercent) / 100;

        // Execute buy
        uint256[] memory amountsBought = uniswapRouter.swapExactETHForTokens{value: BUY_AMOUNT}(
            minTokens,
            path,
            address(this),
            block.timestamp + 300
        );

        emit BuyExecuted(msg.sender, _tokenAddress, BUY_AMOUNT, amountsBought[1]);
    }

    // Function to execute buy-sell cycle (for volume boosting)
    function executeBuySell(address _tokenAddress, uint256 _slippagePercent) external payable whenNotPaused {
        require(msg.value == BUY_AMOUNT, "Must send exactly 0.01 ETH");
        require(_slippagePercent <= 50, "Slippage percent too high");

        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = _tokenAddress;

        // Estimate minimum tokens to receive
        uint256[] memory amounts = uniswapRouter.getAmountsOut(BUY_AMOUNT, path);
        uint256 minTokens = amounts[1] * (100 - _slippagePercent) / 100;

        // Buy tokens
        uint256[] memory amountsBought = uniswapRouter.swapExactETHForTokens{value: BUY_AMOUNT}(
            minTokens,
            path,
            address(this),
            block.timestamp + 300
        );

        uint256 tokensBought = amountsBought[1];

        // Approve tokens for selling
        ensureApproval(_tokenAddress, tokensBought);

        // Sell tokens back to ETH
        path[0] = _tokenAddress;
        path[1] = uniswapRouter.WETH();
        amounts = uniswapRouter.getAmountsOut(tokensBought, path);
        uint256 minEth = amounts[1] * (100 - _slippagePercent) / 100;

        uniswapRouter.swapExactTokensForETH(
            tokensBought,
            minEth,
            path,
            msg.sender,
            block.timestamp + 300
        );

        emit BuySellExecuted(_tokenAddress, BUY_AMOUNT, tokensBought);
    }

    // Function to pause the contract (for emergency)
    function pause() external onlyOwner {
        paused = true;
    }

    // Function to unpause the contract
    function unpause() external onlyOwner {
        paused = false;
    }

    // Function to estimate cost of buy-sell cycle
    function estimateCycleCost(address _tokenAddress) external view returns (uint256 estimatedLoss) {
        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = _tokenAddress;

        uint256[] memory amounts = uniswapRouter.getAmountsOut(BUY_AMOUNT, path);
        uint256 tokensBought = amounts[1];

        path[0] = _tokenAddress;
        path[1] = uniswapRouter.WETH();
        amounts = uniswapRouter.getAmountsOut(tokensBought, path);
        uint256 ethReceived = amounts[1];

        return BUY_AMOUNT > ethReceived ? BUY_AMOUNT - ethReceived : 0;
    }
}