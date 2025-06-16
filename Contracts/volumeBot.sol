pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SimpleVolumeBot is ReentrancyGuard {
    address public immutable UNISWAP_V2_ROUTER;
    address public immutable WETH;
    address public owner;
    address internal token;

    event TokensBought(address indexed buyer, address indexed token, uint256 amountIn, uint256 amountOut);
    event TokensSold(address indexed seller, address indexed token, uint256 amountIn, uint256 amountOut);
    event OperationFailed(address indexed user, string reason);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _uniswapRouter) {
        require(_uniswapRouter != address(0), "Invalid router address");
        UNISWAP_V2_ROUTER = _uniswapRouter;
        WETH = IUniswapV2Router02(_uniswapRouter).WETH();
        owner = msg.sender;
    }

    receive() external payable {}

    function setParameters(address _token, address[] calldata _buyAddresses, uint256 _numTx, uint256 _txPerMinute) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        require(_buyAddresses.length > 0, "No addresses provided");
        require(_numTx <= _buyAddresses.length, "Too many transactions");
        require(_txPerMinute > 0, "Invalid transaction rate");

        token = _token;
    }


    function executeBatch(
        address[] calldata _addresses,
        uint256 _startIndex,
        uint256 _endIndex,
        uint256 _baseAmountPerBuy,
        uint256 _amountVariation,
        uint256 _minAmountOutBuy,
        uint256 _minAmountOutSell,
        uint256 _deadline
    ) external payable onlyOwner {
        require(_addresses.length > 0, "No addresses provided");
        require(_startIndex <= _endIndex, "Invalid index range");
        require(_endIndex < _addresses.length, "End index out of bounds");
        require(_baseAmountPerBuy > 0, "Invalid buy amount");
        require(token != address(0), "Token not set");

        uint256 batchSize = _endIndex - _startIndex + 1;
        require(msg.value >= (_baseAmountPerBuy + _amountVariation) * batchSize, "Insufficient ETH");

        for (uint256 i = _startIndex; i <= _endIndex; i++) {
            uint256 randomAmount = _baseAmountPerBuy + (uint256(keccak256(abi.encodePacked(block.timestamp, _addresses[i]))) % _amountVariation);
            
            // Buy tokens
            if (!buyTokens(_addresses[i], randomAmount, _minAmountOutBuy, _deadline)) {
                emit OperationFailed(_addresses[i], "Buy failed");
                continue;
            }

            // Sell tokens immediately
            if (!sellTokens(_addresses[i], _minAmountOutSell, _deadline)) {
                emit OperationFailed(_addresses[i], "Sell failed");
            }
        }
    }

    function buyTokens(
        address _buyer,
        uint256 _amountIn,
        uint256 _minAmountOut,
        uint256 _deadline
    ) internal returns (bool) {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = token;

        try IUniswapV2Router02(UNISWAP_V2_ROUTER).swapExactETHForTokens{value: _amountIn}(
            _minAmountOut,
            path,
            _buyer,
            _deadline
        ) returns (uint256[] memory amounts) {
            emit TokensBought(_buyer, token, _amountIn, amounts[1]);
            return true;
        } catch {
            return false;
        }
    }

    function sellTokens(
        address _seller,
        uint256 _minAmountOut,
        uint256 _deadline
    ) internal returns (bool) {
        uint256 tokenBalance = IERC20(token).balanceOf(_seller);
        if (tokenBalance == 0) {
            return false;
        }

        try IERC20(token).approve(UNISWAP_V2_ROUTER, tokenBalance) {
            // Proceed with sell
        } catch {
            return false;
        }

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = WETH;

        try IUniswapV2Router02(UNISWAP_V2_ROUTER).swapExactTokensForETH(
            tokenBalance,
            _minAmountOut,
            path,
            _seller,
            _deadline
        ) returns (uint256[] memory amounts) {
            emit TokensSold(_seller, token, tokenBalance, amounts[1]);
            return true;
        } catch {
            return false;
        }
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        (bool sent, ) = payable(owner).call{value: balance}("");
        require(sent, "Failed to withdraw ETH");
    }

    function withdrawTokens(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        require(IERC20(_token).transfer(owner, balance), "Token transfer failed");
    }
}