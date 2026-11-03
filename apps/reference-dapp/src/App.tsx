import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Logo } from "./brand/Logo";
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

const ROOMS = ["New York builders", "Austin night market", "Denver mutual aid"];
const PROOFS = ["Age gate", "US citizen gate", "Instagram next"];
const POSTS = [
  { room: "New York builders", name: "Rae", text: "Demo night moved to the roof. Bring a laptop.", proof: "US citizen, 18+" },
  { room: "Austin night market", name: "Teo", text: "Two stalls left for Saturday. First come.", proof: "18+" },
  { room: "Denver mutual aid", name: "Imani", text: "Pantry restock at 6. We need four hands.", proof: "US citizen" },
];

function Landing(props: { onLaunch: () => void }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "expo.out" } })
        .from(".stage-copy > *", { y: 32, autoAlpha: 0, duration: 1, stagger: 0.08 })
        .from(".phone-slab", { y: 80, autoAlpha: 0, duration: 1.2 }, "-=0.9")
        .from(".phone-post", { y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.1 }, "-=0.7")
        .from(".feed-column li", { x: 24, autoAlpha: 0, duration: 0.7, stagger: 0.05 }, "-=0.8");
      gsap.to(".phone-slab", { y: -10, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true, delay: 1.6 });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <main className="landing" ref={root}>
      <SealField shape="none" className="social-field" />
      <section className="product-stage">
        <div className="stage-copy">
          <h1>Magna Social</h1>
          <p className="lede">Follow people by proof, not by documents.</p>
          <div className="stage-actions">
            <button type="button" onClick={props.onLaunch}>Launch App</button>
          </div>
          <p className="powered"><Logo variant="mark" className="powered-mark" />Entry checked by Login with Magna</p>
        </div>
        <div className="phone-slab" aria-label="Magna Social product preview">
          <div className="phone-head">
            <strong>Circles</strong>
            <span>Near you</span>
          </div>
          <div className="post-line">US citizen, 18+, no passport data exposed.</div>
          {POSTS.map(post => (
            <article className="phone-post" key={post.name}>
              <span className="avatar" aria-hidden="true">{post.name[0]}</span>
              <div>
                <p className="post-meta"><strong>{post.name}</strong> in {post.room}</p>
                <p className="post-text">{post.text}</p>
                <span className="post-proof"><i aria-hidden="true" />{post.proof}</span>
              </div>
            </article>
          ))}
          <div className="post-line thin">Follow people by proof, not by documents.</div>
        </div>
        <div className="feed-columns">
          <div className="feed-column left">
            <span>Citizen-only rooms</span>
            <ul>{ROOMS.map(room => <li key={room}><strong>{room}</strong></li>)}</ul>
          </div>
          <div className="feed-column right">
            <span>Private proofs</span>
            <ul>{PROOFS.map(proof => <li key={proof}><strong>{proof}</strong></li>)}</ul>
          </div>
        </div>
      </section>
    </main>
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
        <button className="magna-login" type="button" disabled={props.login.status === "pending"} onClick={props.onLogin}>
          <Logo variant="mark" mono className="magna-login-mark" />
          {props.login.status === "pending" ? "Opening Magna..." : "Login with Magna"}
        </button>
        {props.login.status === "blocked" ? <p className="blocked">{props.login.message}</p> : null}
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
