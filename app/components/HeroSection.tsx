"use client";

import Link from "next/link";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import MatchNetworkIllustration from "./MatchNetworkIllustration";

export default function HeroSection() {
  const { t } = useLanguage();
  const { user, authReady } = useAuth();

  const primaryHref = authReady && user ? "#match" : "/login";

  return (
    <section className="bg-hero-duo relative overflow-hidden">
      {/*
        VALOPLANT 실측 벤치마크
        - base #05080b
        - 빨강 peak #720e06 / 보라 peak #230941
        - 주기 12~16초 (실측 왕복 ~4초 편도 → 부드러운 루프)
      */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="hero-glow hero-glow-purple" />
        <div className="hero-glow hero-glow-blue" />
        <div className="hero-glow hero-glow-red" />
        <div className="hero-glow hero-glow-red-soft" />
      </div>

      <div className="relative z-[1] mx-auto flex min-h-[100svh] max-w-[1280px] flex-col justify-center px-6 pt-28 pb-16 md:px-10 lg:px-12 lg:pb-20">
        <div className="grid items-center gap-12 lg:grid-cols-[44%_56%] lg:gap-6">
          <div className="order-1 flex flex-col">
            {/*
              줄바꿈 3줄 고정 (모바일도 동일, 폰트만 축소)
              강조: 「실시간 듀오매칭」만 #2DD4C8
            */}
            <h1 className="font-headline text-[clamp(2.1rem,5.2vw,3.6rem)] leading-[1.28] font-bold text-[#F5F5F7] drop-shadow-[0_2px_24px_rgba(0,0,0,0.45)]">
              {t.hero.titleLead}
              <br />
              {t.hero.titleMid}
              <br />
              <span className="whitespace-nowrap text-[#E8384F]">{t.hero.titleAccent}</span>
            </h1>

            <p className="mt-6 max-w-md font-body text-[0.95rem] leading-[1.65] font-medium text-[#8B8894] md:text-[1rem]">
              {t.hero.subtitle}
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link href={primaryHref} className="btn-hero-primary">
                {t.hero.startMatching}
              </Link>
              <a href="#system" className="btn-hero-secondary">
                {t.hero.learnMatching}
              </a>
            </div>
          </div>

          <div className="order-2 lg:pl-2">
            <MatchNetworkIllustration
              primaryLabel={t.hero.avatarYou}
              secondaryLabel={t.hero.avatarPartner}
              stepAnalyze={t.hero.storyAnalyze}
              stepConnect={t.hero.storyConnect}
              stepDone={t.hero.storyDone}
              demoHint={t.hero.storyDemo}
              tagAggression={t.hero.storyTagAggression}
              tagRole={t.hero.storyTagRole}
              aiLabel={t.hero.storyAiLabel}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
