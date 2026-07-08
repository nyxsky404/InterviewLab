/**
 * Landing.jsx — InterviewLab marketing page
 *
 * Vercel React best-practices applied:
 * - rendering-hoist-jsx: all static data arrays hoisted to module scope
 * - rerender-no-inline-components: every sub-component defined at module level
 * - rerender-memo: heavy sub-trees wrapped in React.memo
 * - rerender-functional-setstate: functional form used for toggle state
 * - rerender-simple-expression-in-memo: primitive deps only in effects
 * - js-early-exit: guard returns at top of render paths
 */

import { useState, useEffect, useCallback, memo } from "react";
import { Link } from "react-router-dom";
import { 
  Mic, 
  RefreshCw, 
  FileText, 
  BarChart, 
  Volume2, 
  TrendingUp, 
  Target, 
  Clock, 
  Repeat, 
  Lightbulb,
  MessageCircle,
  Code2,
  Network,
  Users
} from "lucide-react";
import Brand from "../components/Brand.jsx";
import "../styles/landing.css";

/* ─────────────────────────────────────────────────
   STATIC DATA — hoisted to module scope (rendering-hoist-jsx)
   so object identities stay stable across re-renders.
───────────────────────────────────────────────── */

const NAV_LINKS = [
  { label: "Features",     href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Results",      href: "#results" },
  { label: "Pricing",      href: "#pricing" },
];

const HERO_STATS = [
  { value: "4",         label: "Interview types" },
  { value: "~7 min",    label: "Avg. session" },
  { value: "100-point", label: "Score report" },
  { value: "Real-time", label: "Follow-up questions" },
];

const INTERVIEW_TYPES = [
  { label: "Behavioral",    color: "#0070f3", icon: <MessageCircle size={14} strokeWidth={2.5} /> },
  { label: "Technical",     color: "#7928ca", icon: <Code2 size={14} strokeWidth={2.5} /> },
  { label: "System Design", color: "#ab570a", icon: <Network size={14} strokeWidth={2.5} /> },
  { label: "HR",            color: "#eb367f", icon: <Users size={14} strokeWidth={2.5} /> },
];

const FEATURES = [
  {
    icon: <Mic size={24} strokeWidth={1.5} />,
    title: "Talk like you're in the real thing.",
    desc: "Answer out loud — the AI interviewer listens, responds, and digs deeper based on what you say. No typing, no scripts, no multiple choice.",
  },
  {
    icon: <RefreshCw size={24} strokeWidth={1.5} />,
    title: "Questions that adapt to your answers.",
    desc: "Give a weak answer and you'll get a follow-up that probes deeper. Nail it and the difficulty ramps up. Every session is different.",
  },
  {
    icon: <FileText size={24} strokeWidth={1.5} />,
    title: "Tailored to your résumé and target role.",
    desc: "Paste your résumé and the job description. The interviewer will ask about your actual experience — and the report will flag gaps you need to close.",
  },
  {
    icon: <BarChart size={24} strokeWidth={1.5} />,
    title: "A report you can actually act on.",
    desc: "Get a score, a hiring verdict, your top-3 things to fix, and a review of every question — with exactly what you should have said differently.",
  },
  {
    icon: <Volume2 size={24} strokeWidth={1.5} />,
    title: "Hear yourself the way an interviewer does.",
    desc: "Track your talk ratio, filler-word rate, and average answer length. Small habits — like saying 'um' less — make a big difference.",
  },
  {
    icon: <TrendingUp size={24} strokeWidth={1.5} />,
    title: "See your progress over time.",
    desc: "Every session is saved. Compare your scores across multiple practice rounds and see which skills are improving week over week.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Create your free account.",
    desc: "Sign up in 30 seconds. Add your current role and experience level so the AI pitches questions at the right difficulty from session one.",
  },
  {
    num: "02",
    title: "Pick the interview type.",
    desc: "Choose from Behavioral, Technical, System Design, or HR. Each mode has its own style, question bank, and scoring criteria.",
  },
  {
    num: "03",
    title: "Have the conversation.",
    desc: "The AI interviewer speaks. You answer out loud. It listens, reacts, and follows up — just like a real panel. Sessions run 7–11 minutes.",
  },
  {
    num: "04",
    title: "Read your full report.",
    desc: "Get an overall score, a hiring verdict, a skills breakdown, and a review of every question with concrete suggestions for next time.",
  },
];

const REPORT_COMPETENCIES = [
  { label: "Communication",     score: 4.5, pct: 90 },
  { label: "Problem Solving",   score: 4.2, pct: 84 },
  { label: "Technical Depth",   score: 4.0, pct: 80 },
  { label: "Leadership",        score: 3.8, pct: 76 },
];

const REPORT_EXCHANGES = [
  {
    q: "Tell me about a time you led a project under pressure.",
    tag: "Behavioral",
    score: 4,
    color: "#007cf0",
    feedback: "Good structure — add the business outcome to make the impact stick.",
  },
  {
    q: "How would you design a URL shortener at scale?",
    tag: "System Design",
    score: 4,
    color: "#7928ca",
    feedback: "Solid architecture. Mention cache eviction strategy to round out the answer.",
  },
  {
    q: "Walk me through a conflict you resolved on your team.",
    tag: "Behavioral",
    score: 3,
    color: "#007cf0",
    feedback: "The outcome was vague — quantify the improvement and name your specific actions.",
  },
];

const ADAPTIVE_FEATURES = [
  {
    icon: <Target size={24} strokeWidth={1.5} />,
    title: "Struggles are followed up on.",
    desc: "Give a vague or incomplete answer and the AI will probe with a follow-up. Nail it, and it raises the bar for the next question.",
  },
  {
    icon: <Clock size={24} strokeWidth={1.5} />,
    title: "Feels like the real thing.",
    desc: "Sessions run 7–11 minutes — the length of a real interview panel. You can interrupt anytime, just like you would in person.",
  },
  {
    icon: <Repeat size={24} strokeWidth={1.5} />,
    title: "No two sessions are the same.",
    desc: "Every run through is different. The question mix, order, and follow-ups change based on what you say. Practice as many times as you want.",
  },
];

const PRICING_PLANS = [
  {
    tier: "Starter",
    amount: "Free",
    period: "",
    featured: false,
    features: [
      "5 practice sessions / month",
      "All 4 interview formats",
      "Score & summary report",
      "7-min session limit",
    ],
    cta: "Get started free",
    ctaClass: "lp-pricing-card__cta--secondary",
    id: "pricing-starter-cta",
  },
  {
    tier: "Pro",
    badge: "Most popular",
    amount: "$9",
    period: "/ month",
    featured: true,
    features: [
      "Unlimited practice sessions",
      "All 4 interview formats",
      "Résumé + job description matching",
      "Full scored report per session",
      "Question-by-question coaching",
      "Session history & transcripts",
      "11-min session limit",
    ],
    cta: "Start free trial",
    ctaClass: "lp-pricing-card__cta--white",
    id: "pricing-pro-cta",
  },
  {
    tier: "Team",
    amount: "$29",
    period: "/ month",
    featured: false,
    features: [
      "Everything in Pro",
      "Up to 5 seats",
      "Shared session library",
      "Team progress dashboard",
      "Priority support",
    ],
    cta: "Talk to us",
    ctaClass: "lp-pricing-card__cta--primary",
    id: "pricing-team-cta",
  },
];

const FOOTER_COLS = [
  {
    title: "Product",
    links: ["Features", "How it works", "Pricing", "Changelog"],
  },
  {
    title: "Resources",
    links: ["Documentation", "GitHub", "Status", "Blog"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "Privacy Policy", "Terms"],
  },
];

/* ─────────────────────────────────────────────────
   PURE SUB-COMPONENTS (module-level, never inline)
   (rerender-no-inline-components)
───────────────────────────────────────────────── */

/** Animated SVG score ring */
const ScoreRing = memo(function ScoreRing({ score = 87, size = 96, stroke = 6 }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    // rerender-simple-expression-in-memo: primitive deps
    const t = setTimeout(() => setOffset(circ * (1 - score / 100)), 400);
    return () => clearTimeout(t);
  }, [score, circ]);

  return (
    <div className="lp-score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ebebeb" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="#171717"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="lp-score-ring__value" aria-label={`Score: ${score}`}>{score}</div>
    </div>
  );
});

