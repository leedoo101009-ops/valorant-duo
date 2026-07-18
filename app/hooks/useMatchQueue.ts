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
    // 상대가 Discord 계정을 연동했는지 (연락처 공개 여부와 별개)
    discordLinked: boolean;
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

// 어떤 버튼이 돌아가는 중인지 — 전역으로 전부 잠그지 않기 위함
export type PendingAction =
  | null
  | "join"
  | "leave"
  | "dismiss"
  | "cancelSetup"
  | "setupReady"
  | "connection"
  | "review"
  | "acceptNoVoice"
  | "declineNoVoice";

const defaultStatus: MatchQueueStatus = {
  inQueue: false,
  queueCount: 0,
  joinedAt: null,
  activeMatch: null,
  dismissNotice: null,
  pendingReview: null,
};

const JOIN_TIMEOUT_MS = 15_000;

function patchActiveMatch(
  prev: MatchQueueStatus,
  patch: Partial<ActiveMatch>,
): MatchQueueStatus {
  if (!prev.activeMatch) return prev;
  return { ...prev, activeMatch: { ...prev.activeMatch, ...patch } };
}

export function useMatchQueue() {
  const [status, setStatus] = useState<MatchQueueStatus>(defaultStatus);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // 예전 컴포넌트 호환: "뭔가 하나라도 처리 중"
  const actionLoading = pendingAction !== null;

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

  async function joinQueue(): Promise<{
    ok: boolean;
    errorKey?: string;
    cooldownUntil?: string;
  }> {
    setPendingAction("join");

    // 롤백용으로 바꿀 필드만 기억 (snapshot 전체 저장 대신)
    // 이유: snapshot 전체를 저장하면 비동기 중 refresh() 가 업데이트한
    //        서버 데이터까지 덮어쓸 수 있음 → 바꾼 필드만 되돌리는 게 안전
    const prevInQueue = status.inQueue;
    const prevJoinedAt = status.joinedAt;

    setStatus((prev) => ({
      ...prev,
      inQueue: true,
      joinedAt: prev.joinedAt ?? new Date().toISOString(),
    }));

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
        // 바꾼 필드만 원래 값으로 되돌림
        setStatus((prev) => ({ ...prev, inQueue: prevInQueue, joinedAt: prevJoinedAt }));
        return {
          ok: false,
          errorKey: data.errorKey ?? "join_failed",
          cooldownUntil: data.cooldownUntil,
        };
      }

      if (data.matched) {
        setStatus((prev) => ({
          ...prev,
          inQueue: false,
          queueCount: data.queueCount ?? prev.queueCount,
        }));
      } else {
        setStatus((prev) => ({
          ...prev,
          inQueue: true,
          queueCount: data.queueCount ?? prev.queueCount,
        }));
      }

      void refresh();
      return { ok: true };
    } catch (error) {
      setStatus((prev) => ({ ...prev, inQueue: prevInQueue, joinedAt: prevJoinedAt }));
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, errorKey: "join_failed" };
      }
      return { ok: false, errorKey: "join_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function leaveQueue(): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("leave");
    const prevInQueue = status.inQueue;
    const prevJoinedAt = status.joinedAt;

    setStatus((prev) => ({ ...prev, inQueue: false, joinedAt: null }));

    try {
      const response = await fetch("/api/match/queue/leave", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        errorKey?: string;
        queueCount?: number;
      };

      if (!response.ok || !data.ok) {
        setStatus((prev) => ({ ...prev, inQueue: prevInQueue, joinedAt: prevJoinedAt }));
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
      setStatus((prev) => ({ ...prev, inQueue: prevInQueue, joinedAt: prevJoinedAt }));
      return { ok: false, errorKey: "leave_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function dismissMatch(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("dismiss");
    const prevActiveMatch = status.activeMatch;
    setStatus((prev) => ({ ...prev, activeMatch: null }));

    try {
      const response = await fetch("/api/match/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        setStatus((prev) => ({ ...prev, activeMatch: prevActiveMatch }));
        return { ok: false, errorKey: data.errorKey ?? "dismiss_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) => ({ ...prev, activeMatch: prevActiveMatch }));
      return { ok: false, errorKey: "dismiss_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelSetup(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("cancelSetup");
    const prevActiveMatch = status.activeMatch;
    setStatus((prev) => ({ ...prev, activeMatch: null }));

    try {
      const response = await fetch("/api/match/setup/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        setStatus((prev) => ({ ...prev, activeMatch: prevActiveMatch }));
        return { ok: false, errorKey: data.errorKey ?? "setup_cancel_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) => ({ ...prev, activeMatch: prevActiveMatch }));
      return { ok: false, errorKey: "setup_cancel_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function markSetupReady(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("setupReady");
    const prevMySetupReady = status.activeMatch?.mySetupReady ?? false;
    setStatus((prev) => patchActiveMatch(prev, { mySetupReady: true }));

    try {
      const response = await fetch("/api/match/setup/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        setStatus((prev) => patchActiveMatch(prev, { mySetupReady: prevMySetupReady }));
        return { ok: false, errorKey: data.errorKey ?? "setup_ready_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) => patchActiveMatch(prev, { mySetupReady: prevMySetupReady }));
      return { ok: false, errorKey: "setup_ready_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function updateConnection(input: {
    matchId: string;
    voicePreference?: VoicePreference;
    partyCode?: string;
  }): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("connection");

    // 롤백용으로 바꿀 필드만 저장
    const prevVoice = status.activeMatch?.myVoicePreference ?? null;
    const prevPartyCode = status.activeMatch?.partyCode ?? null;
    const prevPartyCodeByMe = status.activeMatch?.partyCodeByMe ?? false;

    if (input.voicePreference !== undefined) {
      setStatus((prev) =>
        patchActiveMatch(prev, { myVoicePreference: input.voicePreference ?? null }),
      );
    }
    if (input.partyCode !== undefined) {
      const code = input.partyCode.trim();
      setStatus((prev) =>
        patchActiveMatch(prev, {
          partyCode: code || prev.activeMatch?.partyCode || null,
          partyCodeByMe: Boolean(code) || prev.activeMatch?.partyCodeByMe || false,
        }),
      );
    }

    try {
      const response = await fetch("/api/match/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        // 바꾼 필드만 원래 값으로 되돌림
        setStatus((prev) =>
          patchActiveMatch(prev, {
            myVoicePreference: prevVoice,
            partyCode: prevPartyCode,
            partyCodeByMe: prevPartyCodeByMe,
          }),
        );
        return { ok: false, errorKey: data.errorKey ?? "connection_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) =>
        patchActiveMatch(prev, {
          myVoicePreference: prevVoice,
          partyCode: prevPartyCode,
          partyCodeByMe: prevPartyCodeByMe,
        }),
      );
      return { ok: false, errorKey: "connection_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function submitReview(input: {
    matchId: string;
    positiveTags: string[];
    negativeTags: string[];
  }): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("review");
    const prevPendingReview = status.pendingReview;
    setStatus((prev) => ({ ...prev, pendingReview: null }));

    try {
      const response = await fetch("/api/match/review/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        setStatus((prev) => ({ ...prev, pendingReview: prevPendingReview }));
        return { ok: false, errorKey: data.errorKey ?? "review_submit_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) => ({ ...prev, pendingReview: prevPendingReview }));
      return { ok: false, errorKey: "review_submit_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  async function acceptPartnerNoVoice(matchId: string): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("acceptNoVoice");
    const prevAccepted = status.activeMatch?.myAcceptedPartnerNoVoice ?? false;
    setStatus((prev) => patchActiveMatch(prev, { myAcceptedPartnerNoVoice: true }));

    try {
      const response = await fetch("/api/match/no-voice/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        setStatus((prev) => patchActiveMatch(prev, { myAcceptedPartnerNoVoice: prevAccepted }));
        return { ok: false, errorKey: data.errorKey ?? "accept_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) => patchActiveMatch(prev, { myAcceptedPartnerNoVoice: prevAccepted }));
      return { ok: false, errorKey: "accept_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  // 상대 No Voice 거절 버튼 — 페널티 없는 전용 API (일반 dismiss와 분리)
  async function declinePartnerNoVoice(
    matchId: string,
  ): Promise<{ ok: boolean; errorKey?: string }> {
    setPendingAction("declineNoVoice");
    const prevActiveMatch = status.activeMatch;
    setStatus((prev) => ({ ...prev, activeMatch: null }));

    try {
      const response = await fetch("/api/match/no-voice/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await response.json()) as { ok?: boolean; errorKey?: string };

      if (!response.ok || !data.ok) {
        setStatus((prev) => ({ ...prev, activeMatch: prevActiveMatch }));
        return { ok: false, errorKey: data.errorKey ?? "decline_failed" };
      }

      void refresh();
      return { ok: true };
    } catch {
      setStatus((prev) => ({ ...prev, activeMatch: prevActiveMatch }));
      return { ok: false, errorKey: "decline_failed" };
    } finally {
      setPendingAction(null);
    }
  }

  return {
    status,
    loading,
    actionLoading,
    pendingAction,
    refresh,
    joinQueue,
    leaveQueue,
    dismissMatch,
    cancelSetup,
    markSetupReady,
    updateConnection,
    submitReview,
    acceptPartnerNoVoice,
    declinePartnerNoVoice,
  };
}
