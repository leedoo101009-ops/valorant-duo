"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import {
  getOnboardingGateCache,
  setOnboardingGateCache,
} from "@/lib/onboarding/gateCache";

/**
 * 로그인됐는데 온보딩 미완료면 /onboarding 으로 보냄.
 * - Providers 에 두어 홈·프로필 등 어디서든 동일하게 적용
 * - 유저별 메모리 캐시로 경로 이동마다 API를 다시 치지 않음
 * - 명시적으로 completed=false 일 때만 리다이렉트
 * - 매칭은 서버 onboarding_required 가드가 막음
 */
export default function OnboardingGate() {
  const { user, authReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!authReady || !user) return;
    // 온보딩·로그인 화면에서는 쫓아내지 않음
    if (pathname?.startsWith("/onboarding") || pathname?.startsWith("/login")) {
      return;
    }

    const cached = getOnboardingGateCache(user.id);
    if (cached) {
      if (cached.completed === false) {
        router.replace("/onboarding");
      }
      // completed === true → 통과 (추가 fetch 없음)
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const data = (await res.json()) as {
          ok?: boolean;
          onboardingCompleted?: boolean;
        };
        if (cancelled) return;

        if (!res.ok || !data.ok) return;

        const completed = data.onboardingCompleted === true;
        // false만 캐시해도 되지만, true도 캐시해야 홈↔프로필 이동 시 재요청이 사라짐
        setOnboardingGateCache(user.id, completed);

        if (!completed) {
          router.replace("/onboarding");
        }
      } catch {
        // 네트워크 실패 시 현재 페이지 유지 — 큐는 서버 가드가 막음
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, user, pathname, router]);

  return null;
}
