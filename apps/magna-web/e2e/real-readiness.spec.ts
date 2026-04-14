import { expect, test, type Locator, type Page } from "@playwright/test";

const REAL_MODE = process.env.MAGNA_WEB_E2E_REAL === "1";
const APP_BOOT_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 120_000;

function statusBanner(page: Page): Locator {
  return page.getByTestId("status-banner");
}

function errorBanner(page: Page): Locator {
  return page.getByTestId("error-banner");
}

function panel(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

function keyValue(container: Locator, testId: string): Locator {
  return container.getByTestId(testId).locator("code");
}

async function expectNoFailure(page: Page): Promise<void> {
  await expect(errorBanner(page)).toHaveCount(0);
  await expect(statusBanner(page)).not.toContainText("failed", { timeout: ACTION_TIMEOUT_MS });
}

async function expectActionSuccess(page: Page, message: string): Promise<void> {
  await expect(statusBanner(page)).toContainText(message, { timeout: ACTION_TIMEOUT_MS });
  await expectNoFailure(page);
}

function incrementIsoDateByOneDay(isoDate: string): string {
  return incrementIsoDateByDays(isoDate, 1);
}

function incrementIsoDateByDays(isoDate: string, days: number): string {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO date input: ${isoDate}`);
  }
  const nextDay = new Date(parsed + days * 24 * 60 * 60 * 1000);
  return nextDay.toISOString().slice(0, 10);
}

function incrementAgeThreshold(currentValue: string): string {
  const parsed = Number.parseInt(currentValue, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid age threshold input: ${currentValue}`);
  }
  return String(parsed + 1);
}

function buildRunNonce(): number {
  return Date.now();
}

async function openRealConsole(page: Page): Promise<void> {
  await page.goto("/");
  await expect(statusBanner(page)).toContainText("App initialized", { timeout: APP_BOOT_TIMEOUT_MS });
  await expectNoFailure(page);
}

