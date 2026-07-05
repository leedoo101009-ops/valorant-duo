"use client";

import { useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/presence/constants";

async function sendHeartbeat() {
  try {
    await fetch("/api/presence/heartbeat", { method: "POST" });
  } catch {
    // 네트워크 오류는 다음 interval에서 재시도
  }
}

function sendLeaveBeacon() {
  try {
    navigator.sendBeacon("/api/match/leave-on-exit", new Blob([], { type: "application/json" }));
  } catch {
    // beacon 실패 시 heartbeat 만료(expire_offline_duo_matches)가 백업
  }
}

// 로그인한 유저만 마운트 — Navbar에서 user 있을 때 렌더
export default function PresenceHeartbeat({ user }: { user: User }) {
  useEffect(() => {
    void sendHeartbeat();

    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    const onPageHide = (event: PageTransitionEvent) => {
      // bfcache 복원 시에는 매칭 유지
      if (event.persisted) {
        return;
      }
      sendLeaveBeacon();
    };

    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [user.id]);

  return null;
}
