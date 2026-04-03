import { describe, expect, it } from "vitest";
import {
  buildPassportClaimsWitness,
  buildPassportPolicy,
  createDefaultPassportClaimsForm,
  passportClaimsFromForm,
  readSponsorSlot,
} from "./magna";

describe("magna app helpers", () => {
  it("converts passport claims form input into witness data", () => {
    const claims = passportClaimsFromForm(createDefaultPassportClaimsForm());
    const witness = buildPassportClaimsWitness(claims);

    expect(witness.minAgeProven).toBe(claims.minAgeProven);
    expect(witness.nationalityAlpha3Packed).toBe(claims.nationalityAlpha3Packed);
  });

  it("maps the zkPassport-style UI form into contract claim fields", () => {
    const claims = passportClaimsFromForm({
      nationalityAlpha3: "can",
      ageThreshold: "21",
      passportExpiryDate: "2030-01-02",
    });

    expect(claims.minAgeProven).toBe(21);
    expect(claims.expiryTs).toBe(1893628799n);
  });

  it("builds an age + nationality policy and parses sponsor slot", () => {
    const policy = buildPassportPolicy({
      minimumAge: "21",
      blockedNationalityAlpha3: "USA",
      sponsorSlot: "5",
    });

    expect(policy.credentialType).toBe(1);
    expect(policy.constraints).toHaveLength(2);
    expect(readSponsorSlot({ minimumAge: "21", blockedNationalityAlpha3: "USA", sponsorSlot: "5" })).toBe(5);
  });
});