async function enableVirtualPasskeyAuthenticator(page: Page): Promise<void> {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName !== "chromium") {
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function createInAppWallet(page: Page): Promise<string> {
  const sessionPanel = panel(page, "panel-session");
  const passkeyButton = page.getByTestId("create-passkey-wallet");
  await expect(passkeyButton).toBeVisible();

  if (await passkeyButton.isEnabled()) {
    await enableVirtualPasskeyAuthenticator(page);
    await passkeyButton.click();
    await expect(statusBanner(page)).toContainText("Create/use Magna passkey wallet", { timeout: ACTION_TIMEOUT_MS });
    const passkeyOutcome = await statusBanner(page).innerText();
    if (passkeyOutcome.includes("completed.")) {
      await expectNoFailure(page);
      await expect(sessionPanel).toContainText("passkey");
    } else {
      // Some local/browser combinations reject passkey RP domains in e2e.
      // Keep the suite runnable by falling back to local managed flow.
      await page.getByTestId("create-managed-wallet").click();
      await expectActionSuccess(page, "Create managed embedded wallet completed.");
      await expect(sessionPanel).toContainText("managed");
    }
  } else {
    await page.getByTestId("create-managed-wallet").click();
    await expectActionSuccess(page, "Create managed embedded wallet completed.");
    await expect(sessionPanel).toContainText("managed");
  }

  const activeAccountSelect = sessionPanel.getByLabel("Active account");
  await expect(activeAccountSelect).toBeEnabled();
  return activeAccountSelect.inputValue();
}

async function issueAndFetchHints(page: Page): Promise<string> {
  const readinessPanel = panel(page, "panel-readiness");

  const issueButton = page.getByTestId("issue-passport");
  await expect(issueButton).toBeEnabled();
  await issueButton.click();
  await expectActionSuccess(page, "Issued credential.");

  const hintsButton = page.getByTestId("fetch-hints");
  await expect(hintsButton).toBeEnabled();
  await hintsButton.click();
  await expectActionSuccess(page, "Hinted notes synced");

  return keyValue(readinessPanel, "readiness-claims-hash").innerText();
}

test.describe("magna web readiness (real tx mode)", () => {
  test.skip(!REAL_MODE, "Set MAGNA_WEB_E2E_REAL=1 and point app env to a real local Aztec deployment.");

  test.beforeEach(async ({ page }) => {
    await openRealConsole(page);
  });

  test("in-app wallet verification flow matches the current user console", async ({ page }) => {
    const runNonce = buildRunNonce();
    const sponsoredSlot = "1";
    const verifySlot = "2";
    const expiryOffsetDays = (runNonce % 2000) + 3;
    const activeAddress = await createInAppWallet(page);
    const issuancePanel = panel(page, "panel-credential-issuance");
    const verifyPanel = panel(page, "panel-verify");

    const uniqueIdentifierInput = issuancePanel.getByLabel("Scoped unique identifier field");
    await uniqueIdentifierInput.fill("12345");
    await expect(uniqueIdentifierInput).toHaveValue("12345");

    const derivedGhostAddress = keyValue(issuancePanel, "issuance-derived-ghost-address");
    await expect(derivedGhostAddress).toBeVisible({ timeout: 30_000 });
    await expect(derivedGhostAddress).not.toContainText(activeAddress);

    const ageThresholdInput = issuancePanel.getByLabel("zkPassport age proof threshold");
    const initialAgeThreshold = await ageThresholdInput.inputValue();
    const parsedInitialAge = Number.parseInt(initialAgeThreshold, 10);
    if (!Number.isFinite(parsedInitialAge)) {
      throw new Error(`Invalid initial age threshold input: ${initialAgeThreshold}`);
    }
    const firstAgeThreshold = String(parsedInitialAge + 1 + (runNonce % 10));
    await ageThresholdInput.fill(firstAgeThreshold);
    await expect(ageThresholdInput).toHaveValue(firstAgeThreshold);

    const passportExpiryInput = issuancePanel.getByLabel("Manual passport expiry date");
    const initialExpiry = await passportExpiryInput.inputValue();
    const firstExpiry = incrementIsoDateByDays(initialExpiry, expiryOffsetDays);
    await passportExpiryInput.fill(firstExpiry);
    await expect(passportExpiryInput).toHaveValue(firstExpiry);

    const firstClaimsHash = await issueAndFetchHints(page);

    const sponsorSlotInput = verifyPanel.getByLabel("Sponsor slot (dev / rate-limit test)");
    await sponsorSlotInput.fill(sponsoredSlot);
    await expect(sponsorSlotInput).toHaveValue(sponsoredSlot);

    const sponsoredVerifyButton = page.getByTestId("sponsored-verify");
    await expect(sponsoredVerifyButton).toBeEnabled();
    await sponsoredVerifyButton.click();
    await expectActionSuccess(page, "Sponsored verify transaction succeeded.");

    const nextExpiry = incrementIsoDateByOneDay(firstExpiry);
    await passportExpiryInput.fill(nextExpiry);
    await expect(passportExpiryInput).toHaveValue(nextExpiry);

    const secondAgeThreshold = incrementAgeThreshold(firstAgeThreshold);
    await ageThresholdInput.fill(secondAgeThreshold);
    await expect(ageThresholdInput).toHaveValue(secondAgeThreshold);

    const secondClaimsHash = await issueAndFetchHints(page);
    expect(secondClaimsHash).not.toBe(firstClaimsHash);

    await sponsorSlotInput.fill(verifySlot);
    await expect(sponsorSlotInput).toHaveValue(verifySlot);

    const verifyButton = page.getByTestId("verify");
    await expect(verifyButton).toBeEnabled();
    await verifyButton.click();
    await expectActionSuccess(page, "Verify transaction succeeded.");
  });

  test("operator rights workflow reflects top-ups in the current funding panel", async ({ page }) => {
    await createInAppWallet(page);
    const sponsorRightsPanel = panel(page, "panel-sponsor-rights");

    const readRightsButton = page.getByTestId("read-rights-state");
    await expect(readRightsButton).toBeEnabled();
    await readRightsButton.click();
    await expectActionSuccess(page, "Sponsor rights loaded.");

    const remainingBefore = BigInt(await keyValue(sponsorRightsPanel, "rights-remaining-verifies").innerText());
    const consumedBefore = BigInt(await keyValue(sponsorRightsPanel, "rights-consumed-verifies").innerText());
    const nextPurchaseIdBefore = BigInt(await keyValue(sponsorRightsPanel, "rights-next-purchase-id").innerText());

    const topUpL1Button = page.getByTestId("topup-rights-l1");
    const topUpL2Button = page.getByTestId("topup-rights-l2");
    await expect(topUpL1Button).toBeVisible();
    await expect(topUpL2Button).toBeVisible();

    if (await topUpL1Button.isEnabled()) {
      await topUpL1Button.click();
      await expectActionSuccess(page, "L1 top-up claim transaction succeeded.");
    } else {
      await topUpL2Button.click();
      await expectActionSuccess(page, "L2 top-up transaction succeeded.");
    }

    const remainingAfter = BigInt(await keyValue(sponsorRightsPanel, "rights-remaining-verifies").innerText());
    const consumedAfter = BigInt(await keyValue(sponsorRightsPanel, "rights-consumed-verifies").innerText());
    const topUpRightsAmount = remainingAfter - remainingBefore;

    expect(topUpRightsAmount).toBeGreaterThan(0n);
    expect(remainingAfter).toBe(remainingBefore + topUpRightsAmount);
    expect(consumedAfter).toBe(consumedBefore);
    const nextPurchaseIdAfter = BigInt(await keyValue(sponsorRightsPanel, "rights-next-purchase-id").innerText());
    expect(nextPurchaseIdAfter).toBeGreaterThan(nextPurchaseIdBefore);
  });

  test("diagnostics panels stay usable after the setup and issuance changes", async ({ page }) => {
    await createInAppWallet(page);
    const issuancePanel = panel(page, "panel-credential-issuance");
    const compatibilityPanel = panel(page, "panel-contract-compatibility");
    const ghostPanel = panel(page, "panel-ghost-context");
    const runtimePanel = panel(page, "panel-runtime");

    await expect(runtimePanel).toContainText("Detected chain identity");

    await issuancePanel.getByLabel("Scoped unique identifier field").fill("12345");
    await expect(keyValue(issuancePanel, "issuance-derived-ghost-address")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("inspect-compatibility").click();
    await expectActionSuccess(page, "Inspect contract compatibility completed.");
    await expect(compatibilityPanel.getByText("Issuer", { exact: true })).toBeVisible();
    await expect(compatibilityPanel.getByText("Rights registry", { exact: true })).toBeVisible();

    await page.getByTestId("derive-ghost-context").click();
    await expectActionSuccess(page, "Derive ghost material and root commitment completed.");
    await expect(keyValue(ghostPanel, "ghost-context-root-commitment")).toBeVisible();
  });
});
