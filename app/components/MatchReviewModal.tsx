"use client";

import { useMemo, useState } from "react";
import {
  NEGATIVE_REVIEW_TAGS,
  POSITIVE_REVIEW_TAGS,
} from "@/lib/reputation/constants";
import type { PendingMatchReview } from "@/lib/reputation/types";

type MatchReviewModalProps = {
  open: boolean;
  pendingReview: PendingMatchReview | null;
  loading: boolean;
  labels: {
    title: string;
    subtitle: string;
    positiveSection: string;
    negativeSection: string;
    submit: string;
    submitting: string;
    skip: string;
    tags: Record<string, string>;
    errors: Record<string, string>;
    submitted: string;
  };
  onSubmit: (input: {
    matchId: string;
    positiveTags: string[];
    negativeTags: string[];
  }) => Promise<{ ok: boolean; errorKey?: string }>;
  onClose: () => void;
};

function partnerName(partner: PendingMatchReview["partner"]): string {
  if (partner.riotId) return partner.riotId;
  if (partner.displayName) return partner.displayName;
  return "—";
}

export default function MatchReviewModal({
  open,
  pendingReview,
  loading,
  labels,
  onSubmit,
  onClose,
}: MatchReviewModalProps) {
  const [positiveTags, setPositiveTags] = useState<string[]>([]);
  const [negativeTags, setNegativeTags] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const canSubmit = useMemo(
    () => positiveTags.length > 0 || negativeTags.length > 0,
    [positiveTags, negativeTags],
  );

  if (!open || !pendingReview) {
    return null;
  }

  function toggleTag(tag: string, kind: "positive" | "negative") {
    setMessage(null);
    setIsError(false);

    if (kind === "positive") {
      setPositiveTags((prev) =>
        prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
      );
      return;
    }

    setNegativeTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  }

  async function handleSubmit() {
    if (!pendingReview) {
      return;
    }

    if (!canSubmit) {
      setIsError(true);
      setMessage(labels.errors.tags_required);
      return;
    }

    const result = await onSubmit({
      matchId: pendingReview.matchId,
      positiveTags,
      negativeTags,
    });

    if (!result.ok) {
      setIsError(true);
      const key = result.errorKey ?? "review_submit_failed";
      setMessage(labels.errors[key] ?? labels.errors.review_submit_failed);
      return;
    }

    setIsError(false);
    setMessage(labels.submitted);
    setPositiveTags([]);
    setNegativeTags([]);
    window.setTimeout(onClose, 700);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-review-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-[#0fbcbf]/40 bg-[#0a0a0a] p-6 shadow-2xl">
        <p className="font-display text-xs tracking-[0.25em] text-[#0fbcbf]">{labels.title}</p>
        <h2 id="match-review-title" className="mt-2 font-display text-2xl font-bold text-white">
          {partnerName(pendingReview.partner)}
        </h2>
        <p className="mt-2 text-sm text-[#888]">{labels.subtitle}</p>

        <div className="mt-6 space-y-5">
          <section>
            <p className="font-display text-[10px] tracking-widest text-[#0fbcbf]">
              {labels.positiveSection}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {POSITIVE_REVIEW_TAGS.map((tag) => {
                const selected = positiveTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag, "positive")}
                    className={`border px-3 py-2 font-display text-[10px] tracking-widest transition-colors ${
                      selected
                        ? "border-[#0fbcbf] bg-[#0fbcbf]/15 text-[#0fbcbf]"
                        : "border-[#333] text-[#888] hover:border-[#555] hover:text-white"
                    }`}
                  >
                    {labels.tags[tag]}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="font-display text-[10px] tracking-widest text-[#ff4655]">
              {labels.negativeSection}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {NEGATIVE_REVIEW_TAGS.map((tag) => {
                const selected = negativeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag, "negative")}
                    className={`border px-3 py-2 font-display text-[10px] tracking-widest transition-colors ${
                      selected
                        ? "border-[#ff4655] bg-[#ff4655]/15 text-[#ff4655]"
                        : "border-[#333] text-[#888] hover:border-[#555] hover:text-white"
                    }`}
                  >
                    {labels.tags[tag]}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {message ? (
          <p className={`mt-4 text-sm ${isError ? "text-[#ff4655]" : "text-[#0fbcbf]"}`}>
            {message}
          </p>
        ) : null}

        <div className="mt-6">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || !canSubmit}
            className="btn-accent w-full disabled:opacity-50"
          >
            {loading ? labels.submitting : labels.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
