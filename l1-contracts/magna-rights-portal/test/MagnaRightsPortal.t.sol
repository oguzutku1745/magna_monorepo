// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {MagnaRightsPortal, DataStructures} from "../src/MagnaRightsPortal.sol";
import {MagnaRightsMessageHash} from "../src/MagnaRightsMessageHash.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract MockInbox {
  bytes32 internal constant MESSAGE_KEY = keccak256("magna-rights-message");
  uint256 internal constant MESSAGE_LEAF_INDEX = 77;

  DataStructures.L2Actor public lastRecipient;
  bytes32 public lastContent;
  bytes32 public lastSecretHash;

  function sendL2Message(DataStructures.L2Actor memory recipient, bytes32 content, bytes32 secretHash)
    external
    returns (bytes32, uint256)
  {
    lastRecipient = recipient;
    lastContent = content;
    lastSecretHash = secretHash;
    return (MESSAGE_KEY, MESSAGE_LEAF_INDEX);
  }

  function expectedMessageKey() external pure returns (bytes32) {
    return MESSAGE_KEY;
  }

  function expectedLeafIndex() external pure returns (uint256) {
    return MESSAGE_LEAF_INDEX;
  }
}

contract MockRollup {
  address public immutable inbox;
  uint256 public immutable version;

  constructor(address inbox_, uint256 version_) {
    inbox = inbox_;
    version = version_;
  }

  function getInbox() external view returns (address) {
    return inbox;
  }

  function getVersion() external view returns (uint256) {
    return version;
  }
}

contract MockRegistry {
  address public immutable rollup;

  constructor(address rollup_) {
    rollup = rollup_;
  }

  function getCanonicalRollup() external view returns (address) {
    return rollup;
  }
}

contract PortalCaller {
  function withdraw(MagnaRightsPortal portal, uint256 amount) external returns (bool) {
    try portal.withdraw(amount) {
      return true;
    } catch {
      return false;
    }
  }

  function initialize(MagnaRightsPortal portal, address registry, bytes32 l2Registry) external returns (bool) {
    try portal.initialize(registry, l2Registry) {
      return true;
    } catch {
      return false;
    }
  }

  function setTreasury(MagnaRightsPortal portal, address newTreasury) external returns (bool) {
    try portal.setTreasury(newTreasury) {
      return true;
    } catch {
      return false;
    }
  }

  function transferOwnership(MagnaRightsPortal portal, address newOwner) external returns (bool) {
    try portal.transferOwnership(newOwner) {
      return true;
    } catch {
      return false;
    }
  }
}

