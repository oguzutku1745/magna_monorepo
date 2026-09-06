# Official mobile developer recovery — 2026-09-06

Result: **passed in the agreed local developer profile**. This refreshes M4
evidence after the managed-clock fix. It does not claim the production
supported-document `SALTED=1` gate.

## Observed run

The holder reported a successful passkey → Passport A2 → Instagram → reference
login → Recovery V3 flow and supplied the browser recovery log. The final UI
showed the new passport credential active at Aztec L2 block **45**, the old
root lineage consumed, and zero credentials in the previous session.

Recovered owner:
`0x0c29913fdf000ce9e30bb6cf0fdaab32a6330a245a4b191abda12f8fa90d2cb7`.

The record includes a real seven-public-input/322-field wrapper proof,
identity/root/Ghost matching, rejection of private destination/nonce/message
secret/expiry/inner-proof/VK mutations, and direct browser submission without
using the Magna API. EVM proof and all seven public-input mutations were
rejected, as was replay. Three canonical local checkpoints made the recovery
Inbox message provable. The transient Ghost was funded and its PXE disposed
after successful recovery; fresh root and linked recovery notes were discovered.

## Public receipts independently checked on the running chain

| Item | Value |
| --- | --- |
| L1 chain | 31337 |
| Anvil genesis hash | `0x44aaaf87e589463e99c08c9baff822d702e28a9e45c0882715fe9469d0cb7156` |
| Recovery portal | `0x0355b7b8cb128fa5692729ab3aaa199c1753f726` |
| Portal transaction | `0xd1a5bf5857c7fa290108db9acbc441ffd92f2c51006b26d3f4822f56a7523616` |
| Portal receipt | Success (`0x1`), L1 block 127 |
| Canonical Inbox | `0x0665fbb86a3aceca91df68388ec4bbe11556ddce` |
| Inbox leaf | `0x006028bfbe194cdbe66f0fc4b2cb1eec2a3869c8d24773f65d58c95b53608e8f` |
| Inbox leaf index | 38912 (`0x9800`), present in the receipt log |
| Aztec consumption transaction | `0x0ea23fc14e764e4a1191aa07d0eb60194b9460951d1d10e1ccd88d0b78bd8ca2` |
| Aztec receipt | `proven`, `executionResult: success`, L2 block 45 |
| Aztec block hash | `0x0f1eb1073fd4dcba06d92a652a3955f68d4f242c615c2e15dae612bd098635d6` |

Browser-recorded wrapper proof keccak256:
`0x8ce51f732ecd2ddbe46ef8a80b30a6f3f2e1643a11a94a9a3092f6c635598687`.
Ghost Fee Juice claim:
`0x2fc8b506ad1a8d8940108edc46e90c4e26f2910cf22faf1508bfcb952c6b0ad3`.

Public receipts were checked directly with `getTxReceipt` and
`eth_getTransactionReceipt`. Private note availability and final wallet UI state
come from the holder's browser log and report; they are not reconstructed from
public chain data. The supplied log does not establish an exact full-flow wall
duration, so the separate [clock timing measurements](local-clock-docker-2026-09-06.md)
remain the timing evidence.

## Reproducibility and retained scope

This run used the working-tree application state after source HEAD `3740630`.
Its genesis is distinct from the earlier automated clock/funding test record;
transactions from those two deployments must not be combined into one chain.
The final release commit and package evidence are indexed by the
[reviewer guide](../reviewer-guide.md).

The earlier [Gate B-dev record](recovery-v3-gate-b-dev-2026-08-28.md) and
bootstrap tests retain registry-revocation/independent-root acceptance coverage.
This supplied log specifically establishes the fresh mobile recovery,
mutations/replay, canonical Inbox and successful destination transition.
Instagram remains in the rootless lane and is issued again on the recovered
wallet. Raw passport/email data, private witnesses and raw proofs are excluded
from this repository record.
