import { useState } from "react";
import { createReferenceMagnaClient, loginWithMagnaSocial, type MagnaLoginResult } from "./login-with-magna";
import { useRoute } from "./router";

type LoginState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "verified"; result: MagnaLoginResult; instagramHandle: string }
  | { status: "blocked"; message: string };

function cleanHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function App() {
  const route = useRoute();
  const [login, setLogin] = useState<LoginState>({ status: "idle" });
  const [handle, setHandle] = useState("");

  async function runLogin() {
    const instagramHandle = cleanHandle(handle);
    if (!/^[a-z0-9._]{1,30}$/.test(instagramHandle)) {
      setLogin({ status: "blocked", message: "Enter a valid Instagram handle without @." });
      return;
    }
    setLogin({ status: "pending" });
    try {
      const result = await loginWithMagnaSocial(instagramHandle, createReferenceMagnaClient());
      if (!result.verified) {
        setLogin({ status: "blocked", message: "Magna could not verify the requested requirements." });
        return;
      }
      setLogin({ status: "verified", result, instagramHandle });
      route.go("/app/result");
    } catch (error) {
      setLogin({ status: "blocked", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="social-shell">
      <header className="social-nav">
        <button className="wordmark" type="button" onClick={() => route.go("/")}>Magna Social</button>
        <button type="button" onClick={() => route.go("/app")}>Launch App</button>
      </header>
      {route.path === "/app" ? (
        <AppGate login={login} handle={handle} setHandle={setHandle} onLogin={() => void runLogin()} />
      ) : route.path === "/app/result" ? (
        <Result login={login} />
      ) : (
        <Landing onLaunch={() => route.go("/app")} />
      )}
    </div>
  );
}

function Landing(props: { onLaunch: () => void }) {
  return (
    <main className="landing">
      <section className="product-stage">
        <div className="feed-column left">
          <span>Citizen-only rooms</span>
          <strong>New York builders</strong>
          <strong>Austin night market</strong>
          <strong>Denver mutual aid</strong>
        </div>
        <div className="phone-slab" aria-label="Magna Social product preview">
          <p>Verified local circles</p>
          <h1>Magna Social</h1>
          <div className="post-line">US citizen, 18+, no passport data exposed.</div>
          <div className="post-line thin">Follow people by proof, not by documents.</div>
          <button type="button" onClick={props.onLaunch}>Launch App</button>
        </div>
        <div className="feed-column right">
          <span>Private proofs</span>
          <strong>Age gate</strong>
          <strong>US citizen gate</strong>
          <strong>Instagram next</strong>
        </div>
      </section>
    </main>
  );
}

function AppGate(props: {
  login: LoginState;
  handle: string;
  setHandle: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <main className="gate">
      <section className="gate-copy">
        <p className="eyebrow">Entry requirement</p>
        <h1>Prove eligibility without handing over identity.</h1>
        <p>Magna Social asks Magna for three facts only: US citizen, older than 18, and owner of the requested Instagram handle.</p>
      </section>
      <section className="requirement-panel">
        <div><span>Requirement 01</span><strong>Citizen of US</strong></div>
        <div><span>Requirement 02</span><strong>Age greater than 18</strong></div>
        <div><span>Requirement 03</span><strong>Instagram handle ownership</strong></div>
        <label>
          Instagram handle
          <input value={props.handle} onChange={event => props.setHandle(event.target.value)} placeholder="magnasocial" />
        </label>
        <button type="button" disabled={props.login.status === "pending"} onClick={props.onLogin}>
          {props.login.status === "pending" ? "Opening Magna..." : "Login with Magna"}
        </button>
        {props.login.status === "blocked" ? <p className="blocked">{props.login.message}</p> : null}
      </section>
    </main>
  );
}

function Result(props: { login: LoginState }) {
  if (props.login.status !== "verified") {
    return (
      <main className="gate">
        <section className="requirement-panel">
          <h1>No verified Magna session</h1>
          <p>Return to the app gate and start Login with Magna.</p>
        </section>
      </main>
    );
  }
  return (
    <main className="gate">
      <section className="gate-copy">
        <p className="eyebrow">Magna verified</p>
        <h1>Your Magna Social session is ready.</h1>
        <p>Magna verified passport eligibility and Instagram ownership without uploading documents to this app.</p>
      </section>
      <section className="requirement-panel">
        <p className="success">Verified @{props.login.instagramHandle}.</p>
        {(props.login.result.receipts ?? [{ id: "passport", kind: "policy", receipt: props.login.result.receipt }]).map(receipt => (
          <p className="receipt" key={receipt.id}>
            {receipt.id} receipt: {receipt.receipt ?? "not returned"}
          </p>
        ))}
      </section>
    </main>
  );
}
