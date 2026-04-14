import cors from "cors";
import express from "express";
import {
  createIssuanceContextLoader,
  hydrateVerificationApiEnvFromFiles,
  loadVerificationApiConfigFromEnv,
  verifyAndIssuePassport,
  type VerifyAndIssueRequest,
} from "./service.js";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

hydrateVerificationApiEnvFromFiles();
const config = loadVerificationApiConfigFromEnv();
const loadIssuanceContext = createIssuanceContextLoader(config);

const app = express();
app.use(cors({ origin: config.allowedOrigin === "*" ? true : config.allowedOrigin }));
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "magna-verification-api",
    issuerAddress: config.issuerAddress,
    aztecNodeUrl: config.aztecNodeUrl,
  });
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

app.listen(config.port, () => {
  console.log(
    `[magna-verification-api] listening on :${config.port} | issuer=${config.issuerAddress} | node=${config.aztecNodeUrl}`,
  );
});
