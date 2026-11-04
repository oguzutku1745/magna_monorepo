import { useState } from "react";
import { Logo } from "./brand/Logo";
import { Landing } from "./landing/Landing";
import { SealField } from "./brand/SealField";
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
        <button type="button" onClick={() => route.go("/app")}>Try the demo</button>
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

export function AppGate(props: {
  login: LoginState;
  handle: string;
  setHandle: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <main className="gate">
      <SealField shape="none" className="gate-field" />
      <section className="gate-copy">
        <p className="eyebrow">Entry requirement</p>
        <h1>Verify eligibility. Keep your documents private.</h1>
        <p>This demo checks passport nationality, age 18 or older and ownership of your Instagram handle. The local demo uses zkPassport development passports (ZKR).</p>
        <ol className="gate-flow" aria-label="How entry works">
          <li><span>01</span>Enter your handle</li>
          <li><span>02</span>Approve in your Magna wallet</li>
          <li><span>03</span>See your verification result</li>
        </ol>
      </section>
      <section className="requirement-panel">
        <header className="pass-head" aria-hidden="true">
          <span>Entry pass</span>
          <Logo variant="mark" mono className="pass-mark" />
        </header>
        <div><span>Requirement 01</span><strong>Passport country (ZKR demo)</strong></div>
        <div><span>Requirement 02</span><strong>Age 18 or older</strong></div>
        <div><span>Requirement 03</span><strong>Instagram handle ownership</strong></div>
        <label>
          Instagram handle
          <span className="handle-field">
            <span className="handle-at" aria-hidden="true">@</span>
            <input value={props.handle} onChange={event => props.setHandle(event.target.value)} placeholder="magnasocial" />
          </span>
        </label>
        <button className="magna-login" type="button" disabled={props.login.status === "pending"} onClick={props.onLogin}>
          <Logo variant="mark" mono className="magna-login-mark" />
          {props.login.status === "pending" ? "Opening Magna..." : "Login with Magna"}
        </button>
        {props.login.status === "blocked" ? <p className="blocked">{props.login.message}</p> : null}
        <p className="pass-note">Your Magna wallet opens to verify these requirements. This app does not receive your passport or security email.</p>
      </section>
    </main>
  );
}

export function Result(props: { login: LoginState }) {
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
        <h1>Verification complete.</h1>
        <p>The demo verified your Passport and Instagram requirements. Your documents were not shared with this app.</p>
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
