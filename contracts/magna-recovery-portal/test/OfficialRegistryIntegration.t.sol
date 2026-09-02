// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {CertificateRegistry} from "@zkpassport-registry/registries/CertificateRegistry.sol";
import {CircuitRegistry} from "@zkpassport-registry/registries/CircuitRegistry.sol";
import {RootRegistry} from "@zkpassport-registry/RootRegistry.sol";
import {IRegistryInstance} from "@zkpassport-registry/IRegistryInstance.sol";
import {
    IAztecInboxV51,
    IRecoveryWrapperVerifier,
    L2Actor,
    MagnaRecoveryPortal
} from "../src/MagnaRecoveryPortal.sol";

interface OfficialRegistryVm {
    function warp(uint256 timestamp) external;
}

/// @dev Unit scaffold only. The generated HonkVerifier + live proof transaction is Gate B-dev.
contract RegistryPathBoundVerifier is IRecoveryWrapperVerifier {
    bytes32 private digest;

    function bind(bytes calldata proof, bytes32[] calldata publicInputs) external {
        digest = keccak256(abi.encode(proof, publicInputs));
    }

    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool) {
        return digest == keccak256(abi.encode(proof, publicInputs));
    }
}

contract RegistryPathInbox is IAztecInboxV51 {
    uint256 public calls;

    function sendL2Message(L2Actor memory, bytes32 content, bytes32 secretHash)
        external
        returns (bytes32 leaf, uint256 globalLeafIndex)
    {
        calls += 1;
        return (keccak256(abi.encode(msg.sender, content, secretHash)), calls - 1);
    }
}

contract OfficialRegistryIntegrationTest {
    OfficialRegistryVm private constant vm =
        OfficialRegistryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant CERTIFICATE_ID = bytes32(uint256(1));
    bytes32 private constant CIRCUIT_ID = bytes32(uint256(2));
    bytes32 private constant CERT_ROOT = bytes32(uint256(0xabc1));
    bytes32 private constant CIRCUIT_ROOT = bytes32(uint256(0xabc2));
    bytes32 private constant TRUST = bytes32(uint256(0xabc3));
    bytes private constant PROOF = hex"010203";

    RootRegistry private rootRegistry;
    CertificateRegistry private certificateRegistry;
    CircuitRegistry private circuitRegistry;
    RegistryPathBoundVerifier private verifier;
    RegistryPathInbox private inbox;
    MagnaRecoveryPortal private portal;

    function setUp() public {
        vm.warp(1_800_000_100);
        rootRegistry = new RootRegistry(address(this), address(this));
        certificateRegistry = new CertificateRegistry(address(this), address(this), address(this));
        circuitRegistry = new CircuitRegistry(address(this), address(this), address(this));
        rootRegistry.addRegistry(CERTIFICATE_ID, IRegistryInstance(address(certificateRegistry)));
        rootRegistry.addRegistry(CIRCUIT_ID, IRegistryInstance(address(circuitRegistry)));
        certificateRegistry.updateRoot(CERT_ROOT, bytes32(0), 1_800_000_000, 1, bytes32(0));
        circuitRegistry.updateRoot(CIRCUIT_ROOT, bytes32(0), 1_800_000_000, 1, bytes32(0));
        verifier = new RegistryPathBoundVerifier();
        inbox = new RegistryPathInbox();
        portal = new MagnaRecoveryPortal(
            block.chainid,
            1,
            address(verifier),
            address(rootRegistry),
            address(inbox),
            bytes32(uint256(0x1111)),
            1,
            TRUST
        );
    }

    function testOfficialRegistryAcceptsSeededUnrevokedRoots() public {
        bytes32[7] memory inputs = _inputs(1);
        _bind(inputs);
        portal.authorizeRecovery(1, PROOF, inputs);
        require(inbox.calls() == 1, "official registry path did not reach Inbox");
    }

    function testOfficialRegistryRevocationAndWrongRegistryAreRejected() public {
        bytes32[7] memory inputs = _inputs(2);
        certificateRegistry.setRevocationStatus(CERT_ROOT, true);
        _bind(inputs);
        _expectRevert(inputs);

        certificateRegistry.setRevocationStatus(CERT_ROOT, false);
        inputs[4] = CIRCUIT_ROOT;
        _bind(inputs);
        _expectRevert(inputs);
        require(inbox.calls() == 0, "invalid official registry root reached Inbox");
    }

    function _inputs(uint256 nonce) private pure returns (bytes32[7] memory inputs) {
        inputs[0] = bytes32(uint256(3));
        inputs[1] = bytes32(uint256(0x1000 + nonce));
        inputs[2] = bytes32(uint256(0x2000 + nonce));
        inputs[3] = bytes32(uint256(1_800_000_000));
        inputs[4] = CERT_ROOT;
        inputs[5] = CIRCUIT_ROOT;
        inputs[6] = TRUST;
    }

    function _bind(bytes32[7] memory inputs) private {
        bytes32[] memory dynamicInputs = new bytes32[](7);
        for (uint256 i = 0; i < 7; ++i) dynamicInputs[i] = inputs[i];
        verifier.bind(PROOF, dynamicInputs);
    }

    function _expectRevert(bytes32[7] memory inputs) private {
        (bool success,) = address(portal).call(abi.encodeCall(MagnaRecoveryPortal.authorizeRecovery, (1, PROOF, inputs)));
        require(!success, "call unexpectedly succeeded");
    }
}
