"use client";

import { useLanguage } from "../context/LanguageContext";
import ScrollReveal from "./ScrollReveal";

export default function CTASection() {
  const { t } = useLanguage();

  return (
    <section className="border-t border-[#222] bg-black py-32 lg:py-48">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <ScrollReveal>
          <div className="accent-line-top relative overflow-hidden bg-[#111] px-8 py-20 lg:px-20 lg:py-28">
            <div className="absolute top-0 right-0 h-full w-1/3 bg-map-grid opacity-30" />

            <div className="relative max-w-3xl">
              <p className="font-display text-xs tracking-[0.3em] text-[#888]">{t.cta.label}</p>
              <h2 className="mt-6 font-display text-[clamp(2.5rem,6vw,5rem)] font-bold uppercase leading-[0.95]">
                {t.cta.titleLine1}
                <br />
                {t.cta.titleLine2}
              </h2>

              <div className="mt-12 flex flex-col gap-4 sm:flex-row">
                <button type="button" className="btn-accent">
                  {t.cta.getStarted}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
                <button type="button" className="btn-outline">
                  {t.cta.learnMore}
                </button>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
