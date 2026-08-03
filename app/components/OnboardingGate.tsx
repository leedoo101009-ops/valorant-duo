"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/useAuth";

/**
 * 로그인됐는데 온보딩 미완료면 /onboarding 으로 보냄.
 * - Providers 에 두어 홈·프로필 등 어디서든 동일하게 적용
 * - 명시적으로 completed=false 일 때만 리다이렉트 (기존 유저 API 순간 실패로 쫓기지 않게)
 * - 화면 덮는 오버레이는 없음 (첫 진입이 어두워지고 클릭 막히던 UX 제거)
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

    let cancelled = false;

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