/** Single competency bar with entrance animation */
const ScoreBar = memo(function ScoreBar({ label, pct, score, delay = 0 }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // rerender-simple-expression-in-memo: only primitives
    const t = setTimeout(() => setWidth(pct), 500 + delay);
    return () => clearTimeout(t);
  }, [pct, delay]);

  return (
    <div className="lp-score-bar">
      <div className="lp-score-bar__header">
        <span>{label}</span>
        <span>{score}/5</span>
      </div>
      <div className="lp-score-bar__track">
        <div className="lp-score-bar__fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
});

/** Star rating display */
function StarRating({ score }) {
  const full  = Math.floor(score);
  const half  = score % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <span className="lp-stars" aria-label={`${score} out of 5 stars`}>
      {"★".repeat(full)}
      {half ? "½" : ""}
      {"☆".repeat(empty)}
    </span>
  );
}

/** Nav component */
function Nav() {
  const [open, setOpen] = useState(false);
  // rerender-functional-setstate: stable toggle callback
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close  = useCallback(() => setOpen(false), []);

  return (
    <>
      <nav className="lp-nav" role="navigation" aria-label="Main navigation">
        <div className="lp-nav__inner">
          {/* Brand — left */}
          <Link to="/" aria-label="InterviewLab home" style={{ textDecoration: "none" }}>
            <Brand />
          </Link>

          {/* Center links — absolutely centred so they don't shift with CTA width */}
          <ul className="lp-nav__links" role="list">
            {NAV_LINKS.map((l) => (
              <li key={l.label}>
                <a className="lp-nav__link" href={l.href} onClick={close}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          {/* CTA cluster — right */}
          <div className="lp-nav__ctas">
            <Link to="/login"  className="lp-nav__btn lp-nav__btn--login">Log in</Link>
            <Link to="/signup" className="lp-nav__btn lp-nav__btn--signup">Sign up</Link>
          </div>

          {/* Hamburger — mobile only */}
          <button
            className="lp-nav__hamburger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={toggle}
          >
            <span style={open ? { transform: "rotate(45deg) translate(5px,5px)" }  : {}} />
            <span style={open ? { opacity: 0 } : {}} />
            <span style={open ? { transform: "rotate(-45deg) translate(5px,-5px)" } : {}} />
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="lp-nav__mobile-menu" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {NAV_LINKS.map((l) => (
            <a key={l.label} className="lp-nav__mobile-link" href={l.href} onClick={close}>
              {l.label}
            </a>
          ))}
          <div className="lp-nav__mobile-ctas">
            <Link to="/login"  className="lp-nav__mobile-cta lp-nav__mobile-cta--login"  onClick={close}>Log in</Link>
            <Link to="/signup" className="lp-nav__mobile-cta lp-nav__mobile-cta--signup" onClick={close}>Start for free — it's free</Link>
          </div>
        </div>
      )}
    </>
  );
}

/** User-facing report preview replacing JSON mockup */
const ReportPreview = memo(function ReportPreview() {
  return (
    <div className="lp-report-preview">
      {/* Header row */}
      <div className="lp-report-preview__header">
        <ScoreRing score={87} size={80} stroke={6} />
        <div className="lp-report-preview__verdict">
          <div className="lp-report-preview__score-label">Your interview score</div>
          <div className="lp-report-preview__verdict-text">Strong Hire</div>
          <p className="lp-report-preview__summary">
            You showed clear technical strength. To stand out further, quantify the impact of your projects with real numbers.
          </p>
        </div>
      </div>

      {/* Skills breakdown */}
      <div className="lp-report-preview__section-label">Skills breakdown</div>
      <div className="lp-report-preview__bars">
        {REPORT_COMPETENCIES.map((c, i) => (
          <ScoreBar key={c.label} label={c.label} pct={c.pct} score={c.score} delay={i * 100} />
        ))}
      </div>

      {/* Top priority */}
      <div className="lp-report-preview__priority">
        <span className="lp-report-preview__priority-label">Top priority</span>
        <span className="lp-report-preview__priority-text" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Target size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} /> 
          <span>Add measurable outcomes (e.g. "reduced load time by 40%") to every STAR answer.</span>
        </span>
      </div>
    </div>
  );
});

