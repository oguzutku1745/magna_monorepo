// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

/// @notice Shared L1 message-content hash for rights credits.
/// @dev Mirrors the Noir-side hashing logic in MagnaCompanyRightsRegistry:
///      sha256_to_field(concat(domain, sponsor, rights_amount, package_id, credit_nonce)).
library MagnaRightsMessageHash {
  uint32 internal constant MAGNA_RIGHTS_CREDIT_DS = 0x4D475243; // "MGRC"

  /// @notice Computes the field-compatible content hash for L1->L2 rights credits.
  /// @dev Matches Aztec's sha256ToField truncation semantics (prepend 1 zero byte + bytes31(sha256(data))).
  function creditContentHash(
    bytes32 sponsorAddressOnAztec,
    uint128 rightsAmount,
    bytes32 packageId,
    bytes32 creditNonce
  ) internal pure returns (bytes32) {
    bytes memory data = abi.encode(
      MAGNA_RIGHTS_CREDIT_DS,
      sponsorAddressOnAztec,
      rightsAmount,
      packageId,
      creditNonce
    );
    return bytes32(bytes.concat(new bytes(1), bytes31(sha256(data))));
  }
}
