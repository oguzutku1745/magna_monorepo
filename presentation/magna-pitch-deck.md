---
marp: true
title: "Magna — The Private Credential Layer"
description: "Verify once. Prove anywhere. Reveal nothing."
paginate: true
theme: magna
style: |
  /* ── Magna pitch theme ───────────────────────────────────────── */
  :root{
    --ink:#0F1C38;        /* deep passport navy */
    --ink-2:#16264a;
    --paper:#EDF0F6;      /* cool paper */
    --paper-2:#F7F9FC;
    --line:#cdd5e3;
    --muted:#5d6b86;
    --gold:#C5A253;       /* foil accent */
    --zk:#1B8794;         /* zero-knowledge / proof */
    --ok:#2E7D52;         /* revealed by user's choice */
    --no:#B5503F;         /* never leaves device */
  }
  section{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 26px;
    color: var(--ink);
    background: var(--paper-2);
    padding: 60px 70px;
    line-height: 1.45;
  }
  h1{ font-family: Georgia, "Times New Roman", serif; font-size: 52px; color: var(--ink); letter-spacing:-0.5px; }
  h2{ font-family: Georgia, "Times New Roman", serif; font-size: 38px; color: var(--ink); border-bottom: 2px solid var(--gold); padding-bottom: 10px; }
  h3{ font-size: 24px; color: var(--ink-2); }
  strong{ color: var(--ink); }
  a{ color: var(--zk); }
  em{ color: var(--muted); font-style: italic; }
  code{ font-family: "SF Mono", ui-monospace, "Cascadia Code", Menlo, monospace; background:#e7ecf5; color:var(--ink-2); padding:1px 6px; border-radius:4px; font-size:0.85em; }
  table{ font-size: 22px; }
  th{ background: var(--ink); color: #fff; }
  td, th{ border: 1px solid var(--line); padding: 8px 12px; }
  blockquote{ border-left: 4px solid var(--zk); color: var(--ink-2); padding-left: 18px; font-style: normal; }
  .lead{ font-size: 30px; color: var(--muted); }
  .big{ font-size: 64px; font-family: Georgia, serif; color: var(--zk); line-height:1.1; }
  .pill{ font-family: "SF Mono", monospace; font-size: 14px; letter-spacing:0.08em; text-transform:uppercase; color: var(--gold); }
  .columns{ display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 28px; }
  .columns.two{ grid-template-columns: 1fr 1fr; }
  section.cover{ background: var(--ink); color: var(--paper); }
  section.cover h1{ color: #fff; font-size: 64px; }
  section.cover .lead{ color: #aab6cf; }
  section.cover .pill{ color: var(--gold); }
  section.section-break{ background: var(--ink); color: var(--paper); justify-content:center; }
  section.section-break h1{ color:#fff; border:0; }
  footer{ color: var(--muted); font-family:"SF Mono", monospace; font-size:13px; }
---

<!-- _class: cover -->
<!-- _paginate: false -->

<span class="pill">Private Credential Layer · Built on Aztec</span>

# Magna

<p class="lead">Verify once. Prove anywhere. Reveal nothing.</p>

A real-world identity proof — like a zkPassport scan — becomes a **reusable, recoverable, revocable** private credential that apps can trust without ever seeing the underlying data.

<!--
Speaker notes:
- One-line hook: Magna is the privacy layer between "prove you're a real, eligible human" and "let an app act on that" — without anyone hoarding the personal data.
- Keep the cover slide to ~20 seconds. The story is on the next slides.
-->

---

<!-- _class: section-break -->
<!-- _paginate: false -->

# 1 · The Problem

---

## Identity online is a data-hoarding model

Every app that needs to know "are you real / over 18 / from an allowed country" does the same thing:

- **Collects your raw documents** — passport scan, selfie, date of birth.
- **Stores that PII** on its own servers, forever.
- **Re-verifies from scratch** the next time, at the next app, and the next.

> The result: hundreds of copies of your most sensitive data, sitting in hundreds of breachable databases — and a slow, repeated onboarding tax on every user.

<!--
Speaker notes:
- Three structural failures: data hoarding (privacy + breach risk), no reuse (cost), heavy friction (lost users).
- This is the status quo Magna replaces. Don't get technical yet — this is the "why anyone should care" slide.
-->

---

## That broken model is expensive — for everyone

| The cost today | |
| --- | --- |
| Avg. KYC review, corporate client | **$2,598** |
| Avg. bank's annual KYC spend | **$60M+** (majors $500M+) |
| Avg. time to complete a KYC review | **~95 days** |
| Repetitive KYC, EU institutions / yr | **€5B+** |
| Avg. cost of a single data breach | **~$4.4M** |

And it costs **customers** too: **60–80%** of users abandon digital onboarding, and **~70%** drop off any flow that takes longer than **3 minutes**.

<footer>Sources: Fenergo / ShareRing 2026 · Sumsub · IBM Cost of a Data Breach 2025 · Jumio · Zyphe. See appendix.</footer>

<!--
Speaker notes:
- Two pains, two audiences: businesses pay (cost + breach liability), users leave (abandonment).
- These numbers justify both "reusable" (cost) and "private" (breach) parts of Magna's value prop.
-->

---

<!-- _class: section-break -->
<!-- _paginate: false -->

# 2 · The Solution

---

## Magna: prove the fact, never share the data

Magna turns a one-time real-world proof into a **private, reusable credential** living on a private blockchain (Aztec).

- The app learns **only what it needs** — "verified ✓", "over 18", "allowed nationality."
- It **never receives** your name, document number, photo, or date of birth.
- **No one** — not the app, not Magna — stores your raw passport data.

<p class="big">Verify once → reuse everywhere</p>

<!--
Speaker notes:
- This is the core promise. Contrast directly with the previous slide: instead of N copies of raw PII, there are zero — only cryptographic commitments.
- "Login with Magna" is the consumer-facing shape of this (covered shortly).
-->

---

## How it works — in three steps

<div class="columns">
<div>

### 1 · Prove
You scan your passport with **zkPassport** on your own phone. A zero-knowledge proof is generated **on-device** — the raw chip data never leaves it.

</div>
<div>

### 2 · Commit
Magna verifies the proof and issues a **private credential** on Aztec. Only opaque cryptographic **commitments** are stored — never the underlying values.

</div>
<div>

### 3 · Reuse
Any integrating app asks a question ("over 18?", "allowed country?"). Magna answers **true/false** with a fresh proof — **gaslessly, in seconds.**

</div>
</div>

<!--
Speaker notes:
- Keep this strictly non-technical for a general/investor audience.
- Step 1 = privacy at capture. Step 2 = privacy at rest (commitments, not data). Step 3 = the reuse + UX win.
- If the audience is technical, you can expand step 2 into the "commitment = sealed box, witness = key" idea.
-->

---

## What makes it different: PII-blind by construction

This isn't a privacy *policy* — it's privacy enforced by **math**.

- The credential stores a **commitment** = a one-way hash of `(value, random blind)`.
- The real values + blinds — the "witness" — **stay on the user's device.**
- The backend verifies proofs and issues credentials having **seen zero raw PII.**

> Even Magna's own servers cannot reveal a user's nationality or birth date. There is no honeypot to breach, no database to subpoena, no PII to leak.

<!--
Speaker notes:
- The defensibility angle: competitors who "promise" not to misuse data still HOLD the data. Magna structurally cannot.
- This is the regulatory tailwind (GDPR/CCPA data-minimization) turned into a product property.
-->

---

## Credentials that behave like real-world ID

A passport isn't single-use — and neither is a Magna credential. Three properties competitors rarely combine:

| Property | What it means |
| --- | --- |
| **Reusable** | Verify once; prove to unlimited apps with no re-scan. |
| **Recoverable** | Lose your device? A deterministic recovery path restores control — without a central account to hack. |
| **Revocable** | Expired or stolen passport pauses/kills the credential; renewal rotates it cleanly. |

<!--
Speaker notes:
- "Reusable, recoverable, revocable" is the memorable triad — straight from the product.
- Recovery uses a deterministic "ghost account"; revocation uses on-chain nullifiers + root authority refresh. Keep it plain unless asked.
-->

---

<!-- _class: section-break -->
<!-- _paginate: false -->

# 3 · The Product

---

## "Login with Magna" — identity as one button

For apps, integration is as simple as "Sign in with Google" — but private.

```ts
const result = await magna.login({
  credentialType: "Passport",
  constraints: [ ageGte(18), countryNeq("USA") ],
});
if (result.verified) unlockApp();
```

- Drop-in SDK; **three steps** to integrate.
- The app gets back `{ verified }` + a chain-bound transaction receipt — **no keys, notes, claims, or identifiers.**
- Verification is **gasless** for the user.

<!--
Speaker notes:
- This is the wedge: developer-friendly distribution. The hard cryptography is hidden behind one call.
- The wallet (passkeys, proving, private state) lives on a Magna-owned origin — the dApp never touches it. Same trust model as federated login, but the dApp learns nothing about the person.
-->

---

## Architecture at a glance

![Architecture at a glance — user device, Magna Verification API, Aztec L2, integrating app](magna-architecture-diagram.svg)

- **On device:** raw data + secrets. **On chain:** opaque commitments. **At the app:** only the answer.
- Built on **Aztec**, a privacy-first L2 — private state is the default, not an add-on.


<!--
Speaker notes:
- The three trust zones map exactly to the three steps. This is the whole security story in one picture.
-->

---

<!-- _class: section-break -->
<!-- _paginate: false -->

# 4 · The Opportunity

---

## A large market, with a hyper-growth core

| Market | 2025/26 | Forecast | CAGR |
| --- | --- | --- | --- |
| Digital identity **solutions** (TAM) | ~$51B | ~$205B (2034) | ~18% |
| Identity **verification** (SAM) | ~$15–17B | ~$32B (2030) | ~17% |
| **Decentralized / self-sovereign ID** (SOM) | ~$3–7B | ~$38–75B (2030) | **66–85%** |

> Magna sits in the **fastest-growing slice** — decentralized, privacy-preserving identity — riding the much larger identity-verification spend as it migrates to reusable, user-controlled credentials.

<footer>Sources: Fortune Business Insights · TBRC · Technavio · Mordor Intelligence · Grand View Research. Ranges reflect differing report scopes. See appendix.</footer>

<!--
Speaker notes:
- TAM / SAM / SOM framing: total identity solutions → verification spend → the SSI segment Magna directly plays in.
- The headline: the SSI segment grows ~4–5x faster than the broader market. Magna is positioned where the puck is going.
-->

---

## Why now

Three curves are crossing at the same moment:

- **Regulation** — GDPR/CCPA data-minimization and EU digital-identity mandates turn "don't hoard PII" from nice-to-have into **compliance necessity.**
- **Technology** — zero-knowledge proving and **on-device identity proofing** are now production-ready and cheap enough to run on a phone.
- **Demand** — breach fatigue and KYC drop-off push both users and businesses toward **verify-once, reveal-nothing** credentials.

<!--
Speaker notes:
- "Why now" answers the investor's "why didn't this exist before / why won't it wait." ZK maturity + regulation + breach fatigue.
- This is the moment the cost of the old model and the capability of the new model crossed.
-->

---

## Business model

Magna monetizes **verification**, not data.

- **Per-verify metering** — integrating apps pay per successful proof through registered gateways.
- **Sponsored / gasless flows** — companies sponsor their users' verifications (covered via on-chain rights), removing all user friction.
- **Reusable-credential economics** — repeat verifications resolve at a fraction of a full KYC check, the saving Magna shares with integrators.

> Aligned incentive: we make money when apps successfully verify users — and we hold none of the liability that comes with storing PII.

<!--
Speaker notes:
- Revenue = metered verifies + sponsorship rails. No data-resale model — that's both an ethical and a moat point.
- Tie back to the cost slide: a reusable check is "cents on the dollar" vs a full KYC, so there's room to price well and still save the integrator money.
-->

---

<!-- _class: section-break -->
<!-- _paginate: false -->

# 5 · Status & Roadmap

---

## What's already built

This is not a concept — the full stack is implemented and running locally end-to-end.

- **Protocol contracts** on Aztec (issuance, verify, recovery, renewal, sponsorship).
- **TypeScript SDK** — the thin "Login with Magna" connector for any dApp.
- **Off-chain verification API** for zkPassport proofs + credential issuance.
- **Two reference apps** — a Management dApp and a Reference (integration) dApp.
- **PII-blind A1 flow live** — only Poseidon2 commitments leave the device.

<!--
Speaker notes:
- Credibility slide. Emphasize: working code, not slideware. Local end-to-end demo is available.
- v1 scope is the rooted, PII-blind passport flow.
-->

---

## Roadmap

| Now | Next | Later |
| --- | --- | --- |
| PII-blind passport credentials (live) | **WebAuthn passkey** accounts (keys never touch JS) | Additional credential types beyond passport |
| Reusable verify + recovery | Production **security audit** | Broader issuer/verifier network |
| Single-tenant gateways | **Multi-tenant** consumer gateways | Salted **OPRF nullifiers** for unlinkable, Sybil-resistant identity |

<!--
Speaker notes:
- Near-term is hardening + distribution (passkeys, audit, multi-tenant).
- The OPRF nullifier upgrade (privacy-preserving, non-recomputable unique IDs) is the forward-looking research item — coordinate with zkPassport on this.
-->

---

## Why Magna wins

| | Centralized IDV (Jumio, Onfido…) | Most SSI wallets | **Magna** |
| --- | --- | --- | --- |
| Stores raw PII | Yes (honeypot) | Sometimes | **Never** |
| Reusable across apps | No | Partial | **Yes** |
| Recoverable + revocable | N/A | Rare | **Yes** |
| Gasless for the user | N/A | No | **Yes** |
| Developer drop-in | Varies | Hard | **One call** |

<!--
Speaker notes:
- The differentiation matrix. Magna's combination — never stores PII + reusable + recoverable/revocable + gasless + drop-in — is the row no competitor fills completely.
- Don't over-claim specific competitor internals in the room; frame as "the category."
-->

---

<!-- _class: cover -->
<!-- _paginate: false -->

# The future of identity isn't *more* data.

<p class="lead">It's proof without exposure.</p>

Magna makes "verify once, prove anywhere, reveal nothing" the default — for every app, every user, every time.

<span class="pill">Verify once · Prove anywhere · Reveal nothing</span>

<!--
Speaker notes:
- Land the vision, then go to your ask (raise / pilot / partnership) — tailor the final ask to the specific audience.
-->

---

<!-- _paginate: false -->

## Appendix — sources

- **Digital identity solutions market** — Fortune Business Insights (2025: $43B → 2034: $205B, 18.9% CAGR); Precedence Research ($55.7B 2026 → $231B 2035).
- **Identity verification market** — The Business Research Co. / giiresearch ($14.8B 2025 → $32.5B 2030, ~17% CAGR); Technavio (+$25.7B 2026–2030, 21.9% CAGR).
- **Decentralized / self-sovereign identity** — Mordor Intelligence ($3.25B 2025 → $65.6B 2030, 82.4% CAGR); Grand View Research ($1.9B 2024 → $38.1B 2030, 66.8%); TBRC ($3.78B 2025 → $74.9B 2030, ~82%).
- **KYC cost** — Fenergo via ShareRing 2026 ($2,598 / corporate client; bank avg $60M/yr; ~95-day review).
- **Repetitive KYC cost** — Sumsub (EU institutions €5B+/yr; drop-off >50%).
- **Onboarding abandonment** — Jumio (60–80%; 68% of banking apps); Zyphe (70% abandon flows >3 min).
- **Reusable-credential savings** — Mordor via ShareRing (30–50% onboarding cost cut; up to 60% repeat-check reduction); Zyphe / Sumsub (~70% higher completion; ~30% higher conversion).
- **Data breach cost** — IBM *Cost of a Data Breach* 2025 (~$4.4M global avg).
- **Product facts** — Magna `README.md`, `docs/magna-system-explainer.md`, `docs/login-with-magna-architecture-draft.md`.

<footer>Market figures vary by report scope/methodology; ranges shown where sources differ. Verify latest figures before external distribution.</footer>
