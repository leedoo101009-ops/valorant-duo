"use client";

import { useLanguage } from "../context/LanguageContext";
import ScrollReveal from "./ScrollReveal";

function AiScanVisual() {
  const { t } = useLanguage();
  const tags = ["ENTRY", "DUELIST", "AGGRESSIVE"] as const;

  return (
    <div className="mt-8 space-y-3">
      {tags.map((tag, i) => (
        <div key={tag} className="flex items-center gap-4">
          <span className="w-20 font-display text-[10px] tracking-widest text-[#555]">
            {t.showcase.tags[tag]}
          </span>
          <div className="hud-bar flex-1">
            <div
              className={i === 2 ? "hud-bar-fill-blue" : "hud-bar-fill"}
              style={{ width: `${90 - i * 20}%` }}
            />
          </div>
        </div>
      ))}
      <div className="mt-6 grid grid-cols-4 gap-2">
        {[65, 80, 45, 72].map((h, i) => (
          <div key={i} className="flex flex-col justify-end border border-[#222] bg-[#0a0a0a] p-2" style={{ height: 80 }}>
            <div className="w-full bg-[#ff4655]" style={{ height: `${h}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveQueueVisual() {
  const { t } = useLanguage();
  const rows = [
    { r: "D2", role: "ENTRY" as const, acs: "248" },
    { r: "D1", role: "SNTL" as const, acs: "198" },
    { r: "P3", role: "INIT" as const, acs: "176" },
  ];

  return (
    <div className="mt-8 space-y-0">
      {rows.map((row) => (
        <div key={row.r + row.role} className="flex items-center justify-between border-b border-[#222] py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center border border-[#333] font-display text-[10px] font-bold">
              {row.r}
            </span>
            <span className="font-display text-[10px] tracking-widest text-[#888]">
              {t.showcase.roles[row.role]}
            </span>
          </div>
          <span className="font-display text-xs text-white">{row.acs}</span>
        </div>
      ))}
      <div className="mt-4 flex items-center gap-2 border border-[#ff4655]/30 bg-[#ff4655]/5 px-3 py-2">
        <span className="online-dot" />
        <span className="font-display text-[10px] tracking-widest text-[#ff4655]">
          {t.showcase.matchesAvailable}
        </span>
      </div>
    </div>
  );
}

function PartyLinkVisual() {
  const { t } = useLanguage();

  return (
    <div className="mt-8 space-y-4">
      <div className="border border-[#222] bg-[#0a0a0a] p-4">
        <p className="font-display text-[10px] tracking-widest text-[#555]">
          {t.showcase.riotPartyLink}
        </p>
        <p className="mt-2 truncate font-mono text-xs text-[#0fbcbf]">
          valorant://party/invite/8xK2m9...
        </p>
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 items-center justify-center border border-[#222] bg-[#111] py-6">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="8" width="24" height="16" stroke="#ff4655" strokeWidth="1" />
            <path d="M12 16h8M16 12v8" stroke="#ff4655" strokeWidth="1" />
          </svg>
        </div>
        <div className="flex flex-1 items-center justify-center border border-[#222] bg-[#111] py-6">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M8 12c0-2 2-4 8-4s8 2 8 4v8c0 2-2 4-8 4s-8-2-8-4v-8z" stroke="#5865F2" strokeWidth="1" />
            <circle cx="16" cy="16" r="3" stroke="#5865F2" strokeWidth="1" />
          </svg>
        </div>
      </div>
      <div className="h-px w-full bg-[#222]" />
      <p className="font-display text-[10px] tracking-[0.2em] text-[#555]">
        {t.showcase.oneClickConnect}
      </p>
    </div>
  );
}

export default function ShowcaseCards() {
  const { t } = useLanguage();

  const cards = [
    { num: "01", title: t.showcase.cards.aiScan, visual: <AiScanVisual /> },
    { num: "02", title: t.showcase.cards.liveQueue, visual: <LiveQueueVisual /> },
    { num: "03", title: t.showcase.cards.partyLink, visual: <PartyLinkVisual /> },
  ];

  return (
    <section id="features" className="border-t border-[#222] bg-black py-32 lg:py-40">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <ScrollReveal>
          <p className="font-display text-xs tracking-[0.3em] text-[#ff4655]">
            {t.showcase.label}
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,4rem)] font-bold uppercase leading-none">
            {t.showcase.titleLine1}
            <br />
            {t.showcase.titleLine2}
          </h2>
        </ScrollReveal>

        <div className="mt-20 grid gap-6 lg:grid-cols-3">
          {cards.map((card, i) => (
            <ScrollReveal key={card.num} delay={i * 120}>
              <div className="panel panel-hover flex h-full flex-col p-8 lg:p-10">
                <div className="flex items-start justify-between">
                  <span className="font-display text-4xl font-bold text-[#222]">{card.num}</span>
                  <div className="h-px w-12 bg-[#ff4655]" />
                </div>
                <h3 className="mt-8 font-display text-2xl font-bold tracking-wide uppercase">
                  {card.title}
                </h3>
                {card.visual}
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
