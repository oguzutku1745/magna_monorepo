import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MagnaVerificationEngine } from "./verification-engine.js";
import { buildCompanySponsorFeeConfig, buildSponsoredFeeConfig } from "./sponsorship.js";
import { CredentialType } from "@magna-protocol/core";

describe("company sponsor fee config", () => {
  it("attaches an external fee payer when logging in via the company sponsor gateway", async () => {
    const sponsorAddress = { kind: "company-sponsor-address" };
    let capturedSendOptions: { from: { toString(): string }; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: { methods: {} } as never,
      companySponsorContract: {
        address: sponsorAddress,
        methods: {
          sponsored_verify: () => ({
            send: async (opts: { from: { toString(): string }; fee?: unknown }) => {
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
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );

    assert.ok(capturedSendOptions, "expected send options to be captured");
    assert.equal(capturedSendOptions.from.toString(), "0x2222222222222222222222222222222222222222222222222222222222222222");
    assert.ok(capturedSendOptions.fee, "expected a fee config to be attached");
    assert.equal((capturedSendOptions.fee as { gasSettings?: unknown }).gasSettings, undefined);
    assert.equal((capturedSendOptions.fee as { congestionEstimate?: unknown }).congestionEstimate, "none");

    const paymentMethod = (capturedSendOptions.fee as { paymentMethod: {
      getFeePayer: () => Promise<unknown>;
      getExecutionPayload: () => Promise<{ calls: unknown[]; feePayer?: unknown }>;
    } }).paymentMethod;

    assert.equal(await paymentMethod.getFeePayer(), sponsorAddress);

    const executionPayload = await paymentMethod.getExecutionPayload();
    assert.deepEqual(executionPayload.calls, []);
    assert.equal(executionPayload.feePayer, sponsorAddress);
  });

  it("can attach network-derived gas limits and max fees without hardcoded protocol maxima", () => {
    const sponsorAddress = AztecAddress.fromStringUnsafe(
      "0x0000000000000000000000000000000000000000000000000000000000000005",
    );
    const feeConfig = buildCompanySponsorFeeConfig(sponsorAddress, {
      gasLimits: { daGas: 55_882, l2Gas: 1_000_000 },
      maxFeesPerGas: { feePerDaGas: 10n, feePerL2Gas: 20n },
    });

    assert.deepEqual(feeConfig.gasSettings, {
      gasLimits: { daGas: 55_882, l2Gas: 1_000_000 },
      maxFeesPerGas: { feePerDaGas: 10n, feePerL2Gas: 20n },
    });
  });
});

describe("legacy Aztec sponsored fee helper", () => {
  it("buildSponsoredFeeConfig returns the official SponsoredFeePaymentMethod shape", async () => {
    const sponsoredFpcAddress = AztecAddress.fromStringUnsafe(
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
