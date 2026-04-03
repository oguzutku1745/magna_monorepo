# MagnaRightsPurchaseL2

`MagnaRightsPurchaseL2` is the direct Aztec L2 top-up rail for company rights budgets.

## What it does

- Charges an Aztec token in public balance (`transfer_in_public`) at a fixed `price_per_verify`.
- Credits rights into `MagnaCompanyRightsRegistry` for a target sponsor address.
- Uses a monotonic `purchase_id` as the rights credit nonce.

## Deployment order

1. Deploy `MagnaCompanyRightsRegistry`.
2. Deploy L2 payment token (Aztec standard `Token` contract).
3. Deploy `MagnaRightsPurchaseL2` with:
   - `admin`
   - `treasury`
   - `payment_token`
   - `rights_registry`
   - `price_per_verify`
4. Initialize registry adapter once:
   - `MagnaCompanyRightsRegistry.initialize_l2_purchase_adapter(<purchase_adapter>)`

## Purchase flow (public authwit)

1. Payer creates an authwit intent for token transfer:
   - caller: `MagnaRightsPurchaseL2`
   - action: `token.transfer_in_public(payer, treasury, payment_amount, authwit_nonce)`
2. Payer sets that authwit in AuthRegistry (`SetPublicAuthwitContractInteraction.create(..., true)`).
3. Payer calls `purchase_rights_public(sponsor, rights_amount, package_id, authwit_nonce)`.
4. Adapter pulls payment and credits rights to `sponsor`.

This keeps budget ownership sponsor-scoped while allowing a different payer account to fund top-ups.
