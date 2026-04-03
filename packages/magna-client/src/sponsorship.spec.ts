import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MagnaClient } from "./client.js";
import { buildSponsoredFeeConfig } from "./sponsorship.js";
import { CredentialType } from "./types.js";

describe("company sponsor fee config", () => {
  it("attaches an external fee payer when logging in via the company sponsor gateway", async () => {
    const sponsorAddress = { kind: "company-sponsor-address" };
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;

    const client = new MagnaClient({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: { methods: {} } as never,
      companySponsorContract: {
        address: sponsorAddress,
        methods: {
          sponsored_verify: () => ({
            send: async (opts: { from: string; fee?: unknown }) => {
              capturedSendOptions = opts;
              return { ok: true };
            },
          }),
        },
      } as never,
    });

    await client.loginWithCompanySponsor(
      {
        policy: {
          credentialType: CredentialType.Passport,
          constraints: [],
        },
        hintedCredentialNote: { id: "credential" },
        hintedStatusNote: { id: "status" },
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
        },
        sponsorSlot: 2,
      },
      "0x2222222222222222222222222222222222222222",
    );

    assert.ok(capturedSendOptions, "expected send options to be captured");
    assert.equal(capturedSendOptions.from, "0x2222222222222222222222222222222222222222");
    assert.ok(capturedSendOptions.fee, "expected a fee config to be attached");

    const paymentMethod = (capturedSendOptions.fee as { paymentMethod: {
      getFeePayer: () => Promise<unknown>;
      getExecutionPayload: () => Promise<{ calls: unknown[]; feePayer?: unknown }>;
    } }).paymentMethod;

    assert.equal(await paymentMethod.getFeePayer(), sponsorAddress);

    const executionPayload = await paymentMethod.getExecutionPayload();
    assert.deepEqual(executionPayload.calls, []);
    assert.equal(executionPayload.feePayer, sponsorAddress);
  });
});

describe("legacy Aztec sponsored fee helper", () => {
  it("buildSponsoredFeeConfig returns the official SponsoredFeePaymentMethod shape", async () => {
    const sponsoredFpcAddress = AztecAddress.fromString(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );

    const feeConfig = await buildSponsoredFeeConfig(sponsoredFpcAddress.toString());
    assert.equal(feeConfig.estimateGas, true);
    assert.equal(feeConfig.estimatedGasPadding, 0.2);
    assert.ok(feeConfig.paymentMethod, "expected an official sponsored payment method");

    const paymentMethod = feeConfig.paymentMethod as {
      getFeePayer: () => Promise<AztecAddress>;
      getExecutionPayload: () => Promise<unknown>;
    };

    assert.equal(typeof paymentMethod.getExecutionPayload, "function");
    const feePayer = await paymentMethod.getFeePayer();
    assert.equal(feePayer.equals(sponsoredFpcAddress), true);
  });
});
