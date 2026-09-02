// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

struct L2Actor {
    bytes32 actor;
    uint256 version;
}

/// @dev Exact ABI implemented by zkPassport/Barretenberg generated proof verifiers.
interface IRecoveryWrapperVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @dev Exact RootRegistry read used by zkPassport SubVerifier.sol.
interface IZkPassportRootRegistry {
    function isRootValid(bytes32 registryId, bytes32 root, uint256 timestamp) external view returns (bool);
}

/// @dev Canonical Aztec 5.1 Inbox ABI.
interface IAztecInboxV51 {
    function sendL2Message(L2Actor memory recipient, bytes32 content, bytes32 secretHash)
        external
        returns (bytes32 leaf, uint256 globalLeafIndex);
}

/// @notice Permissionless proof verifier and canonical Ethereum-to-Aztec transport for Magna Recovery V3.
/// @dev This clean, undeployed protocol pins exactly one wrapper version. A future wrapper requires a new portal.
contract MagnaRecoveryPortal {
    uint256 public constant RECOVERY_SCHEMA = 3;
    uint256 public constant RECOVERY_PROOF_MAX_AGE = 1 hours;
    uint256 public constant WRAPPER_PUBLIC_INPUT_COUNT = 7;
    bytes32 public constant CERTIFICATE_REGISTRY_ID = bytes32(uint256(1));
    bytes32 public constant CIRCUIT_REGISTRY_ID = bytes32(uint256(2));

    uint256 private constant SCHEMA_INDEX = 0;
    uint256 private constant AUTHORIZATION_INDEX = 1;
    uint256 private constant SECRET_HASH_INDEX = 2;
    uint256 private constant CURRENT_DATE_INDEX = 3;
    uint256 private constant CERTIFICATE_ROOT_INDEX = 4;
    uint256 private constant CIRCUIT_ROOT_INDEX = 5;
    uint256 private constant TRUST_CONTEXT_INDEX = 6;

    uint256 public immutable ethereumChainId;
    uint256 public immutable wrapperProofVersion;
    IRecoveryWrapperVerifier public immutable wrapperVerifier;
    IZkPassportRootRegistry public immutable rootRegistry;
    IAztecInboxV51 public immutable inbox;
    L2Actor public recipient;
    bytes32 public immutable expectedTrustContextHash;

    mapping(bytes32 authorization => bool accepted) public accepted;

    event RecoveryAuthorizationSent(
        bytes32 indexed authorization,
        bytes32 indexed inboxLeaf,
        uint256 globalLeafIndex,
        bytes32 messageSecretHash,
        uint256 proofVersion,
        uint256 sourceBlock
    );

    constructor(
        uint256 expectedEthereumChainId,
        uint256 expectedWrapperProofVersion,
        address wrapperVerifierAddress,
        address rootRegistryAddress,
        address inboxAddress,
        bytes32 issuerL2Address,
        uint256 aztecProtocolVersion,
        bytes32 trustContextHash
    ) {
        require(expectedEthereumChainId == block.chainid, "wrong Ethereum chain");
        require(expectedWrapperProofVersion != 0, "wrapper version required");
        require(wrapperVerifierAddress.code.length != 0, "wrapper verifier has no code");
        require(rootRegistryAddress.code.length != 0, "root registry has no code");
        require(inboxAddress.code.length != 0, "Inbox has no code");
        require(uint256(issuerL2Address) != 0, "issuer required");
        require(aztecProtocolVersion != 0, "Aztec version required");
        require(uint256(trustContextHash) != 0, "trust context required");

        ethereumChainId = expectedEthereumChainId;
        wrapperProofVersion = expectedWrapperProofVersion;
        wrapperVerifier = IRecoveryWrapperVerifier(wrapperVerifierAddress);
        rootRegistry = IZkPassportRootRegistry(rootRegistryAddress);
        inbox = IAztecInboxV51(inboxAddress);
        recipient = L2Actor({actor: issuerL2Address, version: aztecProtocolVersion});
        expectedTrustContextHash = trustContextHash;
    }

    function authorizeRecovery(uint256 proofVersion, bytes calldata wrapperProof, bytes32[7] calldata publicInputs)
        external
        returns (bytes32 inboxLeaf, uint256 globalLeafIndex)
    {
        require(block.chainid == ethereumChainId, "wrong Ethereum chain");
        require(proofVersion == wrapperProofVersion, "unsupported wrapper version");
        require(wrapperProof.length != 0, "wrapper proof required");
        require(uint256(publicInputs[SCHEMA_INDEX]) == RECOVERY_SCHEMA, "wrong recovery schema");
        require(publicInputs[TRUST_CONTEXT_INDEX] == expectedTrustContextHash, "wrong trust context");

        bytes32 authorization = publicInputs[AUTHORIZATION_INDEX];
        bytes32 messageSecretHash = publicInputs[SECRET_HASH_INDEX];
        require(uint256(authorization) != 0, "authorization required");
        require(uint256(messageSecretHash) != 0, "secret hash required");
        require(!accepted[authorization], "authorization already accepted");

        uint256 proofCurrentDate = uint256(publicInputs[CURRENT_DATE_INDEX]);
        require(block.timestamp >= proofCurrentDate, "proof date is in the future");
        require(block.timestamp - proofCurrentDate < RECOVERY_PROOF_MAX_AGE, "recovery proof is stale");

        bytes32[] memory verifierInputs = new bytes32[](WRAPPER_PUBLIC_INPUT_COUNT);
        for (uint256 i = 0; i < WRAPPER_PUBLIC_INPUT_COUNT; ++i) {
            verifierInputs[i] = publicInputs[i];
        }
        require(wrapperVerifier.verify(wrapperProof, verifierInputs), "invalid recovery wrapper proof");

        require(
            rootRegistry.isRootValid(CERTIFICATE_REGISTRY_ID, publicInputs[CERTIFICATE_ROOT_INDEX], proofCurrentDate),
            "invalid certificate registry root"
        );
        require(
            rootRegistry.isRootValid(CIRCUIT_REGISTRY_ID, publicInputs[CIRCUIT_ROOT_INDEX], proofCurrentDate),
            "invalid circuit registry root"
        );

        // Effects precede the trusted canonical Inbox call. Any Inbox revert rolls
        // this write back, so an authorization is recorded iff transport succeeds.
        accepted[authorization] = true;
        (inboxLeaf, globalLeafIndex) = inbox.sendL2Message(recipient, authorization, messageSecretHash);

        emit RecoveryAuthorizationSent(
            authorization, inboxLeaf, globalLeafIndex, messageSecretHash, proofVersion, block.number
        );
    }
}
