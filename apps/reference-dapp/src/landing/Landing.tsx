import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { Cta } from "../brand/Cta";
import { Logo } from "../brand/Logo";
import { SealField } from "../brand/SealField";

gsap.registerPlugin(ScrollTrigger);

const ROOMS = ["New York builders", "Austin night market", "Denver mutual aid"];
const PROOFS = ["Age gate", "US citizen gate", "Instagram next"];
const POSTS = [
  { room: "New York builders", name: "Rae", text: "Demo night moved to the roof. Bring a laptop.", proof: "US citizen, 18+" },
  { room: "Austin night market", name: "Teo", text: "Two stalls left for Saturday. First come.", proof: "18+" },
  { room: "Denver mutual aid", name: "Imani", text: "Pantry restock at 6. We need four hands.", proof: "US citizen" },
];
const DOOR = [
  { n: "01", title: "Citizen of US", proves: "Nationality rule holds", never: "Passport number, name, photo" },
  { n: "02", title: "Age greater than 18", proves: "Minimum age holds", never: "Date of birth" },
  { n: "03", title: "Instagram handle ownership", proves: "You own the handle", never: "The security email" },
];
const STEPS = [
  { n: "01", title: "Tap Login with Magna", copy: "Magna Social sends a policy, never a form." },
  { n: "02", title: "Your wallet opens", copy: "The Magna wallet asks which passkey should answer." },
  { n: "03", title: "The proof settles", copy: "An Aztec transaction carries a request-bound nullifier." },
  { n: "04", title: "You are in", copy: "The app checks the receipt and opens your session." },
];
const PROOF_COLUMNS = ["US citizen", "18+", "Instagram"] as const;
const CIRCLES: { name: string; city: string; needs: (typeof PROOF_COLUMNS)[number][] }[] = [
  { name: "Builders", city: "New York", needs: ["US citizen", "18+"] },
  { name: "Night market", city: "Austin", needs: ["18+"] },
  { name: "Mutual aid", city: "Denver", needs: ["US citizen"] },
  { name: "Run club", city: "Chicago", needs: ["18+", "Instagram"] },
  { name: "Zine swap", city: "Seattle", needs: ["Instagram"] },
  { name: "Late chess", city: "Miami", needs: ["US citizen", "18+", "Instagram"] },
];
const KEPT = [
  { label: "Handle you chose", value: "@rae.builds" },
  { label: "Circles you join", value: "3 circles" },
  { label: "What you post", value: "Your posts" },
  { label: "Magna receipts", value: "0x7c41..9e02" },
];
// Example values a document would expose. They are drawn only to be sealed.
const SEALED = [
  { label: "Passport scan", value: "P<USARAE<<BUILDS<<<<<<<" },
  { label: "Date of birth", value: "1994-03-12" },
  { label: "Passport number", value: "561 284 907" },
  { label: "Instagram email", value: "security@mail.instagram.com" },
];

function useLandingMotion(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09 });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "expo.out" } })
        .from(".stage-copy > *", { y: 32, autoAlpha: 0, duration: 1, stagger: 0.08 })
        .from(".phone-slab", { y: 80, autoAlpha: 0, duration: 1.2 }, "-=0.9")
        .from(".phone-post", { y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.1 }, "-=0.7")
        .from(".feed-column li", { x: 24, autoAlpha: 0, duration: 0.7, stagger: 0.05 }, "-=0.8");
      gsap.to(".phone-slab", {
        yPercent: -8, ease: "none",
        scrollTrigger: { trigger: ".product-stage", start: "top top", end: "bottom top", scrub: true },
      });
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach(node => {
        gsap.from(node, { y: 40, autoAlpha: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: node, start: "top 85%" } });
      });
      gsap.from(".door-card", {
        y: 60, autoAlpha: 0, duration: 1, stagger: 0.12, ease: "expo.out",
        scrollTrigger: { trigger: ".door-grid", start: "top 80%" },
      });
      // Entry steps light up one cell at a time as the section scrolls through.
      const steps = gsap.utils.toArray<HTMLElement>(".entry-step");
      let litCount = -1;
      ScrollTrigger.create({
        trigger: ".entry", start: "top 65%", end: "bottom 60%",
        onUpdate: self => {
          const lit = Math.round(self.progress * steps.length);
          if (lit === litCount) return;
          litCount = lit;
          steps.forEach((step, i) => step.classList.toggle("lit", i < lit));
        },
      });
      gsap.from(".mock-popup", {
        y: 60, rotate: -2, autoAlpha: 0, duration: 1.2, ease: "expo.out",
        scrollTrigger: { trigger: ".entry", start: "top 70%" },
      });
      gsap.from(".circle-row", {
        y: 30, autoAlpha: 0, duration: 0.9, stagger: 0.06, ease: "expo.out",
        scrollTrigger: { trigger: ".circle-matrix", start: "top 80%" },
      });
      gsap.from(".circle-row .need.on", {
        scale: 0, duration: 0.5, stagger: 0.04, ease: "back.out(2.4)",
        scrollTrigger: { trigger: ".circle-matrix", start: "top 70%" },
      });
      // The sealed values are visible for a beat, then ink covers them.
      gsap.fromTo(".redact-bar", { scaleX: 0 }, {
        scaleX: 1, duration: 0.8, stagger: 0.14, ease: "expo.inOut",
        scrollTrigger: { trigger: ".ledger-board", start: "top 65%" },
      });
    }, el);

    return () => {
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [root]);
}

