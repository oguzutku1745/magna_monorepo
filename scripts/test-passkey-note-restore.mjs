// Live localnet regression: only a synthetic account is deployed. No real
// passkey, browser profile, credential, or chain reset is used.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { Fr } from "@aztec-labs/aztec.js/fields";
import { ExecutionPayload } from "@aztec-labs/aztec.js/tx";
import { AccountManager } from "@aztec-labs/aztec.js/wallet";
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded";
import { MagnaBrowserClient, MagnaWebAuthnAccountContract } from "@magna/wallet";
import {
  ensureAccountManagerDeployed,
  ensureAccountManagerRegistered,
} from "../packages/magna-wallet/dist/embedded/lifecycle.js";

const nodeUrl = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const node = createAztecNodeClient(nodeUrl);
const nodeInfo = await node.getNodeInfo();
assert.equal(nodeInfo.l1ChainId, 31337, "This test deploys an account and must only run on localnet");
const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
const registration = {
  credentialId: webcrypto.getRandomValues(new Uint8Array(32)),
  publicKey: {
    x: new Uint8Array(Buffer.from(publicKey.x, "base64url")),
    y: new Uint8Array(Buffer.from(publicKey.y, "base64url")),
  },
  rpId: "localhost",
  rpIdHash: new Uint8Array(createHash("sha256").update("localhost").digest()),
  origin: "http://localhost:5174",
};
const secret = Fr.random();
const salt = Fr.random();
const accountContract = () => new MagnaWebAuthnAccountContract(registration, async () => {
  throw new Error("Account preparation and stub estimation must not request a real passkey signature");
});
const createWallet = () => EmbeddedWallet.create(node, {
  ephemeral: true,
  pxeConfig: { proverEnabled: nodeInfo.realProofs },
});

async function assertSigningNoteAfterEstimation(wallet, manager) {
  // Match session startup: publish the SDK account type only after real-account
  // registration/deployment preparation. V6 selects its ECDSA estimation stub
  // from this record, whose four-field note differs from Magna's six-field note.
  await wallet.walletDB.storeAccount(manager.address, {
    type: "ecdsasecp256r1",
    secretKey: secret,
    salt,
    signingKey: secret.toBuffer(),
    alias: "Synthetic passkey note regression",
  });
  const originalResolver = wallet.getAccountFromAddress.bind(wallet);
  wallet.getAccountFromAddress = async address => address.equals(manager.address)
    ? manager.getAccount()
    : originalResolver(address);
  await wallet.pxe.sync();
  const feeOptions = await wallet.completeFeeOptions({ from: manager.address, forEstimation: true });
  await wallet.simulateViaEntrypoint(ExecutionPayload.empty(), {
    from: manager.address,
    feeOptions,
    skipTxValidation: true,
    skipFeeEnforcement: true,
  });
  const address = manager.address.toString();
  const client = new MagnaBrowserClient(wallet, {
    aztecNodeUrl: nodeUrl,
    issuerAddress: address,
    companySponsorAddresses: [],
    requireRealSends: true,
    enableDevOrchestrator: false,
    enableLocalTestBootstrap: false,
    localTestAccountIndex: 0,
  }, address);
  assert.equal(await client.ensureAccountAuthNoteDiscovered(address), 1,
    "The passkey signing note must survive V6 gas estimation");
}

// Test both newly deployed and reopened sessions with separate, empty PXEs.
for (const phase of ["new", "reopened"]) {
  const wallet = await createWallet();
  try {
    const manager = await AccountManager.create(wallet, secret, accountContract(), { salt });
    await ensureAccountManagerRegistered(wallet, manager);
    const deployed = await ensureAccountManagerDeployed(wallet, manager,
      phase === "new" ? { localTestAccountIndex: 0 } : undefined);
    assert.equal(deployed.isReady, true);
    await assertSigningNoteAfterEstimation(wallet, manager);
    console.log(`PASS: ${phase} passkey account retains its signing note after V6 gas estimation`);
  } finally {
    await wallet.stop();
  }
}
