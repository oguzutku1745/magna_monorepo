import { Fragment, useEffect, useRef } from "react";
import { Cta } from "../brand/Cta";
import { Logo } from "../brand/Logo";
import { SealField } from "../brand/SealField";
import type { SealField as Field } from "../brand/ascii-field.js";
import { EASE, gsap, reducedMotion, scrollToTop, ScrollTrigger, useSmoothScroll } from "../brand/motion";
import { PIXELS, type PixelName } from "./pixels";

const HEADLINE = "Prove who you are, reveal nothing else.";

const STEPS: { n: string; icon: PixelName; label: string; title: string; copy: string; stays: string; leaves: string }[] = [
  {
    n: "01", icon: "passkey", label: "Wallet",
    title: "Your wallet, unlocked by you.",
    copy: "Create a wallet and open it with a passkey on your device. Use your face, fingerprint or device PIN instead of remembering another password.",
    stays: "Your passkey", leaves: "Your wallet address",
  },
  {
    n: "02", icon: "passport", label: "Passport",
    title: "Scan a passport. Keep the passport.",
    copy: "Use the zkPassport app on your phone to verify your age and nationality. Save the verification in Magna so apps can check those facts without receiving your passport.",
    stays: "Name, number, photo", leaves: "Verified age and nationality checks",
  },
  {
    n: "03", icon: "email", label: "Instagram",
    title: "Show that the account is yours.",
    copy: "Add proof that you control an Instagram account. Use it with apps that ask to verify account ownership, without giving them access to your account.",
    stays: "Your account access", leaves: "Account ownership verified",
  },
  {
    n: "04", icon: "login", label: "Login",
    title: "Log in with one answer.",
    copy: "An app asks to check a fact, such as whether you are 18 or older. Approve the request in your wallet and the app receives the verification result.",
    stays: "Your documents and private data", leaves: "The approved verification result",
  },
  {
    n: "05", icon: "recover", label: "Recovery",
    title: "Lose the device, not the identity.",
    copy: "Verify your passport again to restore its credential to a new wallet. The old Passport and its linked credentials stop working. Add Instagram again after recovery.",
    stays: "Your original documents", leaves: "Passport restored to your new wallet",
  },
];

const SEES = [
  ["Full name", "Copy stored", "Never sent"],
  ["Passport number", "Copy stored", "Never sent"],
  ["Date of birth", "Copy stored", "Never sent"],
  ["Age 18 or over", "Inferred", "Proven"],
  ["Requested nationality check", "Inferred", "Proven"],
  ["Instagram handle owner", "Screenshot", "Proven"],
] as const;

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

      // The proof front sweeps across the seal once the headline has landed.
      gsap.delayedCall(0.4, () => field.current?.setProgress(1));

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
        let lastActive = -1;
        const travel = gsap.to(track, {
          x: () => -distance(), ease: "none",
          scrollTrigger: {
            trigger: section, start: () => `top ${topbarOffset()}px`, end: () => `+=${distance()}`,
            pin: true, scrub: 0.8, invalidateOnRefresh: true,
            onUpdate: self => {
              const active = Math.min(steps.length - 1, Math.floor(self.progress * steps.length * 0.999));
              if (active === lastActive) return;
              lastActive = active;
              steps.forEach((li, i) => li.classList.toggle("lit", i <= active));
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
        <SealField className="hero-field" fieldRef={field} shape="mark" progress={0} markBox={{ x: 0.5, y: 0.5, size: 0.7 }} />
        <div className="hero-meta" aria-hidden="true">
          <div><span>MG/00</span><Barcode seed={3} bars={42} /></div>
          <div><span className="lit">01 Prove</span><Barcode seed={9} bars={10} /></div>
          <div><span>02 Seal</span><Barcode seed={5} bars={38} /></div>
          <div><span>03 Reveal</span><Barcode seed={13} bars={2} /></div>
        </div>
        <div className="hero-body">
          <h1 className="landing-title hero-title">
            <Words text={HEADLINE} className="w" />
          </h1>
          <p className="hero-copy hero-in">
            Keep verified facts about yourself in one private wallet. Prove your age, nationality or Instagram
            ownership to apps without handing over your documents.
          </p>
          <div className="hero-actions hero-in">
            <Cta label="Open wallet" onClick={() => props.go("/user/login")} />
            <Cta label="For companies" variant="outline" onClick={() => props.go("/company/login")} />
          </div>
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
          <h2 data-lines><Words text="Prove a fact. Keep the document." className="w" /></h2>
          <p data-reveal>
            An age check should not need a copy of your passport. Magna lets apps verify the facts they need
            while your personal documents stay with you. You choose which verification requests to approve.
          </p>
        </div>
        <div className="cards">
          {[
            { k: "Passport", t: "Passport verification", c: "Verify your age and nationality without sharing your passport with apps.", n: "001", icon: "passport" as const },
            { k: "Social", t: "Instagram ownership", c: "Prove that an Instagram account belongs to you without giving apps access to it.", n: "002", icon: "email" as const },
            { k: "Recovery", t: "Passport recovery", c: "Lost access to your wallet? Verify your passport again to restore its credential to a new wallet.", n: "003", icon: "recover" as const },
          ].map(card => (
            <article className="brand-card" key={card.n} data-reveal>
              <span className="corner tl">{card.k}</span>
              <span className="corner tr">{card.k === "Recovery" ? "Wallet access" : "Credential"}</span>
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
          <h2 className="tl-title">How Magna works</h2>
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
                <span className="corner bl">Kept private</span>
                <span className="corner br">Shared result</span>
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
            Apps receive the results of the checks you approve and a verification record. They do not receive
            your passport, date of birth or Instagram security email.
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

      <section className="devs">
        <div className="devs-copy">
          <h2 data-lines><Words text="Build with Magna." className="w" /></h2>
        </div>
        <div className="devs-copy" data-reveal>
          <p>
            Let people prove the facts your app needs without collecting their documents. The Magna SDK connects
            your app to their wallet and checks the verification result.
          </p>
          <div className="hero-actions">
            <Cta
              label="Read the docs"
              variant="outline"
              onClick={() => window.location.assign("https://github.com/oguzutku1745/magna_monorepo/blob/main/docs/integration-guide.md")}
            />
          </div>
        </div>
      </section>

      <section className="closing">
        <div className="closing-top">
          <Logo variant="mark" className="closing-mark" />
          <h2 data-lines><Words text="Open your wallet." className="w" /></h2>
        </div>
        <div className="paths" data-reveal>
          {[
            { k: "For people", n: "01", label: "Open wallet", path: "/user/login", icon: "passkey" as const,
              copy: "Add Passport and Instagram credentials, approve app requests and recover Passport if you lose access." },
            { k: "For companies", n: "02", label: "Company login", path: "/company/login", icon: "login" as const,
              copy: "Buy verifications and cover your users' verification fees while their documents stay private." },
          ].map(item => (
            <button className="path" type="button" key={item.n} onClick={() => props.go(item.path)}>
              <span className="corner tl">{item.k}</span>
              <span className="corner tr">{item.n}</span>
              <Pixel name={item.icon} className="path-pixel" />
              <span className="path-title">{item.label}</span>
              <span className="path-copy">{item.copy}</span>
              <span className="path-go" aria-hidden="true">
                <svg viewBox="0 0 10 10" shapeRendering="crispEdges"><path d="M0 4h6V2h1v1h1v1h1v2H8v1H7v1H6V6H0z" fill="currentColor" /></svg>
              </span>
            </button>
          ))}
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
