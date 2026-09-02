# Recovery V3 clean Docker bootstrap evidence — 2026-08-29

This record covers Docker image construction, clean-volume deployment, service health, browser rendering, and bootstrap idempotency. It does **not** contain a zkPassport proof and does **not** close the official-mobile Docker evidence gate in the Recovery V3 specification.

## Reproduction boundary

- Command: `npm run docker:local`
- Host architecture: Apple Silicon / Docker Desktop Linux VM
- Application runtime: Node.js 24 from the pinned Aztec image
- Aztec image: `aztecprotocol/aztec:5.1.0@sha256:dd26a01042caf0f34760c4221bd1c855862181842e0cbe3c8c6b4e3f6a5b4128`
- L1: exactly one Anvil process using the Foundry binary from that image, chain ID `31337`
- L2: official Aztec `5.1.0` local-network process connected to `http://anvil:8545`
- Portal compiler: Solidity `0.8.30`; normal and `--offline` image-build compilation both passed
- Clean volumes: yes
- Generated deployment manifest SHA-256: `7e0a56000292dd52852886da805e3e0a37b1edd4964119e1472e3ad339fdb940`
- Bootstrap completion time: `2026-08-29T10:14:04.112Z`

## Recovery V3 deployment

- Profile: `development`
- Ethereum/Aztec chain IDs: `31337` / `31337`
- Aztec protocol version: `4149155590`
- L2 issuer: `0x099b6a977f2399306fc0ce8b9e3a1eb429ddaaab80b2eb8cf37266d64e80607c`
- Local Root Registry: `0x5081a39b8a5f0e35a8d959395a630b68b74dd30f`
- Local Certificate Registry: `0x1fa02b2d6a771842690194cf62d91bdd92bfe28d`
- Local Circuit Registry: `0xdbc43ba45381e02825b14322cddd15ec4b3164e6`
- Relations library: `0x51a1ceb83b83f1985a81c295d1ff28afef186e02`
- Transcript library: `0x36b58f5c1969b7b6591d752ea6f5486d069010ab`
- Generated Recovery V3 verifier: `0x8198f5d8f8cffe8f9c413d98a0a55aeb8ab9fbb7`
- Recovery portal: `0x0355b7b8cb128fa5692729ab3aaa199c1753f726`
- Issuer portal initialization transaction: `0x0856b47e272d6df51755ad3a7d02ef2ed2ea75ce89a2628ee62f5306cf0103c8`
- Official registry evidence SHA-256: `add9c3f9229a7db5770f716c4ccc4f222301f354924a9c4fe35c213b460e95d2`

The bootstrap resolved the developer certificate and circuit roots independently from the official Sepolia registry, content-validated their packaged sources, deployed the local registry/verifier context, and initialized the issuer portal. Fee Juice was claimed only after three real local Aztec checkpoints made the canonical L1→L2 message available.

## Runtime checks

- `bootstrap`: exited `0`
- `anvil`: healthy on `8545`
- `aztec-localnet`: healthy on `8080`
- `verification-api`: healthy; `/health` returned HTTP `200`
- `management`: HTTP `200`; rendered in the in-app browser with no console warning/error
- `web`: HTTP `200`; rendered in the in-app browser with no console warning/error
- `reference-dapp`: HTTP `200`; rendered in the in-app browser with no console warning/error
- Repeated `docker compose up -d`: bootstrap exited `0` after matching the completion marker and manifest, confirming all runtime environment files existed, and confirming non-empty portal bytecode on the current L1. It did not redeploy.

## Remaining manual gate

Run a fresh proof through the official zkPassport mobile developer flow against this Docker deployment, then retain the positive recovery and the private/EVM mutation, replay, registry-revocation, and API-offline results. No fixture, synthetic proof, raw public-input replacement, mocked Inbox, or direct tree/database insertion may satisfy that gate.
