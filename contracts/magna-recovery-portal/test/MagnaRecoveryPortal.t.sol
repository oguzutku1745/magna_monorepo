// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {
    IAztecInboxV51,
    IRecoveryWrapperVerifier,
    IZkPassportRootRegistry,
    L2Actor,
    MagnaRecoveryPortal
} from "../src/MagnaRecoveryPortal.sol";

interface Vm {
    function warp(uint256 timestamp) external;
}

contract BoundMockVerifier is IRecoveryWrapperVerifier {
    bytes32 private expectedDigest;

    function expect(bytes calldata proof, bytes32[] calldata publicInputs) external {
        expectedDigest = keccak256(abi.encode(proof, publicInputs));
    }

    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool) {
        return expectedDigest != bytes32(0) && expectedDigest == keccak256(abi.encode(proof, publicInputs));
    }
}

contract MockRootRegistry is IZkPassportRootRegistry {
    mapping(bytes32 registryId => mapping(bytes32 root => bool valid)) private roots;

    function setValid(bytes32 registryId, bytes32 root, bool valid) external {
        roots[registryId][root] = valid;
    }

    function isRootValid(bytes32 registryId, bytes32 root, uint256) external view returns (bool) {
        return roots[registryId][root];
    }
}

contract MockInbox is IAztecInboxV51 {
    bool public shouldRevert;
    uint256 public calls;
    L2Actor public lastRecipient;
    bytes32 public lastContent;
    bytes32 public lastSecretHash;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function sendL2Message(L2Actor memory recipient, bytes32 content, bytes32 secretHash)
        external
        returns (bytes32 leaf, uint256 globalLeafIndex)
    {
        require(!shouldRevert, "Inbox rejected message");
        calls += 1;
        lastRecipient = recipient;
        lastContent = content;
        lastSecretHash = secretHash;
        leaf = keccak256(abi.encode(msg.sender, recipient.actor, recipient.version, content, secretHash, calls));
        globalLeafIndex = calls - 1;
    }
}

contract MagnaRecoveryPortalTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant WRAPPER_VERSION = 1;
    bytes32 private constant TRUST_CONTEXT =
        bytes32(uint256(15566801594253113084049812527739827595382159007829037007465386694684186060403));
    bytes32 private constant ISSUER = bytes32(uint256(0x1111));
    bytes32 private constant CERT_ROOT = bytes32(uint256(0xc001));
    bytes32 private constant CIRCUIT_ROOT = bytes32(uint256(0xc002));
    bytes private constant PROOF = hex"01020304";

    BoundMockVerifier private verifier;
    MockRootRegistry private registry;
    MockInbox private inbox;
    MagnaRecoveryPortal private portal;

    function setUp() public {
        vm.warp(1_800_000_100);
        verifier = new BoundMockVerifier();
        registry = new MockRootRegistry();
        inbox = new MockInbox();
        portal = new MagnaRecoveryPortal(
            block.chainid,
            WRAPPER_VERSION,
            address(verifier),
            address(registry),
            address(inbox),
            ISSUER,
            1,
            TRUST_CONTEXT
        );
        registry.setValid(portal.CERTIFICATE_REGISTRY_ID(), CERT_ROOT, true);
        registry.setValid(portal.CIRCUIT_REGISTRY_ID(), CIRCUIT_ROOT, true);
    }

    function testAuthorizeSendsExactVerifiedOutputsToInbox() public {
        bytes32[7] memory inputs = _validInputs();
        _expectProof(inputs);
        (bytes32 leaf, uint256 index) = portal.authorizeRecovery(WRAPPER_VERSION, PROOF, inputs);

        require(leaf != bytes32(0), "leaf missing");
        require(index == 0, "wrong leaf index");
        require(portal.accepted(inputs[1]), "authorization not recorded");
        require(inbox.calls() == 1, "Inbox not called once");
        require(inbox.lastContent() == inputs[1], "authorization changed");
        require(inbox.lastSecretHash() == inputs[2], "secret hash changed");
        (bytes32 actor, uint256 version) = inbox.lastRecipient();
        require(actor == ISSUER && version == 1, "recipient changed");
    }

    function testRelayerCannotReplaceWrapperAuthenticatedSecretHash() public {
        bytes32[7] memory inputs = _validInputs();
        _expectProof(inputs);
        inputs[2] = bytes32(uint256(inputs[2]) + 1);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);
        require(inbox.calls() == 0, "mutated message reached Inbox");
    }

    function testRejectsReplay() public {
        bytes32[7] memory inputs = _validInputs();
        _expectProof(inputs);
        portal.authorizeRecovery(WRAPPER_VERSION, PROOF, inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);
        require(inbox.calls() == 1, "replay reached Inbox");
    }

    function testRejectsWrongSchemaTrustAndVersion() public {
        bytes32[7] memory inputs = _validInputs();
        inputs[0] = bytes32(uint256(4));
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);

        inputs = _validInputs();
        inputs[6] = bytes32(uint256(TRUST_CONTEXT) + 1);
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);

        inputs = _validInputs();
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION + 1, PROOF);
    }

    function testRejectsFutureAndStrictlyOneHourOldProofs() public {
        bytes32[7] memory inputs = _validInputs();
        inputs[3] = bytes32(block.timestamp + 1);
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);

        inputs = _validInputs();
        inputs[3] = bytes32(block.timestamp - portal.RECOVERY_PROOF_MAX_AGE());
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);
    }

    function testRejectsInvalidOrRevokedRegistryRoots() public {
        bytes32[7] memory inputs = _validInputs();
        registry.setValid(portal.CERTIFICATE_REGISTRY_ID(), CERT_ROOT, false);
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);

        registry.setValid(portal.CERTIFICATE_REGISTRY_ID(), CERT_ROOT, true);
        registry.setValid(portal.CIRCUIT_REGISTRY_ID(), CIRCUIT_ROOT, false);
        _expectProof(inputs);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);
    }

    function testInboxFailureRollsBackReplayMarker() public {
        bytes32[7] memory inputs = _validInputs();
        _expectProof(inputs);
        inbox.setShouldRevert(true);
        _expectRevert(inputs, WRAPPER_VERSION, PROOF);
        require(!portal.accepted(inputs[1]), "failed transport burned authorization");
    }

    function testConstructorRejectsWrongChainAndNonContracts() public {
        bool rejected;
        try new MagnaRecoveryPortal(
            block.chainid + 1,
            WRAPPER_VERSION,
            address(verifier),
            address(registry),
            address(inbox),
            ISSUER,
            1,
            TRUST_CONTEXT
        ) returns (MagnaRecoveryPortal) {
            rejected = false;
        } catch {
            rejected = true;
        }
        require(rejected, "wrong chain accepted");

        try new MagnaRecoveryPortal(
            block.chainid, WRAPPER_VERSION, address(0x1234), address(registry), address(inbox), ISSUER, 1, TRUST_CONTEXT
        ) returns (MagnaRecoveryPortal) {
            rejected = false;
        } catch {
            rejected = true;
        }
        require(rejected, "EOA verifier accepted");
    }

    function _validInputs() private pure returns (bytes32[7] memory inputs) {
        inputs[0] = bytes32(uint256(3));
        inputs[1] = bytes32(uint256(20900827026594571638956016568067781712009857102274172450757267856646554795933));
        inputs[2] = bytes32(uint256(10983938823970359692003842531941101377775130826861974616012302461719711391382));
        inputs[3] = bytes32(uint256(1_800_000_000));
        inputs[4] = CERT_ROOT;
        inputs[5] = CIRCUIT_ROOT;
        inputs[6] = TRUST_CONTEXT;
    }

    function _expectProof(bytes32[7] memory inputs) private {
        bytes32[] memory dynamicInputs = new bytes32[](7);
        for (uint256 i = 0; i < 7; ++i) {
            dynamicInputs[i] = inputs[i];
        }
        verifier.expect(PROOF, dynamicInputs);
    }

    function _expectRevert(bytes32[7] memory inputs, uint256 version, bytes memory proof) private {
        (bool success,) =
            address(portal).call(abi.encodeCall(MagnaRecoveryPortal.authorizeRecovery, (version, proof, inputs)));
        require(!success, "call unexpectedly succeeded");
    }
}
