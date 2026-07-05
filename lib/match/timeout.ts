import type { VoicePreference } from "@/app/hooks/useMatchQueue";

export type DismissNoticeReason =
  | "partner_timeout"
  | "match_timeout"
  | "partner_left"
  | "match_cancelled_offline"
  | "setup_timeout"
  | "partner_setup_cancelled";

type MatchRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_voice_preference: VoicePreference | null;
  user_b_voice_preference: VoicePreference | null;
  cancel_reason: string | null;
  offline_user_id: string | null;
  cancelled_by_user_id: string | null;
  updated_at: string;
};

export function getDismissNoticeForUser(
  match: MatchRow,
  userId: string,
): { matchId: string; reason: DismissNoticeReason } | null {
  if (match.cancel_reason === "voice_response_timeout") {
    const isUserA = match.user_a_id === userId;
    const myVoice = isUserA ? match.user_a_voice_preference : match.user_b_voice_preference;
    const partnerVoice = isUserA
      ? match.user_b_voice_preference
      : match.user_a_voice_preference;

    if (myVoice && !partnerVoice) {
      return { matchId: match.id, reason: "partner_timeout" };
    }

    return { matchId: match.id, reason: "match_timeout" };
  }

  if (match.cancel_reason === "partner_offline") {
    if (match.offline_user_id === userId || match.offline_user_id === null) {
      return { matchId: match.id, reason: "match_cancelled_offline" };
    }

    return { matchId: match.id, reason: "partner_left" };
  }

  if (match.cancel_reason === "setup_timeout") {
    return { matchId: match.id, reason: "setup_timeout" };
  }

  if (match.cancel_reason === "setup_cancelled") {
    if (match.cancelled_by_user_id === userId) {
      return null;
    }

    return { matchId: match.id, reason: "partner_setup_cancelled" };
  }

  return null;
}

export function getMatchExpiresAt(createdAt: string, timeoutSeconds: number): string {
  return new Date(new Date(createdAt).getTime() + timeoutSeconds * 1000).toISOString();
}

export function getSecondsUntilExpiry(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}