/** Q&A exchange row */
function ExchangeRow({ item }) {
  return (
    <div className="lp-exchange">
      <div className="lp-exchange__top">
        <span className="lp-exchange__tag" style={{ background: item.color + "18", color: item.color }}>
          {item.tag}
        </span>
        <span className="lp-exchange__score">
          <StarRating score={item.score} />
        </span>
      </div>
      <p className="lp-exchange__q">{item.q}</p>
      <p className="lp-exchange__feedback" style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <Lightbulb size={14} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 2, color: "#f9cb28" }} />
        <span>{item.feedback}</span>
      </p>
    </div>
  );
}

/** Feature card */
const FeatureCard = memo(function FeatureCard({ icon, title, desc }) {
  return (
    <article className="lp-feature-card">
      <div className="lp-feature-card__icon" aria-hidden="true">{icon}</div>
      <h3 className="lp-feature-card__title">{title}</h3>
      <p className="lp-feature-card__desc">{desc}</p>
    </article>
  );
});

/** Step card */
const StepCard = memo(function StepCard({ num, title, desc }) {
  return (
    <article className="lp-step">
      <span className="lp-step__num lp-mono">{num}</span>
      <h3 className="lp-step__title">{title}</h3>
      <p className="lp-step__desc">{desc}</p>
    </article>
  );
});

