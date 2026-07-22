"use client";

// 프로필 페이지의 API 호출 / 상태 갱신 로직
//
// 왜 UI에서 분리하나?
//   ProfileContent 는 화면만 그리고, "서버에 뭐 요청할지" 는 여기로 모읍니다.
//   fetch URL·에러 키 처리가 컴포넌트 JSX와 섞이면 나중에 고치기 어렵습니다.
//
// 흐름: 버튼 클릭 → 이 훅의 핸들러 → /api/... → 상태 갱신 → 화면 반영

import { useCallback, useEffect, useState } from "react";
import type { PenaltyHistoryResponse, PenaltyRecord } from "@/app/api/match/penalty/history/route";
import { startDiscordLink } from "@/lib/discord/startDiscordLink";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/profile";
import type { ValorantMatch } from "@/lib/supabase/valorant";

export type ProfileDataLabels = {
  saveFailed: string;
  saveSuccess: string;
  syncAfterLink: string;
  syncNeedRiot: string;
  syncEmpty: string;
  /** "{count}" 자리를 숫자로 치환 */
  syncSuccessCount: string;
  unlinkRiotSuccess: string;
  unlinkDiscordSuccess: string;
  unlinkActiveMatch: string;
  unlinkFailed: string;
  linkDiscordSuccess: string;
  riotErrors: Record<string, string>;
  matchErrors: Record<string, string>;
  discordErrors: Record<string, string>;
};

type UseProfileDataArgs = {
  initialProfile: Profile;
  initialMatches: ValorantMatch[];
  labels: ProfileDataLabels;
  /** 서버 컴포넌트 데이터 다시 받기 */
  onRefresh: () => void;
};

export type DiscordSyncResult = {
  ok: boolean;
  errorKey?: string;
};

/** Discord OAuth 콜백 후 프로필에 디스코드 정보 저장 */
export async function syncDiscordProfile(): Promise<DiscordSyncResult> {
  const response = await fetch("/api/discord/sync", { method: "POST" });
  const data = (await response.json()) as {
    ok?: boolean;
    errorKey?: string;
  };

  if (!response.ok || !data.ok) {
    return { ok: false, errorKey: data.errorKey ?? "save_failed" };
  }

  return { ok: true };
}

