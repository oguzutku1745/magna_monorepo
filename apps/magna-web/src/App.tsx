import { useEffect, useMemo, useState } from "react";
import {
  createDefaultPassportClaimsForm,
  createDefaultPolicyForm,
  issuePassportWithDevOrchestrator,
  MagnaBrowserClient,
  type PassportHints,
  type PassportClaimsForm,
  type PolicyForm,
} from "./lib/magna";
import { getPasskeyCapability, createPasskeySpikeCredential, type PasskeyCapability, type PasskeySpikeResult } from "./lib/passkey";
import { getAppEnv } from "./lib/env";
import {
  beginExternalWalletConnection,
  confirmExternalWalletConnection,
  createManagedWalletSession,
  discoverExternalWallets,
  type ManagedAccountFlavor,
  type PendingExternalWalletConnection,
  type WalletSession,
} from "./lib/wallet";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function nowStamp(): string {
  return new Date().toLocaleTimeString();
}

function readReceiptValue(receipt: unknown, key: string): string | undefined {
  if (!receipt || typeof receipt !== "object") {
    return undefined;
  }
  const value = Reflect.get(receipt, key);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && "toString" in value) {
    return String(value.toString());
  }
  return undefined;
}

function describeTxOutcome(
  label: string,
  outcome: { txHash?: string; receipt: unknown },
): string {
  const parts = [`${label} succeeded.`];
  if (outcome.txHash) {
    parts.push(`Tx: ${outcome.txHash}`);
  }

  const blockNumber = readReceiptValue(outcome.receipt, "blockNumber");
  if (blockNumber) {
    parts.push(`Block: ${blockNumber}`);
  }

  const status = readReceiptValue(outcome.receipt, "status");
  if (status) {
    parts.push(`Status: ${status}`);
  }

  const executionResult = readReceiptValue(outcome.receipt, "executionResult");
  if (executionResult) {
    parts.push(`Execution: ${executionResult}`);
  }

  const transactionFee = readReceiptValue(outcome.receipt, "transactionFee");
  if (transactionFee) {
    parts.push(`Fee: ${transactionFee}`);
  }

  return parts.join(" ");
}

