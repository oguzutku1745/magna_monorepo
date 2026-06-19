import cors from "cors";
import express from "express";
import {
  createIssuanceContextLoader,
  hydrateVerificationApiEnvFromFiles,
  loadVerificationApiConfigFromEnv,
  verifyAndIssueInstagram,
  verifyAndIssuePassport,
  verifyRootRecoveryPreflight,
  verifyAndRefreshRootAuthority,
  type VerifyRootRecoveryPreflightRequest,
  type VerifyAndRefreshRootAuthorityRequest,
  type VerifyAndIssueRequest,
  type VerifyAndIssueInstagramRequest,
} from "./service.js";
import { createSessionCode, exchangeSessionCode } from "./session-code-store.js";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

hydrateVerificationApiEnvFromFiles();
const config = loadVerificationApiConfigFromEnv();
const loadIssuanceContext = createIssuanceContextLoader(config);


const walletOrigin = process.env.MAGNA_WALLET_ORIGIN?.trim() || process.env.VITE_MAGNA_WALLET_ORIGIN?.trim() || config.allowedOrigin;

function isOriginAllowed(origin: string | undefined, allowedOrigin: string): boolean {
  if (allowedOrigin === "*") return true;
  return origin === allowedOrigin;
}

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigin === "*" || origin === config.allowedOrigin || origin === walletOrigin) {
      callback(null, true);
      return;
    }
    callback(new Error("origin is not allowed by Magna verification API CORS policy"));
  },
}));
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "magna-verification-api",
    issuerAddress: config.issuerAddress,
    aztecNodeUrl: config.aztecNodeUrl,
  });
});


app.post("/api/session/code", (req, res) => {
  if (!isOriginAllowed(req.get("origin"), walletOrigin)) {
    res.status(403).json({ error: "origin is not allowed to create Magna session codes" });
    return;
  }
  const assertion = (req.body as { assertion?: unknown }).assertion;
  if (assertion === undefined || assertion === null) {
    res.status(400).json({ error: "assertion is required" });
    return;
  }
  res.status(200).json({ code: createSessionCode(assertion) });
});

app.post("/api/session/exchange", (req, res) => {
  const code = (req.body as { code?: unknown }).code;
  if (typeof code !== "string" || !code) {
    res.status(400).json({ error: "code is required" });
    return;
  }
  const assertion = exchangeSessionCode(code);
  if (!assertion) {
    res.status(404).json({ error: "session code not found" });
    return;
  }
  res.status(200).json({ assertion });
});

app.post("/zkpassport/verify-and-issue", async (req, res) => {
  try {
    const payload = req.body as VerifyAndIssueRequest;
    const result = await verifyAndIssuePassport(config, payload, loadIssuanceContext);
    res.status(200).json(result);
  } catch (error) {
    const message = errorMessage(error);
    res.status(400).json({
      error: message,
    });
  }
});

app.post("/instagram/verify", async (req, res) => {
  try {
    const payload = req.body as VerifyAndIssueInstagramRequest;
    const result = await verifyAndIssueInstagram(config, payload, loadIssuanceContext);
    res.status(200).json(result);
  } catch (error) {
    const message = errorMessage(error);
    res.status(400).json({
      error: message,
    });
  }
});

app.post("/zkpassport/verify-and-refresh-root-authority", async (req, res) => {
  try {
    const payload = req.body as VerifyAndRefreshRootAuthorityRequest;
    const result = await verifyAndRefreshRootAuthority(config, payload, loadIssuanceContext);
    res.status(200).json(result);
  } catch (error) {
    const message = errorMessage(error);
    res.status(400).json({
      error: message,
    });
  }
});

app.post("/zkpassport/verify-for-root-recovery", async (req, res) => {
  try {
    const payload = req.body as VerifyRootRecoveryPreflightRequest;
    const result = await verifyRootRecoveryPreflight(config, payload);
    res.status(200).json(result);
  } catch (error) {
    const message = errorMessage(error);
    res.status(400).json({
      error: message,
    });
  }
});

try {
  await loadIssuanceContext();
} catch (error) {
  console.error(`[magna-verification-api] startup preflight failed: ${errorMessage(error)}`);
  process.exit(1);
}

app.listen(config.port, () => {
  console.log(
    `[magna-verification-api] listening on :${config.port} | issuer=${config.issuerAddress} | node=${config.aztecNodeUrl}`,
  );
});
