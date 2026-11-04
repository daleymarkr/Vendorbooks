import Link from "next/link";
import { formatUsd } from "@/domain/money";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-serif text-xl ${light ? "text-paper" : "text-pine"}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect x="2" y="3" width="24" height="22" rx="3" fill={light ? "#f4efe6" : "#1b3f32"} />
        <path d="M8 8h12M8 13h12M8 18h7" stroke={light ? "#1b3f32" : "#f4efe6"} strokeWidth="1.6" />
      </svg>
      VendorBooks
    </span>
  );
}

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <p className="banner-bad">{error}</p>;
  if (notice) return <p className="banner-good">{notice}</p>;
  return null;
}

export function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatUsd(cents)}</span>;
}

export function Stamp({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "good" | "warn" | "bad" }) {
  const tones = {
    ink: "border-ink/20 text-ink",
    good: "border-good/30 text-good",
    warn: "border-warn/40 text-warn",
    bad: "border-brick/40 text-brick",
  };
  return <span className={`stamp ${tones[tone]}`}>{children}</span>;
}

export function PageIntro({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: string }) {
  return (
    <header className="mb-8 max-w-3xl">
      {eyebrow ? <p className="mb-2 text-xs uppercase tracking-[0.18em] text-brass">{eyebrow}</p> : null}
      <h1 className="font-serif text-4xl text-pine md:text-5xl">{title}</h1>
      {lede ? <p className="mt-3 text-lg text-ink-soft">{lede}</p> : null}
    </header>
  );
}

export function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "ghost" | "danger" | "brass" }) {
  const className = variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-danger" : variant === "brass" ? "btn-brass" : "btn-primary";
  return (
    <button className={className} type="submit">
      {children}
    </button>
  );
}

export function Empty({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="card px-6 py-10 text-center">
      <h2 className="font-serif text-2xl text-pine">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">{body}</p>
      {href && action ? (
        <Link className="btn-primary mt-6" href={href}>
          {action}
        </Link>
      ) : null}
    </div>
  );
}
