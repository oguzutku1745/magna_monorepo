# Recovery V3 Aztec Inbox feasibility spike

Status: Gate A mechanics passed on 2026-08-23. This directory is not production recovery code.

This spike exists only to satisfy Gate A in `docs/passport-recovery-v3-spec.md` against an actual Aztec `5.1.0` local network. A TXE-injected message, mocked Inbox, or manually inserted witness does not constitute a pass.

The consumer pins the authorized Ethereum portal in `PublicImmutable<EthAddress>` during its public initializer. Its private entry point deliberately contains only the protocol call being tested:

```noir
self.context.consume_l1_to_l2_message(
    recovery_authorization,
    [message_secret],
    self.storage.portal.read(),
    message_leaf_index,
);
```

The canonical L1 Inbox transaction, proposer import, immutable-sender rejection, content/secret mutation rejection, private L2 consumption, exact leaf reconstruction, duplicate-authorization rejection, and replay rejection completed successfully. The frozen run evidence is in [`evidence/2026-08-23.md`](evidence/2026-08-23.md).

Important scope boundary: the official `aztec start --local-network` preset used real deployed L1 contracts, real world-state synchronization, and real client-side private transaction proofs, but its rollup epoch prover configuration reported `realProofs=false`. Epoch proof soundness is outside this Inbox serialization/consumption spike. This result MUST NOT be presented as a production prover test.