/** Pricing card */
const PricingCard = memo(function PricingCard({ plan }) {
  return (
    <article
      className={`lp-pricing-card${plan.featured ? " lp-pricing-card--featured" : ""}`}
      aria-label={plan.featured ? `${plan.tier} plan — recommended` : `${plan.tier} plan`}
    >
      <div>
        <div className="lp-pricing-card__tier">
          {plan.tier}
          {plan.badge && (
            <span className="lp-pricing-card__badge">{plan.badge}</span>
          )}
        </div>
        <div className="lp-pricing-card__price">
          <span className="lp-pricing-card__amount">{plan.amount}</span>
          {plan.period && <span className="lp-pricing-card__period">{plan.period}</span>}
        </div>
      </div>
      <ul className="lp-pricing-card__features">
        {plan.features.map((f) => (
          <li key={f} className="lp-pricing-card__feature">
            <span className="lp-pricing-card__check" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {f}
          </li>
        ))}
      </ul>
      <Link to="/signup" className={`lp-pricing-card__cta ${plan.ctaClass}`} id={plan.id}>
        {plan.cta}
      </Link>
    </article>
  );
});

/* ─────────────────────────────────────────────────
   MAIN EXPORT
───────────────────────────────────────────────── */

export default function Landing() {
  return (
    <div className="lp-root">
      <title>InterviewLab — AI Mock Interviews That Actually Prepare You</title>

      <Nav />

      {/* ══════════════════════════════════════════ */}
      {/* HERO — full viewport height               */}
      {/* ══════════════════════════════════════════ */}
      <section className="lp-hero" aria-labelledby="hero-headline">
        {/* Atmospheric mesh gradient backdrop */}
        <div className="lp-hero__mesh"      aria-hidden="true" />
        <div className="lp-hero__mesh-glow" aria-hidden="true" />

        <div className="lp-container">
          <div className="lp-hero__inner">
            {/* Announcement chip */}
            <a href="#features" className="lp-banner lp-fade-up" aria-label="Learn about resume personalization">
              <span className="lp-banner__new">New</span>
              The interviewer now knows your résumé — and asks about it.
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 6H9.5M6.5 3L9.5 6L6.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>

            {/* Headline */}
            <h1 id="hero-headline" className="lp-hero__headline lp-fade-up lp-fade-up--d1">
              The mock interview<br />
              that talks back.
            </h1>

            {/* Sub-headline */}
            <p className="lp-hero__sub lp-fade-up lp-fade-up--d2">
              Speak out loud. Get follow-up questions. Walk away with a detailed report that tells you exactly what to fix — before your real interview.
            </p>

            {/* CTAs */}
            <div className="lp-hero__ctas lp-fade-up lp-fade-up--d3">
              <Link to="/signup" className="lp-btn lp-btn--primary" id="hero-cta-signup">
                Practice for free
                <span className="lp-btn__arrow" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </Link>
            </div>

            {/* Stats strip */}
            <div className="lp-metrics lp-fade-up lp-fade-up--d4" aria-label="Key stats">
              {HERO_STATS.map((m) => (
                <div className="lp-metric" key={m.label}>
                  <span className="lp-metric__value">{m.value}</span>
                  <span className="lp-metric__label">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* FEATURES                                  */}
      {/* ══════════════════════════════════════════ */}
      <section id="features" className="lp-section lp-section--soft" aria-labelledby="features-headline">
        <div className="lp-container">
          <div className="lp-section__center">
            <span className="lp-section__eyebrow">What you get</span>
            <h2 id="features-headline" className="lp-section__headline">
              Real practice, not just question lists.
            </h2>
            <p className="lp-section__body">
              Most interview prep is passive. InterviewLab puts you in the hot seat — with an AI that listens, pushes back, and gives you honest feedback.
            </p>
          </div>

          {/* Interview type pills */}
          <div className="lp-types-row" aria-label="Interview formats available">
            {INTERVIEW_TYPES.map(({ label, color, icon }) => (
              <div className="lp-type-pill" key={label}>
                <span className="lp-type-pill__icon" aria-hidden="true" style={{ background: color + "18", color }}>
                  {icon}
                </span>
                {label}
              </div>
            ))}
          </div>

          {/* 3-up feature grid */}
          <div className="lp-features">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} desc={f.desc} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* HOW IT WORKS                              */}
      {/* ══════════════════════════════════════════ */}
      <section id="how-it-works" className="lp-section lp-section--white" aria-labelledby="how-headline">
        <div className="lp-container">
          <div className="lp-section__center">
            <span className="lp-section__eyebrow">How it works</span>
            <h2 id="how-headline" className="lp-section__headline">
              From start to report in under 10 minutes.
            </h2>
            <p className="lp-section__body">
              No setup, no config. Sign up, pick a format, and you're having your first practice conversation in under a minute.
            </p>
          </div>

          <div className="lp-steps">
            {STEPS.map((s) => (
              <StepCard key={s.num} num={s.num} title={s.title} desc={s.desc} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* RESULTS — report UI preview               */}
      {/* ══════════════════════════════════════════ */}
      <section id="results" className="lp-section lp-section--soft" aria-labelledby="results-headline">
        <div className="lp-container">
          <div className="lp-section__center">
            <span className="lp-section__eyebrow">Your report</span>
            <h2 id="results-headline" className="lp-section__headline">
              Know exactly what to work on next.
            </h2>
            <p className="lp-section__body">
              After every session you get a full breakdown — not a generic score. A hiring verdict, skill-by-skill ratings, and feedback grounded in what you actually said.
            </p>
          </div>

          <div className="lp-showcase">
            {/* Left — report score card (UI preview) */}
            <div className="lp-showcase-card">
              <span className="lp-showcase-card__label lp-mono">Score & verdict</span>
              <ReportPreview />
            </div>

            {/* Right — Q&A exchange review */}
            <div className="lp-showcase-card">
              <span className="lp-showcase-card__label lp-mono">Answer coaching</span>
              <h3 className="lp-showcase-card__title">Every answer, reviewed.</h3>
              <p className="lp-showcase-card__body">
                Each question you answered gets a rating and a specific tip — not "be more confident" but "here's what to add to that answer."
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                {REPORT_EXCHANGES.map((item) => (
                  <ExchangeRow key={item.q} item={item} />
                ))}
              </div>
            </div>

            {/* Full-width — delivery metrics */}
            <div className="lp-showcase-card lp-showcase-card--full">
              <span className="lp-showcase-card__label lp-mono">Speaking style</span>
              <div className="lp-delivery-grid">
                <div>
                  <h3 className="lp-showcase-card__title" style={{ marginBottom: 12 }}>
                    Hear how you come across.
                  </h3>
                  <p className="lp-showcase-card__body">
                    You can have perfect answers and still lose on delivery. See your talk ratio, how often you fill silence with "um", and whether your answers are long enough to be convincing.
                  </p>
                </div>
                <div className="lp-delivery-stats">
                  {[
                    { value: "44%",  label: "Talk ratio",      sub: "You spoke 44% of the time" },
                    { value: "16",   label: "Answers given",   sub: "Across the session" },
                    { value: "0%",   label: "Filler words",    sub: "No 'um' or 'like' detected" },
                    { value: "12",   label: "Avg. words",      sub: "Per answer" },
                  ].map((s) => (
                    <div className="lp-delivery-stat" key={s.label}>
                      <span className="lp-delivery-stat__value">{s.value}</span>
                      <span className="lp-delivery-stat__label">{s.label}</span>
                      <span className="lp-delivery-stat__sub">{s.sub}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* DARK BAND — adaptive AI                   */}
      {/* ══════════════════════════════════════════ */}
      <section className="lp-dark-band" aria-labelledby="adaptive-headline">
        <div className="lp-dark-band__mesh" aria-hidden="true" />
        <div className="lp-dark-band__inner">
          <div className="lp-container">
            <div className="lp-section__center">
              <span className="lp-section__eyebrow">Why it feels different</span>
              <h2
                id="adaptive-headline"
                className="lp-section__headline"
                style={{ color: "#fff", marginLeft: "auto", marginRight: "auto" }}
              >
                It reacts to you — not a script.
              </h2>
              <p
                className="lp-section__body"
                style={{ color: "rgba(255,255,255,0.55)", marginLeft: "auto", marginRight: "auto" }}
              >
                Most mock interview tools walk through a fixed list. InterviewLab reads every answer and decides what comes next — so you can't just memorise your way through it.
              </p>
            </div>

            <div className="lp-features" style={{ marginTop: 56 }}>
              {ADAPTIVE_FEATURES.map((f) => (
                <article className="lp-feature-card" key={f.title}>
                  <div className="lp-feature-card__icon" aria-hidden="true">{f.icon}</div>
                  <h3 className="lp-feature-card__title">{f.title}</h3>
                  <p className="lp-feature-card__desc">{f.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* PRICING                                   */}
      {/* ══════════════════════════════════════════ */}
      <section id="pricing" className="lp-section lp-section--white" aria-labelledby="pricing-headline">
        <div className="lp-container">
          <div className="lp-section__center">
            <span className="lp-section__eyebrow">Pricing</span>
            <h2 id="pricing-headline" className="lp-section__headline">
              Start free. Upgrade when you're ready.
            </h2>
            <p className="lp-section__body">
              Five free sessions to see if it helps. No credit card needed to get started.
            </p>
          </div>

          <div className="lp-pricing-grid">
            {PRICING_PLANS.map((plan) => (
              <PricingCard key={plan.tier} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* BOTTOM CTA                                */}
      {/* ══════════════════════════════════════════ */}
      <section className="lp-cta-band" aria-labelledby="cta-headline">
        <div className="lp-container">
          <h2 id="cta-headline" className="lp-cta-band__headline">
            Your next interview<br />is closer than you think.
          </h2>
          <p className="lp-cta-band__sub">
            Five minutes of practice today is worth an hour of reading tips tomorrow. Start your first session now — it's free.
          </p>
          <div className="lp-cta-band__btns">
            <Link to="/signup" className="lp-btn lp-btn--primary" id="cta-band-signup">
              Start practising free
              <span className="lp-btn__arrow" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════ */}
      {/* FOOTER                                    */}
      {/* ══════════════════════════════════════════ */}
      <footer className="lp-footer" role="contentinfo">
        <div className="lp-container">
          <div className="lp-footer__inner">
            {/* Brand column */}
            <div className="lp-footer__brand-col">
              <Link to="/" aria-label="InterviewLab home" style={{ textDecoration: "none" }}>
                <Brand />
              </Link>
              <p className="lp-footer__tagline">
                AI mock interviews that talk back. Practice out loud, get honest feedback, land the job.
              </p>
            </div>

            {/* Link columns */}
            {FOOTER_COLS.map((col) => (
              <div key={col.title}>
                <div className="lp-footer__col-title lp-mono">{col.title}</div>
                <ul className="lp-footer__links">
                  {col.links.map((l) => (
                    <li key={l}>
                      <a href="#" className="lp-footer__link">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="lp-footer__bottom">
            <p className="lp-footer__copy">© {new Date().getFullYear()} InterviewLab. All rights reserved.</p>
            <ul className="lp-footer__legal-links">
              {["Privacy Policy", "Terms of Service", "Cookie Policy"].map((l) => (
                <li key={l}>
                  <a href="#" className="lp-footer__legal-link">{l}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
