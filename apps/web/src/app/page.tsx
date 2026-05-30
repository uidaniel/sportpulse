import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui-kit";
import { Logo } from "@/components/logo";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---------------------------------- Nav --------------------------------- */}
      <header className="sticky top-0 z-50 border-b border-line/60 bg-base/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link href="/dashboard">
                <Button size="sm">Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden sm:block">
                  <Button variant="ghost" size="sm">Sign in</Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* --------------------------------- Hero --------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-40 [mask-image:radial-gradient(60%_60%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs font-medium text-brand">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
              Real-time X → WhatsApp automation
            </span>

            <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Turn X into your <span className="text-gradient">WhatsApp Channel&apos;s</span> newsroom.
            </h1>

            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
              SportPulse auto-publishes breaking sports updates from the X accounts you follow
              straight to your WhatsApp Channel — formatted, filtered, and safely throttled. No
              copy-paste. No delays.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup">
                <Button size="lg">Start free</Button>
              </Link>
              <a href="#how">
                <Button variant="outline" size="lg">See how it works</Button>
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-faint">
              <span className="inline-flex items-center gap-2"><Check /> No password shared</span>
              <span className="inline-flex items-center gap-2"><Check /> Anti-ban throttling</span>
              <span className="inline-flex items-center gap-2"><Check /> Set up in minutes</span>
            </div>
          </div>

          <ChatMockup />
        </div>
      </section>

      {/* ------------------------------- How it works --------------------------- */}
      <Section id="how" eyebrow="How it works" title="Live in three steps">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Connect WhatsApp",
              d: "Scan a QR code to securely link your account. We never see or store your password — just a device session you can revoke anytime.",
              icon: <IconQr />,
            },
            {
              n: "02",
              t: "Add X handles",
              d: "Pick the journalists, tipsters, or clubs you want to mirror. Toggle retweets, replies, and media per handle.",
              icon: <IconAt />,
            },
            {
              n: "03",
              t: "Go live",
              d: "We poll X in real time, clean up every post, and publish to your channel automatically with safe 3–5s spacing.",
              icon: <IconBolt />,
            },
          ].map((s) => (
            <div key={s.n} className="group relative rounded-2xl border border-line bg-surface/60 p-6 transition-colors hover:border-brand/40">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">{s.icon}</span>
                <span className="font-mono text-sm text-faint">{s.n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* -------------------------------- Features ------------------------------ */}
      <Section id="features" eyebrow="Features" title="Everything you need to run an automated channel">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { t: "Real-time aggregation", d: "One efficient lookup per handle, shared across all users — fresh updates every few minutes without burning API costs.", icon: <IconBolt /> },
            { t: "Smart filters", d: "Include or skip retweets, replies, and media — configured independently for each handle you track.", icon: <IconFilter /> },
            { t: "Clean formatting", d: "Strips t.co clutter and noise, preserves the readable text, and forwards images alongside the post.", icon: <IconSparkle /> },
            { t: "Anti-ban guardrails", d: "A mandatory 3–5 second throttle between posts keeps your WhatsApp account safe from spam flags.", icon: <IconShield /> },
            { t: "Channel control", d: "Link your account and choose your target WhatsApp Channel from a clean dashboard — switch anytime.", icon: <IconLayers /> },
            { t: "Reconnect alerts", d: "If your linked device drops offline, we detect it instantly and prompt you to re-authenticate.", icon: <IconBell /> },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-line bg-surface/60 p-6 transition-all hover:-translate-y-0.5 hover:border-brand/40">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">{f.icon}</span>
              <h3 className="mt-5 font-semibold">{f.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------- Use cases ------------------------------ */}
      <Section eyebrow="Who it's for" title="Built for people who move fast">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { t: "Journalists & influencers", d: "Cross-post breaking news from X to your WhatsApp audience the moment it happens — without lifting a finger." },
            { t: "Betting tipsters", d: "Pipe live odds and line changes from the analysts you trust straight to your premium subscriber channel." },
            { t: "Fan clubs & communities", d: "Keep your supporters updated with official team press releases and match graphics, automatically." },
          ].map((u) => (
            <div key={u.t} className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-surface-2/80 to-surface/40 p-7">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand/10 blur-2xl" />
              <h3 className="text-lg font-semibold">{u.t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{u.d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* -------------------------------- Pricing ------------------------------- */}
      <Section id="pricing" eyebrow="Pricing" title="Simple plans that scale with you">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { name: "Free", price: "$0", note: "To kick the tyres", handles: "1", cta: "Start free", featured: false },
            { name: "Basic", price: "$12", note: "For solo creators", handles: "5", cta: "Choose Basic", featured: false },
            { name: "Pro", price: "$29", note: "For serious channels", handles: "25", cta: "Choose Pro", featured: true },
          ].map((p) => (
            <div
              key={p.name}
              className={
                p.featured
                  ? "relative rounded-2xl border border-brand/50 bg-surface p-7 glow-brand"
                  : "relative rounded-2xl border border-line bg-surface/60 p-7"
              }
            >
              {p.featured ? (
                <span className="absolute -top-3 left-7 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-on-brand">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-sm font-medium text-muted">{p.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">{p.price}</span>
                <span className="text-sm text-faint">/mo</span>
              </div>
              <p className="mt-1 text-sm text-faint">{p.note}</p>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-center gap-2"><Check /> <strong className="font-semibold text-foreground">{p.handles}</strong> tracked X {p.handles === "1" ? "handle" : "handles"}</li>
                <li className="flex items-center gap-2"><Check /> Real-time auto-posting</li>
                <li className="flex items-center gap-2"><Check /> Per-handle filters</li>
                <li className="flex items-center gap-2"><Check /> Media forwarding</li>
              </ul>
              <Link href="/signup" className="mt-7 block">
                <Button variant={p.featured ? "primary" : "secondary"} className="w-full">{p.cta}</Button>
              </Link>
            </div>
          ))}
        </div>
      </Section>

      {/* -------------------------------- CTA band ------------------------------ */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-brand/30 bg-gradient-to-br from-brand-soft/60 to-surface px-8 py-14 text-center">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Your channel, on autopilot.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted">
              Connect WhatsApp, add a few X handles, and let SportPulse handle the rest.
            </p>
            <Link href="/signup" className="mt-8 inline-block">
              <Button size="lg">Get started — it&apos;s free</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------------- Footer ------------------------------- */}
      <footer className="border-t border-line/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-faint sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} SportPulse. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------- Section ---------------------------------- */
function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
      <div className="mb-10 max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------- Chat mockup ------------------------------- */
function ChatMockup() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-4 rounded-[2rem] bg-brand/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-2xl">
        {/* channel header */}
        <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-on-brand font-bold">SP</div>
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-semibold">
              SportPulse Live <IconVerified />
            </p>
            <p className="text-xs text-faint">Channel · 12.4k followers</p>
          </div>
        </div>
        {/* messages */}
        <div className="space-y-3 px-4 py-5">
          <Bubble
            handle="@FabrizioRomano"
            text="🚨 BREAKING: Deal agreed. Medical scheduled for tomorrow morning. Here we go! ✅"
            time="20:14"
          />
          <Bubble
            handle="@OptaJoe"
            text="9 — Goals scored by the side in their last 3 matches, their best run this season."
            time="20:31"
          />
          <Bubble handle="@SkySportsNews" text="FULL-TIME: A statement win on the road. 🔴⚪" time="21:02" />
        </div>
      </div>
    </div>
  );
}

function Bubble({ handle, text, time }: { handle: string; text: string; time: string }) {
  return (
    <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-2.5">
      <p className="text-xs font-semibold text-brand">{handle}</p>
      <p className="mt-1 text-sm leading-snug text-foreground">{text}</p>
      <p className="mt-1 text-right text-[10px] text-faint">{time}</p>
    </div>
  );
}

/* ---------------------------------- Icons ---------------------------------- */
function Check() {
  return (
    <svg className="h-4 w-4 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IconVerified() {
  return (
    <svg className="h-4 w-4 text-brand" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 1.8 3-.2 1 2.8 2.5 1.6-1 2.8 1 2.8-2.5 1.6-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8L3.1 16l1-2.8-1-2.8L5.6 8.8l1-2.8 3 .2L12 2z" opacity=".25" />
      <path d="M9.5 12.5l1.8 1.8 3.5-3.8" fill="none" stroke="#04200f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconBolt() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
}
function IconFilter() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z" /></svg>;
}
function IconShield() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
}
function IconSparkle() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></svg>;
}
function IconLayers() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>;
}
function IconBell() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
}
function IconQr() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3M21 21v.01M18 18h.01" /></svg>;
}
function IconAt() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></svg>;
}
