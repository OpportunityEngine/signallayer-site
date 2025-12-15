export default function Home() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Top nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="text-sm font-semibold tracking-tight">SignalLayer</div>
        <div className="flex items-center gap-2">
          <a
            href="#pilot"
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Pilot
          </a>
          <a
            href="#demo"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Book Demo
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12 text-center">
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
            Overlay, don’t replace
          </span>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
            Invoices • Contracts/MLAs • Inventory
          </span>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
            Finance + Ops ready
          </span>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Turn everyday business data into growth, savings, and smarter purchasing — automatically
        </h1>

        <p className="mx-auto mt-6 max-w-3xl text-lg text-slate-700 sm:text-xl">
          Analyze invoices, contracts/MLAs, and inventory activity to uncover revenue opportunities,
          reduce unnecessary spend, and optimize purchase timing — without changing systems or workflows.
        </p>

        <p className="mt-4 text-sm text-slate-500">
          Works alongside existing tools. No migrations. No retraining. No disruption.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="#pilot"
            className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
          >
            Start a 30-Day Pilot
          </a>
          <a
            href="#demo"
            className="rounded-2xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900"
          >
            See a Live Demo
          </a>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-3">
          {[
            "Find expansion opportunities hiding in invoices and usage.",
            "Identify cost-saving alternatives already allowed under agreements.",
            "Guide teams with clear next actions tied to measurable impact.",
          ].map((t) => (
            <div key={t} className="rounded-2xl border border-slate-200 bg-white p-4 text-left">
              <div className="text-sm text-slate-700">{t}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PROBLEM */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Most organizations don’t lack data — they lack visibility.
          </h2>
          <p className="mt-4 max-w-3xl text-slate-700">
            Revenue and savings signals already exist inside invoices, contracts, and inventory activity, but they stay hidden across
            disconnected systems. Teams are forced into manual lookups, reactive purchasing, and inconsistent decisions.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="font-semibold">Fragmented systems</div>
              <p className="mt-2 text-sm text-slate-700">
                Invoices live in one place, customer data in another, contract terms elsewhere. Teams waste time copying,
                searching, and reconciling.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="font-semibold">Manual contract & pricing checks</div>
              <p className="mt-2 text-sm text-slate-700">
                Approved items and pricing rules are hard to find. Errors and delays create leakage and missed opportunities.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="font-semibold">Reactive purchasing</div>
              <p className="mt-2 text-sm text-slate-700">
                Buying decisions happen too late or without usage context. Inventory is overstocked, understocked, or misallocated.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <p className="max-w-3xl text-slate-700">
            Simple mechanics, enterprise-ready execution. Add an intelligence layer — keep your systems and workflows.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Overlay, Don’t Replace",
              body:
                "Sits on top of existing systems, portals, and documents. No migrations. No rebuilds. No disruption.",
            },
            {
              title: "Analyze Automatically",
              body:
                "Scans activity, pricing, inventory behavior, and agreements to surface revenue, savings, and timing signals.",
            },
            {
              title: "Act with Confidence",
              body:
                "Prioritized recommendations appear where teams already work — tied to financial impact and next steps.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-semibold">{c.title}</div>
              <p className="mt-2 text-sm text-slate-700">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* WHAT IT FINDS */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What it finds</h2>
          <p className="mt-3 max-w-3xl text-slate-700">
            Four signal families that drive growth, margin protection, and better purchasing decisions.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {[
              {
                title: "Revenue opportunities",
                bullets: [
                  "Missed add-ons and incomplete coverage",
                  "Cross-sell / expansion signals",
                  "Adoption gaps hiding in invoices",
                ],
              },
              {
                title: "Cost savings",
                bullets: [
                  "Overbuying, waste, and redundancy",
                  "Pricing mismatches and leakage",
                  "Approved lower-cost substitutions",
                ],
              },
              {
                title: "Inventory & timing insights",
                bullets: [
                  "Usage-driven replenishment windows",
                  "Overstock and stockout risk indicators",
                  "Margin- and cash-aware timing signals",
                ],
              },
              {
                title: "Contract / MLA coverage",
                bullets: [
                  "What’s approved and at what price",
                  "Rules, tiers, and eligibility checks",
                  "Local vs national applicability",
                ],
              },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-base font-semibold">{c.title}</div>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {c.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY DIFFERENT */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Why this is different</h2>
        <p className="mt-3 max-w-3xl text-slate-700">
          Not a replacement. Not a dashboard. Not another tool your teams must maintain. SignalLayer delivers actions tied to impact
          while keeping your systems and workflows intact.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Not a CRM add-on",
              body:
                "CRMs track activity. SignalLayer finds financial and operational signals inside invoices, contracts, and usage.",
            },
            {
              title: "Not a dashboard",
              body:
                "Dashboards show data. SignalLayer delivers prioritized actions your teams can execute immediately.",
            },
            {
              title: "Not a rip-and-replace",
              body:
                "Keep your systems. Keep your workflows. Add an intelligence layer that speeds decisions and reduces errors.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-semibold">{c.title}</div>
              <p className="mt-2 text-sm text-slate-700">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PILOT PRICING */}
      <section id="pilot" className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">30-Day Pilot</h2>
              <p className="mt-3 max-w-xl text-slate-700">
                Low-risk proof with real outputs. Designed to be fast to deploy and easy to justify to Finance.
              </p>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-lg font-semibold">Growth & Cost Intelligence Pilot — $2,500</div>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
                  <li>Up to 20 users</li>
                  <li>Onboarding + weekly review</li>
                  <li>Invoice + contract/MLA + inventory signals</li>
                  <li>Opportunity outputs + recommendations</li>
                  <li>Pilot readout for Finance and leadership</li>
                </ul>
              </div>
            </div>

            <div id="demo" className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-semibold">Finance-friendly ROI narrative</div>
              <p className="mt-2 text-sm text-slate-700">
                The pilot is designed to validate measurable value quickly:
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
                <li>Reduce leakage from missed add-ons and coverage gaps</li>
                <li>Protect margin by aligning pricing and surfacing approved substitutions</li>
                <li>Improve purchase timing using usage-driven signals</li>
                <li>Increase team productivity by reducing manual lookups across systems</li>
              </ul>

              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="#"
                  className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
                >
                  Request Pilot
                </a>
                <a
                  href="#"
                  className="rounded-2xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900"
                >
                  Book Demo
                </a>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Next step: we’ll connect your pilot to sample data first, then to real sources once approved.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Security & compliance posture</h2>
        <p className="mt-3 max-w-3xl text-slate-700">
          Designed for enterprise data handling with least-privilege access and configurable retention. Integrations are optional and scoped.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {["Least privilege", "Configurable retention", "Explainable outputs", "Audit trail ready"].map((t) => (
            <span key={t} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Your data already knows where to grow and where to save.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-700">
            Let SignalLayer surface the opportunities your teams are missing — and guide decisions without changing your systems.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#pilot"
              className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
            >
              Start a 30-Day Pilot
            </a>
            <a
              href="#demo"
              className="rounded-2xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900"
            >
              See a Live Demo
            </a>
          </div>

          <p className="mt-10 text-xs text-slate-500">
            © {new Date().getFullYear()} SignalLayer. All rights reserved.
          </p>
        </div>
      </section>
    </main>
  )
}
