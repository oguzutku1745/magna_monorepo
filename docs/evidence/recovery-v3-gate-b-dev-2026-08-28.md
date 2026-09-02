# Recovery V3 Gate B-dev clean-deployment evidence — 2026-08-28

Result: **PASS** for the clean-deployment Gate B-dev combined recovery run.

This record contains only redacted structural metadata and public chain evidence.
The raw zkPassport proof, scoped identifier, Ghost signing material, passport data,
private witnesses, Inbox message secret, and passkey material were neither retained
here nor sent to the Magna API.

## Scope and software

```text
Repository base commit             ef14f05ca850af8e23fe4af4d96710a88afe9993
Aztec CLI/packages                  5.1.0
Aztec protocol version              3031439860 (0xb4b019f4)
zkPassport SDK                      0.16.1
zkPassport utils                    0.37.3
zkPassport registry client          0.14.0
zkPassport circuit                  outer_count_7@0.20.0
zkPassport VK                       0x19d93a8a69386b80903a8559d884bea729dc1ecc1db48afc6d3bb73d4ed3abbe
L1/Aztec chain ID                   31337
Local Ethereum/Aztec slot profile   4s / 8s
Local sequencer block duration      1000ms
Proof profile                       official devMode=true / NON_SALTED_MOCK=2
Magna API during authorization      not used
```

The official zkPassport mobile application produced a fresh cryptographic proof
from the official John Smith developer passport. No checked-in fixture, synthetic
witness, hand-built public-input array, mock verifier, patched circuit, or direct
Inbox/tree insertion was used.

## Frozen artifact hashes

```text
d991a055650f3f7b4abfa1717c2a7dab9530e34a217cebc5d4369f75c2b8819f  packages/magna-recovery-wrapper-proof/circuit-dev/src/main.nr
e434fcd7f5097ac0a7bfe9f09645302560f48e8dd04641ad68a6747983034e6f  packages/magna-recovery-wrapper-proof/circuit-dev/Nargo.toml
7f068e040fd1d0bce2602d6c86567b590f9d58120c143e6061a9c58134c2e06b  packages/magna-recovery-wrapper-proof/circuit-dev/bundle/magna_recovery_wrapper_proof_dev.json
d2746c69515f4126d915232610b76ab99d401b7cb71a883d4cbb0296005f2e86  contracts/magna-recovery-portal/src/generated/RecoveryWrapperVerifier.sol
6d52531fa7352f82a89d383f1d751006e8731b8df9e8c996c395239856645bb7  contracts/magna-recovery-portal/src/MagnaRecoveryPortal.sol
62dd5f0daf407bbfbdb830d3a757819992d0d30429ef6b155361d9eb88c9430b  contracts/magna-recovery-portal/out/MagnaRecoveryPortal.sol/MagnaRecoveryPortal.json
11ee1977d58faadfa22c5876e6e9e7b2aa1b7e95b949ba9cd73fd49d4fd01bb5  contracts/magna-issuer/src/main.nr
2d28d4194a472c0b6d930909cf00ee942e83ca877865745b72f8ae5fa0b2e388  contracts/magna-issuer/target/magna_issuer-MagnaIssuer.json
9557de5ce5e7faa87429826a3ba6644a631400b47c726c8d198a775b5e9abb90  deployments/local.json
```

Generated target and Foundry output files are reproducible build outputs. Their
hashes identify the exact artifacts exercised by this run.

## Clean deployment

```text
Canonical Inbox                    0x0665fbb86a3aceca91df68388ec4bbe11556ddce
Aztec Rollup                       0x4ed7c70f96b99c776995fb64377f0d4ab3b0e1c1
Magna issuer L2                    0x27b3e14a90dd4f9af7df7068e1fad163c40e8cc76698a7e29398a40ee0a0040a
Recovery portal L1                 0x51a1ceb83b83f1985a81c295d1ff28afef186e02
Developer wrapper verifier L1      0xdc11f7e700a4c898ae5caddb1082cffa76512add
Local RootRegistry                 0xb0d4afd8879ed9f52b28595d31b441d079b2ca07
Local CertificateRegistry          0x162a433068f51e18b7d13932f27e66a3f99e6890
Local CircuitRegistry              0x922d6956c99e12dfeb3224dea977d0939758a1fe
Independent registry evidence hash add9c3f9229a7db5770f716c4ccc4f222301f354924a9c4fe35c213b460e95d2
```

The bootstrap derived and content-validated the accepted certificate and circuit
roots independently from the official registry data before the live proof was
scanned. Its existing negative checks rejected an unseeded root and a temporarily
revoked seeded root before restoring the clean developer state.

## Live proof and authorization

```text
Outer proof SHA-256                bbf665eccd722dc33227a2abcc5f23146e027ccedd3d8fcef183a69f6055995f
Wrapper proof keccak256             0xfa684aa03799ac81ea5b29f8e8e285051fc5fef0f16871db8cfdf7c50b4609b5
Clock-sync L1 blocks                109 -> 110
Clock-sync L1 timestamps            1787926873 -> 1787928085
Clock-sync result block             0xe14f34403284d1453aca5f073d5bbd2781efbe64bb1c600c62ad4aef46967143
Portal authorization transaction    0xe45bc257130b5641743f28564d8dca37faea0cafcdb340b299f42476979c39fb
Canonical Inbox leaf                0x000a33078c97a32cf582ea0b7c1cc71a65b07960eb2faa6900ac0ecc6f011fdd
Canonical Inbox global index        31744
Checkpoints required                3
```

The client established that the authenticated recovery identity matched the
selected A2 root and Ghost owner before portal submission. The portal call was
submitted directly from the browser while the Magna API was not used.

## Negative assertions

- Private witness mutations for destination, nonce, message secret hash, expiry,
  inner proof, and inner VK hash were rejected against the exact live proof.
- EVM mutations of the wrapper proof and each of its seven public inputs were
  rejected.
- Reusing the accepted portal authorization was rejected.
- Canonical Inbox membership was obtained through the normal Aztec node API for
  the exact portal-emitted leaf and index; no witness was injected.

## Aztec recovery result

```text
Destination account                 0x077589733cfb3311233a753f8fa6f67fa6afd336815c720ee34572fb427e808b
Recovery issuer transaction          0x21c3bf67b1c82f18589b2100d5c6679f134586a90a50c9227c262585d1f38611
Execution result                     proven / success
Aztec L2 block                       38
Recovered claims hash                21610776298312325851876284916814354484552996229837939619219232671983756387804
Recovered root commitment            8942127809682637574862156267743199622096813075106792444684941574693875090291
```

After proof success, the destination wallet discovered one recovered credential
reference. The application then evaluated its status from Aztec nullifier state,
not browser storage, and reported the rooted passport active and chain-valid at
L2 block `38`. Fresh Ghost-owned root and linked recovery notes were independently
discoverable after the transition. The successful V3 terminal state did not end
in `recovery_pending`.

## Conclusion and boundary

The clean Gate B-dev integration requirement is passed. This run proves the
official developer-proof, recursive-wrapper, real-EVM-verifier, canonical Inbox,
Ghost-authorized private issuer transition, and destination note-discovery path.

It does not satisfy Gate B-production. A production release still requires a
fresh production `SALTED = 1` proof from a supported physical passport, the
separately isolated production wrapper/verifier, production registry checks, and
the complete production mutation and replay suite.
