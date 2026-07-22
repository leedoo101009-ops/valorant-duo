"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import MatchInGamePanel from "./MatchInGamePanel";
import MatchGuidelinesModal from "./MatchGuidelinesModal";
import MatchReviewModal from "./MatchReviewModal";
import ReputationBadge from "./ReputationBadge";
import {
  hasSeenMatchGuidelines,
  markMatchGuidelinesSeen,
  shouldShowMatchGuidelines,
} from "@/lib/match/guidelinesStorage";
import { startDiscordLink } from "@/lib/discord/startDiscordLink";
import type {
  ActiveMatch,
  MatchQueueStatus,
  PendingAction,
  VoicePreference,
} from "../hooks/useMatchQueue";

type MatchQueueControlsProps = {
  status: MatchQueueStatus;
  actionLoading: boolean;
  pendingAction?: PendingAction;
  joinQueue: () => Promise<{ ok: boolean; errorKey?: string; cooldownUntil?: string }>;
  leaveQueue: () => Promise<{ ok: boolean; errorKey?: string }>;
  dismissMatch: (matchId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  cancelSetup: (matchId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  markSetupReady: (matchId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  updateConnection: (input: {
    matchId: string;
    voicePreference?: VoicePreference;
    partyCode?: string;
  }) => Promise<{ ok: boolean; errorKey?: string }>;
  submitReview: (input: {
    matchId: string;
    positiveTags: string[];
    negativeTags: string[];
  }) => Promise<{ ok: boolean; errorKey?: string }>;
  acceptPartnerNoVoice: (matchId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  // No Voice 거절 전용 — 페널티 없음 (일반 dismiss와 다름)
  declinePartnerNoVoice: (matchId: string) => Promise<{ ok: boolean; errorKey?: string }>;
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

function dismissNoticeMessage(
  notice: { reason: string },
  messages: {
    partnerTimeout: string;
    matchTimeout: string;
    partnerLeft: string;
    matchCancelledOffline: string;
    setupTimeout: string;
    partnerSetupCancelled: string;
  },
): string {
  switch (notice.reason) {
    case "partner_timeout":
      return messages.partnerTimeout;
    case "match_timeout":
      return messages.matchTimeout;
    case "partner_left":
      return messages.partnerLeft;
    case "match_cancelled_offline":
      return messages.matchCancelledOffline;
    case "setup_timeout":
      return messages.setupTimeout;
    case "partner_setup_cancelled":
      return messages.partnerSetupCancelled;
    default:
      return messages.matchTimeout;
  }
}

function voiceChoiceStyle(voice: VoicePreference | null): string {
  if (voice === "valorant") return "border-[#0fbcbf]/50 bg-[#0fbcbf]/10 text-[#0fbcbf]";
  if (voice === "discord") return "border-[#5865F2]/50 bg-[#5865F2]/10 text-[#c9d1ff]";
  if (voice === "none") return "border-[#888]/50 bg-[#888]/10 text-[#aaa]";
  return "border-[#333] bg-black/40 text-[#555]";
}

function voiceChoiceLabel(
  voice: VoicePreference | null,
  options: Record<"valorant" | "discord" | "none", string>,
  waiting: string,
): string {
  if (!voice) return waiting;
  return options[voice];
}

export default function MatchQueueControls({
  status,
  actionLoading,
  pendingAction = null,
  joinQueue,
  leaveQueue,
  dismissMatch,
  cancelSetup,
  markSetupReady,
  updateConnection,
  submitReview,
  acceptPartnerNoVoice,
  declinePartnerNoVoice,
}: MatchQueueControlsProps) {
  // 해당 액션만 로딩 — 다른 버튼까지 전부 잠그지 않음
  const busy = (action: NonNullable<PendingAction>) => pendingAction === action;
  const { t } = useLanguage();
  const router = useRouter();
  const { user, authReady } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [lastErrorKey, setLastErrorKey] = useState<string | null>(null);
  const [partyCodeInput, setPartyCodeInput] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [showGuidelinesModal, setShowGuidelinesModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [discordRedirecting, setDiscordRedirecting] = useState(false);

  useEffect(() => {
    if (status.pendingReview) {
      setShowReviewModal(true);
    }
  }, [status.pendingReview]);

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

  // 무응답 자동 취소 알림 — 같은 matchId는 세션당 한 번만 표시
  useEffect(() => {
    const notice = status.dismissNotice;
    if (!notice || status.activeMatch) {
      return;
    }

    const storageKey = `match-dismiss-notice-${notice.matchId}`;
    if (sessionStorage.getItem(storageKey)) {
      return;
    }

    sessionStorage.setItem(storageKey, "1");
    setMessage(
      dismissNoticeMessage(notice, {
        partnerTimeout: t.matchQueue.partnerTimeout,
        matchTimeout: t.matchQueue.matchTimeout,
        partnerLeft: t.matchQueue.partnerLeft,
        matchCancelledOffline: t.matchQueue.matchCancelledOffline,
        setupTimeout: t.matchQueue.setupTimeout,
        partnerSetupCancelled: t.matchQueue.partnerSetupCancelled,
      }),
    );
    setIsError(true);
  }, [
    status.dismissNotice,
    status.activeMatch,
    t.matchQueue.matchTimeout,
    t.matchQueue.matchCancelledOffline,
    t.matchQueue.partnerLeft,
    t.matchQueue.partnerSetupCancelled,
    t.matchQueue.partnerTimeout,
    t.matchQueue.setupTimeout,
  ]);

  const activeMatch = status.activeMatch;
  const myVoice = activeMatch?.myVoicePreference ?? null;
  const partnerVoice = activeMatch?.partnerVoicePreference ?? null;
  const voiceSelectionIncomplete = Boolean(activeMatch && (!myVoice || !partnerVoice));
  const voiceDeadline = activeMatch?.phase === "connecting" ? activeMatch.expiresAt : null;
  const setupDeadline = activeMatch?.phase === "setup" ? activeMatch.setupExpiresAt : null;
  const showVoiceCountdown = Boolean(voiceDeadline && voiceSelectionIncomplete);
  const showSetupCountdown = Boolean(setupDeadline);
  const voiceSecondsLeft = voiceDeadline
    ? Math.max(0, Math.ceil((new Date(voiceDeadline).getTime() - now) / 1000))
    : null;
  const setupSecondsLeft = setupDeadline
    ? Math.max(0, Math.ceil((new Date(setupDeadline).getTime() - now) / 1000))
    : null;

  useEffect(() => {
    if (!showVoiceCountdown && !showSetupCountdown) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [showVoiceCountdown, showSetupCountdown, voiceDeadline, setupDeadline, activeMatch?.id]);

  async function proceedJoinQueue() {
    setShowGuidelinesModal(false);
    setIsError(false);
    setMessage(t.matchQueue.joining); // 클릭 즉시 피드백

    const result = await joinQueue();

    if (!result.ok) {
      setIsError(true);
      const key = result.errorKey ?? "join_failed";
      setLastErrorKey(key);

      if (key === "match_cooldown_active" && result.cooldownUntil) {
        const until = new Date(result.cooldownUntil).toLocaleTimeString();
        const errors = t.matchQueue.errors as Record<string, string>;
        const base = errors["match_cooldown_active"] ?? "큐 이용 제한 중입니다.";
        setMessage(`${base} (${until}까지)`);
      } else {
        const errors = t.matchQueue.errors as Record<string, string>;
        setMessage(errors[key] ?? errors.join_failed);
      }
      return;
    }

    setMessage(t.matchQueue.joined);
  }

  async function handleStartMatching() {
    setMessage(null);
    setIsError(false);
    setLastErrorKey(null);

    if (!user) {
      router.push("/login?next=/");
      return;
    }

    if (shouldShowMatchGuidelines(user.id)) {
      setShowGuidelinesModal(true);
      return;
    }

    await proceedJoinQueue();
  }

  async function handleGuidelinesConfirm(hideForOneWeek: boolean) {
    if (!user) {
      return;
    }

    markMatchGuidelinesSeen(user.id, hideForOneWeek);
    setShowGuidelinesModal(false);
    await proceedJoinQueue();
  }

  async function handleLeaveQueue() {
    setIsError(false);
    setLastErrorKey(null);
    setMessage(t.matchQueue.left);

    const result = await leaveQueue();
    if (!result.ok) {
      setIsError(true);
      const key = result.errorKey ?? "leave_failed";
      setLastErrorKey(key);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[key] ?? errors.leave_failed);
    }
  }

  async function handleDismissMatch() {
    if (!status.activeMatch) return;

    setIsError(false);
    setMessage(t.matchQueue.dismissed);

    const result = await dismissMatch(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "dismiss_failed"] ?? errors.dismiss_failed);
    }
  }

  // 「상대가 No Voice → 매칭 취소」버튼 전용 (페널티 없음)
  async function handleDeclinePartnerNoVoice() {
    if (!status.activeMatch) return;

    setIsError(false);
    setMessage(t.matchQueue.dismissed);

    const result = await declinePartnerNoVoice(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "decline_failed"] ?? errors.decline_failed);
    }
  }

  async function handleVoiceSelect(voicePreference: VoicePreference) {
    const activeMatch = status.activeMatch;
    if (!activeMatch) return;

    // 화면은 hook에서 즉시 반영 — 성공 메시지도 바로
    setIsError(false);
    setMessage(t.matchQueue.voiceSaved);

    const result = await updateConnection({
      matchId: activeMatch.id,
      voicePreference,
    });

    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "connection_failed"] ?? errors.connection_failed);
    }
  }

  async function handleSharePartyCode() {
    const activeMatch = status.activeMatch;
    if (!activeMatch) return;

    const code = partyCodeInput.trim();
    setPartyCodeInput("");
    setIsError(false);
    setMessage(t.matchQueue.partyCodeShared);

    const result = await updateConnection({
      matchId: activeMatch.id,
      partyCode: code,
    });

    if (!result.ok) {
      setPartyCodeInput(code);
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "connection_failed"] ?? errors.connection_failed);
    }
  }

  async function handleSetupComplete() {
    if (!status.activeMatch) return;

    setIsError(false);
    setMessage(t.matchQueue.setupReadySaved);

    const result = await markSetupReady(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "setup_ready_failed"] ?? errors.setup_ready_failed);
    }
  }

  async function handleSetupCancel() {
    if (!status.activeMatch) return;

    setIsError(false);
    setMessage(t.matchQueue.setupCancelled);

    const result = await cancelSetup(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "setup_cancel_failed"] ?? errors.setup_cancel_failed);
    }
  }

  async function handleEndInGameSession() {
    if (!status.activeMatch) return;

    setIsError(false);
    setMessage(t.matchQueue.dismissed);

    const result = await dismissMatch(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "dismiss_failed"] ?? errors.dismiss_failed);
    }
  }

  async function handleAcceptPartnerNoVoice() {
    if (!status.activeMatch) return;

    setMessage(t.matchQueue.acceptNoVoiceSuccess);
    setIsError(false);

    const result = await acceptPartnerNoVoice(status.activeMatch.id);
    if (!result.ok) {
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors[result.errorKey ?? "accept_failed"] ?? errors.accept_failed);
    }
  }

  async function handleCopy(value: string) {
    const ok = await copyText(value);
    setIsError(!ok);
    setMessage(ok ? t.matchQueue.copied : t.matchQueue.errors.copy_failed);
  }

  async function handleLinkDiscord() {
    setDiscordRedirecting(true);
    setMessage(null);
    setIsError(false);

    const result = await startDiscordLink("/?discord_linked=1");
    if (!result.ok && result.errorKey !== "login_required") {
      setDiscordRedirecting(false);
      setIsError(true);
      const errors = t.matchQueue.errors as Record<string, string>;
      setMessage(errors.discord_authorize_failed ?? t.matchQueue.discordLinkNeeded);
    }
  }

  const partnerChoseNoVoice = partnerVoice === "none" && myVoice !== null && myVoice !== "none";
  const iChoseNoVoice = myVoice === "none" && partnerVoice !== null && partnerVoice !== "none";
  const bothChoseNoVoice = myVoice === "none" && partnerVoice === "none";
  const myAcceptedPartnerNoVoice = activeMatch?.myAcceptedPartnerNoVoice ?? false;
  const partnerAcceptedNoVoice = activeMatch?.partnerAcceptedNoVoice ?? false;
  const partnerNoVoicePending = partnerChoseNoVoice && !myAcceptedPartnerNoVoice;
  const useValorantTools =
    myVoice === "valorant" ||
    bothChoseNoVoice ||
    (partnerChoseNoVoice && myAcceptedPartnerNoVoice);
  const showSetupActions =
    Boolean(myVoice) &&
    (!partnerChoseNoVoice || myAcceptedPartnerNoVoice) &&
    (!iChoseNoVoice || partnerAcceptedNoVoice);
  const useDiscordTools = myVoice === "discord";
  const partyInviteLink = activeMatch?.partyCode
    ? `valorant://party/invite/${activeMatch.partyCode}`
    : null;

  return (
    <div className="space-y-4">
      <MatchGuidelinesModal
        open={showGuidelinesModal}
        isFirstTime={user ? !hasSeenMatchGuidelines(user.id) : true}
        loading={busy("join")}
        labels={{
          title: t.matchQueue.guidelines.title,
          intro: t.matchQueue.guidelines.intro,
          items: [
            t.matchQueue.guidelines.discordTip,
            t.matchQueue.guidelines.penaltyTip,
            t.matchQueue.guidelines.completeTip,
          ],
          dontShowAgain: t.matchQueue.guidelines.dontShowAgain,
          confirm: t.matchQueue.guidelines.confirm,
          confirming: t.matchQueue.joining,
          close: t.matchQueue.guidelines.close,
        }}
        onConfirm={handleGuidelinesConfirm}
        onClose={() => setShowGuidelinesModal(false)}
      />

      <MatchReviewModal
        open={showReviewModal}
        pendingReview={status.pendingReview}
        loading={busy("review")}
        labels={{
          title: t.matchReview.title,
          subtitle: t.matchReview.subtitle,
          positiveSection: t.matchReview.positiveSection,
          negativeSection: t.matchReview.negativeSection,
          submit: t.matchReview.submit,
          submitting: t.matchReview.submitting,
          skip: t.matchReview.skip,
          tags: t.matchReview.tags,
          errors: t.matchReview.errors,
          submitted: t.matchReview.submitted,
        }}
        onSubmit={submitReview}
        onClose={() => setShowReviewModal(false)}
      />

      {activeMatch?.phase === "in_game" ? (
        <MatchInGamePanel
          activeMatch={activeMatch}
          actionLoading={busy("dismiss")}
          onEndSession={handleEndInGameSession}
          labels={{
            inGameTitle: t.matchQueue.inGameTitle,
            connectingPlayers: t.matchQueue.connectingPlayers,
            inGameStatus: t.matchQueue.inGameStatus,
            voiceLabel: t.matchQueue.voiceLabel,
            riotIdLabel: t.matchQueue.partnerRiotId,
            partyCodeLabel: t.matchQueue.partnerPartyCode,
            connected: t.matchQueue.playerConnected,
            playerMe: t.matchQueue.playerMe,
            playerPartner: t.matchQueue.playerPartner,
            waitingPartnerReady: t.matchQueue.waitingPartnerReadyComplete,
            endSession: t.matchQueue.endSession,
            ending: t.matchQueue.dismissing,
            voiceOptions: t.matchQueue.voiceOptions,
            reputation: {
              newUser: t.matchReview.newUser,
              trustLabel: t.matchReview.trustLabel,
              gradePrefix: t.matchReview.gradePrefix,
              tags: t.matchReview.tags,
            },
          }}
        />
      ) : activeMatch ? (
        <div className="space-y-5 border border-[#0fbcbf]/30 bg-[#0fbcbf]/5 p-6">
          <p className="font-display text-xs tracking-[0.25em] text-[#0fbcbf]">
            {t.matchQueue.matchFound}
          </p>

          <div className="space-y-2">
            <p className="font-display text-2xl font-bold text-white">
              {partnerLabel(activeMatch.partner)}
            </p>
            <ReputationBadge
              reputation={activeMatch.partner.reputation}
              labels={{
                newUser: t.matchReview.newUser,
                trustLabel: t.matchReview.trustLabel,
                gradePrefix: t.matchReview.gradePrefix,
                tags: t.matchReview.tags,
              }}
            />
            <p className="font-display text-[10px] tracking-widest text-[#888]">
              {t.matchQueue.connectionIntro}
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-display text-[10px] tracking-widest text-[#555]">
              {t.matchQueue.voiceChoicesTitle}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-[#333] bg-black/40 px-4 py-3">
                <p className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.matchQueue.myVoiceLabel}
                </p>
                <p className="mt-1 font-display text-xs tracking-widest text-[#888]">
                  {activeMatch.me.riotId ?? activeMatch.me.displayName ?? t.matchQueue.you}
                </p>
                <p
                  className={`mt-2 inline-block border px-2 py-1 font-display text-[10px] tracking-widest ${voiceChoiceStyle(myVoice)}`}
                >
                  {voiceChoiceLabel(myVoice, t.matchQueue.voiceOptions, t.matchQueue.waiting)}
                </p>
              </div>
              <div className="border border-[#333] bg-black/40 px-4 py-3">
                <p className="font-display text-[10px] tracking-widest text-[#555]">
                  {t.matchQueue.partnerVoiceLabel}
                </p>
                <p className="mt-1 font-display text-xs tracking-widest text-white">
                  {partnerLabel(activeMatch.partner)}
                </p>
                <p
                  className={`mt-2 inline-block border px-2 py-1 font-display text-[10px] tracking-widest ${voiceChoiceStyle(partnerVoice)}`}
                >
                  {voiceChoiceLabel(
                    partnerVoice,
                    t.matchQueue.voiceOptions,
                    t.matchQueue.waiting,
                  )}
                </p>
              </div>
            </div>
          </div>

          {showVoiceCountdown && voiceSecondsLeft !== null && (
            <div className="flex items-center gap-3 border border-[#ff4655]/50 bg-[#ff4655]/10 px-4 py-3">
              <span className="online-dot shrink-0" />
              <p className="font-display text-xs tracking-widest text-[#ff4655]">
                {voiceSecondsLeft > 0
                  ? t.matchQueue.responseTimeoutHint.replace("{seconds}", String(voiceSecondsLeft))
                  : t.matchQueue.responseTimeoutSoon}
              </p>
            </div>
          )}

          {showSetupCountdown && setupSecondsLeft !== null && (
            <div className="flex items-center gap-3 border border-[#ff4655]/50 bg-[#ff4655]/10 px-4 py-3">
              <span className="online-dot shrink-0" />
              <p className="font-display text-xs tracking-widest text-[#ff4655]">
                {setupSecondsLeft > 0
                  ? t.matchQueue.setupTimeoutHint.replace("{seconds}", String(setupSecondsLeft))
                  : t.matchQueue.setupTimeoutSoon}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <p className="font-display text-xs tracking-[0.2em] text-white">
              {t.matchQueue.voiceQuestion}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["valorant", "discord", "none"] as const).map((voice) => (
                <button
                  key={voice}
                  type="button"
                  onClick={() => void handleVoiceSelect(voice)}
                  disabled={busy("connection")}
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
          </div>

          {partnerNoVoicePending && (
            <div className="space-y-3 border border-[#ff4655]/40 bg-[#ff4655]/5 p-4">
              <p className="text-sm text-[#ff4655]">{t.matchQueue.partnerNoVoiceCancelPrompt}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleAcceptPartnerNoVoice()}
                  disabled={busy("acceptNoVoice") || busy("declineNoVoice")}
                  className="btn-accent !py-3 disabled:opacity-50"
                >
                  {busy("acceptNoVoice")
                    ? t.matchQueue.acceptingNoVoice
                    : t.matchQueue.acceptNoVoice}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeclinePartnerNoVoice()}
                  disabled={busy("acceptNoVoice") || busy("declineNoVoice")}
                  className="btn-outline !py-3 disabled:opacity-50"
                >
                  {busy("declineNoVoice")
                    ? t.matchQueue.dismissing
                    : t.matchQueue.dismissNoVoiceMatch}
                </button>
              </div>
            </div>
          )}

          {iChoseNoVoice && !partnerAcceptedNoVoice && (
            <div className="flex items-center gap-3 border border-[#888]/40 bg-[#888]/5 px-4 py-3">
              <span className="online-dot" />
              <p className="font-display text-xs tracking-widest text-[#888]">
                {t.matchQueue.waitingPartnerDecision}
              </p>
            </div>
          )}

          {useValorantTools && !partnerNoVoicePending && (
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
                  disabled={busy("connection") || !partyCodeInput.trim()}
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

          {useDiscordTools && !partnerNoVoicePending && (
            <div className="space-y-4 border border-[#5865F2]/40 bg-[#5865F2]/10 p-4">
              {!activeMatch.me.discordId ? (
                <div className="space-y-3">
                  <p className="text-sm text-[#c9d1ff]">{t.matchQueue.discordLinkNeeded}</p>
                  <button
                    type="button"
                    onClick={() => void handleLinkDiscord()}
                    disabled={discordRedirecting}
                    className="btn-accent !py-3 disabled:opacity-50"
                  >
                    {discordRedirecting
                      ? t.matchQueue.discordRedirecting
                      : t.matchQueue.linkDiscordNow}
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-display text-[10px] tracking-widest text-[#888]">
                    {t.matchQueue.myDiscordReady}: {activeMatch.me.discordUsername}
                  </p>

                  {/*
                    예전 버그: 상대가 Valorant 등 다른 마이크를 고르면 API가
                    discordId를 숨기는데, UI가 그걸 "미연동"으로 착각했음.
                    → 미연동 문구는 상대가 discord를 골랐고, 실제로 연동 안 됐을 때만.
                  */}
                  {activeMatch.partnerVoicePreference === "discord" &&
                  activeMatch.partner.discordId ? (
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
                            onClick={() =>
                              handleCopy(activeMatch.partner.discordUsername ?? "")
                            }
                            className="btn-outline !py-3"
                          >
                            {t.matchQueue.copyDiscord}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : activeMatch.partnerVoicePreference === "discord" &&
                    activeMatch.partner.discordLinked === false ? (
                    <p className="text-sm text-[#888]">{t.matchQueue.partnerDiscordMissing}</p>
                  ) : null}
                </>
              )}
            </div>
          )}

          {!myVoice && (
            <p className="text-sm text-[#888]">{t.matchQueue.chooseVoiceHint}</p>
          )}

          {showSetupActions && (
            <div className="space-y-3 border border-[#333] bg-black/40 p-4">
              <p className="font-display text-[10px] tracking-widest text-[#555]">
                {t.matchQueue.setupActionsIntro}
              </p>
              {activeMatch.mySetupReady && !activeMatch.partnerSetupReady && (
                <p className="font-display text-xs tracking-widest text-[#0fbcbf]">
                  {t.matchQueue.waitingPartnerComplete}
                </p>
              )}
              {activeMatch.partnerSetupReady && !activeMatch.mySetupReady && (
                <p className="font-display text-xs tracking-widest text-[#0fbcbf]">
                  {t.matchQueue.partnerCompletedSetup}
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleSetupComplete()}
                  disabled={
                    busy("setupReady") ||
                    busy("cancelSetup") ||
                    activeMatch.phase !== "setup" ||
                    activeMatch.mySetupReady
                  }
                  className="btn-accent !py-3 disabled:opacity-50"
                >
                  {busy("setupReady")
                    ? t.matchQueue.completingSetup
                    : t.matchQueue.completeSetup}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSetupCancel()}
                  disabled={busy("setupReady") || busy("cancelSetup")}
                  className="btn-outline !py-3 disabled:opacity-50"
                >
                  {busy("cancelSetup")
                    ? t.matchQueue.cancellingSetup
                    : t.matchQueue.cancelSetup}
                </button>
              </div>
              {activeMatch.phase !== "setup" && (
                <p className="text-xs text-[#888]">{t.matchQueue.waitingPartnerVoiceForSetup}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          {status.inQueue ? (
            <button
              type="button"
              onClick={() => void handleLeaveQueue()}
              disabled={busy("leave")}
              className="btn-outline disabled:opacity-50"
            >
              {busy("leave") ? t.matchQueue.leaving : t.matchQueue.cancel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStartMatching()}
              disabled={!authReady || busy("join")}
              className="btn-accent disabled:opacity-50"
            >
              {busy("join") ? t.matchQueue.joining : t.hero.startMatching}
              {!busy("join") && (
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
