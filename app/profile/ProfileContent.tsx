"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { PenaltyHistoryResponse, PenaltyRecord } from "@/app/api/match/penalty/history/route";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ReputationBadge from "../components/ReputationBadge";
import { useLanguage } from "../context/LanguageContext";
import { GRADE_STYLES } from "@/lib/reputation/scoring";
import type { ReviewTagStat, UserReputation } from "@/lib/reputation/types";
import { getQueueLabel } from "@/lib/riot/agents";
import { formatValorantTierLabel } from "@/lib/riot/tierLabels";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/profile";
import type { ValorantMatch } from "@/lib/supabase/valorant";

type ProfileContentProps = {
  profile: Profile;
  initialMatches: ValorantMatch[];
  reputation: UserReputation | null;
  tagStats: ReviewTagStat[];
};

function formatPlayedAt(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DiscordLinkHandler({
  onResult,
}: {
  onResult: (message: string, isError: boolean) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }

    const errorKey = searchParams.get("discord_error");
    if (errorKey) {
      handled.current = true;
      const errors = t.profile.discordErrors as Record<string, string>;
      onResult(errors[errorKey] ?? errorKey, true);
      router.replace("/profile");
      return;
    }

    if (searchParams.get("discord_linked") !== "1") {
      return;
    }

    handled.current = true;

    async function syncDiscord() {
      const response = await fetch("/api/discord/sync", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        errorKey?: string;
        discord_username?: string;
      };

      if (!response.ok || !data.ok) {
        const errors = t.profile.discordErrors as Record<string, string>;
        const key = data.errorKey ?? "save_failed";
        onResult(errors[key] ?? t.profile.discordErrors.save_failed, true);
      } else {
        onResult(t.profile.linkDiscordSuccess, false);
      }

      router.replace("/profile");
      router.refresh();
    }

    void syncDiscord();
  }, [searchParams, t, onResult, router]);

  return null;
}

