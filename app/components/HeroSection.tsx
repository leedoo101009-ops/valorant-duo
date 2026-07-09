"use client";

import { useLanguage } from "../context/LanguageContext";
import { useOnlineCount } from "../hooks/useOnlineCount";
import { useMatchQueue } from "../hooks/useMatchQueue";
import MatchQueueControls from "./MatchQueueControls";

function HeroHud({
  queueCount,
  inQueue,
}: {
  queueCount: number;
  inQueue: boolean;
}) {
  const { t } = useLanguage();
  const onlineCount = useOnlineCount();

  const agents = [
    { name: "REYNA", pct: 82 },
    { name: "JETT", pct: 64 },
    { name: "PHOENIX", pct: 41 },
  ];

  const showQueueEmpty = queueCount === 0 && !inQueue;

  return (
    <div className="panel relative w-full overflow-hidden">
      <div className="absolute top-0 left-0 h-full w-px bg-[#ff4655]/40" />
      <div className="absolute top-0 right-0 h-px w-full bg-[#222]" />

      <div className="grid lg:grid-cols-[1fr_1px_1fr_1px_1.2fr]">
        <div className="p-6 lg:p-8">
          <p className="font-display text-[10px] tracking-[0.25em] text-[#555]">
            {t.hero.agentPool}
          </p>
          <div className="mt-6 space-y-5">
            {agents.map((a) => (
              <div key={a.name}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-xs tracking-widest text-[#888]">{a.name}</span>
                  <span className="font-display text-sm font-bold text-white">{a.pct}%</span>
                </div>
                <div className="hud-bar">
                  <div className="hud-bar-fill" style={{ width: `${a.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden bg-[#222] lg:block" />

        <div className="border-t border-[#222] p-6 lg:border-t-0 lg:p-8">
          <p className="font-display text-[10px] tracking-[0.25em] text-[#555]">
            {t.hero.playerStats}
          </p>
          <div className="mt-6">
            <p className="font-display text-5xl font-bold leading-none text-white">D2</p>
            <p className="mt-1 font-display text-xs tracking-[0.2em] text-[#ff4655]">
              {t.hero.diamond}
            </p>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-4">
            {[
              { v: "248", l: "ACS" },
              { v: "1.4", l: "KDA" },
              { v: "54", l: "WR" },
            ].map((s) => (
              <div key={s.l} className="border border-[#222] bg-[#0a0a0a] p-3">
                <p className="font-display text-xl font-bold">{s.v}</p>
                <p className="font-display text-[10px] tracking-widest text-[#555]">{s.l}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden bg-[#222] lg:block" />

        <div className="border-t border-[#222] p-6 lg:border-t-0 lg:p-8">
          <div className="flex items-center justify-between">
            <p className="font-display text-[10px] tracking-[0.25em] text-[#555]">
              {t.hero.liveQueue}
            </p>
            <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex items-center gap-2">
                <span className="online-dot" />
                <span className="font-display text-[10px] tracking-widest text-[#ff4655]">
                  {onlineCount} {t.hero.online}
                </span>
              </div>
              <span className="font-display text-[10px] tracking-widest text-[#888]">
                {queueCount} {t.hero.inQueue}
              </span>
            </div>
          </div>
          {inQueue && (
            <div className="mt-4 flex items-center justify-between border border-[#ff4655]/40 bg-[#ff4655]/5 px-4 py-3">
              <span className="font-display text-xs tracking-widest text-white">
                {t.matchQueue.you}
              </span>
              <span className="font-display text-[10px] tracking-widest text-[#ff4655]">
                {t.hero.live}
              </span>
            </div>
          )}
          <div className="mt-6 space-y-0">
            {showQueueEmpty ? (
              <p className="py-6 font-display text-[10px] tracking-widest text-[#555]">
                {t.matchQueue.queueEmpty}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.04]">
        <div className="scan-line h-24 w-full bg-white" />
      </div>
    </div>
  );
}

export default function HeroSection() {
  const { t } = useLanguage();
  const { status, actionLoading, joinQueue, leaveQueue, dismissMatch, cancelSetup, markSetupReady, updateConnection, submitReview, acceptPartnerNoVoice } =
    useMatchQueue();

  return (
    <section className="relative min-h-screen bg-black">
      <div className="absolute inset-0 bg-map-grid opacity-60" />
      <div className="absolute top-0 right-0 h-[600px] w-[600px] bg-[#ff4655]/[0.04] blur-[120px]" />

      <div className="pointer-events-none absolute right-0 bottom-0 hidden w-1/2 opacity-[0.06] lg:block">
        <svg viewBox="0 0 400 600" fill="none" className="h-full w-full">
          <path d="M200 40 L280 120 L320 280 L260 400 L200 560 L140 400 L80 280 L120 120 Z" stroke="white" strokeWidth="1" />
          <path d="M200 120 L240 200 L200 320 L160 200 Z" stroke="white" strokeWidth="0.5" />
          <line x1="0" y1="300" x2="400" y2="300" stroke="white" strokeWidth="0.5" />
          <line x1="200" y1="0" x2="200" y2="600" stroke="white" strokeWidth="0.5" />
        </svg>
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1400px] flex-col justify-center px-6 pt-28 pb-20 lg:px-12">
        <div className="mb-6 flex items-center gap-3">
          <span className="online-dot" />
          <span className="font-display text-xs tracking-[0.25em] text-[#888]">
            {t.hero.badge}
          </span>
        </div>

        <h1 className="font-display text-[clamp(3rem,10vw,7.5rem)] leading-[0.9] font-bold tracking-tight uppercase">
          {t.hero.titleLine1}
          <br />
          <span className="text-[#ff4655]">{t.hero.titleLine2}</span>
        </h1>

        <p className="mt-8 max-w-md font-display text-sm tracking-[0.15em] text-[#888] uppercase">
          {t.hero.subtitle}
        </p>

        <div className="mt-12">
          <MatchQueueControls
            status={status}
            actionLoading={actionLoading}
            joinQueue={joinQueue}
            leaveQueue={leaveQueue}
            dismissMatch={dismissMatch}
            cancelSetup={cancelSetup}
            markSetupReady={markSetupReady}
            updateConnection={updateConnection}
            submitReview={submitReview}
            acceptPartnerNoVoice={acceptPartnerNoVoice}
          />
        </div>

        <div className="mt-20 lg:mt-28">
          <HeroHud queueCount={status.queueCount} inQueue={status.inQueue} />
        </div>

        <div className="mt-16 flex justify-center">
          <a href="#features" className="flex flex-col items-center gap-3 text-[#555] transition-colors hover:text-[#888]">
            <span className="font-display text-[10px] tracking-[0.3em]">{t.hero.scroll}</span>
            <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
              <path d="M6 0v16M6 16l-4-4M6 16l4-4" stroke="currentColor" strokeWidth="1" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
