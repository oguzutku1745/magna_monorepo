// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

contract MockERC20 {
  string public name;
  string public symbol;
  uint8 public immutable decimals;
  uint256 public totalSupply;

  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  constructor(string memory name_, string memory symbol_, uint8 decimals_, address initialHolder, uint256 initialSupply) {
    name = name_;
    symbol = symbol_;
    decimals = decimals_;
    _mint(initialHolder, initialSupply);
  }

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: insufficient allowance");
    allowance[from][msg.sender] = currentAllowance - amount;
    emit Approval(from, msg.sender, allowance[from][msg.sender]);
    _transfer(from, to, amount);
    return true;
  }

  function _mint(address to, uint256 amount) internal {
    require(to != address(0), "ERC20: mint to zero");
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
  }

  function _transfer(address from, address to, uint256 amount) internal {
    require(to != address(0), "ERC20: transfer to zero");
    uint256 fromBalance = balanceOf[from];
    require(fromBalance >= amount, "ERC20: insufficient balance");
    balanceOf[from] = fromBalance - amount;
    balanceOf[to] += amount;
    emit Transfer(from, to, amount);
  }
}
