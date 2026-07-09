"use client";

import { GRADE_STYLES } from "@/lib/reputation/scoring";
import type { UserReputation } from "@/lib/reputation/types";

type ReputationBadgeProps = {
  reputation: UserReputation | null;
  labels: {
    newUser: string;
    trustLabel: string;
    gradePrefix: string;
    tags: Record<string, string>;
  };
  compact?: boolean;
};

export default function ReputationBadge({
  reputation,
  labels,
  compact = false,
}: ReputationBadgeProps) {
  if (!reputation) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "mt-3"}`}>
      {reputation.isNewUser ? (
        <span className="inline-flex items-center gap-1 border border-[#555]/60 bg-[#111] px-2 py-1 font-display text-[10px] tracking-widest text-[#aaa]">
          🆕 {labels.newUser}
        </span>
      ) : reputation.mannerGrade ? (
        <span
          className={`inline-flex items-center border px-2 py-1 font-display text-[10px] font-bold tracking-widest ${GRADE_STYLES[reputation.mannerGrade]}`}
        >
          {labels.gradePrefix} {reputation.mannerGrade}
        </span>
      ) : null}

      <span className="font-display text-[10px] tracking-widest text-[#888]">
        {labels.trustLabel} {reputation.trustScore}
      </span>

      {reputation.topTags.slice(0, 2).map((tag) => (
        <span
          key={tag}
          className="border border-[#333] bg-black/40 px-2 py-1 font-display text-[10px] tracking-widest text-[#bbb]"
        >
          {labels.tags[tag] ?? tag}
        </span>
      ))}
    </div>
  );
}
