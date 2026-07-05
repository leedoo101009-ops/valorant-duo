"use client";

import { useEffect, useState } from "react";

type MatchGuidelinesModalProps = {
  open: boolean;
  isFirstTime: boolean;
  loading: boolean;
  labels: {
    title: string;
    intro: string;
    items: [string, string, string];
    dontShowAgain: string;
    confirm: string;
    confirming: string;
    close: string;
  };
  onConfirm: (hideForOneWeek: boolean) => void;
  onClose: () => void;
};

export default function MatchGuidelinesModal({
  open,
  isFirstTime,
  loading,
  labels,
  onConfirm,
  onClose,
}: MatchGuidelinesModalProps) {
  const [hideForOneWeek, setHideForOneWeek] = useState(false);

  useEffect(() => {
    if (open) {
      setHideForOneWeek(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isFirstTime) {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isFirstTime, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-guidelines-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-[#ff4655]/40 bg-[#0a0a0a] p-6 shadow-2xl">
        <p
          id="match-guidelines-title"
          className="font-display text-xs tracking-[0.25em] text-[#ff4655]"
        >
          {labels.title}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[#ccc]">{labels.intro}</p>

        <ul className="mt-5 space-y-4">
          {labels.items.map((item, index) => (
            <li
              key={item}
              className="flex gap-3 border border-[#222] bg-black/40 px-4 py-3 text-sm leading-relaxed text-[#ddd]"
            >
              <span className="font-display shrink-0 text-[#ff4655]">{index + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {!isFirstTime && (
          <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm text-[#888]">
            <input
              type="checkbox"
              checked={hideForOneWeek}
              onChange={(event) => setHideForOneWeek(event.target.checked)}
              className="h-4 w-4 accent-[#ff4655]"
            />
            {labels.dontShowAgain}
          </label>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => onConfirm(isFirstTime ? false : hideForOneWeek)}
            disabled={loading}
            className="btn-accent !py-3 disabled:opacity-50"
          >
            {loading ? labels.confirming : labels.confirm}
          </button>
          {!isFirstTime && (
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-outline !py-3 disabled:opacity-50"
            >
              {labels.close}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
