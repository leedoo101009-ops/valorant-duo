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
      className="flex border border-[#333] bg-[#111]"
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
            className={`px-3 py-2 font-display text-[10px] tracking-[0.2em] transition-colors ${
              active
                ? "bg-[#ff4655] text-white"
                : "text-[#888] hover:text-white"
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