function ProfileContentInner({
  profile: initialProfile,
  initialMatches,
  reputation,
  tagStats,
}: ProfileContentProps) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [matches, setMatches] = useState(initialMatches);
  const [displayName, setDisplayName] = useState(initialProfile.display_name ?? "");
  const [riotIdInput, setRiotIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkingRiot, setLinkingRiot] = useState(false);
  const [unlinkingRiot, setUnlinkingRiot] = useState(false);
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setMessage(t.profile.saveFailed);
      setLoading(false);
      return;
    }

    setProfile(data);
    setMessage(t.profile.saveSuccess);
    setLoading(false);
  }

  async function handleLinkRiot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const errors = t.profile.riotErrors as Record<string, string>;
      const key = data.errorKey ?? "server_error";
      setMessage(errors[key] ?? errors.server_error);
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
    setMessage(t.profile.syncAfterLink);
    setIsError(false);
    await runMatchSync(false, linkedRiotId);
    router.refresh();
  }

  async function runMatchSync(
    showLoading = true,
    riotIdOverride?: string | null,
  ): Promise<boolean> {
    const hasRiot = Boolean(riotIdOverride ?? profile.riot_id);
    if (!hasRiot) {
      setIsError(true);
      setMessage(t.profile.syncNeedRiot);
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
      const errors = t.profile.matchErrors as Record<string, string>;
      const key = data.errorKey ?? "server_error";
      let message = errors[key] ?? errors.server_error;
      if ((key === "sync_cooldown" || key === "rate_limit") && data.retryAfterSec) {
        message = `${message} (${data.retryAfterSec}s)`;
      }
      setMessage(message);
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
      setMessage(t.profile.syncEmpty);
    } else {
      const count = data.fetched ?? data.total ?? 0;
      const base = t.profile.syncSuccessCount.replace("{count}", String(count));
      // 일부만 가져온 경우(한도)에도 성공으로 보여 주되 안내를 붙입니다.
      if (data.warningKey === "rate_limit") {
        setMessage(`${base} ${t.profile.matchErrors.rate_limit}`);
      } else {
        setMessage(base);
      }
    }

    if (showLoading) {
      setSyncingMatches(false);
    }
    return true;
  }

  async function handleSyncMatches() {
    setMessage(null);
    await runMatchSync(true);
    router.refresh();
  }

  async function handleUnlinkRiot() {
    if (!profile.riot_id) return;
    setUnlinkingRiot(true);
    setMessage(null);
    setIsError(false);

    const response = await fetch("/api/riot/unlink", { method: "POST" });
    const data = (await response.json()) as { ok?: boolean; errorKey?: string };

    if (!response.ok || !data.ok) {
      setIsError(true);
      if (data.errorKey === "active_match_exists") {
        setMessage(t.profile.unlinkActiveMatch);
      } else {
        setMessage(t.profile.unlinkFailed);
      }
      setUnlinkingRiot(false);
      return;
    }

    setProfile((prev) => ({
      ...prev,
      riot_id: null,
      tier: null,
      ranked_rating: null,
    }));
    setMessage(t.profile.unlinkRiotSuccess);
    setUnlinkingRiot(false);
    router.refresh();
  }

  async function handleUnlinkDiscord() {
    if (!profile.discord_username) return;
    setUnlinkingDiscord(true);
    setMessage(null);
    setIsError(false);

    const response = await fetch("/api/discord/unlink", { method: "POST" });
    const data = (await response.json()) as { ok?: boolean; errorKey?: string };

    if (!response.ok || !data.ok) {
      setIsError(true);
      if (data.errorKey === "active_match_exists") {
        setMessage(t.profile.unlinkActiveMatch);
      } else {
        setMessage(t.profile.unlinkFailed);
      }
      setUnlinkingDiscord(false);
      return;
    }

    setProfile((prev) => ({ ...prev, discord_username: null, discord_id: null }));
    setMessage(t.profile.unlinkDiscordSuccess);
    setUnlinkingDiscord(false);
    router.refresh();
  }

  return (
    <div className="relative min-h-screen bg-black px-6 py-24">
      <Suspense fallback={null}>
        <DiscordLinkHandler onResult={(msg, err) => { setMessage(msg); setIsError(err); }} />
      </Suspense>
      <div className="absolute inset-0 bg-map-grid opacity-60" />
      <div className="absolute top-6 right-6 z-10">
        <LanguageSwitcher />
      </div>

      <div className="relative mx-auto w-full max-w-lg">
        <div className="panel p-8 lg:p-10">
          <p className="font-display text-xs tracking-[0.3em] text-[#ff4655]">{t.profile.label}</p>
          <h1 className="mt-4 font-display text-3xl font-bold uppercase">{t.profile.title}</h1>
          <p className="mt-3 text-sm text-[#888]">{t.profile.subtitle}</p>

          <dl className="mt-8 space-y-4 border border-[#222] bg-[#0a0a0a] p-5">
            <div>
              <dt className="font-display text-[10px] tracking-widest text-[#555]">{t.profile.email}</dt>
              <dd className="mt-1 text-sm text-white">{profile.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-display text-[10px] tracking-widest text-[#555]">{t.profile.memberSince}</dt>
              <dd className="mt-1 text-sm text-[#888]">
                {new Date(profile.created_at).toLocaleDateString()}
              </dd>
            </div>
          </dl>

          <div className="mt-8 border border-[#222] bg-[#0a0a0a] p-5">
            <p className="font-display text-[10px] tracking-[0.25em] text-[#ff4655]">
              {t.profile.connectionsTitle}
            </p>
            <dl className="mt-5 space-y-4">
              <div>
                <dt className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.riotAccount}
                </dt>
                <dd className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-sm text-white">
                    {profile.riot_id ?? (
                      <span className="text-[#555]">{t.profile.notConnected}</span>
                    )}
                  </span>
                  {profile.riot_id ? (
                    <button
                      type="button"
                      onClick={() => void handleUnlinkRiot()}
                      disabled={unlinkingRiot}
                      className="font-display text-[10px] tracking-widest text-[#888] underline transition-colors hover:text-[#ff4655] disabled:opacity-50"
                    >
                      {unlinkingRiot ? t.profile.unlinking : t.profile.unlinkRiot}
                    </button>
                  ) : null}
                </dd>
              </div>
              {profile.riot_id ? (
                <div className="space-y-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="font-display text-[10px] tracking-widest text-[#555]">
                        {t.profile.valorantTier}
                      </dt>
                      <dd className="mt-1 font-display text-lg font-bold tracking-wide text-white">
                        {formatValorantTierLabel(profile.tier, locale) ?? (
                          <span className="text-sm font-normal text-[#555]">
                            {t.profile.tierUnknown}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-display text-[10px] tracking-widest text-[#555]">
                        {t.profile.rankedRating}
                      </dt>
                      <dd className="mt-1 font-display text-lg font-bold tracking-wide text-white">
                        {profile.ranked_rating != null ? (
                          <>
                            {profile.ranked_rating}
                            <span className="ml-1 text-sm font-normal text-[#888]">RR</span>
                          </>
                        ) : (
                          <span className="text-sm font-normal text-[#555]">—</span>
                        )}
                      </dd>
                    </div>
                  </div>
                </div>
              ) : null}
              <div>
                <dt className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.discordAccount}
                </dt>
                <dd className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-sm text-white">
                    {profile.discord_username ?? (
                      <span className="text-[#555]">{t.profile.notConnected}</span>
                    )}
                  </span>
                  {profile.discord_username ? (
                    <button
                      type="button"
                      onClick={() => void handleUnlinkDiscord()}
                      disabled={unlinkingDiscord}
                      className="font-display text-[10px] tracking-widest text-[#888] underline transition-colors hover:text-[#ff4655] disabled:opacity-50"
                    >
                      {unlinkingDiscord ? t.profile.unlinking : t.profile.unlinkDiscord}
                    </button>
                  ) : null}
                </dd>
              </div>
            </dl>

            {!profile.riot_id && (
              <form onSubmit={handleLinkRiot} className="mt-5 space-y-3">
                <input
                  type="text"
                  required
                  value={riotIdInput}
                  onChange={(e) => setRiotIdInput(e.target.value)}
                  placeholder={t.profile.riotPlaceholder}
                  className="input-field"
                />
                <button
                  type="submit"
                  disabled={linkingRiot}
                  className="btn-outline w-full !py-3 disabled:opacity-50"
                >
                  {linkingRiot ? t.profile.linkingRiot : t.profile.linkRiot}
                </button>
              </form>
            )}

            {!profile.discord_username && (
              <div className="mt-5 space-y-2">
                <a href="/api/discord/authorize" className="btn-outline flex w-full !py-3">
                  {t.profile.linkDiscord}
                </a>
                <p className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.linkDiscordHint}
                </p>
              </div>
            )}
          </div>

          <div className="mt-8 border border-[#222] bg-[#0a0a0a] p-5">
            <p className="font-display text-[10px] tracking-[0.25em] text-[#ff4655]">
              {t.profile.reputationTitle}
            </p>
            <p className="mt-2 text-sm text-[#888]">{t.profile.reputationSubtitle}</p>

            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.mannerGrade}
                </dt>
                <dd className="mt-2">
                  {reputation?.isNewUser ? (
                    <span className="inline-flex items-center gap-1 border border-[#555]/60 bg-[#111] px-2 py-1 font-display text-[10px] tracking-widest text-[#aaa]">
                      🆕 {t.profile.newUserBadge}
                    </span>
                  ) : reputation?.mannerGrade ? (
                    <span
                      className={`inline-flex border px-2 py-1 font-display text-xs font-bold tracking-widest ${GRADE_STYLES[reputation.mannerGrade]}`}
                    >
                      {t.profile.gradePrefix} {reputation.mannerGrade}
                    </span>
                  ) : (
                    <span className="text-sm text-[#555]">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.trustScore}
                </dt>
                <dd className="mt-2 font-display text-2xl font-bold text-white">
                  {reputation?.trustScore ?? profile.trust_score ?? 70}
                </dd>
              </div>
              <div>
                <dt className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.reviewCount}
                </dt>
                <dd className="mt-2 font-display text-2xl font-bold text-white">
                  {reputation?.reviewCount ?? profile.review_count ?? 0}
                </dd>
              </div>
            </dl>

            {reputation ? (
              <ReputationBadge
                reputation={reputation}
                labels={{
                  newUser: t.matchReview.newUser,
                  trustLabel: t.matchReview.trustLabel,
                  gradePrefix: t.matchReview.gradePrefix,
                  tags: t.matchReview.tags,
                }}
              />
            ) : null}

            <div className="mt-6">
              <p className="font-display text-[10px] tracking-widest text-[#555]">
                {t.profile.tagStatsTitle}
              </p>
              {tagStats.length === 0 ? (
                <p className="mt-3 text-sm text-[#888]">{t.profile.noTagStats}</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {tagStats.map((stat) => (
                    <li
                      key={`${stat.kind}-${stat.tag}`}
                      className={`border px-3 py-2 font-display text-[10px] tracking-widest ${
                        stat.kind === "positive"
                          ? "border-[#0fbcbf]/40 text-[#0fbcbf]"
                          : "border-[#ff4655]/40 text-[#ff4655]"
                      }`}
                    >
                      {(t.matchReview.tags as Record<string, string>)[stat.tag] ?? stat.tag} · {stat.count}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 페널티 기록 */}
          <div className="mt-8 border border-[#222] bg-[#0a0a0a] p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="font-display text-[10px] tracking-[0.25em] text-[#ff4655]">
                {t.profile.penaltyTitle}
              </p>
              <span className="font-display text-xs text-[#888]">
                {t.profile.penaltyCount}: {penaltyCount}
              </span>
            </div>

            {/* 현재 쿨다운 표시 */}
            {isCoolingDown && cooldownUntil ? (
              <div className="mt-3 flex items-center gap-3 border border-[#ff4655]/50 bg-[#ff4655]/10 px-4 py-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff4655]" />
                <p className="font-display text-xs tracking-widest text-[#ff4655]">
                  {t.profile.cooldownActive}:{" "}
                  {new Date(cooldownUntil).toLocaleTimeString(
                    locale === "ko" ? "ko-KR" : "en-US",
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-2 font-display text-[10px] tracking-widest text-[#0fbcbf]">
                {t.profile.cooldownLifted}
              </p>
            )}

            {penalties.length === 0 ? (
              <p className="mt-4 text-sm text-[#888]">{t.profile.noPenalties}</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {penalties.map((p) => {
                  const countAfter = p.penalty_count_after;
                  let badge: string;
                  let badgeColor: string;
                  if (countAfter >= 5) {
                    badge = t.profile.penaltyCooldown15;
                    badgeColor = "border-[#ff4655]/60 bg-[#ff4655]/10 text-[#ff4655]";
                  } else if (countAfter === 4) {
                    badge = t.profile.penaltyCooldown5;
                    badgeColor = "border-[#fbbf24]/60 bg-[#fbbf24]/10 text-[#fbbf24]";
                  } else {
                    badge = t.profile.penaltyWarning;
                    badgeColor = "border-[#888]/50 bg-[#111] text-[#aaa]";
                  }
                  const reasons = t.profile.penaltyReasons as Record<string, string>;
                  const reasonLabel = reasons[p.reason] ?? p.reason;
                  const dateStr = new Date(p.created_at).toLocaleDateString(
                    locale === "ko" ? "ko-KR" : "en-US",
                    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
                  );

                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 border border-[#1a1a1a] bg-black/40 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm text-white">{reasonLabel}</p>
                        <p className="mt-0.5 font-display text-[10px] tracking-widest text-[#555]">
                          {dateStr}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 border px-2 py-1 font-display text-[10px] tracking-widest ${badgeColor}`}
                      >
                        {badge}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {profile.riot_id && (
            <div className="mt-8 border border-[#222] bg-[#0a0a0a] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-[10px] tracking-[0.25em] text-[#ff4655]">
                    {t.profile.matchHistoryTitle}
                  </p>
                  <p className="mt-2 font-display text-[10px] tracking-widest text-[#555]">
                    {t.profile.lastSynced}:{" "}
                    {profile.last_match_sync_at
                      ? formatPlayedAt(profile.last_match_sync_at, locale)
                      : t.profile.neverSynced}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSyncMatches}
                  disabled={syncingMatches}
                  className="btn-accent shrink-0 !px-4 !py-2 text-xs disabled:opacity-50"
                >
                  {syncingMatches ? t.profile.syncingMatches : t.profile.syncMatches}
                </button>
              </div>

              {matches.length === 0 ? (
                <p className="mt-5 text-sm text-[#888]">{t.profile.noMatches}</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {matches.map((match) => (
                    <li
                      key={match.id}
                      className="border border-[#222] bg-black/40 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">
                            {match.map_name} · {match.agent_name}
                          </p>
                          <p className="mt-1 font-display text-[10px] tracking-widest text-[#555]">
                            {getQueueLabel(match.queue_id)} ·{" "}
                            {formatPlayedAt(match.played_at, locale)}
                          </p>
                        </div>
                        <span
                          className={`font-display text-[10px] tracking-widest ${
                            match.won ? "text-[#0fbcbf]" : "text-[#ff4655]"
                          }`}
                        >
                          {match.won ? t.profile.win : t.profile.loss}
                        </span>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <dt className="font-display text-[10px] tracking-widest text-[#555]">
                            {t.profile.kda}
                          </dt>
                          <dd className="mt-0.5 text-white">
                            {match.kills}/{match.deaths}/{match.assists}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-display text-[10px] tracking-widest text-[#555]">
                            {t.profile.score}
                          </dt>
                          <dd className="mt-0.5 text-white">{match.score.toLocaleString()}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="displayName"
                className="mb-2 block font-display text-[10px] tracking-widest text-[#555]"
              >
                {t.profile.displayName}
              </label>
              <input
                id="displayName"
                type="text"
                required
                maxLength={32}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-field"
              />
            </div>

            {message && (
              <p className={`text-sm ${isError ? "text-[#ff4655]" : "text-[#0fbcbf]"}`}>{message}</p>
            )}

            <button type="submit" disabled={loading} className="btn-accent w-full !py-4 disabled:opacity-50">
              {loading ? t.profile.saving : t.profile.saveButton}
            </button>
          </form>

          <Link
            href="/"
            className="mt-8 inline-block font-display text-xs tracking-widest text-[#555] hover:text-white"
          >
            ← {t.profile.backHome}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ProfileContent(props: ProfileContentProps) {
  return <ProfileContentInner {...props} />;
}
