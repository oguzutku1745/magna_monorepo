// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

struct L2Actor {
    bytes32 actor;
    uint256 version;
}

interface IAztecInboxV51 {
    function sendL2Message(L2Actor memory recipient, bytes32 content, bytes32 secretHash)
        external
        returns (bytes32 leaf, uint256 globalLeafIndex);
}

contract RecoveryInboxPortal {
    IAztecInboxV51 public immutable inbox;
    L2Actor public recipient;
    mapping(bytes32 authorization => bool accepted) public accepted;

    event RecoveryAuthorizationSent(
        bytes32 indexed authorization,
        bytes32 indexed leaf,
        uint256 globalLeafIndex,
        bytes32 secretHash
    );

    constructor(address inboxAddress, bytes32 issuerL2Address, uint256 aztecProtocolVersion) {
        inbox = IAztecInboxV51(inboxAddress);
        recipient = L2Actor({actor: issuerL2Address, version: aztecProtocolVersion});
    }

    function authorize(bytes32 authorization, bytes32 secretHash)
        external
        returns (bytes32 leaf, uint256 globalLeafIndex)
    {
        require(!accepted[authorization], "authorization already accepted");
        (leaf, globalLeafIndex) = inbox.sendL2Message(recipient, authorization, secretHash);
        accepted[authorization] = true;
        emit RecoveryAuthorizationSent(authorization, leaf, globalLeafIndex, secretHash);
    }
}