export function Landing(props: { onLaunch: () => void }) {
  const root = useRef<HTMLElement>(null);
  useLandingMotion(root);

  return (
    <main className="landing" ref={root}>
      <section className="product-stage">
        <SealField shape="none" className="social-field" />
        <div className="stage-copy">
          <h1>Magna Social</h1>
          <p className="lede">Follow people by proof, not by documents.</p>
          <div className="stage-actions">
            <Cta label="Launch App" variant="ink" onClick={props.onLaunch} />
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

      <section className="door">
        <div className="section-split">
          <h2 data-reveal>Three proofs at the door. Nothing else comes in.</h2>
          <p data-reveal>
            Every circle on Magna Social is gated by facts, not uploads. Magna proves each fact from your own wallet
            and this app only learns that it holds.
          </p>
        </div>
        <div className="door-grid">
          {DOOR.map(item => (
            <article className="door-card" key={item.n}>
              <span className="door-n">{item.n}</span>
              <h3>{item.title}</h3>
              <dl>
                <div className="proves"><dt>Proves</dt><dd>{item.proves}</dd></div>
                <div><dt>Never sees</dt><dd>{item.never}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="entry">
        <div className="entry-copy">
          <h2 data-reveal>Entry takes one tap and one passkey.</h2>
          <ol className="entry-steps">
            {STEPS.map(step => (
              <li className="entry-step" key={step.n}>
                <span className="entry-cell" aria-hidden="true" />
                <span className="entry-n">{step.n}</span>
                <span className="entry-text"><strong>{step.title}</strong><small>{step.copy}</small></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="mock-stage" aria-hidden="true">
          <div className="mock-popup">
            <Logo className="mock-logo" />
            <span className="mock-kicker">Magna Wallet</span>
            <strong className="mock-title">Login with Magna</strong>
            <p>Choose the named wallet whose private credential should authorize this login.</p>
            <div className="mock-wallet"><span><b>Personal</b><small>0x2f9c..e41a</small></span><i>Open</i></div>
            <div className="mock-wallet"><span><b>Work</b><small>0x91d0..7b3c</small></span><i>Open</i></div>
          </div>
        </div>
      </section>

      <section className="circles">
        <div className="section-split">
          <h2 data-reveal>Circles that know who belongs.</h2>
          <p data-reveal>Each room picks its own rules. Join with the proofs you already hold.</p>
        </div>
        <div className="circle-matrix" role="table" aria-label="Circles and the proofs they require">
          <div className="circle-row circle-head" role="row">
            <span role="columnheader">Circle</span>
            {PROOF_COLUMNS.map(col => <span role="columnheader" className="need-col" key={col}>{col}</span>)}
            <span aria-hidden="true" />
          </div>
          {CIRCLES.map((circle, i) => (
            <div className="circle-row" role="row" key={circle.name}>
              <span role="cell" className="circle-name">
                <small>{String(i + 1).padStart(2, "0")} {circle.city}</small>
                <strong>{circle.name}</strong>
              </span>
              {PROOF_COLUMNS.map(col => {
                const on = circle.needs.includes(col);
                return (
                  <span role="cell" className="need-col" key={col}>
                    <i className={on ? "need on" : "need"} aria-label={on ? `${col} required` : `${col} not required`} />
                  </span>
                );
              })}
              <span className="circle-go" aria-hidden="true">
                <svg viewBox="0 0 10 10" shapeRendering="crispEdges"><path d="M0 4h6V2h1v1h1v1h1v2H8v1H7v1H6V6H0z" fill="currentColor" /></svg>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="ledger">
        <div className="section-split">
          <h2 data-reveal>What crosses the line.</h2>
          <p data-reveal>
            Magna Social keeps what you choose to share. Everything a document would reveal stays sealed in your
            wallet and never reaches this app.
          </p>
        </div>
        <div className="ledger-board">
          <div className="ledger-side">
            <div className="ledger-head"><strong>Kept by Magna Social</strong><span>Shared by you</span></div>
            <ul>
              {KEPT.map(item => (
                <li key={item.label}><span>{item.label}</span><code>{item.value}</code></li>
              ))}
            </ul>
          </div>
          <div className="ledger-side sealed">
            <div className="ledger-head"><strong>Sealed in your wallet</strong><span>Never sent</span></div>
            <ul>
              {SEALED.map(item => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <span className="redact">
                    <code aria-hidden="true">{item.value}</code>
                    <i className="redact-bar" aria-hidden="true"><b>Sealed</b></i>
                    <span className="sr-only">not shared</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="social-closing">
        <h2 data-reveal>Find your circle.</h2>
        <div className="closing-actions" data-reveal>
          <Cta label="Launch App" onClick={props.onLaunch} />
          <p className="powered"><Logo variant="mark" className="powered-mark" />Entry checked by Login with Magna</p>
        </div>
        <footer className="social-foot">
          <span>Magna Social is a reference app for Login with Magna.</span>
          <span>©2026</span>
        </footer>
      </section>
    </main>
  );
}
