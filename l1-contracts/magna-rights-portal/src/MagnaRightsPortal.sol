// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {MagnaRightsMessageHash} from "./MagnaRightsMessageHash.sol";

library DataStructures {
  struct L2Actor {
    bytes32 actor;
    uint256 version;
  }
}

interface IAztecInbox {
  function sendL2Message(DataStructures.L2Actor memory _recipient, bytes32 _content, bytes32 _secretHash)
    external
    returns (bytes32, uint256);
}

interface IAztecRegistryLike {
  function getCanonicalRollup() external view returns (address);
}

interface IAztecRollupLike {
  function getInbox() external view returns (address);
  function getVersion() external view returns (uint256);
}

interface IERC20Like {
  function transfer(address to, uint256 value) external returns (bool);
  function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice L1 payment portal for Magna rights purchases.
/// @dev Accepts L1 payment and emits an L1->L2 message that credits rights to a sponsor address.
contract MagnaRightsPortal {
  struct PurchaseData {
    uint256 purchaseId;
    bytes32 creditNonce;
    bytes32 contentHash;
    bytes32 messageKey;
    uint256 messageLeafIndex;
    uint256 paymentAmount;
  }

  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
  event Initialized(
    address indexed registry,
    address indexed rollup,
    address indexed inbox,
    bytes32 l2RightsRegistry,
    uint256 rollupVersion
  );
  event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
  event Withdrawn(address indexed treasury, uint256 amount);
  event RightsPurchased(
    uint256 indexed purchaseId,
    bytes32 indexed sponsorAddressOnAztec,
    uint128 rightsAmount,
    bytes32 packageId,
    bytes32 creditNonce,
    bytes32 contentHash,
    bytes32 secretHash,
    bytes32 messageKey,
    uint256 messageLeafIndex,
    uint256 paymentAmount,
    address payer
  );

  address public owner;
  address public treasury;
  IERC20Like public immutable paymentAsset;
  uint256 public immutable pricePerVerify;
  bytes32 public l2RightsRegistry;
  IAztecRegistryLike public registry;
  IAztecInbox public inbox;
  uint256 public rollupVersion;
  uint256 public nextPurchaseId;
  bool public initialized;

  modifier onlyOwner() {
    require(msg.sender == owner, "owner only");
    _;
  }

  function _fitsField(bytes32 value) internal pure returns (bool) {
    return (uint8(bytes1(value)) & 0xC0) == 0;
  }

  function _safeTransferFrom(address from, address to, uint256 value) internal {
    (bool ok, bytes memory returndata) =
      address(paymentAsset).call(abi.encodeCall(IERC20Like.transferFrom, (from, to, value)));
    require(ok && (returndata.length == 0 || abi.decode(returndata, (bool))), "payment transfer failed");
  }

  function _safeTransfer(address to, uint256 value) internal {
    (bool ok, bytes memory returndata) = address(paymentAsset).call(abi.encodeCall(IERC20Like.transfer, (to, value)));
    require(ok && (returndata.length == 0 || abi.decode(returndata, (bool))), "withdraw transfer failed");
  }

  constructor(address treasuryAddress, address paymentAssetAddress, uint256 pricePerVerify_) {
    require(treasuryAddress != address(0), "treasury required");
    require(paymentAssetAddress != address(0), "payment asset required");
    require(pricePerVerify_ > 0, "price per verify required");
    owner = msg.sender;
    treasury = treasuryAddress;
    paymentAsset = IERC20Like(paymentAssetAddress);
    pricePerVerify = pricePerVerify_;
  }

  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "new owner required");
    address previousOwner = owner;
    owner = newOwner;
    emit OwnershipTransferred(previousOwner, newOwner);
  }

  function setTreasury(address newTreasury) external onlyOwner {
    require(newTreasury != address(0), "treasury required");
    address previousTreasury = treasury;
    treasury = newTreasury;
    emit TreasuryUpdated(previousTreasury, newTreasury);
  }

  function withdraw(uint256 amount) external onlyOwner {
    require(amount > 0, "withdraw amount required");
    _safeTransfer(treasury, amount);
    emit Withdrawn(treasury, amount);
  }

  function initialize(address registryAddress, bytes32 l2RightsRegistryAddress) external onlyOwner {
    require(!initialized, "already initialized");
    require(registryAddress != address(0), "registry required");
    require(l2RightsRegistryAddress != bytes32(0), "l2 registry required");

    registry = IAztecRegistryLike(registryAddress);
    l2RightsRegistry = l2RightsRegistryAddress;

    address rollupAddress = registry.getCanonicalRollup();
    require(rollupAddress != address(0), "rollup unavailable");
    IAztecRollupLike rollup = IAztecRollupLike(rollupAddress);
    address inboxAddress = rollup.getInbox();
    require(inboxAddress != address(0), "inbox unavailable");
    inbox = IAztecInbox(inboxAddress);
    rollupVersion = rollup.getVersion();
    initialized = true;

    emit Initialized(registryAddress, rollupAddress, inboxAddress, l2RightsRegistryAddress, rollupVersion);
  }

  function purchaseRights(
    bytes32 sponsorAddressOnAztec,
    uint128 rightsAmount,
    bytes32 secretHash,
    bytes32 packageId,
    bytes32 extraPolicyHash
  ) external returns (uint256 purchaseId, bytes32 creditNonce, bytes32 messageKey, uint256 messageLeafIndex) {
    require(initialized, "not initialized");
    require(sponsorAddressOnAztec != bytes32(0), "sponsor required");
    require(rightsAmount > 0, "rights amount required");
    require(secretHash != bytes32(0), "secret hash required");
    require(_fitsField(sponsorAddressOnAztec), "sponsor out of field range");
    require(_fitsField(packageId), "package id out of field range");
    require(_fitsField(secretHash), "secret hash out of field range");

    PurchaseData memory purchase;
    purchase.paymentAmount = uint256(rightsAmount) * pricePerVerify;
    require(purchase.paymentAmount / uint256(rightsAmount) == pricePerVerify, "payment overflow");
    _safeTransferFrom(msg.sender, address(this), purchase.paymentAmount);

    purchase.purchaseId = nextPurchaseId + 1;
    nextPurchaseId = purchase.purchaseId;

    // Keep nonce field-compatible for Noir claim inputs.
    purchase.creditNonce = bytes32(
      bytes.concat(
        new bytes(1), bytes31(keccak256(abi.encode(purchase.purchaseId, msg.sender, block.chainid, extraPolicyHash)))
      )
    );

    purchase.contentHash =
      MagnaRightsMessageHash.creditContentHash(sponsorAddressOnAztec, rightsAmount, packageId, purchase.creditNonce);

    DataStructures.L2Actor memory recipient = DataStructures.L2Actor(l2RightsRegistry, rollupVersion);
    (purchase.messageKey, purchase.messageLeafIndex) = inbox.sendL2Message(recipient, purchase.contentHash, secretHash);

    emit RightsPurchased(
      purchase.purchaseId,
      sponsorAddressOnAztec,
      rightsAmount,
      packageId,
      purchase.creditNonce,
      purchase.contentHash,
      secretHash,
      purchase.messageKey,
      purchase.messageLeafIndex,
      purchase.paymentAmount,
      msg.sender
    );

    return (purchase.purchaseId, purchase.creditNonce, purchase.messageKey, purchase.messageLeafIndex);
  }
}
