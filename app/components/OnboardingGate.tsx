"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/useAuth";

/**
 * 로그인됐는데 온보딩 미완료면 /onboarding 으로 보냄.
 * - 명시적으로 completed=false 일 때만 리다이렉트 (기존 유저 API 순간 실패로 쫓기지 않게)
 * - 체크 중에는 얇은 오버레이로 매칭 연타를 줄임 (서버도 onboarding_required 가드)
 */
export default function OnboardingGate() {
  const { user, authReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    if (!authReady || !user) {
      setBlocking(false);
      return;
    }
    if (pathname?.startsWith("/onboarding")) {
      setBlocking(false);
      return;
    }

    let cancelled = false;
    setBlocking(true);

    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const data = (await res.json()) as {
          ok?: boolean;
          onboardingCompleted?: boolean;
        };
        if (cancelled) return;

        if (res.ok && data.ok && data.onboardingCompleted === false) {
          router.replace("/onboarding");
          return;
        }
      } catch {
        // 네트워크 실패 시 홈은 유지 — 큐는 서버 가드가 막음
      } finally {
        if (!cancelled) setBlocking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, user, pathname, router]);

  if (blocking && user && authReady && !pathname?.startsWith("/onboarding")) {
    return (
      <div
        className="fixed inset-0 z-[60] bg-[#05080b]/40"
        aria-busy="true"
        aria-hidden="true"
      />
    );
  }

  return null;
}