export function useProfileData({
  initialProfile,
  initialMatches,
  labels,
  onRefresh,
}: UseProfileDataArgs) {
  const [profile, setProfile] = useState(initialProfile);
  const [matches, setMatches] = useState(initialMatches);
  const [displayName, setDisplayName] = useState(initialProfile.display_name ?? "");
  const [riotIdInput, setRiotIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkingRiot, setLinkingRiot] = useState(false);
  const [unlinkingRiot, setUnlinkingRiot] = useState(false);
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [syncingMatches, setSyncingMatches] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [penalties, setPenalties] = useState<PenaltyRecord[]>([]);
  const [penaltyCount, setPenaltyCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [isCoolingDown, setIsCoolingDown] = useState(false);

  const fetchPenalties = useCallback(async () => {
    try {
      const res = await fetch("/api/match/penalty/history");
      if (!res.ok) return;
      const data = (await res.json()) as PenaltyHistoryResponse;
      if (data.ok) {
        setPenalties(data.penalties);
        setPenaltyCount(data.penaltyCount);
        setCooldownUntil(data.cooldownUntil);
        setIsCoolingDown(data.isCoolingDown);
      }
    } catch {
      // 조용히 실패
    }
  }, []);

  useEffect(() => {
    setProfile(initialProfile);
    setMatches(initialMatches);
    setDisplayName(initialProfile.display_name ?? "");
  }, [initialProfile, initialMatches]);

  useEffect(() => {
    void fetchPenalties();
  }, [fetchPenalties]);

  async function saveDisplayName(): Promise<void> {
    setLoading(true);
    setMessage(null);
    setIsError(false);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("id", profile.id)
      .select(
        "id, email, display_name, riot_id, discord_username, discord_id, last_match_sync_at, created_at, updated_at",
      )
      .single();

    if (error) {
      setIsError(true);
      setMessage(labels.saveFailed);
      setLoading(false);
      return;
    }

    setProfile(data);
    setMessage(labels.saveSuccess);
    setLoading(false);
  }

  async function runMatchSync(
    showLoading = true,
    riotIdOverride?: string | null,
  ): Promise<boolean> {
    const hasRiot = Boolean(riotIdOverride ?? profile.riot_id);
    if (!hasRiot) {
      setIsError(true);
      setMessage(labels.syncNeedRiot);
      return false;
    }

    if (showLoading) {
      setSyncingMatches(true);
    }
    setIsError(false);

    const response = await fetch("/api/valorant/sync", { method: "POST" });
    const data = (await response.json()) as {
      ok?: boolean;
      errorKey?: string;
      warningKey?: string;
      retryAfterSec?: number;
      inserted?: number;
      fetched?: number;
      total?: number;
      matches?: ValorantMatch[];
      lastMatchSyncAt?: string;
      tier?: number | null;
      rankedRating?: number | null;
    };

    if (!response.ok || !data.ok) {
      setIsError(true);
      const key = data.errorKey ?? "server_error";
      let nextMessage = labels.matchErrors[key] ?? labels.matchErrors.server_error;
      if ((key === "sync_cooldown" || key === "rate_limit") && data.retryAfterSec) {
        nextMessage = `${nextMessage} (${data.retryAfterSec}s)`;
      }
      setMessage(nextMessage);
      if (showLoading) {
        setSyncingMatches(false);
      }
      return false;
    }

    if (Array.isArray(data.matches)) {
      setMatches(data.matches);
    }

    setProfile((prev) => ({
      ...prev,
      last_match_sync_at: data.lastMatchSyncAt ?? prev.last_match_sync_at ?? null,
      tier: data.tier !== undefined ? data.tier : prev.tier,
      ranked_rating:
        data.rankedRating !== undefined ? data.rankedRating : prev.ranked_rating,
    }));

    if ((data.total ?? 0) === 0) {
      setMessage(labels.syncEmpty);
    } else {
      const count = data.fetched ?? data.total ?? 0;
      const base = labels.syncSuccessCount.replace("{count}", String(count));
      if (data.warningKey === "rate_limit") {
        setMessage(`${base} ${labels.matchErrors.rate_limit}`);
      } else {
        setMessage(base);
      }
    }

    if (showLoading) {
      setSyncingMatches(false);
    }
    return true;
  }

  async function linkRiot(): Promise<void> {
    setLinkingRiot(true);
    setMessage(null);
    setIsError(false);

    const response = await fetch("/api/riot/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ riotId: riotIdInput }),
    });

    const data = (await response.json()) as {
      ok?: boolean;
      errorKey?: string;
      message?: string;
      riot_id?: string;
      tier?: number | null;
      rankedRating?: number | null;
    };

    if (!response.ok || !data.ok) {
      setIsError(true);
      const key = data.errorKey ?? "server_error";
      setMessage(labels.riotErrors[key] ?? labels.riotErrors.server_error);
      setLinkingRiot(false);
      return;
    }

    // setState는 비동기라 바로 아래 runMatchSync에서 profile.riot_id가 아직 예전 값일 수 있음
    const linkedRiotId = data.riot_id ?? profile.riot_id;
    setProfile((prev) => ({
      ...prev,
      riot_id: linkedRiotId,
      tier: data.tier ?? prev.tier ?? null,
      ranked_rating: data.rankedRating ?? prev.ranked_rating ?? null,
    }));
    setRiotIdInput("");
    setLinkingRiot(false);
    setMessage(labels.syncAfterLink);
    setIsError(false);
    await runMatchSync(false, linkedRiotId);
    onRefresh();
  }

  async function syncMatches(): Promise<void> {
    setMessage(null);
    setSyncingMatches(true); // 클릭 즉시 버튼 문구 변경
    const ok = await runMatchSync(true);
    if (ok) {
      onRefresh();
    }
  }

  async function unlinkRiot(): Promise<void> {
    if (!profile.riot_id) return;
    setUnlinkingRiot(true);
    setMessage(null);
    setIsError(false);

    // 클릭 즉시 UI에서 해제된 것처럼 보이게
    const snapshot = profile;
    setProfile((prev) => ({
      ...prev,
      riot_id: null,
      tier: null,
      ranked_rating: null,
    }));
    setMessage(labels.unlinkRiotSuccess);

    const response = await fetch("/api/riot/unlink", { method: "POST" });
    const data = (await response.json()) as { ok?: boolean; errorKey?: string };

    if (!response.ok || !data.ok) {
      setProfile(snapshot);
      setIsError(true);
      if (data.errorKey === "active_match_exists") {
        setMessage(labels.unlinkActiveMatch);
      } else {
        setMessage(labels.unlinkFailed);
      }
      setUnlinkingRiot(false);
      return;
    }

    setUnlinkingRiot(false);
    onRefresh();
  }

  // 클릭 즉시 "이동 중…" → 브라우저에서 Discord OAuth (우리 API 우회)
  async function linkDiscord(): Promise<void> {
    setLinkingDiscord(true);
    setMessage(null);
    setIsError(false);

    const result = await startDiscordLink("/profile?discord_linked=1");
    if (!result.ok && result.errorKey !== "login_required") {
      setLinkingDiscord(false);
      setIsError(true);
      setMessage(
        labels.discordErrors[result.errorKey ?? "authorize_failed"] ??
          labels.discordErrors.authorize_failed,
      );
    }
    // ok면 Discord로 페이지 이동 — 버튼 상태는 그대로 두어도 됨
  }

  async function unlinkDiscord(): Promise<void> {
    if (!profile.discord_username) return;
    setUnlinkingDiscord(true);
    setMessage(null);
    setIsError(false);

    const snapshot = profile;
    setProfile((prev) => ({ ...prev, discord_username: null, discord_id: null }));
    setMessage(labels.unlinkDiscordSuccess);

    const response = await fetch("/api/discord/unlink", { method: "POST" });
    const data = (await response.json()) as { ok?: boolean; errorKey?: string };

    if (!response.ok || !data.ok) {
      setProfile(snapshot);
      setIsError(true);
      if (data.errorKey === "active_match_exists") {
        setMessage(labels.unlinkActiveMatch);
      } else {
        setMessage(labels.unlinkFailed);
      }
      setUnlinkingDiscord(false);
      return;
    }

    setUnlinkingDiscord(false);
    onRefresh();
  }

  return {
    profile,
    matches,
    displayName,
    setDisplayName,
    riotIdInput,
    setRiotIdInput,
    loading,
    linkingRiot,
    unlinkingRiot,
    unlinkingDiscord,
    linkingDiscord,
    syncingMatches,
    message,
    setMessage,
    isError,
    setIsError,
    penalties,
    penaltyCount,
    cooldownUntil,
    isCoolingDown,
    saveDisplayName,
    linkRiot,
    syncMatches,
    unlinkRiot,
    linkDiscord,
    unlinkDiscord,
  };
}
