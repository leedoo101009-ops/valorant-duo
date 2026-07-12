"use client";

import { useCallback, useEffect, useState } from "react";
import { QUEUE_STATUS_POLL_MS } from "@/lib/match/constants";
import type { PendingMatchReview, UserReputation } from "@/lib/reputation/types";

export type MatchPhase = "connecting" | "setup" | "in_game";

export type ActiveMatch = {
  id: string;
  createdAt: string;
  phase: MatchPhase;
  expiresAt: string | null;
  secondsUntilExpiry: number | null;
  setupExpiresAt: string | null;
  setupSecondsUntilExpiry: number | null;
  myVoicePreference: VoicePreference | null;
  partnerVoicePreference: VoicePreference | null;
  mySetupReady: boolean;
  partnerSetupReady: boolean;
  inGameAt: string | null;
  partyCode: string | null;
  partyCodeByMe: boolean;
  myAcceptedPartnerNoVoice: boolean;
  partnerAcceptedNoVoice: boolean;
  me: {
    displayName: string | null;
    riotId: string | null;
    discordUsername: string | null;
    discordId: string | null;
  };
  partner: {
    displayName: string | null;
    riotId: string | null;
    discordUsername: string | null;
    discordId: string | null;
    reputation: UserReputation | null;
  };
};

export type VoicePreference = "valorant" | "discord" | "none";

export type DismissNotice = {
  matchId: string;
  reason:
    | "partner_timeout"
    | "match_timeout"
    | "partner_left"
    | "match_cancelled_offline"
    | "setup_timeout"
    | "partner_setup_cancelled";
};

export type MatchQueueStatus = {
  inQueue: boolean;
  queueCount: number;
  joinedAt: string | null;
  activeMatch: ActiveMatch | null;
  dismissNotice: DismissNotice | null;
  pendingReview: PendingMatchReview | null;
};

const defaultStatus: MatchQueueStatus = {
  inQueue: false,
  queueCount: 0,
  joinedAt: null,
  activeMatch: null,
  dismissNotice: null,
  pendingReview: null,
};

export function useMatchQueue() {
  const [status, setStatus] = useState<MatchQueueStatus>(defaultStatus);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/match/queue/status");
      const data = (await response.json()) as MatchQueueStatus & { ok?: boolean };

      if (response.ok && data.ok !== false) {
        setStatus({
          inQueue: Boolean(data.inQueue),
          queueCount: data.queueCount ?? 0,
          joinedAt: data.joinedAt ?? null,
          activeMatch: data.activeMatch ?? null,
          dismissNotice: data.dismissNotice ?? null,
          pendingReview: data.pendingReview ?? null,
        });
      }
    } catch {
      // 이전 상태 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();

    const intervalId = window.setInterval(refresh, QUEUE_STATUS_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

const JOIN_TIMEOUT_MS = 15_000;

  async function joinQueue(): Promise<{
    ok: boolean;
    errorKey?: string;
    cooldownUntil?: string;
  }> {
    setActionLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);

      const response = await fetch("/api/match/queue/join", {
        method: "POST",
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      const data = (await response.json()) as {
        ok?: boolean;
        matched?: boolean;
        errorKey?: string;
        cooldownUntil?: string;
        queueCount?: number;
      };

      if (!response.ok || !data.ok) {
        return {
          ok: false,
          errorKey: data.errorKey ?? "join_failed",
          cooldownUntil: data.cooldownUntil,
        };
      }

      // 즉시 매칭된 경우 inQueue=true로 두면 안 됩니다 (매치 화면으로 가야 함).
      // refresh()가 activeMatch를 감지해 매칭 화면으로 전환합니다.
      if (!data.matched) {
        // refresh 전에 즉시 큐 상태 반영 — status poll 실패해도 UI가 멈추지 않음
        setStatus((prev) => ({
          ...prev,
          inQueue: true,
          queueCount: data.queueCount ?? prev.queueCount,
        }));
      }

      void refresh();
      return { ok: true };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, errorKey: "join_failed" };
      }
      return { ok: false, errorKey: "join_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function leaveQueue(): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/queue/leave", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        errorKey?: string;
        queueCount?: number;
      };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "leave_failed" };
      }

      setStatus((prev) => ({
        ...prev,
        inQueue: false,
        joinedAt: null,
        queueCount: data.queueCount ?? prev.queueCount,
      }));
      void refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "leave_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function dismissMatch(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "dismiss_failed" };
      }

      setStatus((prev) => ({ ...prev, activeMatch: null }));
      void refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "dismiss_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelSetup(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/setup/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "setup_cancel_failed" };
      }

      setStatus((prev) => ({ ...prev, activeMatch: null }));
      void refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "setup_cancel_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function markSetupReady(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/setup/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "setup_ready_failed" };
      }

      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "setup_ready_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function updateConnection(input: {
    matchId: string;
    voicePreference?: VoicePreference;
    partyCode?: string;
  }): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "connection_failed" };
      }

      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "connection_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function submitReview(input: {
    matchId: string;
    positiveTags: string[];
    negativeTags: string[];
  }): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/review/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "review_submit_failed" };
      }

      setStatus((prev) => ({ ...prev, pendingReview: null }));
      void refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "review_submit_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  async function acceptPartnerNoVoice(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/no-voice/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "accept_failed" };
      }

      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, errorKey: "accept_failed" };
    } finally {
      setActionLoading(false);
    }
  }

  return {
    status,
    loading,
    actionLoading,
    refresh,
    joinQueue,
    leaveQueue,
    dismissMatch,
    cancelSetup,
    markSetupReady,
    updateConnection,
    submitReview,
    acceptPartnerNoVoice,
  };
}
