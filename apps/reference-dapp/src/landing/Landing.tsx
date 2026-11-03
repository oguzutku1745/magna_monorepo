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
const CIRCLES = [
  { name: "New York builders", tags: ["US citizen", "18+"] },
  { name: "Austin night market", tags: ["18+"] },
  { name: "Denver mutual aid", tags: ["US citizen"] },
  { name: "Chicago run club", tags: ["18+", "Instagram"] },
  { name: "Seattle zine swap", tags: ["Instagram"] },
  { name: "Miami late chess", tags: ["US citizen", "18+", "Instagram"] },
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
      ScrollTrigger.create({
        trigger: ".entry", start: "top 65%", end: "bottom 60%", scrub: true,
        onUpdate: self => {
          const lit = Math.round(self.progress * steps.length);
          steps.forEach((step, i) => step.classList.toggle("lit", i < lit));
        },
      });
      gsap.from(".mock-popup", {
        y: 60, rotate: -2, autoAlpha: 0, duration: 1.2, ease: "expo.out",
        scrollTrigger: { trigger: ".entry", start: "top 70%" },
      });
      gsap.from(".circle-card", {
        y: 40, autoAlpha: 0, duration: 0.9, stagger: 0.06, ease: "expo.out",
        scrollTrigger: { trigger: ".circle-grid", start: "top 80%" },
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
        <div className="circle-grid">
          {CIRCLES.map((circle, i) => (
            <article className="circle-card" key={circle.name}>
              <span className="circle-index">{String(i + 1).padStart(2, "0")}</span>
              <h3>{circle.name}</h3>
              <div className="circle-tags">
                {circle.tags.map(tag => <span key={tag}><i aria-hidden="true" />{tag}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ledger">
        <div className="ledger-col" data-reveal>
          <h3>Magna Social keeps</h3>
          <ul><li>The handle you chose</li><li>The circles you join</li><li>What you post</li><li>Magna receipts</li></ul>
        </div>
        <div className="ledger-col never" data-reveal>
          <h3>Magna Social never receives</h3>
          <ul><li>A passport scan</li><li>Your date of birth</li><li>Your passport number</li><li>Your Instagram email</li></ul>
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
