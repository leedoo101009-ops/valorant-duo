"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import type { DuoGoal } from "@/lib/onboarding/types";

type Step = 1 | 2;

export default function OnboardingPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, authReady } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [duoGoal, setDuoGoal] = useState<DuoGoal | null>(null);
  const [riotIdInput, setRiotIdInput] = useState("");
  const [statsConsent, setStatsConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // 로그인 안 됨 → login / 이미 온보딩 완료 → 홈
  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const data = (await res.json()) as {
          ok?: boolean;
          onboardingCompleted?: boolean;
          duoGoal?: DuoGoal | null;
        };
        if (cancelled) return;

        if (data.onboardingCompleted) {
          router.replace("/");
          return;
        }

        if (data.duoGoal) {
          setDuoGoal(data.duoGoal);
          setStep(2);
        }
      } catch {
        // 상태 조회 실패해도 온보딩 UI는 보여 줌
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, user, router]);

  async function saveGoalAndNext() {
    if (!duoGoal) return;
    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duoGoal }),
      });
      const data = (await res.json()) as { ok?: boolean; errorKey?: string };

      if (!res.ok || !data.ok) {
        setIsError(true);
        setMessage(t.onboarding.saveFailed);
        setLoading(false);
        return;
      }

      setStep(2);
    } catch {
      setIsError(true);
      setMessage(t.onboarding.saveFailed);
    } finally {
      setLoading(false);
    }
  }

  async function handleLinkRiot(event: FormEvent) {
    event.preventDefault();
    if (!statsConsent) {
      setIsError(true);
      setMessage(t.onboarding.consentRequired);
      return;
    }

    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const linkRes = await fetch("/api/riot/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riotId: riotIdInput.trim() }),
      });
      const linkData = (await linkRes.json()) as {
        ok?: boolean;
        errorKey?: string;
      };

      if (!linkRes.ok || !linkData.ok) {
        setIsError(true);
        const key = linkData.errorKey;
        setMessage(
          (key &&
            t.profile.riotErrors[key as keyof typeof t.profile.riotErrors]) ||
            t.onboarding.linkFailed,
        );
        setLoading(false);
        return;
      }

      const doneRes = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true, skipRiot: false }),
      });
      const doneData = (await doneRes.json()) as { ok?: boolean };

      if (!doneRes.ok || !doneData.ok) {
        setIsError(true);
        setMessage(t.onboarding.saveFailed);
        setLoading(false);
        return;
      }

      router.replace("/#match");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage(t.onboarding.linkFailed);
      setLoading(false);
    }
  }

  async function handleSkipRiot() {
    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true, skipRiot: true }),
      });
      const data = (await res.json()) as { ok?: boolean };

      if (!res.ok || !data.ok) {
        setIsError(true);
        setMessage(t.onboarding.saveFailed);
        setLoading(false);
        return;
      }

      // 매칭은 홈에서 가능하지만, riot 없으면 큐 API가 riot_required로 막음
      router.replace("/");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage(t.onboarding.saveFailed);
      setLoading(false);
    }
  }

  const goalOptions: { value: DuoGoal; label: string }[] = [
    { value: "rank_up", label: t.onboarding.goalRankUp },
    { value: "casual_duo", label: t.onboarding.goalCasual },
    { value: "any", label: t.onboarding.goalAny },
  ];

  if (!authReady || checking) {
    return (
      <div className="bg-hero-duo relative flex min-h-screen items-center justify-center">
        <p className="font-body text-sm text-[#8B8894]">{t.onboarding.loading}</p>
      </div>
    );
  }

  return (
    <div className="bg-hero-duo relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-24">
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-45"
        aria-hidden="true"
      >
        <div className="hero-glow hero-glow-purple" />
        <div className="hero-glow hero-glow-blue" />
        <div className="hero-glow hero-glow-red" />
        <div className="hero-glow hero-glow-red-soft" />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-black/35" aria-hidden="true" />

      <div className="absolute top-6 right-6 z-10 md:top-8 md:right-10">
        <LanguageSwitcher />
      </div>

      <div className="relative z-[1] w-full max-w-md rounded-2xl border border-white/[0.07] bg-[rgba(4,7,11,0.92)] p-8 shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-md lg:p-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[#FF4655] font-headline text-base font-black text-white">
            D
          </span>
          <span className="font-headline text-xl font-extrabold tracking-tight text-white">
            Duorant
          </span>
        </div>

        {/* 진행바 N/2 */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-body text-[11px] font-semibold tracking-[0.14em] text-[#3DE0D0] uppercase">
              {t.onboarding.label}
            </p>
            <p className="font-body text-[12px] font-semibold tabular-nums text-[#8B8894]">
              {step}/2
            </p>
          </div>
          <div className="flex gap-2">
            {[1, 2].map((n) => (
              <div
                key={n}
                className={`h-1.5 flex-1 rounded-full ${
                  n <= step ? "bg-[#3DE0D0]" : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>

        {step === 1 ? (
          <>
            <h1 className="font-headline text-[1.5rem] font-bold tracking-tight text-[#F5F5F7]">
              {t.onboarding.goalTitle}
            </h1>
            <p className="mt-2 font-body text-sm text-[#8B8894]">
              {t.onboarding.goalSubtitle}
            </p>

            <div className="mt-8 flex flex-col gap-3">
              {goalOptions.map((opt) => {
                const active = duoGoal === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDuoGoal(opt.value)}
                    className={`rounded-xl border px-4 py-3.5 text-left font-body text-sm font-semibold transition-colors ${
                      active
                        ? "border-[#3DE0D0]/60 bg-[rgba(61,224,208,0.1)] text-[#F5F5F7]"
                        : "border-white/10 bg-black/35 text-[#C4C2CC] hover:border-white/20"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {message && (
              <p
                className={`mt-4 font-body text-sm ${
                  isError ? "text-[#FF4655]" : "text-[#3DE0D0]"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="button"
              disabled={!duoGoal || loading}
              onClick={() => void saveGoalAndNext()}
              className="btn-hero-primary btn-hero-primary--soft-glow mt-8 w-full !py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t.onboarding.loading : t.onboarding.next}
            </button>
          </>
        ) : (
          <>
            <h1 className="font-headline text-[1.5rem] font-bold tracking-tight text-[#F5F5F7]">
              {t.onboarding.riotTitle}
            </h1>
            <p className="mt-2 font-body text-sm text-[#8B8894]">
              {t.onboarding.riotSubtitle}
            </p>

            <form onSubmit={handleLinkRiot} className="mt-8 space-y-4">
              <div>
                <label
                  htmlFor="riotId"
                  className="mb-2 block font-body text-[11px] font-semibold tracking-[0.12em] text-[#8B8894] uppercase"
                >
                  {t.onboarding.riotIdLabel}
                </label>
                <input
                  id="riotId"
                  type="text"
                  required
                  value={riotIdInput}
                  onChange={(e) => setRiotIdInput(e.target.value)}
                  placeholder={t.profile.riotPlaceholder}
                  className="auth-input"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3">
                <input
                  type="checkbox"
                  checked={statsConsent}
                  onChange={(e) => setStatsConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#3DE0D0]"
                />
                <span className="font-body text-sm leading-relaxed text-[#C4C2CC]">
                  {t.onboarding.statsConsent}
                </span>
              </label>

              {message && (
                <p
                  className={`font-body text-sm ${
                    isError ? "text-[#FF4655]" : "text-[#3DE0D0]"
                  }`}
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !statsConsent}
                className="btn-hero-primary btn-hero-primary--soft-glow w-full !py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? t.onboarding.loading : t.onboarding.linkRiot}
              </button>
            </form>

            <button
              type="button"
              disabled={loading}
              onClick={() => void handleSkipRiot()}
              className="mt-4 w-full rounded-full border border-white/10 bg-transparent py-3 font-body text-sm font-semibold text-[#8B8894] transition-colors hover:border-white/20 hover:text-[#F5F5F7] disabled:opacity-50"
            >
              {t.onboarding.skipRiot}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => setStep(1)}
              className="mt-4 font-body text-sm text-[#8B8894] hover:text-[#3DE0D0]"
            >
              ← {t.onboarding.back}
            </button>
          </>
        )}

        <Link
          href="/"
          className="mt-8 inline-block font-body text-sm font-medium text-[#555] hover:text-[#8B8894]"
        >
          ← {t.auth.backHome}
        </Link>
      </div>
    </div>
  );
}