export function App() {
  const env = useMemo(() => getAppEnv(), []);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("App initialized.");
  const [error, setError] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof discoverExternalWallets>>>([]);
  const [pendingConnection, setPendingConnection] = useState<PendingExternalWalletConnection | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [managedAlias, setManagedAlias] = useState<string>("magna-user");
  const [managedFlavor, setManagedFlavor] = useState<ManagedAccountFlavor>("schnorr");
  const [ghostOwner, setGhostOwner] = useState<string>("");
  const [claimsForm, setClaimsForm] = useState<PassportClaimsForm>(createDefaultPassportClaimsForm);
  const [policyForm, setPolicyForm] = useState<PolicyForm>(createDefaultPolicyForm);
  const [hints, setHints] = useState<PassportHints | null>(null);
  const [passkeyCapability, setPasskeyCapability] = useState<PasskeyCapability | null>(null);
  const [passkeyResult, setPasskeyResult] = useState<PasskeySpikeResult | null>(null);

  useEffect(() => {
    void getPasskeyCapability().then(setPasskeyCapability).catch(() => {
      setPasskeyCapability({
        isSupported: false,
        hasConditionalUi: false,
        hasPlatformAuthenticator: false,
      });
    });
  }, []);

  useEffect(() => {
    if (!session) {
      setSelectedAccount("");
      return;
    }
    setSelectedAccount(session.activeAccount.address);
  }, [session]);

  const activeAccount = useMemo(
    () => session?.accounts.find(account => account.address === selectedAccount) ?? session?.activeAccount ?? null,
    [selectedAccount, session],
  );

  const appendLog = (message: string) => {
    setActivityLog(current => [`[${nowStamp()}] ${message}`, ...current].slice(0, 10));
  };

  const runAction = async <T,>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
    setBusyAction(label);
    setError(null);
    setStatusMessage(`${label} started...`);
    appendLog(`${label} started`);
    try {
      const result = await work();
      setStatusMessage(`${label} completed.`);
      appendLog(`${label} completed`);
      return result;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(`${label}: ${message}`);
      setStatusMessage(`${label} failed.`);
      appendLog(`${label} failed: ${message}`);
      return undefined;
    } finally {
      setBusyAction(null);
    }
  };

  const createUserClient = (): MagnaBrowserClient => {
    if (!session || !activeAccount) {
      throw new Error("Connect an Aztec wallet or create a managed account first.");
    }
    return new MagnaBrowserClient(session.wallet, env, activeAccount.address);
  };

  const handleDiscoverWallets = async () => {
    const found = await runAction("Discover external wallets", async () => {
      const nextProviders = await discoverExternalWallets(env.aztecNodeUrl, env.appId);
      setProviders(nextProviders);
      return nextProviders;
    });
    if (found && found.length === 0) {
      setStatusMessage("No compatible extension wallet approved the discovery request.");
    }
  };

  const handleBeginExternalConnection = async (providerIndex: number) => {
    const provider = providers[providerIndex];
    if (!provider) return;
    const connection = await runAction(`Open secure channel with ${provider.name}`, async () =>
      beginExternalWalletConnection(provider, env.appId),
    );
    if (connection) {
      setPendingConnection(connection);
    }
  };

  const handleConfirmExternalConnection = async () => {
    if (!pendingConnection) return;
    const connected = await runAction("Confirm external wallet connection", async () =>
      confirmExternalWalletConnection(pendingConnection),
    );
    if (connected) {
      setSession(connected);
      setPendingConnection(null);
      setHints(null);
      if (!ghostOwner) {
        setGhostOwner(connected.activeAccount.address);
      }
    }
  };

  const handleCreateManagedWallet = async () => {
    const created = await runAction("Create managed embedded wallet", async () =>
      createManagedWalletSession({
        nodeUrl: env.aztecNodeUrl,
        alias: managedAlias.trim() || "magna-user",
        flavor: managedFlavor,
        localTestAccountIndex: env.localTestAccountIndex,
        bootstrapWithLocalTestAccount: env.enableLocalTestBootstrap,
      }),
    );
    if (created) {
      setSession(created);
      setHints(null);
      setGhostOwner(created.activeAccount.address);
    }
  };

  const handleDisconnect = async () => {
    if (!session) return;
    await runAction("Disconnect wallet session", async () => {
      await session.disconnect();
      setSession(null);
      setHints(null);
      setPendingConnection(null);
    });
  };

  const handlePasskeySpike = async () => {
    const result = await runAction("Create browser passkey spike credential", async () =>
      createPasskeySpikeCredential(`magna-${Date.now()}`),
    );
    if (result) {
      setPasskeyResult(result);
    }
  };

  const handleIssuePassport = async () => {
    if (!activeAccount) {
      setError("Choose an active account before issuing a credential.");
      return;
    }
    const result = await runAction("Issue passport credential via dev orchestrator", async () =>
      issuePassportWithDevOrchestrator(env, {
        activeOwner: activeAccount.address,
        ghostOwner: ghostOwner.trim() || activeAccount.address,
        claimsForm,
      }),
    );
    if (result) {
      setStatusMessage(`Issued credential. Claims hash: ${result.claimsHash}`);
    }
  };

  const handleFetchHints = async () => {
    if (!activeAccount) {
      setError("Choose an active account before fetching hinted notes.");
      return;
    }
    const result = await runAction("Fetch Magna hinted notes", async () => {
      const client = createUserClient();
      await client.syncOrchestratorSender();
      const nextHints = await client.fetchPassportHints(activeAccount.address, claimsForm);
      setHints(nextHints);
      return nextHints;
    });
    if (result) {
      setStatusMessage(`Hinted notes synced for claims hash ${result.claimsHash}.`);
    }
  };

  const handleVerify = async () => {
    if (!hints) {
      setError("Fetch hinted notes before calling verify.");
      return;
    }
    const result = await runAction("Run Magna verify", async () => {
      const client = createUserClient();
      return await client.verifyPassport(claimsForm, policyForm, hints);
    });
    if (result) {
      setStatusMessage(describeTxOutcome("Verify transaction", result));
    }
  };

  const handleSponsoredVerify = async () => {
    if (!hints) {
      setError("Fetch hinted notes before calling sponsored verify.");
      return;
    }
    const result = await runAction("Run Magna sponsored verify", async () => {
      const client = createUserClient();
      return await client.verifyPassportWithCompanySponsor(claimsForm, policyForm, hints);
    });
    if (result) {
      setStatusMessage(describeTxOutcome("Sponsored verify transaction", result));
    }
  };

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Magna x Aztec</p>
        <h1>Browser onboarding, credential readiness, and verification</h1>
        <p className="body-copy">
          This app implements the first Magna browser slice: external wallet connection via wallet-sdk,
          managed embedded-wallet onboarding for local development, passkey spike capture, and user-side
          Magna verification flows backed by the repo’s existing SDK and bindings.
        </p>
        <div className="status-banner">{statusMessage}</div>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="grid-layout">
        <Panel
          title="Runtime"
          description="All runtime wiring comes from env vars so this app can point at local network or a future hosted setup."
        >
          <KeyValue label="Aztec node" value={env.aztecNodeUrl} />
          <KeyValue label="App id" value={env.appId} />
          <KeyValue label="Issuer" value={env.issuerAddress ?? "not configured"} />
          <KeyValue label="Company sponsor" value={env.companySponsorAddress ?? "not configured"} />
          <KeyValue label="Orchestrator" value={env.orchestratorAddress ?? "local test bootstrap"} />
          <KeyValue label="Managed wallets" value={env.enableManagedWallets ? "enabled" : "disabled"} />
          <KeyValue label="Dev orchestrator" value={env.enableDevOrchestrator ? "enabled" : "disabled"} />
        </Panel>

        <Panel
          title="External Wallets"
          description="Uses `@aztec/wallet-sdk` discovery plus the secure-channel emoji handshake before a wallet session is confirmed."
        >
          <button disabled={busyAction !== null} onClick={() => void handleDiscoverWallets()}>
            Discover extension wallets
          </button>
          {providers.length === 0 ? <p className="muted-text">No wallet providers discovered yet.</p> : null}
          <div className="stack-list">
            {providers.map((provider, index) => (
              <button key={provider.id} className="secondary-button" disabled={busyAction !== null} onClick={() => void handleBeginExternalConnection(index)}>
                Connect {provider.name}
              </button>
            ))}
          </div>
          {pendingConnection ? (
            <div className="sub-card">
              <p className="label">Verify these wallet-sdk emojis in your wallet UI</p>
              <p className="emoji-grid">{pendingConnection.emojiGrid}</p>
              <div className="button-row">
                <button disabled={busyAction !== null} onClick={() => void handleConfirmExternalConnection()}>
                  Confirm secure channel
                </button>
                <button
                  className="secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => {
                    pendingConnection.pending.cancel();
                    setPendingConnection(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Managed Wallet"
          description="Local-dev fallback using browser `EmbeddedWallet`, with optional bootstrap from Aztec’s initial test account so new users can be deployed and exercised immediately."
        >
          <Field label="Managed account alias">
            <input value={managedAlias} onChange={event => setManagedAlias(event.target.value)} />
          </Field>
          <Field label="Account flavor">
            <select value={managedFlavor} onChange={event => setManagedFlavor(event.target.value as ManagedAccountFlavor)}>
              <option value="schnorr">Schnorr</option>
              <option value="secp256r1">secp256r1 / P-256</option>
            </select>
          </Field>
          <p className="muted-text">
            Bootstrap source: {env.enableLocalTestBootstrap ? `local test account #${env.localTestAccountIndex}` : "disabled"}
          </p>
          <button disabled={!env.enableManagedWallets || busyAction !== null} onClick={() => void handleCreateManagedWallet()}>
            Create managed wallet
          </button>
        </Panel>

        <Panel
          title="Passkey Spike"
          description="Technical spike for browser WebAuthn. This captures the passkey credential metadata we will need for a custom Aztec/WebAuthn account path."
        >
          <KeyValue label="WebAuthn support" value={passkeyCapability?.isSupported ? "yes" : "no"} />
          <KeyValue label="Conditional UI" value={passkeyCapability?.hasConditionalUi ? "yes" : "no"} />
          <KeyValue label="Platform authenticator" value={passkeyCapability?.hasPlatformAuthenticator ? "yes" : "no"} />
          <button disabled={busyAction !== null || !passkeyCapability?.isSupported} onClick={() => void handlePasskeySpike()}>
            Create spike passkey
          </button>
          <p className="muted-text">
            Current Aztec account contracts still expect direct secp256r1 signing material, so this spike stores
            browser passkey outputs without pretending the full signer bridge is finished.
          </p>
          {passkeyResult ? (
            <div className="sub-card">
              <KeyValue label="Credential id" value={passkeyResult.credentialId} />
              <KeyValue label="RP id" value={passkeyResult.rpId} />
              <KeyValue label="Attachment" value={passkeyResult.authenticatorAttachment ?? "unknown"} />
              <KeyValue label="Algorithm" value={String(passkeyResult.publicKeyAlgorithm ?? "unknown")} />
            </div>
          ) : null}
        </Panel>
      </section>

      <section className="grid-layout">
        <Panel
          title="Session"
          description="The selected active account is used for note sync and verify transactions."
        >
          {session ? (
            <>
              <KeyValue label="Session kind" value={session.kind} />
              <KeyValue label="Wallet label" value={session.label} />
              {session.metadata
                ? Object.entries(session.metadata).map(([key, value]) => <KeyValue key={key} label={key} value={value} />)
                : null}
              <Field label="Active account">
                <select value={selectedAccount} onChange={event => setSelectedAccount(event.target.value)}>
                  {session.accounts.map(account => (
                    <option key={account.address} value={account.address}>
                      {account.alias || "unnamed"} - {account.address}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="secondary-button" disabled={busyAction !== null} onClick={() => void handleDisconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <p className="muted-text">No wallet session connected yet.</p>
          )}
        </Panel>

        <Panel
          title="Credential Issuance"
          description="Dev-only orchestration path for local network. This form now matches Magna's real zkPassport-backed passport model: age threshold, nationality, and passport expiry."
        >
          <Field label="Recovery / ghost owner">
            <input
              value={ghostOwner}
              onChange={event => setGhostOwner(event.target.value)}
              placeholder={activeAccount?.address ?? "0x..."}
            />
          </Field>
          <ClaimsFormEditor form={claimsForm} onChange={setClaimsForm} />
          <button disabled={busyAction !== null || !activeAccount || !env.enableDevOrchestrator} onClick={() => void handleIssuePassport()}>
            Issue passport credential
          </button>
        </Panel>

        <Panel
          title="Readiness"
          description="Registers the orchestrator sender and pulls hinted notes for the currently selected account and claims hash."
        >
          <button disabled={busyAction !== null || !activeAccount || !env.issuerAddress} onClick={() => void handleFetchHints()}>
            Fetch hinted notes
          </button>
          {hints ? (
            <div className="sub-card">
              <KeyValue label="Claims hash" value={hints.claimsHash} />
              <KeyValue label="Credential note" value="loaded" />
              <KeyValue label="Status note" value="loaded" />
            </div>
          ) : (
            <p className="muted-text">Fetch hinted notes after issuance or when pointing at an already-issued credential.</p>
          )}
        </Panel>

        <Panel
          title="Verify"
          description="Runs the first user-facing Magna flows: normal verify and company-sponsored verify."
        >
          <PolicyFormEditor form={policyForm} onChange={setPolicyForm} />
          <div className="button-row">
            <button disabled={busyAction !== null || !hints || !activeAccount} onClick={() => void handleVerify()}>
              Verify with Magna
            </button>
            <button
              className="secondary-button"
              disabled={busyAction !== null || !hints || !activeAccount || !env.companySponsorAddress}
              onClick={() => void handleSponsoredVerify()}
            >
              Sponsored verify
            </button>
          </div>
        </Panel>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Activity Log</h2>
            <p className="panel-copy">Latest app actions, limited to the most recent ten entries.</p>
          </div>
        </div>
        {activityLog.length === 0 ? (
          <p className="muted-text">No actions recorded yet.</p>
        ) : (
          <div className="log-list">
            {activityLog.map(entry => (
              <code key={entry}>{entry}</code>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Panel(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{props.title}</h2>
          <p className="panel-copy">{props.description}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="key-value">
      <span>{props.label}</span>
      <code>{props.value}</code>
    </div>
  );
}

function ClaimsFormEditor(props: { form: PassportClaimsForm; onChange: (form: PassportClaimsForm) => void }) {
  const { form, onChange } = props;
  return (
    <>
      <p className="muted-text">
        Magna's current passport credential commitment is derived from zkPassport disclosure for nationality, an
        age proof threshold like "18+", and the passport expiry date. The older upper-age placeholder is not part
        of the user-facing policy surface and is fixed internally.
      </p>
      <div className="field-grid">
        <Field label="Disclosed nationality (alpha-3)">
          <input
            value={form.nationalityAlpha3}
            onChange={event => onChange({ ...form, nationalityAlpha3: event.target.value })}
            placeholder="TUR"
          />
        </Field>
        <Field label="zkPassport age proof threshold">
          <input
            value={form.ageThreshold}
            onChange={event => onChange({ ...form, ageThreshold: event.target.value })}
            placeholder="18"
          />
        </Field>
        <Field label="Passport expiry date">
          <input
            type="date"
            value={form.passportExpiryDate}
            onChange={event => onChange({ ...form, passportExpiryDate: event.target.value })}
          />
        </Field>
      </div>
    </>
  );
}

function PolicyFormEditor(props: { form: PolicyForm; onChange: (form: PolicyForm) => void }) {
  const { form, onChange } = props;
  return (
    <>
      <p className="muted-text">
        Current passport verification policy checks only the disclosed age threshold, nationality, and expiry.
      </p>
      <div className="field-grid">
        <Field label="Minimum age required">
          <input value={form.minimumAge} onChange={event => onChange({ ...form, minimumAge: event.target.value })} />
        </Field>
        <Field label="Disallow nationality (optional)">
          <input
            value={form.blockedNationalityAlpha3}
            onChange={event => onChange({ ...form, blockedNationalityAlpha3: event.target.value })}
            placeholder="USA"
          />
        </Field>
        <Field label="Sponsor slot (dev / rate-limit test)">
          <input value={form.sponsorSlot} onChange={event => onChange({ ...form, sponsorSlot: event.target.value })} />
        </Field>
      </div>
    </>
  );
}