contract MagnaRightsPortalTest {
  uint256 internal constant PRICE_PER_VERIFY = 150_000; // 0.15 USDC with 6 decimals
  bytes32 internal constant SPONSOR = bytes32(uint256(0x1234));
  bytes32 internal constant PACKAGE_ID = bytes32(uint256(0x5678));
  bytes32 internal constant SECRET_HASH = bytes32(uint256(0x9ABC));
  bytes32 internal constant EXTRA_POLICY_HASH = bytes32(uint256(0xDEF0));
  bytes32 internal constant L2_REGISTRY = bytes32(uint256(0xCAFE));
  address internal constant TREASURY = address(0xBEEF);

  function testPurchaseRequiresInitialization() public {
    (MagnaRightsPortal portal, MockERC20 token) = _deployUninitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);

    _expectRevert(
      address(portal),
      abi.encodeCall(
        portal.purchaseRights,
        (SPONSOR, uint128(1), SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH)
      )
    );
  }

  function testInitializeCanOnlyRunOnce() public {
    (MagnaRightsPortal portal,,) = _deployInitializedPortal();
    MockInbox inbox = new MockInbox();
    MockRollup rollup = new MockRollup(address(inbox), 9);
    MockRegistry registry = new MockRegistry(address(rollup));

    _expectRevert(address(portal), abi.encodeCall(portal.initialize, (address(registry), L2_REGISTRY)));
  }

  function testInitializeRequiresRegistryAddress() public {
    (MagnaRightsPortal portal,) = _deployUninitializedPortal();
    _expectRevert(address(portal), abi.encodeCall(portal.initialize, (address(0), L2_REGISTRY)));
  }

  function testInitializeRequiresL2RightsRegistryAddress() public {
    (MagnaRightsPortal portal,) = _deployUninitializedPortal();
    MockInbox inbox = new MockInbox();
    MockRollup rollup = new MockRollup(address(inbox), 9);
    MockRegistry registry = new MockRegistry(address(rollup));

    _expectRevert(address(portal), abi.encodeCall(portal.initialize, (address(registry), bytes32(0))));
  }

  function testInitializeRequiresRollupAddress() public {
    (MagnaRightsPortal portal,) = _deployUninitializedPortal();
    MockRegistry registry = new MockRegistry(address(0));

    _expectRevert(address(portal), abi.encodeCall(portal.initialize, (address(registry), L2_REGISTRY)));
  }

  function testInitializeRequiresInboxAddress() public {
    (MagnaRightsPortal portal,) = _deployUninitializedPortal();
    MockRollup rollup = new MockRollup(address(0), 9);
    MockRegistry registry = new MockRegistry(address(rollup));

    _expectRevert(address(portal), abi.encodeCall(portal.initialize, (address(registry), L2_REGISTRY)));
  }

  function testPurchasePullsStablePaymentAndBuildsMessage() public {
    (MagnaRightsPortal portal, MockERC20 token, MockInbox inbox) = _deployInitializedPortal();
    uint128 rightsAmount = 3;
    uint256 expectedPayment = uint256(rightsAmount) * PRICE_PER_VERIFY;

    token.approve(address(portal), expectedPayment);
    (uint256 purchaseId, bytes32 creditNonce, bytes32 messageKey, uint256 messageLeafIndex) =
      portal.purchaseRights(SPONSOR, rightsAmount, SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH);

    _assertEq(purchaseId, 1, "purchase id");
    _assertEq(token.balanceOf(address(portal)), expectedPayment, "portal token balance");
    _assertEq(token.balanceOf(address(this)), 1_000_000_000 - expectedPayment, "payer token balance");
    _assertEq(messageKey, inbox.expectedMessageKey(), "message key");
    _assertEq(messageLeafIndex, inbox.expectedLeafIndex(), "message leaf index");
    (bytes32 recipientActor, uint256 recipientVersion) = inbox.lastRecipient();
    _assertEq(recipientVersion, 9, "rollup version");
    _assertEq(uint256(recipientActor), uint256(L2_REGISTRY), "l2 registry recipient");
    _assertEq(uint256(inbox.lastSecretHash()), uint256(SECRET_HASH), "secret hash");
    _assertEq(
      uint256(inbox.lastContent()),
      uint256(MagnaRightsMessageHash.creditContentHash(SPONSOR, rightsAmount, PACKAGE_ID, creditNonce)),
      "content hash"
    );
  }

  function testWithdrawTransfersStableToTreasury() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    uint256 paymentAmount = 2 * PRICE_PER_VERIFY;
    token.approve(address(portal), paymentAmount);
    portal.purchaseRights(SPONSOR, 2, SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH);

    portal.withdraw(paymentAmount);

    _assertEq(token.balanceOf(address(portal)), 0, "portal balance after withdraw");
    _assertEq(token.balanceOf(TREASURY), paymentAmount, "treasury balance after withdraw");
  }

  function testWithdrawIsOwnerOnly() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    uint256 paymentAmount = PRICE_PER_VERIFY;
    token.approve(address(portal), paymentAmount);
    portal.purchaseRights(SPONSOR, 1, SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH);

    PortalCaller caller = new PortalCaller();
    bool ok = caller.withdraw(portal, paymentAmount);
    require(!ok, "non-owner withdraw should fail");
    _assertEq(token.balanceOf(address(portal)), paymentAmount, "portal balance preserved");
    _assertEq(token.balanceOf(TREASURY), 0, "treasury balance unchanged");
  }

  function testSetTreasuryUpdatesDestination() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    address newTreasury = address(0xC0FFEE);
    uint256 paymentAmount = 2 * PRICE_PER_VERIFY;

    portal.setTreasury(newTreasury);
    token.approve(address(portal), paymentAmount);
    portal.purchaseRights(SPONSOR, 2, SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH);
    portal.withdraw(paymentAmount);

    _assertEq(token.balanceOf(newTreasury), paymentAmount, "new treasury receives funds");
    _assertEq(token.balanceOf(TREASURY), 0, "old treasury does not receive funds");
  }

  function testSetTreasuryIsOwnerOnly() public {
    (MagnaRightsPortal portal,,) = _deployInitializedPortal();
    PortalCaller caller = new PortalCaller();
    bool ok = caller.setTreasury(portal, address(0xC0FFEE));
    require(!ok, "non-owner setTreasury should fail");
  }

  function testTransferOwnershipChangesAuthorizedOwner() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    PortalCaller caller = new PortalCaller();

    bool nonOwnerCanSetTreasuryBeforeTransfer = caller.setTreasury(portal, address(0xA11CE));
    require(!nonOwnerCanSetTreasuryBeforeTransfer, "non-owner should not set treasury");

    portal.transferOwnership(address(caller));

    bool newOwnerCanSetTreasury = caller.setTreasury(portal, address(0xA11CE));
    require(newOwnerCanSetTreasury, "new owner should be able to set treasury");

    uint256 paymentAmount = PRICE_PER_VERIFY;
    token.approve(address(portal), paymentAmount);
    portal.purchaseRights(SPONSOR, 1, SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH);
    bool newOwnerCanWithdraw = caller.withdraw(portal, paymentAmount);
    require(newOwnerCanWithdraw, "new owner should be able to withdraw");
  }

  function testPurchaseRejectsZeroSponsor() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);
    _expectRevert(
      address(portal),
      abi.encodeCall(portal.purchaseRights, (bytes32(0), uint128(1), SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH))
    );
  }

  function testPurchaseRejectsZeroRightsAmount() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);
    _expectRevert(
      address(portal),
      abi.encodeCall(portal.purchaseRights, (SPONSOR, uint128(0), SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH))
    );
  }

  function testPurchaseRejectsZeroSecretHash() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);
    _expectRevert(
      address(portal),
      abi.encodeCall(portal.purchaseRights, (SPONSOR, uint128(1), bytes32(0), PACKAGE_ID, EXTRA_POLICY_HASH))
    );
  }

  function testPurchaseRejectsOutOfFieldRangeSponsor() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);
    bytes32 outOfFieldSponsor = bytes32(uint256(1) << 255);
    _expectRevert(
      address(portal),
      abi.encodeCall(
        portal.purchaseRights, (outOfFieldSponsor, uint128(1), SECRET_HASH, PACKAGE_ID, EXTRA_POLICY_HASH)
      )
    );
  }

  function testPurchaseRejectsOutOfFieldRangePackageId() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);
    bytes32 outOfFieldPackageId = bytes32(uint256(1) << 255);
    _expectRevert(
      address(portal),
      abi.encodeCall(
        portal.purchaseRights, (SPONSOR, uint128(1), SECRET_HASH, outOfFieldPackageId, EXTRA_POLICY_HASH)
      )
    );
  }

  function testPurchaseRejectsOutOfFieldRangeSecretHash() public {
    (MagnaRightsPortal portal, MockERC20 token,) = _deployInitializedPortal();
    token.approve(address(portal), PRICE_PER_VERIFY);
    bytes32 outOfFieldSecretHash = bytes32(uint256(1) << 255);
    _expectRevert(
      address(portal),
      abi.encodeCall(portal.purchaseRights, (SPONSOR, uint128(1), outOfFieldSecretHash, PACKAGE_ID, EXTRA_POLICY_HASH))
    );
  }

  function testWithdrawRequiresPositiveAmount() public {
    (MagnaRightsPortal portal,,) = _deployInitializedPortal();
    _expectRevert(address(portal), abi.encodeCall(portal.withdraw, (0)));
  }

  function _deployInitializedPortal() internal returns (MagnaRightsPortal, MockERC20, MockInbox) {
    MockInbox inbox = new MockInbox();
    MockRollup rollup = new MockRollup(address(inbox), 9);
    MockRegistry registry = new MockRegistry(address(rollup));
    MockERC20 token = new MockERC20("Mock USD", "mUSD", 6, address(this), 1_000_000_000);
    MagnaRightsPortal portal = new MagnaRightsPortal(TREASURY, address(token), PRICE_PER_VERIFY);
    portal.initialize(address(registry), L2_REGISTRY);
    return (portal, token, inbox);
  }

  function _deployUninitializedPortal() internal returns (MagnaRightsPortal, MockERC20) {
    MockERC20 token = new MockERC20("Mock USD", "mUSD", 6, address(this), 1_000_000_000);
    MagnaRightsPortal portal = new MagnaRightsPortal(TREASURY, address(token), PRICE_PER_VERIFY);
    return (portal, token);
  }

  function _expectRevert(address target, bytes memory callData) internal {
    (bool ok,) = target.call(callData);
    require(!ok, "expected revert");
  }

  function _assertEq(uint256 left, uint256 right, string memory label) internal pure {
    require(left == right, label);
  }

  function _assertEq(bytes32 left, bytes32 right, string memory label) internal pure {
    require(left == right, label);
  }
}
