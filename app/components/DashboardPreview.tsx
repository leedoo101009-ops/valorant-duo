"use client";

import { useLanguage } from "../context/LanguageContext";
import ScrollReveal from "./ScrollReveal";

const players = [
  { rank: "D2", name: "REYNA_MAIN", role: "ENTRY" as const, acs: "248", wr: "54", live: true },
  { rank: "D1", name: "SAGE_HEAL", role: "SENTINEL" as const, acs: "198", wr: "58", live: true },
  { rank: "D2", name: "SOVA_INTEL", role: "INITIATOR" as const, acs: "212", wr: "51", live: true },
  { rank: "P3", name: "OMEN_SMK", role: "CONTROLLER" as const, acs: "185", wr: "49", live: false },
];

function CompatibilityBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between">
        <span className="font-display text-[10px] tracking-widest text-[#555]">{label}</span>
        <span className="font-display text-xs font-bold text-white">{value}%</span>
      </div>
      <div className="hud-bar h-1">
        <div className="hud-bar-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function DashboardPreview() {
  const { t } = useLanguage();

  const bars = [
    { label: t.dashboard.bars.roleSync, value: 92 },
    { label: t.dashboard.bars.tierMatch, value: 88 },
    { label: t.dashboard.bars.playstyle, value: 85 },
    { label: t.dashboard.bars.schedule, value: 78 },
  ];

  return (
    <section id="dashboard" className="border-t border-[#222] bg-black py-32 lg:py-40">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <ScrollReveal>
          <p className="font-display text-xs tracking-[0.3em] text-[#ff4655]">
            {t.dashboard.label}
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,4rem)] font-bold uppercase leading-none">
            {t.dashboard.titleLine1}
            <br />
            {t.dashboard.titleLine2}
          </h2>
        </ScrollReveal>

        <ScrollReveal delay={150}>
          <div className="panel mt-20 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#222] bg-[#111] px-6 py-4 lg:px-8">
              <div className="flex items-center gap-4">
                <span className="online-dot" />
                <span className="font-display text-xs tracking-[0.2em] text-[#888]">
                  {t.dashboard.session}
                </span>
              </div>
              <span className="font-display text-xs tracking-widest text-[#555]">v0.1 MVP</span>
            </div>

            <div className="grid lg:grid-cols-2">
              <div className="border-b border-[#222] lg:border-r lg:border-b-0">
                <div className="border-b border-[#222] px-6 py-4 lg:px-8">
                  <p className="font-display text-[10px] tracking-[0.25em] text-[#555]">
                    {t.dashboard.onlinePlayers}
                  </p>
                </div>
                <div className="divide-y divide-[#222]">
                  {players.map((p) => (
                    <div
                      key={p.name}
                      className={`flex items-center justify-between px-6 py-5 lg:px-8 ${p.live ? "bg-[#0a0a0a]" : "opacity-40"}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center border border-[#333] bg-[#111] font-display text-xs font-bold">
                          {p.rank}
                        </div>
                        <div>
                          <p className="font-display text-sm font-bold tracking-wider">{p.name}</p>
                          <p className="font-display text-[10px] tracking-widest text-[#555]">
                            {t.dashboard.roles[p.role]}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="hidden text-right sm:block">
                          <p className="font-display text-sm font-bold">{p.acs}</p>
                          <p className="font-display text-[10px] text-[#555]">ACS</p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="font-display text-sm font-bold">{p.wr}%</p>
                          <p className="font-display text-[10px] text-[#555]">WR</p>
                        </div>
                        {p.live && (
                          <span className="border border-[#ff4655]/40 px-2 py-1 font-display text-[10px] tracking-widest text-[#ff4655]">
                            {t.dashboard.live}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="border-b border-[#222] px-6 py-4 lg:px-8">
                  <p className="font-display text-[10px] tracking-[0.25em] text-[#555]">
                    {t.dashboard.aiAnalysis}
                  </p>
                </div>
                <div className="p-6 lg:p-8">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-3xl font-bold">REYNA_MAIN</p>
                      <p className="mt-1 font-display text-xs tracking-[0.2em] text-[#ff4655]">
                        DIAMOND 2
                      </p>
                    </div>
                    <div className="border border-[#222] bg-[#0a0a0a] px-4 py-3 text-right">
                      <p className="font-display text-2xl font-bold text-[#ff4655]">A+</p>
                      <p className="font-display text-[10px] tracking-widest text-[#555]">
                        {t.dashboard.compat}
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 flex flex-wrap gap-2">
                    {t.dashboard.tags.map((tag) => (
                      <span
                        key={tag}
                        className="border border-[#333] px-3 py-1.5 font-display text-[10px] tracking-widest text-[#888]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-10 space-y-5">
                    {bars.map((bar) => (
                      <CompatibilityBar key={bar.label} label={bar.label} value={bar.value} />
                    ))}
                  </div>

                  <button type="button" className="btn-accent mt-10 w-full !py-4">
                    {t.dashboard.sendInvite}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
