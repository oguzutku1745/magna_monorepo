import { getProofData } from "@zkpassport/utils";
import { describe, expect, it } from "vitest";
import {
  PASSPORT_A2_INNER_PROOF_FIELD_COUNT,
  PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT,
} from "@magna/passport-wrapper-proof/safe";
import {
  assertLocalRecoveryClockReadyForScan,
  assertRecoveryProofFreshAtL1,
  mutateZkPassportPrivateProofField,
  recoveryDevClockWarpTarget,
  recoveryL1ClockNeedsWarp,
  recoveryLocalCheckpointAdvanceLimit,
  recoveryLocalCheckpointWaitSeconds,
} from "./recovery-v3";

const fieldModulus =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const fieldHex = (value: bigint) => value.toString(16).padStart(64, "0");

describe("Recovery V3 live-proof mutations", () => {
  it("requires a coordinated local L1/L2 warp only while Anvil is behind the proof date", () => {
    expect(recoveryL1ClockNeedsWarp(100n, 101n)).toBe(true);
    expect(recoveryL1ClockNeedsWarp(101n, 101n)).toBe(false);
    expect(recoveryL1ClockNeedsWarp(102n, 101n)).toBe(false);
  });

  it("uses the minimum authenticated proof time as the dev warp target", () => {
    expect(recoveryDevClockWarpTarget(100n, 101n)).toBe(100);
    expect(() => recoveryDevClockWarpTarget(102n, 101n)).toThrow(/ahead of the browser wall clock/);
  });

  it("enforces the portal freshness boundary against the resulting L1 block", () => {
    expect(assertRecoveryProofFreshAtL1(3_699n, 100n, 31_337n, 3_699n)).toBe(3_599n);
    expect(() => assertRecoveryProofFreshAtL1(3_700n, 100n, 31_337n, 3_600n)).toThrow(
      /proof is 3500s old by host time.*L1.*100s ahead.*proof age 3600s/s,
    );
    expect(() => assertRecoveryProofFreshAtL1(99n, 100n, 31_337n, 100n)).toThrow(
      /still behind the authenticated recovery proof date/,
    );
  });

  it("classifies the observed future-shifted local-chain failure before portal simulation", () => {
    expect(() =>
      assertRecoveryProofFreshAtL1(1_787_865_066n, 1_787_860_804n, 31_337n, 1_787_861_104n),
    ).toThrow(
      /proof is 300s old by host time.*3962s ahead.*proof age 4262s/s,
    );
  });

  it("blocks a drifted local network before the user scans a fresh passport proof", () => {
    expect(assertLocalRecoveryClockReadyForScan(1_000n, 900n, 31_337n)).toBe(100n);
    expect(() => assertLocalRecoveryClockReadyForScan(1_080n, 900n, 31_337n)).toThrow(
      /180s ahead.*before zkPassport scanning.*fresh passport scan by itself cannot repair/s,
    );
    expect(assertLocalRecoveryClockReadyForScan(1_080n, 900n, 11_155_111n)).toBe(180n);
  });

  it("bounds local Inbox checkpoint advancement from the canonical Inbox lag", () => {
    expect(recoveryLocalCheckpointAdvanceLimit(2n)).toBe(4);
    expect(() => recoveryLocalCheckpointAdvanceLimit(0n)).toThrow(/invalid local checkpoint lag/);
    expect(() => recoveryLocalCheckpointAdvanceLimit(65n)).toThrow(/invalid local checkpoint lag/);
  });

  it("paces each forced checkpoint until wall time is ahead of monotonic L1 time", () => {
    expect(recoveryLocalCheckpointWaitSeconds(100n, 101n)).toBe(0n);
    expect(recoveryLocalCheckpointWaitSeconds(100n, 100n)).toBe(1n);
    expect(recoveryLocalCheckpointWaitSeconds(108n, 100n)).toBe(9n);
  });

  it("changes the transcript-bound libraSum without touching public inputs or other proof fields", () => {
    const publicInputs = Array.from(
      { length: PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT },
      (_, index) => fieldHex(BigInt(index + 1)),
    );
    const privateProof = Array.from(
      { length: PASSPORT_A2_INNER_PROOF_FIELD_COUNT },
      (_, index) => fieldHex(BigInt(index + 17)),
    );
    const original = `0x${[...publicInputs, ...privateProof].join("")}`;
    const mutated = mutateZkPassportPrivateProofField(original);
    const originalData = getProofData(original.slice(2), PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT);
    const mutatedData = getProofData(mutated.slice(2), PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT);

    expect(mutatedData.publicInputs).toEqual(originalData.publicInputs);
    expect(mutatedData.proof.slice(0, 48)).toEqual(originalData.proof.slice(0, 48));
    expect(mutatedData.proof[48]).not.toBe(originalData.proof[48]);
    expect(mutatedData.proof.slice(49)).toEqual(originalData.proof.slice(49));
    expect(BigInt(`0x${mutatedData.proof[48]}`)).toBeLessThan(fieldModulus);
  });

  it("fails closed for malformed or public-input-only artifacts", () => {
    expect(() => mutateZkPassportPrivateProofField("not-hex")).toThrow(/field-aligned/);
    expect(() =>
      mutateZkPassportPrivateProofField(publicInputsOnly()),
    ).toThrow(/must contain exactly/);
  });
});

function publicInputsOnly(): string {
  return Array.from(
    { length: PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT },
    (_, index) => fieldHex(BigInt(index + 1)),
  ).join("");
}
