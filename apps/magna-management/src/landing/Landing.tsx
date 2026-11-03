import { Fragment, useEffect, useRef } from "react";
import { Logo } from "../brand/Logo";
import { SealField } from "../brand/SealField";
import type { SealField as Field } from "../brand/ascii-field.js";
import { EASE, gsap, reducedMotion, scrollToTop, ScrollTrigger, useSmoothScroll } from "../brand/motion";
import { PIXELS, type PixelName } from "./pixels";

const HEADLINE = "Prove who you are, reveal nothing else.";

const STEPS: { n: string; icon: PixelName; label: string; title: string; copy: string; stays: string; leaves: string }[] = [
  {
    n: "01", icon: "passkey", label: "Wallet",
    title: "Open a wallet with your face.",
    copy: "A passkey creates an Aztec account in the browser. No seed phrase, no custodian. The private key never leaves the authenticator.",
    stays: "Passkey secret", leaves: "Account address",
  },
  {
    n: "02", icon: "passport", label: "Passport",
    title: "Scan a passport. Keep the passport.",
    copy: "zkPassport reads the chip on your phone and proves age and nationality claims. Magna issues them as a private credential in your wallet.",
    stays: "Name, number, photo", leaves: "A proof of the claims",
  },
  {
    n: "03", icon: "email", label: "Instagram",
    title: "Prove a handle from a signed email.",
    copy: "Your browser checks Instagram's DKIM signature on a security email and proves the handle locally. The email never leaves the device.",
    stays: "The email, the handle", leaves: "A blinded commitment",
  },
  {
    n: "04", icon: "login", label: "Login",
    title: "Log in with one answer.",
    copy: "An app asks for a policy, such as age 18 or over. The wallet answers in an Aztec transaction; the SDK checks its request-bound nullifier.",
    stays: "Notes, witnesses, documents", leaves: "Yes, and a transaction hash",
  },
  {
    n: "05", icon: "recover", label: "Recovery",
    title: "Lose the device, not the identity.",
    copy: "A fresh passport proof rotates your passport root to a new passkey. The old lineage is consumed, so a lost wallet cannot come back.",
    stays: "The old wallet stays dead", leaves: "Root moves to the new key",
  },
];

const SEES = [
  ["Full name", "Copy stored", "Never sent"],
  ["Passport number", "Copy stored", "Never sent"],
  ["Date of birth", "Copy stored", "Never sent"],
  ["Age 18 or over", "Inferred", "Proven"],
  ["Nationality rule", "Inferred", "Proven"],
  ["Instagram handle owner", "Screenshot", "Proven"],
] as const;

const STATS = [
  { value: 0, label: "Documents an app receives" },
  { value: 4, label: "Kinds of secret that never leave the wallet" },
  { value: 2, label: "Live credential rails" },
  { value: 1, label: "Passkey to open all of it" },
];

function Pixel(props: { name: PixelName; className?: string }) {
  return (
    <span className={`pixel ${props.className ?? ""}`} aria-hidden="true">
      {PIXELS[props.name].flatMap((row, y) =>
        [...row].map((v, x) => <i key={`${x}-${y}`} className={v === "S" ? "on seal" : v === "1" ? "on" : ""} />),
      )}
    </span>
  );
}

