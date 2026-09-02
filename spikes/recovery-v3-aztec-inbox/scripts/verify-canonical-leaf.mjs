import { pathToFileURL } from "node:url";

const aztecHome = process.env.AZTEC_51_HOME;
if (!aztecHome) {
  throw new Error("Set AZTEC_51_HOME to the installed Aztec 5.1.0 directory");
}

const moduleUrl = relativePath =>
  pathToFileURL(`${aztecHome}/node_modules/${relativePath}`).href;

const [
  { L1ToL2Message },
  { L1Actor },
  { L2Actor },
  { EthAddress },
  { AztecAddress },
  { Fr },
] = await Promise.all([
  import(moduleUrl("@aztec/stdlib/dest/messaging/l1_to_l2_message.js")),
  import(moduleUrl("@aztec/stdlib/dest/messaging/l1_actor.js")),
  import(moduleUrl("@aztec/stdlib/dest/messaging/l2_actor.js")),
  import(moduleUrl("@aztec/foundation/dest/eth-address/index.js")),
  import(moduleUrl("@aztec/stdlib/dest/aztec-address/index.js")),
  import(moduleUrl("@aztec/foundation/dest/curves/bn254/field.js")),
]);

const recipient = AztecAddress.fromStringUnsafe(
  process.env.RECIPIENT ??
    "0x2881e2f9a92b1ba56239ac79bcb6ee4e464b3d825f0c609dce34daa94f705ac2",
);
const secretHash = Fr.fromHexString(
  process.env.SECRET_HASH ??
    "0x21c9561a649b1a0066823eac74b9f59b0d7ead9c77eb486281d3f4343a6ce58c",
);
const content = Fr.fromHexString(process.env.CONTENT ?? "0x4242");

const vectors = [
  {
    label: "portal message",
    sender: process.env.PORTAL ?? "0x8464135c8f25da09e49bc8782676a84730c318bc",
    index: BigInt(process.env.PORTAL_INDEX ?? "7168"),
    expectedLeaf: process.env.PORTAL_LEAF ??
      "0x00202c4f2429859544aa4685ef22355ef9d921db0566ac51fd3ad8820c7ab330",
  },
  {
    label: "direct non-portal message",
    sender: process.env.DIRECT_SENDER ?? "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    index: BigInt(process.env.DIRECT_INDEX ?? "7169"),
    expectedLeaf: process.env.DIRECT_LEAF ??
      "0x009cc0e41d76bc7926e03e45f723933f380532e38119c683a3374d6d9c11975e",
  },
];

for (const vector of vectors) {
  const message = new L1ToL2Message(
    new L1Actor(EthAddress.fromString(vector.sender), 31337),
    new L2Actor(recipient, 3031439860),
    content,
    secretHash,
    new Fr(vector.index),
  );
  const actualLeaf = message.hash().toString();
  console.log(JSON.stringify({
    label: vector.label,
    fields: message.toFields().map(String),
    actualLeaf,
  }, null, 2));
  if (actualLeaf !== vector.expectedLeaf) {
    throw new Error(`${vector.label} leaf mismatch: ${actualLeaf} !== ${vector.expectedLeaf}`);
  }
}
