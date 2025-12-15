"use client";

import React, { useMemo, useState } from "react";

type IndustryKey = "manufacturing" | "healthcare" | "logistics";

const EMAIL_TO = "founders@signallayer.ai"; // <-- replace with your email/alias

function mailtoHref(subject: string, body: string) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  return `mailto:${EMAIL_TO}?subject=${s}&body=${b}`;
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function DotIcon({
  tone = "dark",
}: {
  tone?: "dark" | "emerald" | "muted" | "gold";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "gold"
      ? "bg-amber-300"
      : tone === "muted"
      ? "bg-slate-300"
      : "bg-slate-950";
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/70 shadow-[0_16px_50px_rgba(0,0,0,0.25)] backdrop-blur">
      <span className={classNames("h-2.5 w-2.5 rounded-full", cls)} />
    </span>
  );
}

function Sheen() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="motion-safe:animate-[sheen_10s_linear_infinite] absolute -left-1/2 top-0 h-full w-[140%] rotate-[-12deg] bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-60" />
      <style>{`
        @keyframes sheen {
          0% { transform: translateX(-15%) rotate(-12deg); }
          100% { transform: translateX(15%) rotate(-12deg); }
        }
      `}</style>
    </div>
  );
}

export default function Page() {
  const [industry, setIndustry] = useState<IndustryKey>("manufacturing");

  const industryCopy = useMemo(() => {
    // Smaller, more Apple-style hero: one headline + subtle descriptor
    const base = {
      headline: "Clean data. Faster connects. Confident growth.",
      descriptor:
        "AI lead sourcing, data cleanup, and contract-aware opportunity discovery—built for execution.",
      subhead:
        "SignalLayer turns day-to-day transactions into clean account data, measurable savings, and contract-approved opportunities—then routes your team to the fastest path to a real decision-maker. Less searching. More connects. More revenue.",
      credibility:
        "Business contacts only. Uses licensed data where applicable and permitted public sources per policy. No rip-and-replace.",
    };

    const demo = {
      manufacturing: {
        label: "Manufacturing",
        exampleAccount: "Demo Manufacturing Plant A",
        exampleLocation: "Minneapolis, MN 55430",
        scenarioTitle: "Program Coverage + Approved Add-Ons",
        scenarioBody:
          "Spot coverage gaps, validate approved add-ons, and route the rep to the most reachable decision-maker—without digging through disconnected tools.",
        commissionExample: {
          title: "Commission preview (example)",
          math:
            "If $100 added value → $300 commission at 36 months remaining (your multiplier example).",
          payout:
            "Estimated payout date: Next month after install is keyed (based on prior month installs).",
        },
        opportunity: {
          title: "Opportunity summary (example account)",
          bullets: [
            "Detected program coverage gaps across wearers; flagged inconsistent outerwear coverage.",
            "Found approved add-on SKU(s) at contract pricing (example: insulated liner).",
            "Suggested next-best actions: propose add-on, confirm local approval rules, and notify internal service (optional workflow).",
          ],
        },
      },
      healthcare: {
        label: "Healthcare",
        exampleAccount: "Demo Regional Health System",
        exampleLocation: "St. Louis, MO 63103",
        scenarioTitle: "Supply Spend + Contract Compliance",
        scenarioBody:
          "Detect duplicate spend, pricing mismatches, and contract-approved substitutions—then guide the next best action for teams.",
        commissionExample: {
          title: "Impact preview (example)",
          math:
            "Flagged duplicate spend + suggested contract-approved swap → estimated monthly savings.",
          payout:
            "For reps/CSMs: show expected payout timing tied to installed/activated changes (configurable).",
        },
        opportunity: {
          title: "Opportunity summary (example account)",
          bullets: [
            "Detected duplicate purchases across locations for the same category.",
            "Flagged irregular line items and mismatched contract pricing.",
            "Recommended approved substitutions and an outreach path to the right admin contact.",
          ],
        },
      },
      logistics: {
        label: "Logistics",
        exampleAccount: "Demo Distribution Network",
        exampleLocation: "Dallas, TX 75201",
        scenarioTitle: "Inventory + Cost-to-Serve",
        scenarioBody:
          "Highlight irregular replenishment patterns, pricing variance, and approved alternatives—then reduce waste and improve margins.",
        commissionExample: {
          title: "Impact preview (example)",
          math:
            "Identified savings + expansion opportunities across sites with approved pricing guidance.",
          payout:
            "For teams with incentive programs: show estimated payout/bonus impacts (configurable).",
        },
        opportunity: {
          title: "Opportunity summary (example account)",
          bullets: [
            "Flagged irregularities: unexpected line items and usage spikes.",
            "Highlighted approved alternatives and best-time-to-purchase indicators (when data exists).",
            "Recommended the fastest path to a reachable contact for execution.",
          ],
        },
      },
    };

    return { base, demo: demo[industry] };
  }, [industry]);

  const howItWorks = [
    {
      iconTone: "dark" as const,
      title: "Connect what’s already there",
      body:
        "SignalLayer sits on top of existing tools and surfaces the “needle in the haystack” insights teams miss when systems don’t talk.",
    },
    {
      iconTone: "emerald" as const,
      title: "Clean data and find irregularities",
      body:
        "Normalize accounts, de-dupe records, and detect inconsistencies or leakage—then route issues with a clean evidence trail.",
    },
    {
      iconTone: "gold" as const,
      title: "Surface contract-approved growth",
      body:
        "Identify approved opportunities and next-best actions—so execution happens faster with fewer clicks and fewer errors.",
    },
    {
      iconTone: "muted" as const,
      title: "Reach the right person faster",
      body:
        "Refresh and rank business contact paths using licensed data and permitted public sources—prioritizing reachable departments when decision-makers aren’t picking up.",
    },
  ];

  const leadSourcingBullets = [
    "Cleans and normalizes messy account data (names, addresses, duplicates across systems).",
    "Refreshes business contact pathways (direct/department/HQ) and scores reachability to maximize connects.",
    "Creates a consistent “best next number to call” when ideal contacts aren’t reachable (Reception → HR → Maintenance/Safety).",
    "Designed for business-contact use cases (no personal/sensitive targeting).",
  ];

  const trustBullets = [
    "No rip-and-replace: pilot on top of existing workflows; deeper integrations later if value is proven.",
    "Data minimization and least-privilege access: only what’s needed for the workflow.",
    "Configurable retention and export controls (policy-driven).",
    "Business contacts only: licensed sources where applicable, plus permitted public sources per customer policy.",
  ];

  const demoRequestHref = mailtoHref(
    "🎥 Demo Request — SignalLayer",
    [
      "Hi SignalLayer Team,",
      "",
      "I’d like to request a demo.",
      "",
      "Company:",
      "Role / Team:",
      "Industry:",
      "What I’d like to see (cleanup, savings, growth, lead routing, etc):",
      "(Optional) Timeline:",
      "",
      "Thanks!",
    ].join("\n")
  );

  const pilotRequestHref = mailtoHref(
    "🚀 Pilot Request — SignalLayer",
    [
      "Hi SignalLayer Team,",
      "",
      "I’d like to explore a pilot.",
      "",
      "Company:",
      "Role / Team:",
      "Industry:",
      "Data sources available (e.g., invoices, agreements, CRM, ERP):",
      "Primary goals (cleanup, savings, growth, execution speed, contact refresh):",
      "(Optional) Timeline:",
      "",
      "Thanks!",
    ].join("\n")
  );

  return (
    <main className="min-h-screen bg-[#0B0F17]">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0B0F17]/75 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-white/90 to-white/20 shadow-[0_18px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10" />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">SignalLayer</div>
              <div className="text-xs text-slate-300/80">
                Opportunity + Efficiency Overlay
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <a
              href="#how-it-works"
              className="text-sm text-slate-300 hover:text-white"
            >
              How it works
            </a>
            <a href="#demo" className="text-sm text-slate-300 hover:text-white">
              Demo
            </a>
            <a
              href="#leads"
              className="text-sm text-slate-300 hover:text-white"
            >
              Lead sourcing
            </a>
            <a href="#trust" className="text-sm text-slate-300 hover:text-white">
              Trust
            </a>
            <a
              href="#cta"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
            >
              Request a demo
            </a>
          </nav>
        </div>
      </header>

      {/* Hero (smaller, Apple-like) */}
      <section className="relative overflow-hidden">
        {/* Aurora background (restrained, premium) */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-72 left-1/2 h-[820px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),rgba(11,15,23,0)_58%)] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-72 left-8 h-[760px] w-[760px] rounded-full bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.14),rgba(11,15,23,0)_62%)] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-10 right-8 h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.12),rgba(11,15,23,0)_62%)] blur-3xl"
        />

        {/* reduced vertical padding */}
        <div className="mx-auto max-w-6xl px-6 py-12 sm:py-14">
          <div className="max-w-3xl">
            {/* Apple-style pill */}
            <div className="relative inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur">
              <Sheen />
              <span className="relative z-10 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                AI overlay for savings, growth, and faster connects
              </span>
            </div>

            {/* One-line headline */}
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {industryCopy.base.headline}
            </h1>

            {/* Subtle descriptor line */}
            <p className="mt-2 text-sm text-slate-200/80 sm:text-base">
              {industryCopy.base.descriptor}
            </p>

            {/* Main subhead */}
            <p className="mt-4 max-w-2xl text-base text-slate-200/90 sm:text-lg">
              {industryCopy.base.subhead}
            </p>

            <p className="mt-3 text-sm text-slate-300/70">
              {industryCopy.base.credibility}
            </p>
          </div>

          {/* KPI strip */}
          <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Data cleaned",
                  value: "De-duped accounts",
                  note: "Normalize names, addresses, and duplicates across systems.",
                },
                {
                  label: "Opportunities surfaced",
                  value: "Approved + actionable",
                  note: "Contract-aligned growth suggestions with clear next steps.",
                },
                {
                  label: "Time saved",
                  value: "Fewer clicks",
                  note: "Less hunting for pricing, contacts, and approvals context.",
                },
              ].map((k) => (
                <div
                  key={k.label}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-200/70">
                      {k.label}
                    </div>
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {k.value}
                  </div>
                  <div className="mt-1 text-xs text-slate-200/70">{k.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick value strip */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur">
              <div className="flex items-center gap-3">
                <DotIcon tone="emerald" />
                <div className="text-sm font-semibold text-white">
                  Data Cleanup + Savings
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-200/80">
                Normalize accounts, reduce duplicates, and surface irregularities
                tied to measurable cost leakage.
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur">
              <div className="flex items-center gap-3">
                <DotIcon tone="gold" />
                <div className="text-sm font-semibold text-white">
                  Contract-Approved Growth
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-200/80">
                Surface approved opportunities and next-best actions—so teams
                grow revenue with confidence.
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur">
              <div className="flex items-center gap-3">
                <DotIcon tone="dark" />
                <div className="text-sm font-semibold text-white">
                  More Activity, Faster
                </div>
              </div>
              <div className="mt-3 text-sm text-slate-200/80">
                Reduce time spent searching, clicking, and chasing the wrong
                contact—so reps execute more.
              </div>
            </div>
          </div>

          {/* Minimal proof strip */}
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-200/90">
                <span className="font-semibold text-white">
                  “We turned scattered activity into a clean action list.”
                </span>{" "}
                Less hunting. More execution. Cleaner data.
              </div>
              <div className="text-xs text-slate-300/70">
                Pilot preview • anonymized
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Light content wrapper */}
      <div className="bg-white text-slate-900">
        {/* How it works */}
        <section
          id="how-it-works"
          className="border-t border-slate-100 bg-slate-50"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">
                How it works
              </h2>
              <p className="mt-3 text-slate-600">
                SignalLayer turns messy, disconnected activity into clear actions
                your teams can execute—fast.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {howItWorks.map((x) => (
                <div
                  key={x.title}
                  className="rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_18px_60px_rgba(2,6,23,0.08)]"
                >
                  <div className="flex items-start gap-3">
                    <DotIcon tone={x.iconTone} />
                    <div>
                      <div className="text-lg font-semibold">{x.title}</div>
                      <div className="mt-2 text-sm text-slate-600">{x.body}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className="border-t border-slate-100 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-semibold tracking-tight">
                  Opportunity Summary — Example Account
                </h2>
                <p className="mt-3 text-slate-600">
                  A realistic preview of what reps and operators see: cost issues,
                  approved actions, and the fastest path to execution.
                </p>
              </div>

              {/* Industry toggle */}
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 shadow-sm">
                {(
                  [
                    ["manufacturing", "Manufacturing"],
                    ["healthcare", "Healthcare"],
                    ["logistics", "Logistics"],
                  ] as Array<[IndustryKey, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setIndustry(key)}
                    className={classNames(
                      "rounded-xl px-4 py-2 text-sm font-medium transition",
                      industry === key
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-700 hover:bg-white hover:shadow-sm"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {/* Left: Demo card */}
              <div className="rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_18px_60px_rgba(2,6,23,0.08)] lg:col-span-2">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Example account
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {industryCopy.demo.exampleAccount}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {industryCopy.demo.exampleLocation}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Industry
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-800">
                      {industryCopy.demo.label}
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-3xl border border-slate-100 bg-slate-50 p-6">
                  <div className="text-sm font-semibold">
                    {industryCopy.demo.scenarioTitle}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {industryCopy.demo.scenarioBody}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl border border-slate-100 bg-white p-6">
                    <div className="flex items-center gap-3">
                      <DotIcon tone="emerald" />
                      <div className="text-sm font-semibold">
                        {industryCopy.demo.commissionExample.title}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">
                      {industryCopy.demo.commissionExample.math}
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {industryCopy.demo.commissionExample.payout}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-100 bg-white p-6">
                    <div className="flex items-center gap-3">
                      <DotIcon tone="gold" />
                      <div className="text-sm font-semibold">
                        Lead routing (example)
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">
                      If the ideal decision-maker doesn’t answer, SignalLayer
                      recommends the fastest reachable path:
                    </div>
                    <ul className="mt-3 space-y-2 text-sm text-slate-700">
                      <li>• Reception / Front Desk</li>
                      <li>• HR / Admin</li>
                      <li>• Maintenance / Operations</li>
                      <li>• Safety / EHS</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Right: Opportunity bullets */}
              <div className="rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_18px_60px_rgba(2,6,23,0.08)]">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {industryCopy.demo.opportunity.title}
                </div>

                <ul className="mt-4 space-y-3 text-sm text-slate-700">
                  {industryCopy.demo.opportunity.bullets.map((b) => (
                    <li
                      key={b}
                      className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                    >
                      {b}
                    </li>
                  ))}
                </ul>

                <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="text-sm font-semibold">What teams get</div>
                  <div className="mt-2 text-sm text-slate-600">
                    Clear summaries, evidence, approvals context, and next-best
                    actions—so execution happens faster.
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-6 text-xs text-slate-500">
              Note: Example content is illustrative and anonymized.
            </p>
          </div>
        </section>

        {/* Lead sourcing */}
        <section id="leads" className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">
                  Lead sourcing + data cleanup
                </h2>
                <p className="mt-3 text-slate-600">
                  Outdated data kills activity. SignalLayer cleans messy account
                  records, refreshes business contact paths, and ranks the best
                  number to call—so teams spend time executing, not searching.
                </p>

                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  {leadSourcingBullets.map((b) => (
                    <li
                      key={b}
                      className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
                    >
                      {b}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Executive reachability scoring */}
              <div className="rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_18px_60px_rgba(2,6,23,0.08)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">
                      Reachability scoring (example)
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      SignalLayer ranks business contact paths using phone type,
                      verification freshness, and role-based answer likelihood—to
                      maximize real connects without guesswork.
                    </p>
                  </div>
                  <DotIcon tone="emerald" />
                </div>

                <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-100 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Signal
                      </div>
                      <div className="mt-2 text-sm text-slate-700">
                        Phone type, freshness, match confidence, and department
                        likelihood of a human answer.
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Outcome
                      </div>
                      <div className="mt-2 text-sm text-slate-700">
                        Ranked “best next number” plus fallback routes when ideal
                        contacts don’t answer.
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-white">
                    <div className="grid grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                      <div className="col-span-6">Contact path</div>
                      <div className="col-span-3">Type</div>
                      <div className="col-span-3 text-right">Score</div>
                    </div>

                    {[
                      { name: "Reception / Front Desk", type: "Department", score: 92 },
                      { name: "HR / Admin", type: "Department", score: 86 },
                      { name: "Maintenance / Operations", type: "Department", score: 80 },
                      { name: "HQ / Main Switchboard", type: "HQ/Main", score: 61 },
                    ].map((r) => (
                      <div
                        key={r.name}
                        className="grid grid-cols-12 gap-2 px-4 py-3 text-sm text-slate-700"
                      >
                        <div className="col-span-6 font-medium">{r.name}</div>
                        <div className="col-span-3 text-slate-600">{r.type}</div>
                        <div className="col-span-3 text-right text-slate-500">
                          {r.score}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Business contacts only. Scores blend type, freshness, match strength, and role-based likelihood.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="border-t border-slate-100 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">
                Trust, security, and practicality
              </h2>
              <p className="mt-3 text-slate-600">
                Built to be adopted quickly and safely: start with a pilot, prove
                value, then deepen integration.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {trustBullets.map((b) => (
                <div
                  key={b}
                  className="rounded-3xl border border-slate-100 bg-slate-50 p-7 shadow-sm"
                >
                  <div className="text-sm text-slate-800">{b}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section
          id="cta"
          className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50"
        >
          <div className="mx-auto max-w-6xl px-6 py-20 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Request a demo or a pilot
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600">
              Get a walkthrough in minutes—or run a 30-day pilot to quantify savings, cleanup wins, and growth impact.
            </p>

            <div className="mx-auto mt-10 flex max-w-xl flex-col gap-4 sm:flex-row sm:justify-center">
              <a
                href={demoRequestHref}
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-8 py-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
              >
                Request a demo
              </a>
              <a
                href={pilotRequestHref}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-8 py-4 text-sm font-medium text-white shadow-sm hover:bg-slate-900"
              >
                Request a pilot
              </a>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              No commitment. No platform migration. Just clarity.
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-100 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              <div className="font-semibold text-slate-950">SignalLayer</div>
              <div className="mt-1">Opportunity + Efficiency Overlay</div>
              <div className="mt-1 text-xs text-slate-500">
                © {new Date().getFullYear()} SignalLayer. All rights reserved.
              </div>
            </div>

            <div className="flex items-center gap-5 text-sm">
              <a href="#" className="text-slate-600 hover:text-slate-900">
                Privacy
              </a>
              <a href="#" className="text-slate-600 hover:text-slate-900">
                Terms
              </a>
              <a
                href={`mailto:${EMAIL_TO}`}
                className="text-slate-600 hover:text-slate-900"
              >
                Contact
              </a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
