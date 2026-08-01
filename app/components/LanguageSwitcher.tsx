"use client";

import { useLanguage } from "../context/LanguageContext";
import type { Locale } from "../i18n/translations";

const options: { value: Locale; label: string }[] = [
  { value: "ko", label: "KO" },
  { value: "en", label: "EN" },
];

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div
      className="inline-flex overflow-hidden rounded-full border border-white/15 bg-white/[0.06] p-0.5"
      role="group"
      aria-label="Language"
    >
      {options.map((option) => {
        const active = locale === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLocale(option.value)}
            className={`rounded-full px-3 py-1.5 font-body text-[11px] font-bold tracking-[0.14em] transition-colors duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              active
                ? "bg-[#FF4655] text-white shadow-[0_4px_14px_rgba(255,70,85,0.35)]"
                : "text-[#8B8894] hover:text-[#F5F5F7]"
            }`}
            aria-pressed={active}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
