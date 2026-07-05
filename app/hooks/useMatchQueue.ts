"use client";

import { useCallback, useEffect, useState } from "react";
import { QUEUE_STATUS_POLL_MS } from "@/lib/match/constants";

export type ActiveMatch = {
  id: string;
  createdAt: string;
  myVoicePreference: VoicePreference | null;
  partnerVoicePreference: VoicePreference | null;
  partyCode: string | null;
  partyCodeByMe: boolean;
  me: {
    discordUsername: string | null;
    discordId: string | null;
  };
  partner: {
    displayName: string | null;
    riotId: string | null;
    discordUsername: string | null;
    discordId: string | null;
  };
};

export type VoicePreference = "valorant" | "discord" | "none";

export type MatchQueueStatus = {
  inQueue: boolean;
  queueCount: number;
  joinedAt: string | null;
  activeMatch: ActiveMatch | null;
};

const defaultStatus: MatchQueueStatus = {
  inQueue: false,
  queueCount: 0,
  joinedAt: null,
  activeMatch: null,
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

  async function joinQueue(): Promise<{ ok: boolean; errorKey?: string }> {
    setActionLoading(true);
    try {
      const response = await fetch("/api/match/queue/join", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        errorKey?: string;
        queueCount?: number;
      };

      if (!response.ok || !data.ok) {
        return { ok: false, errorKey: data.errorKey ?? "join_failed" };
      }

      await refresh();
      return { ok: true };
    } catch {
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

  return {
    status,
    loading,
    actionLoading,
    refresh,
    joinQueue,
    leaveQueue,
    dismissMatch,
    updateConnection,
  };
}
