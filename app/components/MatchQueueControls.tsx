"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useLanguage } from "../context/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import type { ActiveMatch, MatchQueueStatus, VoicePreference } from "../hooks/useMatchQueue";

type MatchQueueControlsProps = {
  status: MatchQueueStatus;
  actionLoading: boolean;
  joinQueue: () => Promise<{ ok: boolean; errorKey?: string }>;
  leaveQueue: () => Promise<{ ok: boolean; errorKey?: string }>;
  dismissMatch: (matchId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  updateConnection: (input: {
    matchId: string;
    voicePreference?: VoicePreference;
    partyCode?: string;
  }) => Promise<{ ok: boolean; errorKey?: string }>;
};

function partnerLabel(partner: ActiveMatch["partner"]): string {
  if (partner.riotId) return partner.riotId;
  if (partner.displayName) return partner.displayName;
  return "—";
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export default function MatchQueueControls({
  status,
  actionLoading,
  joinQueue,
  leaveQueue,
  dismissMatch,
  updateConnection,
}: MatchQueueControlsProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [lastErrorKey, setLastErrorKey] = useState<string | null>(null);
  const [partyCodeInput, setPartyCodeInput] = useState("");

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!window.location.search.includes("discord_linked=1")) {
      return;
    }

    async function syncDiscordAfterReturn() {
      const response = await fetch("/api/discord/sync", { method: "POST" });
      if (response.ok) {
        setMessage(t.matchQueue.discordLinked);
        setIsError(false);
      } else {
        setMessage(t.matchQueue.errors.discord_sync_failed);
        setIsError(true);
      }

      router.replace("/", { scroll: false });
    }

    void syncDiscordAfterReturn();
  }, [router, t.matchQueue.discordLinked, t.matchQueue.errors.discord_sync_failed]);

  useEffect(() => {
    if (status.activeMatch) {
      setMessage(t.matchQueue.matched);
      setIsError(false);
    }
  }, [status.activeMatch, t.matchQueue.matched]);

  async function handleStartMatching() {
    setMessage(null);
    setIsError(false);
    setLastErrorKey(null);

    if (!user) {
      router.push("/login?next=/");
      return;
    }

    const result = await joinQueue();
    if (!result.ok) {
      setIsError(true);
      const key = result.errorKey ?? "join_failed";
      setLastErrorKey(key);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[key] ?? errors.join_failed);
      return;
    }

    if (!status.activeMatch) {
      setMessage(t.matchQueue.joined);
    }
  }

  async function handleLeaveQueue() {
    setMessage(null);
    setIsError(false);
    setLastErrorKey(null);

    const result = await leaveQueue();
    if (!result.ok) {
      setIsError(true);
      const key = result.errorKey ?? "leave_failed";
      setLastErrorKey(key);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[key] ?? errors.leave_failed);
      return;
    }

    setMessage(t.matchQueue.left);
  }

  async function handleDismissMatch() {
    if (!status.activeMatch) return;

    setMessage(null);
    setIsError(false);

    const result = await dismissMatch(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "dismiss_failed"] ?? errors.dismiss_failed);
      return;
    }

    setMessage(t.matchQueue.dismissed);
  }

  async function handleVoiceSelect(voicePreference: VoicePreference) {
    const activeMatch = status.activeMatch;
    if (!activeMatch) return;

    const result = await updateConnection({
      matchId: activeMatch.id,
      voicePreference,
    });

    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "connection_failed"] ?? errors.connection_failed);
      return;
    }

    setIsError(false);
    setMessage(t.matchQueue.voiceSaved);
  }

  async function handleSharePartyCode() {
    const activeMatch = status.activeMatch;
    if (!activeMatch) return;

    const result = await updateConnection({
      matchId: activeMatch.id,
      partyCode: partyCodeInput,
    });

    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "connection_failed"] ?? errors.connection_failed);
      return;
    }

    setPartyCodeInput("");
    setIsError(false);
    setMessage(t.matchQueue.partyCodeShared);
  }

  async function handleCopy(value: string) {
    const ok = await copyText(value);
    setIsError(!ok);
    setMessage(ok ? t.matchQueue.copied : t.matchQueue.errors.copy_failed);
  }

  const activeMatch = status.activeMatch;
  const myVoice = activeMatch?.myVoicePreference ?? null;
  const partnerVoice = activeMatch?.partnerVoicePreference ?? null;
  const discordAuthorizeHref = `/api/discord/authorize?next=${encodeURIComponent(
    "/?discord_linked=1",
  )}`;
  const partnerChoseNoVoice = partnerVoice === "none" && myVoice !== null && myVoice !== "none";
  const iChoseNoVoice = myVoice === "none" && partnerVoice !== null && partnerVoice !== "none";
  const bothChoseNoVoice = myVoice === "none" && partnerVoice === "none";
  const useValorantTools = myVoice === "valorant" || bothChoseNoVoice;
  const useDiscordTools = myVoice === "discord";
  const partyInviteLink = activeMatch?.partyCode
    ? `valorant://party/invite/${activeMatch.partyCode}`
    : null;

  return (
    <div className="space-y-4">
      {activeMatch ? (
        <div className="space-y-5 border border-[#0fbcbf]/30 bg-[#0fbcbf]/5 p-6">
          <p className="font-display text-xs tracking-[0.25em] text-[#0fbcbf]">
            {t.matchQueue.matchFound}
          </p>

          <div className="space-y-2">
            <p className="font-display text-2xl font-bold text-white">
              {partnerLabel(activeMatch.partner)}
            </p>
            <p className="font-display text-[10px] tracking-widest text-[#888]">
              {t.matchQueue.connectionIntro}
            </p>
          </div>

          <div className="space-y-3">
            <p className="font-display text-xs tracking-[0.2em] text-white">
              {t.matchQueue.voiceQuestion}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["valorant", "discord", "none"] as const).map((voice) => (
                <button
                  key={voice}
                  type="button"
                  onClick={() => handleVoiceSelect(voice)}
                  disabled={actionLoading}
                  className={`border px-4 py-3 font-display text-[10px] tracking-widest transition-colors disabled:opacity-50 ${
                    myVoice === voice
                      ? "border-[#ff4655] bg-[#ff4655]/10 text-white"
                      : "border-[#333] bg-[#0a0a0a] text-[#888] hover:border-[#555] hover:text-white"
                  }`}
                >
                  {t.matchQueue.voiceOptions[voice]}
                </button>
              ))}
            </div>
            {myVoice && (
              <p className="font-display text-[10px] tracking-widest text-[#888]">
                {t.matchQueue.partnerVoiceLabel}:{" "}
                {partnerVoice ? t.matchQueue.voiceOptions[partnerVoice] : t.matchQueue.waiting}
              </p>
            )}
          </div>

          {partnerChoseNoVoice && (
            <div className="space-y-3 border border-[#ff4655]/40 bg-[#ff4655]/5 p-4">
              <p className="text-sm text-[#ff4655]">{t.matchQueue.partnerNoVoiceCancelPrompt}</p>
              <button
                type="button"
                onClick={handleDismissMatch}
                disabled={actionLoading}
                className="btn-outline !py-3 disabled:opacity-50"
              >
                {actionLoading ? t.matchQueue.dismissing : t.matchQueue.dismiss}
              </button>
            </div>
          )}

          {iChoseNoVoice && (
            <div className="flex items-center gap-3 border border-[#888]/40 bg-[#888]/5 px-4 py-3">
              <span className="online-dot" />
              <p className="font-display text-xs tracking-widest text-[#888]">
                {t.matchQueue.waitingPartnerDecision}
              </p>
            </div>
          )}

          {useValorantTools && !partnerChoseNoVoice && (
            <div className="space-y-4 border border-[#222] bg-black/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display text-[10px] tracking-widest text-[#555]">
                    {t.matchQueue.partnerRiotId}
                  </p>
                  <p className="font-display text-sm font-bold text-white">
                    {partnerLabel(activeMatch.partner)}
                  </p>
                </div>
                {activeMatch.partner.riotId && (
                  <button
                    type="button"
                    onClick={() => handleCopy(activeMatch.partner.riotId ?? "")}
                    className="btn-outline !py-3"
                  >
                    {t.matchQueue.copyRiotId}
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={partyCodeInput}
                  onChange={(event) => setPartyCodeInput(event.target.value)}
                  placeholder={t.matchQueue.partyCodePlaceholder}
                  className="border border-[#333] bg-[#0a0a0a] px-4 py-3 font-mono text-sm text-white outline-none transition-colors placeholder:text-[#555] focus:border-[#ff4655]"
                />
                <button
                  type="button"
                  onClick={handleSharePartyCode}
                  disabled={actionLoading || !partyCodeInput.trim()}
                  className="btn-accent !py-3 disabled:opacity-50"
                >
                  {t.matchQueue.sharePartyCode}
                </button>
              </div>

              {activeMatch.partyCode && (
                <div className="space-y-3 border border-[#0fbcbf]/30 bg-[#0fbcbf]/5 p-4">
                  <p className="font-display text-[10px] tracking-widest text-[#555]">
                    {activeMatch.partyCodeByMe
                      ? t.matchQueue.myPartyCode
                      : t.matchQueue.partnerPartyCode}
                  </p>
                  <p className="font-mono text-xl font-bold text-[#0fbcbf]">
                    {activeMatch.partyCode}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => handleCopy(activeMatch.partyCode ?? "")}
                      className="btn-outline !py-3"
                    >
                      {t.matchQueue.copyPartyCode}
                    </button>
                    {partyInviteLink && (
                      <a href={partyInviteLink} className="btn-accent !py-3">
                        {t.matchQueue.openValorant}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {useDiscordTools && !partnerChoseNoVoice && (
            <div className="space-y-4 border border-[#5865F2]/40 bg-[#5865F2]/10 p-4">
              {!activeMatch.me.discordId ? (
                <div className="space-y-3">
                  <p className="text-sm text-[#c9d1ff]">{t.matchQueue.discordLinkNeeded}</p>
                  <a href={discordAuthorizeHref} className="btn-accent !py-3">
                    {t.matchQueue.linkDiscordNow}
                  </a>
                </div>
              ) : (
                <p className="font-display text-[10px] tracking-widest text-[#888]">
                  {t.matchQueue.myDiscordReady}: {activeMatch.me.discordUsername}
                </p>
              )}

              {activeMatch.partner.discordId ? (
                <div className="space-y-3">
                  <p className="font-display text-sm font-bold text-white">
                    {activeMatch.partner.discordUsername}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <a
                      href={`https://discord.com/users/${activeMatch.partner.discordId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-accent !py-3"
                    >
                      {t.matchQueue.openDiscordProfile}
                    </a>
                    {activeMatch.partner.discordUsername && (
                      <button
                        type="button"
                        onClick={() => handleCopy(activeMatch.partner.discordUsername ?? "")}
                        className="btn-outline !py-3"
                      >
                        {t.matchQueue.copyDiscord}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#888]">{t.matchQueue.partnerDiscordMissing}</p>
              )}
            </div>
          )}

          {!myVoice && (
            <p className="text-sm text-[#888]">{t.matchQueue.chooseVoiceHint}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          {status.inQueue ? (
            <button
              type="button"
              onClick={handleLeaveQueue}
              disabled={actionLoading}
              className="btn-outline disabled:opacity-50"
            >
              {actionLoading ? t.matchQueue.leaving : t.matchQueue.cancel}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartMatching}
              disabled={!authReady || actionLoading}
              className="btn-accent disabled:opacity-50"
            >
              {actionLoading ? t.matchQueue.joining : t.hero.startMatching}
              {!actionLoading && (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </button>
          )}
          <a href="#dashboard" className="btn-outline">
            {t.hero.viewDashboard}
          </a>
        </div>
      )}

      {status.inQueue && !activeMatch && (
        <div className="flex items-center gap-3 border border-[#ff4655]/30 bg-[#ff4655]/5 px-4 py-3">
          <span className="online-dot" />
          <p className="font-display text-xs tracking-widest text-[#ff4655]">
            {t.matchQueue.searching}
          </p>
        </div>
      )}

      {!user && authReady && !activeMatch && (
        <p className="font-display text-[10px] tracking-widest text-[#555]">
          {t.matchQueue.loginHint}{" "}
          <Link href="/login" className="text-[#888] underline hover:text-white">
            {t.nav.login}
          </Link>
        </p>
      )}

      {message && (
        <p className={`text-sm ${isError ? "text-[#ff4655]" : "text-[#0fbcbf]"}`}>{message}</p>
      )}

      {lastErrorKey === "riot_required" && (
        <Link
          href="/profile"
          className="font-display text-xs tracking-widest text-[#888] underline hover:text-white"
        >
          {t.matchQueue.goProfile}
        </Link>
      )}
    </div>
  );
}
