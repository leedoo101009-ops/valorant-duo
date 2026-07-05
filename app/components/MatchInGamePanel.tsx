"use client";

import type { ActiveMatch } from "../hooks/useMatchQueue";

type MatchInGamePanelProps = {
  activeMatch: ActiveMatch;
  actionLoading: boolean;
  onEndSession: () => void;
  labels: {
    inGameTitle: string;
    connectingPlayers: string;
    inGameStatus: string;
    voiceLabel: string;
    riotIdLabel: string;
    partyCodeLabel: string;
    connected: string;
    waitingPartnerReady: string;
    endSession: string;
    ending: string;
    voiceOptions: Record<"valorant" | "discord" | "none", string>;
  };
};

function playerName(
  player: { riotId: string | null; displayName: string | null },
): string {
  if (player.riotId) return player.riotId;
  if (player.displayName) return player.displayName;
  return "—";
}

export default function MatchInGamePanel({
  activeMatch,
  actionLoading,
  onEndSession,
  labels,
}: MatchInGamePanelProps) {
  const players = [
    { key: "me", label: labels.connected, player: activeMatch.me, voice: activeMatch.myVoicePreference },
    {
      key: "partner",
      label: labels.connected,
      player: activeMatch.partner,
      voice: activeMatch.partnerVoicePreference,
    },
  ] as const;

  return (
    <div className="space-y-5 border border-[#0fbcbf]/40 bg-[#0fbcbf]/10 p-6">
      <div className="space-y-2">
        <p className="font-display text-xs tracking-[0.25em] text-[#0fbcbf]">
          {labels.inGameTitle}
        </p>
        <p className="font-display text-2xl font-bold text-white">{labels.inGameStatus}</p>
        <p className="font-display text-[10px] tracking-widest text-[#888]">
          {labels.connectingPlayers}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {players.map(({ key, player, voice }) => (
          <div key={key} className="space-y-3 border border-[#333] bg-black/50 p-4">
            <div className="flex items-center gap-2">
              <span className="online-dot shrink-0" />
              <p className="font-display text-[10px] tracking-widest text-[#0fbcbf]">
                {labels.connected}
              </p>
            </div>
            <div>
              <p className="font-display text-[10px] tracking-widest text-[#555]">
                {labels.riotIdLabel}
              </p>
              <p className="font-display text-sm font-bold text-white">{playerName(player)}</p>
            </div>
            <div>
              <p className="font-display text-[10px] tracking-widest text-[#555]">
                {labels.voiceLabel}
              </p>
              <p className="font-display text-xs tracking-widest text-[#888]">
                {voice ? labels.voiceOptions[voice] : "—"}
              </p>
            </div>
            {activeMatch.partyCode && (
              <div>
                <p className="font-display text-[10px] tracking-widest text-[#555]">
                  {labels.partyCodeLabel}
                </p>
                <p className="font-mono text-sm font-bold text-[#0fbcbf]">{activeMatch.partyCode}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {!activeMatch.mySetupReady || !activeMatch.partnerSetupReady ? (
        <p className="font-display text-xs tracking-widest text-[#888]">
          {labels.waitingPartnerReady}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onEndSession}
        disabled={actionLoading}
        className="btn-outline !py-3 disabled:opacity-50"
      >
        {actionLoading ? labels.ending : labels.endSession}
      </button>
    </div>
  );
}