function Barcode(props: { seed: number; bars?: number; className?: string }) {
  let s = props.seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const count = props.bars ?? 48;
  return (
    <span className={`barcode ${props.className ?? ""}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const dense = i < count * 0.2;
        return (
          <i
            key={i}
            style={{
              width: dense ? 3 : 1 + Math.floor(rnd() * 3),
              marginRight: dense ? 1 : 2 + Math.floor(rnd() * 9),
            }}
          />
        );
      })}
    </span>
  );
}

function Words(props: { text: string; className?: string }) {
  return (
    <>
      {props.text.split(" ").map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="word"><span className={props.className}>{word}</span></span>{" "}
        </Fragment>
      ))}
    </>
  );
}

const topbarOffset = () => document.querySelector<HTMLElement>(".topbar")?.offsetHeight ?? 0;

function useLandingMotion(root: React.RefObject<HTMLElement | null>, field: React.MutableRefObject<Field | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (reducedMotion()) {
      field.current?.setProgress(1);
      return;
    }
    const ctx = gsap.context(() => {
      // Hero: words rise out of their masks, then the rest settles in.
      gsap.timeline({ defaults: { ease: EASE } })
        .from(".hero-title .w", { yPercent: 110, duration: 1.1, stagger: 0.05 })
        .from(".hero-in", { y: 24, autoAlpha: 0, duration: 0.9, stagger: 0.08 }, "-=0.7")
        .from(".hero-meta .barcode i", { scaleY: 0, transformOrigin: "bottom", duration: 0.5, stagger: 0.004 }, "-=0.9");

      // The proof front resolves the seal as the hero scrolls away, starting part-way resolved.
      field.current?.setProgress(0.55);
      ScrollTrigger.create({
        trigger: ".landing-hero",
        start: "top top",
        end: "bottom top",
        onUpdate: self => field.current?.setProgress(0.55 + self.progress * 0.45),
      });
      gsap.to(".landing-hero .seal-field", {
        yPercent: 18, ease: "none",
        scrollTrigger: { trigger: ".landing-hero", start: "top top", end: "bottom top", scrub: true },
      });

      // Marquee rows drift against each other with scroll.
      gsap.utils.toArray<HTMLElement>(".marquee-row").forEach((row, i) => {
        gsap.fromTo(row, { xPercent: i % 2 ? -30 : 0 }, {
          xPercent: i % 2 ? 0 : -30, ease: "none",
          scrollTrigger: { trigger: ".marquee", start: "top bottom", end: "bottom top", scrub: true },
        });
      });

      // Generic reveals.
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach(node => {
        gsap.from(node, {
          y: 40, autoAlpha: 0, duration: 1, ease: EASE,
          scrollTrigger: { trigger: node, start: "top 85%" },
        });
      });
      gsap.utils.toArray<HTMLElement>("[data-lines]").forEach(node => {
        gsap.from(node.querySelectorAll(".w"), {
          yPercent: 110, duration: 0.9, stagger: 0.04, ease: EASE,
          scrollTrigger: { trigger: node, start: "top 85%" },
        });
      });

      // Stats count up in pixel type.
      gsap.utils.toArray<HTMLElement>("[data-count]").forEach(node => {
        const to = Number(node.dataset.count);
        const counter = { v: 0 };
        node.textContent = "0";
        gsap.to(counter, {
          v: to, duration: 1.4, ease: "power2.out",
          scrollTrigger: { trigger: node, start: "top 85%" },
          onUpdate: () => { node.textContent = String(Math.round(counter.v)); },
        });
      });

      // Comparison table: the Magna column seals row by row.
      gsap.from(".sees-row", {
        autoAlpha: 0, y: 16, duration: 0.7, stagger: 0.08, ease: EASE,
        scrollTrigger: { trigger: ".sees-table", start: "top 75%" },
      });

      // Timeline: pinned horizontal travel on wide screens, stacked reveals on narrow ones.
      const mm = gsap.matchMedia();
      mm.add("(min-width: 960px)", () => {
        const track = el.querySelector<HTMLElement>(".tl-track");
        const section = el.querySelector<HTMLElement>(".timeline");
        if (!track || !section) return;
        const distance = () => track.scrollWidth - window.innerWidth;
        const steps = gsap.utils.toArray<HTMLElement>(".tl-step-index li");
        const travel = gsap.to(track, {
          x: () => -distance(), ease: "none",
          scrollTrigger: {
            trigger: section, start: () => `top ${topbarOffset()}px`, end: () => `+=${distance()}`,
            pin: true, scrub: 0.8, invalidateOnRefresh: true,
            onUpdate: self => {
              const active = Math.min(steps.length - 1, Math.floor(self.progress * steps.length * 0.999));
              steps.forEach((li, i) => li.classList.toggle("lit", i <= active));
              section.style.setProperty("--tl-progress", String(self.progress));
            },
          },
        });
        gsap.utils.toArray<HTMLElement>(".tl-panel").forEach((panel, i) => {
          // The first panel is already in view when the pin starts, so it reveals on the section itself.
          const trigger = i === 0
            ? { trigger: section, start: "top 60%" }
            : { trigger: panel, containerAnimation: travel, start: "left 70%" };
          gsap.from(panel.querySelectorAll(".pixel i.on"), {
            scale: 0, duration: 0.4, stagger: { each: 0.012, from: "random" }, ease: "back.out(2)",
            scrollTrigger: trigger,
          });
          gsap.from(panel.querySelectorAll(".tl-copy > *"), {
            x: 60, autoAlpha: 0, duration: 0.9, stagger: 0.07, ease: EASE,
            scrollTrigger: trigger,
          });
        });
      });
      mm.add("(max-width: 959px)", () => {
        gsap.utils.toArray<HTMLElement>(".tl-panel").forEach(panel => {
          gsap.from(panel, { y: 48, autoAlpha: 0, duration: 1, ease: EASE, scrollTrigger: { trigger: panel, start: "top 85%" } });
        });
      });
    }, el);
    return () => ctx.revert();
  }, [root, field]);
}

export function Landing(props: { go: (path: string) => void }) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<Field | null>(null);
  useSmoothScroll();
  useLandingMotion(root, field);

  return (
    <main className="landing" ref={root}>
      <section className="landing-hero">
        <SealField className="hero-field" fieldRef={field} shape="mark" progress={0} markBox={{ x: 0.52, y: 0.5, size: 0.7 }} />
        <div className="hero-meta" aria-hidden="true">
          <div><span>MG/00</span><Barcode seed={3} bars={42} /></div>
          <div><span className="lit">01 Prove</span><Barcode seed={9} bars={10} /></div>
          <div><span>02 Seal</span><Barcode seed={5} bars={38} /></div>
          <div><span>03 Reveal</span><Barcode seed={13} bars={2} /></div>
        </div>
        <div className="hero-body">
          <p className="eyebrow hero-in">Private identity layer on Aztec</p>
          <h1 className="landing-title hero-title">
            <Words text={HEADLINE} className="w" />
          </h1>
          <p className="hero-copy hero-in">
            Magna turns your passport and social proofs into private credentials held in a passkey wallet. Apps get a
            simple yes or no, never your documents.
          </p>
          <div className="hero-actions hero-in">
            <button className="magnetic" type="button" onClick={() => props.go("/user/login")}>User Login</button>
            <button className="secondary magnetic" type="button" onClick={() => props.go("/company/login")}>
              Company Login
            </button>
          </div>
        </div>
        <div className="hero-foot">
          <span>Scroll to follow a credential ↓</span>
        </div>
      </section>

      <section className="marquee" aria-hidden="true">
        <div className="marquee-row">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>Prove once<Logo variant="mark" className="marquee-mark" /></span>
          ))}
        </div>
        <div className="marquee-row ghost">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>Reveal nothing<Logo variant="mark" mono className="marquee-mark" /></span>
          ))}
        </div>
      </section>

      <section className="mission">
        <div className="split">
          <h2 data-lines><Words text="Every app asks for the whole document." className="w" /></h2>
          <p data-reveal>
            Age gates, KYC checks and creator verifications keep copies of passports and emails they never needed.
            Magna keeps the document with you and lets apps check only the rule they care about. The answer is
            enforced on Aztec, so the app can trust it without seeing anything behind it.
          </p>
        </div>
        <div className="cards">
          {[
            { k: "Passport", t: "Passport A2", c: "zkPassport proof of age and nationality claims, issued as a rooted private credential.", n: "001", icon: "passport" as const },
            { k: "Social", t: "Instagram V2", c: "Handle ownership proven in the browser from a DKIM-signed Instagram security email.", n: "002", icon: "email" as const },
            { k: "Recovery", t: "Recovery V3", c: "A fresh passport proof moves your passport root to a new passkey and retires the old one.", n: "003", icon: "recover" as const },
          ].map(card => (
            <article className="brand-card" key={card.n} data-reveal>
              <span className="corner tl">{card.k}</span>
              <span className="corner tr">Credential</span>
              <Pixel name={card.icon} className="card-pixel" />
              <h3>{card.t}</h3>
              <p>{card.c}</p>
              <span className="corner bl">{card.n}</span>
              <span className="corner br">Live</span>
            </article>
          ))}
        </div>
      </section>

      <section className="timeline" aria-label="The life of a Magna credential">
        <div className="tl-head">
          <p className="eyebrow">The life of a credential</p>
          <ol className="tl-step-index">
            {STEPS.map(step => (
              <li key={step.n}><i /><span>{step.n} {step.label}</span></li>
            ))}
          </ol>
        </div>
        <div className="tl-track">
          {STEPS.map(step => (
            <article className="tl-panel" key={step.n}>
              <div className="tl-figure">
                <span className="corner tl">Step {step.n}</span>
                <span className="corner tr">{step.label}</span>
                <Pixel name={step.icon} className="tl-pixel" />
                <span className="corner bl">In the wallet</span>
                <span className="corner br">To the app</span>
              </div>
              <div className="tl-copy">
                <span className="tl-number">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
                <dl>
                  <div><dt>Stays</dt><dd>{step.stays}</dd></div>
                  <div className="leaves"><dt>Leaves</dt><dd>{step.leaves}</dd></div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="sees">
        <div className="split">
          <h2 data-lines><Words text="What the app actually sees." className="w" /></h2>
          <p data-reveal>
            The dApp receives public request metadata and transaction hashes. Private notes, credential witnesses,
            passkey secrets and passport or email data stay in the wallet.
          </p>
        </div>
        <div className="sees-table" role="table" aria-label="Data an app receives">
          <div className="sees-row sees-head" role="row">
            <span role="columnheader"><Barcode seed={21} bars={24} /></span>
            <span role="columnheader">Typical KYC</span>
            <span role="columnheader">Login with Magna</span>
          </div>
          {SEES.map(([field, kyc, magna]) => (
            <div className="sees-row" role="row" key={field}>
              <span role="cell">{field}</span>
              <span role="cell" className="kyc">{kyc}</span>
              <span role="cell" className={magna === "Proven" ? "proven" : "sealed"}><i />{magna}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stats">
        {STATS.map(stat => (
          <div className="stat" key={stat.label} data-reveal>
            <span className="stat-value" data-count={stat.value}>{stat.value}</span>
            <span className="stat-label">{stat.label}</span>
          </div>
        ))}
      </section>

      <section className="devs">
        <div className="devs-copy">
          <p className="eyebrow">For builders</p>
          <h2 data-lines><Words text="Ask for a rule, not a person." className="w" /></h2>
          <p data-reveal>
            <code>@magna-protocol/client</code> opens the wallet, binds your policy hash into the request and checks the
            policy-bound nullifier in the successful Aztec transaction before it resolves.
          </p>
        </div>
        <pre className="code" data-reveal>
          <span className="code-head"><span>login.ts</span><span>TypeScript</span></span>
          <code>{`const passportGate: Policy = {
  credentialType: CredentialType.Passport,
  constraints: [
    { claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n },
  ],
};

const result = await magna.login(passportGate);

if (result.verified) {
  unlockProtectedAction();
}`}</code>
        </pre>
      </section>

      <section className="closing">
        <div className="closing-top">
          <Logo variant="mark" className="closing-mark" />
          <h2 data-lines><Words text="Open your wallet." className="w" /></h2>
          <div className="hero-actions">
            <button type="button" onClick={() => props.go("/user/login")}>User Login</button>
            <button className="secondary" type="button" onClick={() => props.go("/company/login")}>Company Login</button>
          </div>
        </div>
        <div className="closing-word" aria-hidden="true"><Logo className="closing-logo" /></div>
        <footer className="landing-foot">
          <span>Prove who you are. Reveal nothing else.</span>
          <button type="button" className="text-button" onClick={scrollToTop}>Back to top ↑</button>
          <span>©2026 Magna</span>
        </footer>
      </section>
    </main>
  );
}
