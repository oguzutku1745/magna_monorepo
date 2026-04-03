# MagnaRightsPortal (L1)

This Solidity contract accepts company payment in an ERC-20 stablecoin on Ethereum and emits an Aztec Inbox L1->L2 message that credits
verify rights on `MagnaCompanyRightsRegistry`.

## Core entrypoint

- `initialize(address registryAddress, bytes32 l2RightsRegistryAddress)`
- `purchaseRights(bytes32 sponsorAddressOnAztec, uint128 rightsAmount, bytes32 secretHash, bytes32 packageId, bytes32 extraPolicyHash)`
- `withdraw(uint256 amount)`

## Pricing

- The portal pulls payment from the buyer using `transferFrom(...)` on the configured ERC-20 payment asset.
- Current price: `0.15` stable units per verify.
- For a 6-decimal token such as USDC, that is `150000` base units per verify.

## Payment flow

1. Deploy `MagnaRightsPortal` with:
   - treasury address
   - ERC-20 payment asset address
   - price per verify in token base units
2. Buyer calls `approve(portal, rightsAmount * pricePerVerify)` on the payment token.
3. Buyer calls `purchaseRights(...)`.
4. Portal pulls the stablecoin into its own balance and emits the Aztec Inbox message.
5. Owner withdraws accumulated token balances with `withdraw(...)` to the configured treasury.

## Deployment flow

1. Deploy `MagnaRightsPortal`.
2. Deploy `MagnaCompanyRightsRegistry` with the L1 portal address.
3. Call `initialize(...)` on the portal with the Aztec registry and L2 registry address.
4. Start accepting `purchaseRights(...)`.

## Build

```bash
forge build
```

## Message-content schema

`MagnaRightsMessageHash.creditContentHash(...)` hashes:

1. domain separator `MGRC` (`0x4D475243`)
2. sponsor Aztec address (`bytes32`)
3. rights amount (`uint128`, ABI-encoded in a 32-byte slot)
4. package id (`bytes32`)
5. credit nonce (`bytes32`, field-compatible)

The Noir claim path mirrors this exact layout.
