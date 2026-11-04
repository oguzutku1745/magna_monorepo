# Agreed onboarding and gas policy

Decision date: 2026-10-26. Status: agreed product policy, pending implementation.
This records the onboarding and payment decisions; it does not describe current
public-network behavior or authorize implementation of the unresolved items.

## Onboarding

Magna pays for the initial passkey wallet deployment and one successful initial
credential issuance total per eligible passport-backed identity, across all
credential types. This is not one free issuance per credential type.

Create the passkey and derive its counterfactual wallet address locally first.
Verify the first credential proof and passport-backed subsidy eligibility before
sending any Magna-funded deployment transaction. Bind the credential request to
that destination wallet, reserve the allowance before spending gas, and make
retries resume the same operation without funding additional wallets.

Track the allowance against the recognized passport identity rather than the
wallet address. Creating another wallet, recovering, renewing, or revoking must
not reset it. The current Passport uniqueness boundary is a scoped zkPassport
identifier within an issuer deployment, not global person-wide uniqueness across
documents; subsidy persistence across redeployments needs explicit handling.

An Instagram account alone does not establish one-person subsidy eligibility.
How passport eligibility is checked when the chosen first credential is another
type remains an implementation decision.

## Gas responsibility

| Operation | Economic payer |
| --- | --- |
| Eligible initial wallet deployment | Magna |
| One eligible initial credential issuance | Magna |
| Additional credential issuance | Outside Magna's free allowance; payment mechanism remains to be defined |
| Company-requested verification or login | Requesting company's sponsor |
| Renewal, recovery, and revocation | User |

User-funded Aztec operations require Fee Juice at the account paying the fee.
The holder wallet and recovery Ghost have separate balances; Ethereum recovery
portal transactions require ETH. Fee Juice cannot be transferred between Aztec
addresses or withdrawn by the user, so recovery cannot assume that the lost
wallet's balance can fund another account.

The present local funding helper, orchestrator-funded issuance/renewal
authorization, and recovery payer configuration require changes to implement
this policy on a public network.

## Credential requests and open work

Credentials may remain independent and be requested together. Pricing should
account for the requested bundle; a single combined proof is not a requirement.

Rootless recovery and Instagram duplicate-issuance prevention remain unresolved.
They must distinguish initial issuance, renewal, recovery, and account ownership
changes, preserve the one-time subsidy limit, and define how old credentials are
invalidated when replaced. No particular solution for these items has been agreed.
