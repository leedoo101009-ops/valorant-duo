"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useLanguage } from "../context/LanguageContext";
import { getQueueLabel } from "@/lib/riot/agents";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/profile";
import type { ValorantMatch } from "@/lib/supabase/valorant";

type ProfileContentProps = {
  profile: Profile;
  initialMatches: ValorantMatch[];
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
}: ProfileContentProps) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [matches, setMatches] = useState(initialMatches);
  const [displayName, setDisplayName] = useState(initialProfile.display_name ?? "");
  const [riotIdInput, setRiotIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkingRiot, setLinkingRiot] = useState(false);
  const [syncingMatches, setSyncingMatches] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    setProfile(initialProfile);
    setMatches(initialMatches);
    setDisplayName(initialProfile.display_name ?? "");
  }, [initialProfile, initialMatches]);

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

    const data = (await response.json()) as { ok?: boolean; message?: string; riot_id?: string };

    if (!response.ok || !data.ok) {
      setIsError(true);
      setMessage(data.message ?? "Failed to link Riot account");
      setLinkingRiot(false);
      return;
    }

    setProfile((prev) => ({ ...prev, riot_id: data.riot_id ?? prev.riot_id }));
    setRiotIdInput("");
    setMessage(t.profile.linkRiotSuccess);
    setLinkingRiot(false);
    router.refresh();
  }

  async function handleSyncMatches() {
    if (!profile.riot_id) {
      setIsError(true);
      setMessage(t.profile.syncNeedRiot);
      return;
    }

    setSyncingMatches(true);
    setMessage(null);
    setIsError(false);

    const response = await fetch("/api/valorant/sync", { method: "POST" });
    const data = (await response.json()) as {
      ok?: boolean;
      message?: string;
      errorKey?: string;
      inserted?: number;
      fetched?: number;
      total?: number;
    };

    if (!response.ok || !data.ok) {
      setIsError(true);
      const errors = t.profile.matchErrors as Record<string, string>;
      const key = data.errorKey ?? data.message;
      setMessage((key && errors[key]) || data.message || "Failed to sync matches");
      setSyncingMatches(false);
      return;
    }

    if (data.total === 0) {
      setMessage(t.profile.syncEmpty);
    } else {
      setMessage(t.profile.syncSuccess);
    }

    setSyncingMatches(false);
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
                <dd className="mt-1 text-sm text-white">
                  {profile.riot_id ?? (
                    <span className="text-[#555]">{t.profile.notConnected}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.profile.discordAccount}
                </dt>
                <dd className="mt-1 text-sm text-white">
                  {profile.discord_username ?? (
                    <span className="text-[#555]">{t.profile.notConnected}</span>
                  )}
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
