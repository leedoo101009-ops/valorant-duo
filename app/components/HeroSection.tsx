"use client";

import Link from "next/link";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import MatchNetworkIllustration from "./MatchNetworkIllustration";

export default function HeroSection() {
  const { t, locale } = useLanguage();
  const { user, authReady } = useAuth();
  const isEn = locale === "en";

  // authReady 전에는 /login으로 보내지 않음 — 세션 복구 중인데 로그인 페이지로 튕기는 버그 방지
  const primaryHref = user ? "#match" : "/login";

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
        {/*
          영문 헤드라인이 더 길어서 애니메이션과 붙음
          → EN만 칼럼 간격·비율을 넓게 (KO는 기존 밀도 유지)
        */}
        <div
          className={
            isEn
              ? // EN만 간격 더 벌림 (문구·글 크기는 건드리지 않음)
                "grid items-center gap-14 lg:grid-cols-[42%_58%] lg:gap-16 xl:gap-24"
              : "grid items-center gap-12 lg:grid-cols-[44%_56%] lg:gap-6"
          }
        >
          <div className="order-1 flex flex-col">
            {/* 한국어 기준 원래 크기 — leading 1.28 / bold / drop-shadow */}
            <h1 className="font-headline text-[clamp(2.1rem,5.2vw,3.6rem)] leading-[1.28] font-bold text-[#F5F5F7] drop-shadow-[0_2px_24px_rgba(0,0,0,0.45)]">
              {t.hero.titleLead}
              <br />
              {t.hero.titleMid}
              <br />
              <span className="whitespace-nowrap text-[#3DE0D0]">{t.hero.titleAccent}</span>
            </h1>

            <p className="mt-6 max-w-md font-body text-[0.95rem] leading-[1.65] font-medium text-[#8B8894] md:text-[1rem]">
              {t.hero.subtitle}
            </p>

            {/* 메인 CTA — auth 준비 전에는 비활성 (세션 있는 유저가 /login으로 가는 것 방지) */}
            <div className="mt-10">
              {authReady ? (
                <Link href={primaryHref} className="btn-hero-primary btn-hero-primary-lg">
                  {t.hero.startMatching}
                </Link>
              ) : (
                <span
                  className="btn-hero-primary btn-hero-primary-lg cursor-wait opacity-60"
                  aria-busy="true"
                  aria-disabled="true"
                >
                  {t.hero.startMatching}
                </span>
              )}
            </div>
          </div>

          <div className={`order-2 ${isEn ? "lg:pl-8 xl:pl-12" : "lg:pl-2"}`}>
            <MatchNetworkIllustration
              primaryLabel={t.hero.avatarYou}
              secondaryLabel={t.hero.avatarPartner}
              stepAnalyze={t.hero.storyAnalyze}
              stepConnect={t.hero.storyConnect}
              stepDone={t.hero.storyDone}
              demoHint={t.hero.storyDemo}
              tagAggression={t.hero.storyTagAggression}
              tagRole={t.hero.storyTagRole}
              engMark={t.hero.storyEngMark}
              aiLabel={t.hero.storyAiLabel}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
